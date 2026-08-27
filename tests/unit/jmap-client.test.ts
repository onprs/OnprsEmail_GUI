import { afterEach, describe, expect, it, vi } from 'vitest'
import { JmapClient } from '@main/jmap/jmap-client'

const session = {
  capabilities: {
    'urn:ietf:params:jmap:core': {},
    'urn:ietf:params:jmap:mail': {}
  },
  accounts: {
    account1: {
      name: '测试账号',
      accountCapabilities: { 'urn:ietf:params:jmap:mail': {} }
    }
  },
  primaryAccounts: { 'urn:ietf:params:jmap:mail': 'account1' },
  username: 'user@onprs.online',
  apiUrl: 'https://mail.onprs.online/jmap/',
  downloadUrl: 'https://mail.onprs.online/jmap/download/{accountId}/{blobId}/{name}?accept={type}',
  uploadUrl: 'https://mail.onprs.online/jmap/upload/{accountId}/',
  state: '1'
}

afterEach(() => vi.unstubAllGlobals())

describe('JMAP 客户端', () => {
  it('发现账号并完成方法调用', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            methodResponses: [['Mailbox/get', { accountId: 'account1', state: '2', list: [] }, 'c1']],
            sessionState: '1'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const client = await JmapClient.connect('https://mail.onprs.online', 'user@onprs.online', 'secret')
    expect(client.accountId).toBe('account1')
    const result = await client.call<{ state: string }>(
      ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
      'Mailbox/get',
      { accountId: 'account1' }
    )
    expect(result.state).toBe('2')
    const request = fetchMock.mock.calls[1]?.[1]
    expect(String((request?.headers as Record<string, string>).Authorization)).toMatch(/^Basic /)
  })

  it('拒绝将凭据发送到不安全的上传端点', async () => {
    const client = JmapClient.fromSession(
      { ...session, uploadUrl: 'http://attacker.example/upload/{accountId}' },
      'account1',
      'user@onprs.online',
      'secret'
    )
    await expect(client.upload(new Uint8Array([1, 2, 3]), 'a.txt', 'text/plain')).rejects.toMatchObject({
      code: 'INSECURE_JMAP_ENDPOINT'
    })
  })

  it('拒绝携带凭据跨站重定向', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 307,
        headers: { Location: 'https://attacker.example/jmap/session' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(JmapClient.connect('https://mail.onprs.online', 'user@onprs.online', 'secret')).rejects.toMatchObject({
      code: 'CROSS_ORIGIN_REDIRECT'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('认证失效时通知账号服务清除运行期会话', async () => {
    const onAuthenticationRequired = vi.fn()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = JmapClient.fromSession(session, 'account1', 'user@onprs.online', 'secret', onAuthenticationRequired)

    await expect(client.call(['urn:ietf:params:jmap:core'], 'Mailbox/get', {})).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED'
    })
    expect(onAuthenticationRequired).toHaveBeenCalledOnce()
  })

  it('将 JMAP 方法错误转换为稳定错误', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            methodResponses: [['error', { type: 'forbidden', description: 'No permission' }, 'c1']]
          }),
          { status: 200 }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const client = await JmapClient.connect('https://mail.onprs.online', 'user@onprs.online', 'secret')
    await expect(client.call(['urn:ietf:params:jmap:core'], 'Mailbox/get', {})).rejects.toMatchObject({
      code: 'JMAP_FORBIDDEN',
      message: 'No permission'
    })
  })
})
