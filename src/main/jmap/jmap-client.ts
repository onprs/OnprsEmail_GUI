import { jmapResponseSchema, jmapSessionSchema } from '@shared/schemas'
import type { UploadedAttachment } from '@shared/types'
import { AppError } from '../errors'

export type JmapMethodCall = [name: string, arguments_: Record<string, unknown>, callId: string]
export type JmapMethodResponse = [name: string, arguments_: unknown, callId: string]

export interface JmapSession {
  capabilities: Record<string, unknown>
  accounts: Record<
    string,
    {
      name?: string
      isPersonal?: boolean
      isReadOnly?: boolean
      accountCapabilities?: Record<string, unknown>
    }
  >
  primaryAccounts: Record<string, string>
  username: string
  apiUrl: string
  downloadUrl: string
  uploadUrl: string
  eventSourceUrl?: string
  state: string
}

interface RequestOptions {
  timeoutMs?: number
}

function normalizedOrigin(value: string): string {
  const url = new URL(value)
  const localDevelopment = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new AppError('INSECURE_SERVER_URL', '邮件服务器必须使用 HTTPS')
  }
  return url.origin
}

function authorization(email: string, secret: string): string {
  return `Basic ${Buffer.from(`${email}:${secret}`, 'utf8').toString('base64')}`
}

function secureEndpoint(value: string | URL): URL {
  const url = value instanceof URL ? value : new URL(value)
  const localDevelopment = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new AppError('INSECURE_JMAP_ENDPOINT', '邮件服务器返回了不安全的接口地址')
  }
  return url
}

async function safeFetch(value: string | URL, init: RequestInit): Promise<Response> {
  let currentUrl = secureEndpoint(value)
  const allowedOrigin = currentUrl.origin
  const method = (init.method ?? 'GET').toUpperCase()

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(currentUrl, { ...init, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    if (!location) throw new AppError('INVALID_REDIRECT', '邮件服务器返回了无效的重定向')
    const nextUrl = secureEndpoint(new URL(location, currentUrl))
    if (nextUrl.origin !== allowedOrigin) {
      throw new AppError('CROSS_ORIGIN_REDIRECT', '邮件服务器尝试将凭据重定向到其他站点')
    }
    if (method !== 'GET' && method !== 'HEAD' && response.status !== 307 && response.status !== 308) {
      throw new AppError('UNSAFE_METHOD_REDIRECT', '邮件服务器返回了不安全的写请求重定向')
    }
    currentUrl = nextUrl
  }
  throw new AppError('TOO_MANY_REDIRECTS', '邮件服务器重定向次数过多')
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new AppError('INVALID_SERVER_RESPONSE', '服务器返回了无法解析的数据', true, { cause: error })
  }
}

export class JmapClient {
  readonly session: JmapSession
  readonly accountId: string
  private readonly authHeader: string
  private readonly onAuthenticationRequired?: () => void

  private constructor(
    session: JmapSession,
    accountId: string,
    authHeader: string,
    onAuthenticationRequired?: () => void
  ) {
    this.session = session
    this.accountId = accountId
    this.authHeader = authHeader
    this.onAuthenticationRequired = onAuthenticationRequired
  }

