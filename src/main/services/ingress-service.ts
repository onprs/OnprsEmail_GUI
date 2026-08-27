import { writeFile } from 'node:fs/promises'
import { dialog } from 'electron'
import type {
  IngressAttachmentSaveInput,
  IngressConfiguration,
  IngressConfigurationInput,
  IngressMessageDetail,
  IngressMessageSummary,
  IngressPage,
  IngressPageInput,
  IngressRecipient
} from '@shared/types'
import { AppError } from '../errors'
import { sanitizeMailHtml } from '../security/mail-html'
import type { AppDatabase } from '../storage/database'
import type { CredentialStore } from '../storage/credential-store'

interface V1Message {
  id?: number
  message_id?: string
  from?: string
  to?: string
  subject?: string
  body_text?: string
  body_html?: string
  links?: string[]
  otp_code?: string
  created_at?: number
}

interface V2Message extends V1Message {
  preview?: string
  is_read?: boolean
  has_html?: boolean
  attachments?: Array<{ part?: string; name?: string; type?: string; size?: number }>
}

interface V2ListResponse {
  data?: V2Message[]
  items?: V2Message[]
  next_cursor?: number | null
  recipients?: Array<{ address?: string; count?: number; latest_at?: number }>
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value)
  const localDevelopment = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new AppError('INSECURE_INGRESS_URL', '全域收件服务必须使用 HTTPS')
  }
  let path = url.pathname.replace(/\/+$/, '')
  if (path.endsWith('/api/email-ingress')) path = path.slice(0, -'/api/email-ingress'.length)
  return `${url.origin}${path}`.replace(/\/+$/, '')
}

function secureIngressUrl(value: string | URL): URL {
  const url = value instanceof URL ? value : new URL(value)
  const localDevelopment = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new AppError('INSECURE_INGRESS_URL', '全域收件服务返回了不安全的接口地址')
  }
  return url
}

export async function fetchIngress(
  baseUrl: string,
  secret: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  let currentUrl = secureIngressUrl(new URL(path, `${baseUrl}/`))
  const allowedOrigin = currentUrl.origin
  const method = (init.method ?? 'GET').toUpperCase()

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        'X-Ingress-Secret': secret,
        ...init.headers
      },
      signal: AbortSignal.timeout(20_000)
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    if (!location) throw new AppError('INVALID_INGRESS_REDIRECT', '全域收件服务返回了无效的重定向')
    const nextUrl = secureIngressUrl(new URL(location, currentUrl))
    if (nextUrl.origin !== allowedOrigin) {
      throw new AppError('CROSS_ORIGIN_INGRESS_REDIRECT', '全域收件服务尝试将令牌重定向到其他站点')
    }
    if (method !== 'GET' && method !== 'HEAD' && response.status !== 307 && response.status !== 308) {
      throw new AppError('UNSAFE_INGRESS_REDIRECT', '全域收件服务返回了不安全的写请求重定向')
    }
    currentUrl = nextUrl
  }
  throw new AppError('TOO_MANY_INGRESS_REDIRECTS', '全域收件服务重定向次数过多')
}

function mapSummary(message: V2Message): IngressMessageSummary {
  const body = message.body_text ?? ''
  const preview = message.preview || body.replace(/\s+/g, ' ').trim().slice(0, 180)
  return {
    id: Number(message.id ?? 0),
    messageId: message.message_id ?? '',
    from: message.from ?? '',
    to: message.to ?? '',
    subject: message.subject?.trim() || '（无主题）',
    preview,
    otpCode: message.otp_code ?? '',
    hasHtml: message.has_html ?? Boolean(message.body_html),
    createdAt: Number(message.created_at ?? 0),
    isRead: Boolean(message.is_read)
  }
}

function mapDetail(message: V2Message): IngressMessageDetail {
  return {
    ...mapSummary(message),
    bodyText: message.body_text ?? '',
    bodyHtml: sanitizeMailHtml(message.body_html ?? ''),
    links: Array.isArray(message.links) ? message.links.filter((link) => typeof link === 'string') : [],
    attachments: (message.attachments ?? []).map((attachment, index) => ({
      part: attachment.part ?? String(index),
      name: attachment.name || '附件',
      type: attachment.type || 'application/octet-stream',
      size: Number(attachment.size ?? 0)
    }))
  }
}

export class IngressService {
  private readonly v1Details = new Map<number, IngressMessageDetail>()

