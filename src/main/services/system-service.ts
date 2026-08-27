import { resolveMx } from 'node:dns/promises'
import type { ServiceCheck, SystemStatus } from '@shared/types'
import type { AppDatabase } from '../storage/database'

async function timedCheck(id: string, name: string, action: () => Promise<string>): Promise<ServiceCheck> {
  const started = performance.now()
  try {
    const detail = await action()
    return {
      id,
      name,
      status: 'healthy',
      detail,
      latencyMs: Math.round(performance.now() - started)
    }
  } catch (error) {
    return {
      id,
      name,
      status: 'offline',
      detail: error instanceof Error ? error.message : '检查失败',
      latencyMs: Math.round(performance.now() - started)
    }
  }
}

async function fetchStatus(url: string, expected: number[] = [200]): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'follow' })
  if (!expected.includes(response.status)) throw new Error(`HTTP ${response.status}`)
  return response
}

export class SystemService {
  constructor(private readonly database: AppDatabase) {}

  async getStatus(): Promise<SystemStatus> {
    const ingressBase = this.database.getIngressConfiguration()?.baseUrl ?? 'https://mail.onprs.online'
    const checks = await Promise.all([
      timedCheck('jmap', 'JMAP 邮件服务', async () => {
        const response = await fetchStatus('https://mail.onprs.online/.well-known/jmap')
        const session = await response.json() as { capabilities?: Record<string, unknown> }
        const count = Object.keys(session.capabilities ?? {}).length
        return `已连接，声明 ${count} 项能力`
      }),
      timedCheck('ingress', '全域收件网关', async () => {
        const response = await fetchStatus(new URL('/api/email-ingress/health', `${ingressBase}/`).toString())
        const payload = await response.json() as { status?: string }
        return payload.status === 'healthy' ? '网关运行正常' : '网关响应异常'
      }),
      timedCheck('webmail', 'SnappyMail 网页邮箱', async () => {
        await fetchStatus('https://use-mail.onprs.online', [200, 302])
        return '网页邮箱可访问'
      }),
      timedCheck('dns', '域名邮件路由', async () => {
        const records = await resolveMx('onprs.online')
        if (!records.length) throw new Error('未找到 MX 记录')
        return records.sort((a, b) => a.priority - b.priority).map((record) => record.exchange).join('、')
      })
    ])
    return { checkedAt: new Date().toISOString(), checks }
  }
}
