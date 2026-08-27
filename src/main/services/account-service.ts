import { randomUUID } from 'node:crypto'
import type {
  AccountConnectionInput,
  AccountRegistrationInput,
  AccountRegistrationResult,
  AccountSummary,
  RegistrationCredentialStatus,
  RegistrationCredentialUpdate
} from '@shared/types'
import { jmapSessionSchema } from '@shared/schemas'
import { JMAP_CORE, JMAP_MAIL } from '@shared/types'
import { AppError } from '../errors'
import { JmapClient, type JmapSession } from '../jmap/jmap-client'
import type { AppDatabase, StoredAccount } from '../storage/database'
import type { CredentialStore } from '../storage/credential-store'

interface RegistrationResponse {
  email?: string
  error?: string
  code?: string
}

interface AccountServiceOptions {
  registrationServerUrl?: string
}

interface RegistrationRequestInput {
  localPart: string
  password: string
  registrationCode: string
  displayName?: string
}

interface ResolvedRegistrationCredential {
  code: string
  revision: number
  source: 'saved' | 'new'
  rememberNewCode: boolean
  encryptedCandidate: Uint8Array | null
}

const PRODUCTION_MAIL_SERVER_URL = 'https://mail.onprs.online'

function secureOrigin(value: string): URL {
  const url = new URL(value)
  const localDevelopment = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new AppError('INSECURE_SERVER_URL', '邮件服务器必须使用 HTTPS')
  }
  return new URL(url.origin)
}

async function parseRegistrationResponse(response: Response): Promise<RegistrationResponse> {
  try {
    return await response.json() as RegistrationResponse
  } catch {
    return {}
  }
}

async function requestRegistration(input: RegistrationRequestInput, serverUrl: string): Promise<string> {
  const origin = secureOrigin(serverUrl)
  let endpoint = new URL('/api/email-ingress/v2/accounts', origin)

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Registration-Code': input.registrationCode
        },
        body: JSON.stringify({
          local_part: input.localPart,
          password: input.password,
          display_name: input.displayName?.trim() || undefined
        }),
        signal: AbortSignal.timeout(30_000)
      })
    } catch (error) {
      throw new AppError('REGISTRATION_NETWORK_ERROR', '无法连接邮箱注册服务', true, { cause: error })
    }

    if ([307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new AppError('INVALID_REGISTRATION_REDIRECT', '注册服务返回了无效的重定向')
      const next = new URL(location, endpoint)
      const localDevelopment = next.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(next.hostname)
      if (next.origin !== origin.origin || (next.protocol !== 'https:' && !localDevelopment)) {
        throw new AppError('CROSS_ORIGIN_REGISTRATION_REDIRECT', '注册服务尝试将注册码发送到其他站点')
      }
      endpoint = next
      continue
    }

    const payload = await parseRegistrationResponse(response)
    if (response.status === 201) {
      const expectedEmail = `${input.localPart}@onprs.online`
      if (payload.email?.trim().toLowerCase() === expectedEmail) return expectedEmail
      throw new AppError('INVALID_REGISTRATION_RESPONSE', '注册服务返回了无效的邮箱地址')
    }
    if (response.ok) {
      throw new AppError('INVALID_REGISTRATION_RESPONSE', '注册服务返回了无效的成功状态')
    }
    if (response.status === 401 && payload.code === 'registration_code_invalid') {
      throw new AppError('REGISTRATION_CODE_INVALID', '注册码无效')
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError('REGISTRATION_AUTHORIZATION_FAILED', '注册请求未获授权，请确认注册码后重试')
    }
    if (response.status === 409) throw new AppError('ACCOUNT_NAME_UNAVAILABLE', '这个邮箱地址已被使用')
    if (response.status === 422) throw new AppError('REGISTRATION_REJECTED', payload.error || '邮箱名或密码不符合服务器要求')
    if (response.status === 429) throw new AppError('REGISTRATION_RATE_LIMITED', '创建请求过于频繁，请稍后再试', true)
    if (response.status === 503) {
      if (payload.code === 'registration_commit_unknown') {
        throw new AppError('REGISTRATION_COMMIT_UNKNOWN', '邮箱创建结果尚未确认，正在尝试恢复', true)
      }
      if (payload.code === 'registration_not_configured') {
        throw new AppError('REGISTRATION_UNAVAILABLE', '邮箱注册服务尚未配置')
      }
      throw new AppError('REGISTRATION_TEMPORARILY_UNAVAILABLE', '邮箱注册服务暂时不可用，请稍后再试', true)
    }
    throw new AppError('REGISTRATION_FAILED', payload.error || `邮箱创建失败（HTTP ${response.status}）`, response.status >= 500)
  }

  throw new AppError('TOO_MANY_REGISTRATION_REDIRECTS', '注册服务重定向次数过多')
}

export class AccountService {
  private readonly memorySecrets = new Map<string, string>()
  private readonly clients = new Map<string, JmapClient>()
  private readonly authenticationFailures = new Set<string>()
  private readonly registrationServerUrl: string
  private registrationInProgress = false