  constructor(
    private readonly database: AppDatabase,
    private readonly credentials: CredentialStore
  ) {}

  getConfiguration(): IngressConfiguration {
    const configuration = this.database.getIngressConfiguration()
    return configuration
      ? { configured: true, baseUrl: configuration.baseUrl, apiVersion: configuration.apiVersion }
      : { configured: false, baseUrl: 'https://mail.onprs.online', apiVersion: 1 }
  }

  async configure(input: IngressConfigurationInput): Promise<IngressConfiguration> {
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    let apiVersion: 1 | 2 = 2
    let response = await this.request(baseUrl, input.secret, '/api/email-ingress/v2/messages?limit=1')
    if (response.status === 404) {
      apiVersion = 1
      response = await this.request(baseUrl, input.secret, '/api/email-ingress/messages?limit=1')
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError('INGRESS_AUTHENTICATION_FAILED', '全域收件令牌不正确')
    }
    if (!response.ok) {
      throw new AppError('INGRESS_CONNECTION_FAILED', `无法连接全域收件服务（HTTP ${response.status}）`, true)
    }
    this.database.saveIngressConfiguration({
      configured: true,
      baseUrl,
      apiVersion,
      encryptedSecret: this.credentials.encrypt(input.secret)
    })
    return { configured: true, baseUrl, apiVersion }
  }

  clearConfiguration(): void {
    this.v1Details.clear()
    this.database.clearIngressConfiguration()
  }

  async listMessages(input: IngressPageInput): Promise<IngressPage> {
    const configuration = this.requireConfiguration()
    const secret = this.credentials.decrypt(configuration.encryptedSecret)
    if (configuration.apiVersion === 2) {
      const query = new URLSearchParams({ limit: String(input.limit) })
      if (input.recipient) query.set('to', input.recipient)
      if (input.search) query.set('q', input.search)
      if (input.cursor) query.set('cursor', String(input.cursor))
      const response = await this.request(configuration.baseUrl, secret, `/api/email-ingress/v2/messages?${query}`)
      if (!response.ok) throw this.responseError(response)
      const payload = (await response.json()) as V2ListResponse
      const items = (payload.items ?? payload.data ?? []).map(mapSummary)
      const recipients = (payload.recipients ?? [])
        .map((recipient) => ({
          address: recipient.address ?? '',
          count: Number(recipient.count ?? 0),
          latestAt: Number(recipient.latest_at ?? 0)
        }))
        .filter((recipient) => recipient.address)
      return { items, recipients, nextCursor: payload.next_cursor ?? null, apiVersion: 2 }
    }

    const query = new URLSearchParams({ limit: String(Math.min(input.limit, 100)) })
    if (input.recipient) query.set('to', input.recipient)
    const response = await this.request(configuration.baseUrl, secret, `/api/email-ingress/messages?${query}`)
    if (!response.ok) throw this.responseError(response)
    const payload = (await response.json()) as { data?: V1Message[] }
    let details = (payload.data ?? []).map(mapDetail)
    if (input.search) {
      const search = input.search.toLocaleLowerCase()
      details = details.filter((message) =>
        `${message.from} ${message.to} ${message.subject} ${message.bodyText}`.toLocaleLowerCase().includes(search)
      )
    }
    details.forEach((detail) => this.v1Details.set(detail.id, detail))
    const recipients = this.aggregateRecipients(details)
    return {
      items: details.map(
        ({ bodyText: _bodyText, bodyHtml: _bodyHtml, links: _links, attachments: _attachments, ...summary }) => summary
      ),
      recipients,
      nextCursor: null,
      apiVersion: 1
    }
  }

  async getMessage(id: number): Promise<IngressMessageDetail> {
    const configuration = this.requireConfiguration()
    const secret = this.credentials.decrypt(configuration.encryptedSecret)
    if (configuration.apiVersion === 2) {
      const response = await this.request(configuration.baseUrl, secret, `/api/email-ingress/v2/messages/${id}`)
      if (!response.ok) throw this.responseError(response)
      const payload = (await response.json()) as { data?: V2Message } & V2Message
      return mapDetail(payload.data ?? payload)
    }
    const cached = this.v1Details.get(id)
    if (cached) return cached
    await this.listMessages({ limit: 100 })
    const loaded = this.v1Details.get(id)
    if (!loaded) throw new AppError('INGRESS_MESSAGE_NOT_FOUND', '这封全域收件邮件已不存在')
    return loaded
  }