  static async connect(serverUrl: string, email: string, secret: string): Promise<JmapClient> {
    const origin = normalizedOrigin(serverUrl)
    const authHeader = authorization(email, secret)
    const sessionUrl = new URL('/.well-known/jmap', origin)
    let response: Response
    try {
      response = await safeFetch(sessionUrl, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000)
      })
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('JMAP_DISCOVERY_FAILED', '无法连接邮件服务', true, { cause: error })
    }

    if (response.status === 401 || response.status === 403) {
      throw new AppError('AUTHENTICATION_FAILED', '邮箱账号或密码不正确')
    }
    if (!response.ok) {
      throw new AppError('JMAP_DISCOVERY_FAILED', `无法连接邮件服务（HTTP ${response.status}）`, true)
    }

    const parsed = jmapSessionSchema.safeParse(await parseJson(response))
    if (!parsed.success) {
      throw new AppError('INVALID_JMAP_SESSION', '邮件服务的 JMAP Session 数据不完整')
    }

    const session = parsed.data as JmapSession
    secureEndpoint(session.apiUrl)
    const mailCapability = 'urn:ietf:params:jmap:mail'
    const accountId =
      session.primaryAccounts[mailCapability] ??
      Object.entries(session.accounts).find(([, account]) =>
        Boolean(account.accountCapabilities?.[mailCapability])
      )?.[0]

    if (!accountId) {
      throw new AppError('MAIL_ACCOUNT_UNAVAILABLE', '该账号没有可用的 JMAP 邮件权限')
    }

    return new JmapClient(session, accountId, authHeader)
  }

  static fromSession(
    session: JmapSession,
    accountId: string,
    email: string,
    secret: string,
    onAuthenticationRequired?: () => void
  ): JmapClient {
    return new JmapClient(session, accountId, authorization(email, secret), onAuthenticationRequired)
  }

  supports(capability: string): boolean {
    return Boolean(this.session.accounts[this.accountId]?.accountCapabilities?.[capability])
  }

  async call<T>(
    using: string[],
    name: string,
    arguments_: Record<string, unknown>,
    callId = 'c1',
    options: RequestOptions = {}
  ): Promise<T> {
    const responses = await this.callMany(using, [[name, arguments_, callId]], options)
    const response = responses.find((item) => item[2] === callId)
    if (!response) {
      throw new AppError('JMAP_MISSING_RESPONSE', `服务器未返回 ${name} 的结果`, true)
    }
    if (response[0] === 'error') {
      const details = response[1] as { type?: string; description?: string }
      throw new AppError(
        `JMAP_${(details.type ?? 'METHOD_ERROR').toUpperCase()}`,
        details.description ?? `${name} 执行失败`,
        details.type === 'serverFail'
      )
    }
    if (response[0] !== name) {
      throw new AppError('JMAP_UNEXPECTED_RESPONSE', `服务器返回了意外的 ${response[0]} 响应`, true)
    }
    return response[1] as T
  }

  async callMany(
    using: string[],
    methodCalls: JmapMethodCall[],
    options: RequestOptions = {}
  ): Promise<JmapMethodResponse[]> {
    const apiUrl = new URL(this.session.apiUrl)
    if (
      apiUrl.protocol !== 'https:' &&
      !(apiUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(apiUrl.hostname))
    ) {
      throw new AppError('INSECURE_API_URL', 'JMAP API 地址不是安全连接')
    }

    let response: Response
    try {
      response = await safeFetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ using: [...new Set(using)], methodCalls }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
      })
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('NETWORK_ERROR', '连接邮件服务器失败，请检查网络后重试', true, { cause: error })
    }

    if (response.status === 401 || response.status === 403) {
      this.onAuthenticationRequired?.()
      throw new AppError('AUTHENTICATION_REQUIRED', '账号认证已失效，请重新登录')
    }
    if (!response.ok) {
      throw new AppError('JMAP_HTTP_ERROR', `邮件服务器请求失败（HTTP ${response.status}）`, response.status >= 500)
    }

    const parsed = jmapResponseSchema.safeParse(await parseJson(response))
    if (!parsed.success) {
      throw new AppError('INVALID_JMAP_RESPONSE', '邮件服务器返回的数据格式不受支持', true)
    }
    return parsed.data.methodResponses as JmapMethodResponse[]
  }

  async upload(data: Uint8Array, name: string, type: string): Promise<UploadedAttachment> {
    const url = this.resolveTemplate(this.session.uploadUrl, {
      accountId: this.accountId
    })
    const response = await safeFetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': type,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
      },
      body: data as BodyInit,
      signal: AbortSignal.timeout(60_000)
    })
    if (response.status === 401 || response.status === 403) {
      this.onAuthenticationRequired?.()
      throw new AppError('AUTHENTICATION_REQUIRED', '账号认证已失效，请重新登录')
    }
    if (!response.ok) {
      throw new AppError('ATTACHMENT_UPLOAD_FAILED', `附件 ${name} 上传失败`, response.status >= 500)
    }
    const result = (await parseJson(response)) as { blobId?: string; type?: string; size?: number }
    if (!result?.blobId) {
      throw new AppError('ATTACHMENT_UPLOAD_INVALID', '附件上传结果不完整')
    }
    return {
      blobId: result.blobId,
      name,
      type: result.type ?? type,
      size: result.size ?? data.byteLength
    }
  }

  async download(blobId: string, name: string, type: string): Promise<Buffer> {
    const url = this.resolveTemplate(this.session.downloadUrl, {
      accountId: this.accountId,
      blobId,
      name,
      type
    })
    const response = await safeFetch(url, {
      headers: { Authorization: this.authHeader, Accept: type },
      signal: AbortSignal.timeout(60_000)
    })
    if (response.status === 401 || response.status === 403) {
      this.onAuthenticationRequired?.()
      throw new AppError('AUTHENTICATION_REQUIRED', '账号认证已失效，请重新登录')
    }
    if (!response.ok) {
      throw new AppError('ATTACHMENT_DOWNLOAD_FAILED', `附件 ${name} 下载失败`, response.status >= 500)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  private resolveTemplate(template: string, values: Record<string, string>): URL {
    let resolved = template
    for (const [key, value] of Object.entries(values)) {
      resolved = resolved.replaceAll(`{${key}}`, encodeURIComponent(value))
      resolved = resolved.replaceAll(`{${key}:*}`, encodeURIComponent(value))
    }
    return secureEndpoint(resolved)
  }
}