  constructor(
    private readonly database: AppDatabase,
    private readonly credentials: CredentialStore,
    options: AccountServiceOptions = {}
  ) {
    this.registrationServerUrl = secureOrigin(options.registrationServerUrl ?? PRODUCTION_MAIL_SERVER_URL).origin
  }

  listAccounts(): AccountSummary[] {
    return this.database.listAccounts().map((account) => this.toSummary(account))
  }

  getRegistrationCredentialStatus(): RegistrationCredentialStatus {
    const credential = this.database.getRegistrationCredential()
    if (!credential.encryptedCode) return { hasSavedRegistrationCode: false }
    this.decryptRegistrationCode(credential.encryptedCode)
    return { hasSavedRegistrationCode: true }
  }

  forgetRegistrationCredential(): void {
    this.database.forgetRegistrationCredential()
  }

  async register(input: AccountRegistrationInput): Promise<AccountRegistrationResult> {
    if (this.registrationInProgress) {
      throw new AppError('REGISTRATION_IN_PROGRESS', '已有邮箱创建请求正在处理，请稍候')
    }
    this.registrationInProgress = true
    try {
      return await this.performRegistration(input)
    } finally {
      this.registrationInProgress = false
    }
  }

  private async performRegistration(input: AccountRegistrationInput): Promise<AccountRegistrationResult> {
    const credential = this.resolveRegistrationCredential(input)
    const expectedEmail = `${input.localPart}@onprs.online`
    let email: string
    try {
      email = await requestRegistration({
        localPart: input.localPart,
        password: input.password,
        registrationCode: credential.code,
        displayName: input.displayName
      }, this.registrationServerUrl)
    } catch (error) {
      if (error instanceof AppError && error.code === 'REGISTRATION_CODE_INVALID' && credential.source === 'saved') {
        try {
          this.database.replaceRegistrationCredential(credential.revision, null)
        } catch {
          // 保留原始服务端错误；后续状态读取仍会暴露本地存储故障。
        }
      }
      const recoverableCodes = new Set([
        'REGISTRATION_NETWORK_ERROR',
        'REGISTRATION_COMMIT_UNKNOWN',
        'INVALID_REGISTRATION_RESPONSE',
        'ACCOUNT_NAME_UNAVAILABLE'
      ])
      if (error instanceof AppError && recoverableCodes.has(error.code)) {
        try {
          const account = await this.connectRegistrationAccount(input, expectedEmail)
          return {
            account,
            registrationCredentialUpdate: credential.source === 'new' && credential.rememberNewCode
              ? 'unconfirmed'
              : 'unchanged'
          }
        } catch {
          // 恢复登录失败时保留原始注册错误，避免把既有他人账号误报为创建成功。
        }
      }
      throw error
    }

    const registrationCredentialUpdate = this.commitRegistrationCredential(credential)
    try {
      const account = await this.connectRegistrationAccount(input, email)
      return { account, registrationCredentialUpdate }
    } catch (error) {
      throw new AppError(
        'ACCOUNT_CREATED_LOGIN_FAILED',
        `邮箱 ${email} 已创建，但自动登录失败，请返回登录页重试`,
        true,
        { cause: error }
      )
    }
  }

  private resolveRegistrationCredential(input: AccountRegistrationInput): ResolvedRegistrationCredential {
    const stored = this.database.getRegistrationCredential()
    if (input.registrationCredential.source === 'saved') {
      if (!stored.encryptedCode) {
        throw new AppError('REGISTRATION_CODE_REQUIRED', '请先输入注册码')
      }
      return {
        code: this.decryptRegistrationCode(stored.encryptedCode),
        revision: stored.revision,
        source: 'saved',
        rememberNewCode: false,
        encryptedCandidate: null
      }
    }

    const code = input.registrationCredential.registrationCode
    return {
      code,
      revision: stored.revision,
      source: 'new',
      rememberNewCode: input.registrationCredential.remember,
      encryptedCandidate: input.registrationCredential.remember ? this.credentials.encrypt(code) : null
    }
  }

  private decryptRegistrationCode(encryptedCode: Uint8Array): string {
    let code: string
    try {
      code = this.credentials.decrypt(encryptedCode)
    } catch (error) {
      throw new AppError(
        'REGISTRATION_CREDENTIAL_UNAVAILABLE',
        '已保存的注册码无法读取，请重试或忘记后重新输入',
        false,
        { cause: error }
      )
    }
    if (code.length < 32 || code.length > 4096) {
      throw new AppError('REGISTRATION_CREDENTIAL_INVALID', '已保存的注册码数据无效，请忘记后重新输入')
    }
    return code
  }

  private commitRegistrationCredential(credential: ResolvedRegistrationCredential): RegistrationCredentialUpdate {
    if (credential.source === 'saved') return 'unchanged'
    try {
      const replacement = credential.rememberNewCode ? credential.encryptedCandidate : null
      const committed = this.database.replaceRegistrationCredential(credential.revision, replacement)
      if (!committed) return 'unchanged'
      return credential.rememberNewCode ? 'saved' : 'cleared'
    } catch {
      return 'failed'
    }
  }