  async deleteMessage(id: number): Promise<void> {
    const configuration = this.requireConfiguration()
    if (configuration.apiVersion !== 2) {
      throw new AppError('INGRESS_UPGRADE_REQUIRED', '当前服务端仅支持按收件地址清理，请先升级 Ingress v2')
    }
    const secret = this.credentials.decrypt(configuration.encryptedSecret)
    const response = await this.request(configuration.baseUrl, secret, `/api/email-ingress/v2/messages/${id}`, {
      method: 'DELETE'
    })
    if (!response.ok) throw this.responseError(response)
  }

  async deleteRecipient(recipient: string): Promise<void> {
    const configuration = this.requireConfiguration()
    const secret = this.credentials.decrypt(configuration.encryptedSecret)
    const prefix = configuration.apiVersion === 2 ? '/api/email-ingress/v2/messages' : '/api/email-ingress/messages'
    const response = await this.request(
      configuration.baseUrl,
      secret,
      `${prefix}?to=${encodeURIComponent(recipient)}`,
      { method: 'DELETE' }
    )
    if (!response.ok) throw this.responseError(response)
  }

  async saveAttachment(input: IngressAttachmentSaveInput): Promise<boolean> {
    const configuration = this.requireV2Configuration()
    const secret = this.credentials.decrypt(configuration.encryptedSecret)
    const response = await this.request(
      configuration.baseUrl,
      secret,
      `/api/email-ingress/v2/messages/${input.messageId}/attachments/${encodeURIComponent(input.part)}`,
      { headers: { Accept: input.type } }
    )
    if (!response.ok) throw this.responseError(response)
    const result = await dialog.showSaveDialog({ title: '保存附件', defaultPath: input.name })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, Buffer.from(await response.arrayBuffer()))
    return true
  }

  async saveRaw(messageId: number, subject: string): Promise<boolean> {
    const configuration = this.requireV2Configuration()
    const secret = this.credentials.decrypt(configuration.encryptedSecret)
    const response = await this.request(
      configuration.baseUrl,
      secret,
      `/api/email-ingress/v2/messages/${messageId}/raw`,
      {
        headers: { Accept: 'message/rfc822' }
      }
    )
    if (!response.ok) throw this.responseError(response)
    const safeSubject = subject.replace(/[\p{Cc}<>:"/\\|?*]/gu, '_').slice(0, 100) || `message-${messageId}`
    const result = await dialog.showSaveDialog({ title: '保存原始邮件', defaultPath: `${safeSubject}.eml` })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, Buffer.from(await response.arrayBuffer()))
    return true
  }

  private requireV2Configuration() {
    const configuration = this.requireConfiguration()
    if (configuration.apiVersion !== 2) {
      throw new AppError('INGRESS_UPGRADE_REQUIRED', '当前服务端不支持此操作，请先升级 Ingress v2')
    }
    return configuration
  }

  private requireConfiguration() {
    const configuration = this.database.getIngressConfiguration()
    if (!configuration) throw new AppError('INGRESS_NOT_CONFIGURED', '请先配置全域收件服务')
    return configuration
  }

  private async request(baseUrl: string, secret: string, path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetchIngress(baseUrl, secret, path, init)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INGRESS_NETWORK_ERROR', '连接全域收件服务失败', true, { cause: error })
    }
  }

  private responseError(response: Response): AppError {
    if (response.status === 401 || response.status === 403)
      return new AppError('INGRESS_AUTHENTICATION_FAILED', '全域收件认证已失效')
    if (response.status === 404) return new AppError('INGRESS_NOT_FOUND', '全域收件数据不存在')
    return new AppError('INGRESS_HTTP_ERROR', `全域收件请求失败（HTTP ${response.status}）`, response.status >= 500)
  }

  private aggregateRecipients(messages: IngressMessageDetail[]): IngressRecipient[] {
    const recipients = new Map<string, IngressRecipient>()
    for (const message of messages) {
      const current = recipients.get(message.to)
      recipients.set(message.to, {
        address: message.to,
        count: (current?.count ?? 0) + 1,
        latestAt: Math.max(current?.latestAt ?? 0, message.createdAt)
      })
    }
    return [...recipients.values()].sort((a, b) => b.latestAt - a.latestAt)
  }
}
