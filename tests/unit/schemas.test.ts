import { describe, expect, it } from 'vitest'
import {
  accountConnectionSchema,
  accountRegistrationSchema,
  composeSchema,
  externalUrlSchema,
  ingressPageSchema
} from '@shared/schemas'

describe('IPC 输入契约', () => {
  it('接受安全的 JMAP 账号连接参数', () => {
    const result = accountConnectionSchema.safeParse({
      email: 'user@onprs.online',
      password: 'secret',
      serverUrl: 'https://mail.onprs.online',
      remember: true
    })
    expect(result.success).toBe(true)
  })

  it('校验桌面端邮箱创建参数并丢弃客户端注入的服务器地址', () => {
    const valid = accountRegistrationSchema.safeParse({
      localPart: 'new.user',
      password: 'StrongPassword-1234',
      registrationCredential: {
        source: 'new',
        registrationCode: 'registration-code-1234567890-abcdef',
        remember: true
      },
      serverUrl: 'https://attacker.example',
      displayName: '新用户',
      remember: true
    })
    expect(valid.success).toBe(true)
    if (valid.success) expect(valid.data).not.toHaveProperty('serverUrl')

    expect(accountRegistrationSchema.safeParse({
      localPart: 'Admin@onprs.online',
      password: 'short',
      registrationCredential: { source: 'new', registrationCode: 'short', remember: true },
      remember: true
    }).success).toBe(false)

    expect(accountRegistrationSchema.safeParse({
      localPart: 'new.user',
      password: 'StrongPassword-1234',
      registrationCredential: { source: 'saved', registrationCode: 'injected-code' },
      remember: true
    }).success).toBe(false)

    expect(accountRegistrationSchema.safeParse({
      localPart: 'new.user',
      password: 'StrongPassword-1234',
      registrationCredential: { source: 'saved' },
      remember: true
    }).success).toBe(true)
  })

  it('拒绝公网明文 HTTP 服务', () => {
    const result = accountConnectionSchema.safeParse({
      email: 'user@onprs.online',
      password: 'secret',
      serverUrl: 'http://mail.onprs.online',
      remember: true
    })
    expect(result.success).toBe(false)
  })

  it('拒绝危险的外部链接协议', () => {
    expect(externalUrlSchema.safeParse('javascript:alert(1)').success).toBe(false)
    expect(externalUrlSchema.safeParse('file:///C:/Windows/System32/calc.exe').success).toBe(false)
    expect(externalUrlSchema.safeParse('https://onprs.online').success).toBe(true)
  })

  it('限制分页和发件人输入规模', () => {
    expect(ingressPageSchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(composeSchema.safeParse({
      accountId: 'a1',
      to: ['invalid-address'],
      cc: [],
      bcc: [],
      subject: '',
      text: '',
      html: '',
      attachments: []
    }).success).toBe(false)
  })
})
