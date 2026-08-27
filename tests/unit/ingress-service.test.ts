import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchIngress } from '@main/services/ingress-service'

const secret = 'ingress-secret-1234567890-abcdef'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Ingress 请求重定向', () => {
  it('跨源重定向时拒绝继续发送令牌', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 307,
        headers: { Location: 'https://attacker.example/collect' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchIngress('https://mail.onprs.online/api/email-ingress', secret, 'v2/messages')
    ).rejects.toMatchObject({ code: 'CROSS_ORIGIN_INGRESS_REDIRECT' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('仅在同源安全重定向后再次附加令牌', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { Location: '/api/email-ingress/v2/messages/' }
        })
      )
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetchIngress('https://mail.onprs.online/api/email-ingress', secret, 'v2/messages')
    expect(response.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const redirectedUrl = fetchMock.mock.calls[1]?.[0] as URL
    const redirectedInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(redirectedUrl.origin).toBe('https://mail.onprs.online')
    expect(new Headers(redirectedInit.headers).get('X-Ingress-Secret')).toBe(secret)
  })
})