  private connectRegistrationAccount(input: AccountRegistrationInput, email: string): Promise<AccountSummary> {
    return this.connect({
      email,
      password: input.password,
      serverUrl: this.registrationServerUrl,
      displayName: input.displayName,
      remember: input.remember
    })
  }

  async connect(input: AccountConnectionInput): Promise<AccountSummary> {
    const client = await JmapClient.connect(input.serverUrl, input.email, input.password)

    await client.call(
      [JMAP_CORE, JMAP_MAIL],
      'Mailbox/get',
      {
        accountId: client.accountId,
        ids: null,
        properties: ['id']
      },
      'verify'
    )

    const existing = this.database.listAccounts().find((account) => account.email.toLowerCase() === input.email.toLowerCase())
    const now = new Date().toISOString()
    const accountId = existing?.id ?? randomUUID()
    const accountName = client.session.accounts[client.accountId]?.name
    const stored: StoredAccount = {
      id: accountId,
      email: input.email.toLowerCase(),
      displayName: input.displayName?.trim() || accountName || input.email.split('@')[0] || input.email,
      serverUrl: new URL(input.serverUrl).origin,
      jmapAccountId: client.accountId,
      capabilities: Object.keys(client.session.accounts[client.accountId]?.accountCapabilities ?? {}),
      createdAt: existing?.createdAt ?? now,
      lastConnectedAt: now,
      requiresAuthentication: !input.remember,
      encryptedSecret: input.remember ? this.credentials.encrypt(input.password) : null,
      sessionJson: JSON.stringify(client.session)
    }

    this.database.saveAccount(stored)
    this.memorySecrets.set(accountId, input.password)
    this.authenticationFailures.delete(accountId)
    this.clients.set(accountId, JmapClient.fromSession(
      client.session,
      client.accountId,
      stored.email,
      input.password,
      () => this.markAuthenticationRequired(accountId)
    ))
    return this.toSummary(stored)
  }

  remove(accountId: string): void {
    this.clients.delete(accountId)
    this.memorySecrets.delete(accountId)
    this.authenticationFailures.delete(accountId)
    this.database.removeAccount(accountId)
  }

  getStoredAccount(accountId: string): StoredAccount {
    const account = this.database.getAccount(accountId)
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', '找不到指定邮箱账号')
    }
    return account
  }

  getPendingSubmissionEmailId(accountId: string): string | null {
    this.getStoredAccount(accountId)
    return this.database.getPendingSubmissionEmailId(accountId)
  }

  savePendingSubmission(accountId: string, emailId: string): void {
    this.getStoredAccount(accountId)
    this.database.savePendingSubmission(accountId, emailId)
  }

  clearPendingSubmission(accountId: string): void {
    this.database.clearPendingSubmission(accountId)
  }

  getClient(accountId: string): JmapClient {
    if (this.authenticationFailures.has(accountId)) {
      throw new AppError('AUTHENTICATION_REQUIRED', '账号认证已失效，请重新登录')
    }
    const cached = this.clients.get(accountId)
    if (cached) return cached

    const account = this.getStoredAccount(accountId)
    let secret = this.memorySecrets.get(accountId)
    if (!secret && account.encryptedSecret) {
      secret = this.credentials.decrypt(account.encryptedSecret)
    }
    if (!secret) {
      throw new AppError('AUTHENTICATION_REQUIRED', '请重新登录该邮箱账号')
    }

    let session: JmapSession
    try {
      const parsed = jmapSessionSchema.safeParse(JSON.parse(account.sessionJson))
      if (!parsed.success) throw new TypeError('JMAP Session 校验失败')
      session = parsed.data as JmapSession
    } catch (error) {
      this.markAuthenticationRequired(accountId)
      throw new AppError('AUTHENTICATION_REQUIRED', '账号会话数据已损坏，请重新登录', false, { cause: error })
    }

    const client = JmapClient.fromSession(
      session,
      account.jmapAccountId,
      account.email,
      secret,
      () => this.markAuthenticationRequired(accountId)
    )
    this.clients.set(accountId, client)
    return client
  }

  private markAuthenticationRequired(accountId: string): void {
    this.clients.delete(accountId)
    this.authenticationFailures.add(accountId)
  }

  private toSummary(account: StoredAccount): AccountSummary {
    let requiresAuthentication = this.authenticationFailures.has(account.id) || !this.memorySecrets.has(account.id)
    if (requiresAuthentication && !this.authenticationFailures.has(account.id) && account.encryptedSecret) {
      try {
        this.credentials.decrypt(account.encryptedSecret)
        requiresAuthentication = false
      } catch {
        requiresAuthentication = true
      }
    }
    return {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      serverUrl: account.serverUrl,
      jmapAccountId: account.jmapAccountId,
      capabilities: account.capabilities,
      createdAt: account.createdAt,
      lastConnectedAt: account.lastConnectedAt,
      requiresAuthentication,
      pendingSubmissionEmailId: this.database.getPendingSubmissionEmailId(account.id) ?? undefined
    }
  }
}
