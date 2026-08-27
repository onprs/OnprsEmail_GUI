import { describe, expect, it, vi } from 'vitest'
import { MailService } from '@main/services/mail-service'
import { AppError } from '@main/errors'
import type { AccountService } from '@main/services/account-service'
import type { ComposeInput } from '@shared/types'

const composeInput: ComposeInput = {
  accountId: 'local-account',
  draftId: 'old-draft',
  to: ['recipient@example.com'],
  cc: [],
  bcc: [],
  subject: '测试主题',
  text: '纯文本正文',
  html: '<p>HTML 正文</p>',
  attachments: []
}

function createService(options: {
  existingSubmission?: boolean
  cleanupFails?: boolean
  cleanupAuthenticationRequired?: boolean
  createFails?: boolean
  submissionNetworkFailure?: boolean
  pendingEmailId?: string
} = {}) {
  let pendingEmailId = options.pendingEmailId ?? null
  const call = vi.fn(async (_using: string[], name: string, args: Record<string, unknown>) => {
    if (name === 'Identity/get') {
      return { accountId: 'remote-account', state: '1', list: [{ id: 'identity-1', name: 'User', email: 'user@onprs.online' }] }
    }
    if (name === 'Mailbox/get') {
      return {
        accountId: 'remote-account',
        state: '1',
        list: [
          { id: 'drafts-box', name: 'Drafts', role: 'drafts' },
          { id: 'sent-box', name: 'Sent', role: 'sent' },
          { id: 'inbox-box', name: 'Inbox', role: 'inbox' }
        ]
      }
    }
    if (name === 'Email/set') {
      if (args.destroy) {
        if (options.cleanupAuthenticationRequired) {
          throw new AppError('AUTHENTICATION_REQUIRED', '账号认证已失效，请重新登录')
        }
        return {
          accountId: 'remote-account',
          oldState: '2',
          newState: '3',
          ...(options.cleanupFails
            ? { notDestroyed: { 'old-draft': { type: 'serverFail' } } }
            : { destroyed: args.destroy })
        }
      }
      const create = args.create as Record<string, unknown> | undefined
      const createId = create ? Object.keys(create)[0] : undefined
      return {
        accountId: 'remote-account',
        oldState: '1',
        newState: '2',
        ...(options.createFails && createId
          ? { notCreated: { [createId]: { type: 'serverFail' } } }
          : { created: createId ? { [createId]: { id: 'new-draft' } } : undefined })
      }
    }
    if (name === 'EmailSubmission/query') {
      return {
        accountId: 'remote-account',
        queryState: '1',
        canCalculateChanges: false,
        position: 0,
        ids: options.existingSubmission ? ['submission-existing'] : []
      }
    }
    if (name === 'Email/get') {
      return {
        accountId: 'remote-account',
        state: '2',
        list: [{ id: 'pending-draft', mailboxIds: { 'drafts-box': true }, keywords: { '$draft': true } }]
      }
    }
    throw new Error(`未处理的方法 ${name}`)
  })
  const callMany = vi.fn(async (_using: string[], calls: Array<[string, Record<string, unknown>, string]>) => {
    if (options.submissionNetworkFailure) {
      throw new AppError('NETWORK_ERROR', '连接邮件服务器失败', true)
    }
    const [, args, callId] = calls[0]!
    const create = args.create as Record<string, unknown>
    const createId = Object.keys(create)[0]!
    return [
      ['EmailSubmission/set', {
        accountId: 'remote-account',
        oldState: '1',
        newState: '2',
        created: { [createId]: { id: 'submission-1' } }
      }, callId],
      ['Email/set', {
        accountId: 'remote-account',
        oldState: '2',
        newState: '3',
        updated: { 'new-draft': null }
      }, callId]
    ]
  })
  const client = {
    accountId: 'remote-account',
    session: { capabilities: {}, accounts: {} },
    supports: () => true,
    call,
    callMany
  }
  const accounts = {
    getClient: () => client,
    getPendingSubmissionEmailId: () => pendingEmailId,
    savePendingSubmission: (_accountId: string, emailId: string) => { pendingEmailId = emailId },
    clearPendingSubmission: () => { pendingEmailId = null }
  } as unknown as AccountService
  return { service: new MailService(accounts), call, callMany, getPendingEmailId: () => pendingEmailId }
}

describe('MailService 草稿与发信', () => {
  it('重存草稿时先确认新建成功，再单独销毁旧草稿', async () => {
    const { service, call } = createService()
    const result = await service.saveDraft(composeInput)
    expect(result.emailId).toBe('new-draft')
    expect(result.cleanupWarning).toBeUndefined()

    const emailSets = call.mock.calls.filter((item) => item[1] === 'Email/set')
    expect(emailSets).toHaveLength(2)
    expect(emailSets[0]?.[2]).toMatchObject({ create: expect.any(Object) })
    expect(emailSets[0]?.[2]).not.toHaveProperty('destroy')
    expect(emailSets[1]?.[2]).toMatchObject({ destroy: ['old-draft'] })
    expect(emailSets[1]?.[2]).not.toHaveProperty('create')
  })

  it('新草稿创建失败时不销毁旧草稿', async () => {
    const { service, call } = createService({ createFails: true })
    await expect(service.saveDraft(composeInput)).rejects.toMatchObject({ code: 'JMAP_SET_SERVERFAIL' })
    const emailSets = call.mock.calls.filter((item) => item[1] === 'Email/set')
    expect(emailSets).toHaveLength(1)
    expect(emailSets[0]?.[2]).not.toHaveProperty('destroy')
  })

  it('旧草稿清理失败时保留新草稿并返回警告', async () => {
    const { service } = createService({ cleanupFails: true })
    const result = await service.saveDraft(composeInput)
    expect(result).toMatchObject({ emailId: 'new-draft', cleanupWarning: '新草稿已保存，但旧草稿未能自动清理' })
  })

  it('旧草稿清理遇到认证失效时保留新草稿 ID 和重登录状态', async () => {
    const { service } = createService({ cleanupAuthenticationRequired: true })
    const result = await service.saveDraft(composeInput)
    expect(result).toMatchObject({
      emailId: 'new-draft',
      cleanupWarning: '新草稿已保存，但旧草稿未能自动清理',
      authenticationRequired: true
    })
  })

  it('发信通过 onSuccessUpdateEmail 原子归档已保存的草稿', async () => {
    const { service, call, callMany, getPendingEmailId } = createService()
    const result = await service.submitDraft('local-account', 'new-draft')
    expect(result).toMatchObject({ emailId: 'new-draft', submissionId: 'submission-1', status: 'submitted' })
    expect(result.cleanupWarning).toBeUndefined()
    expect(getPendingEmailId()).toBeNull()

    const emailSets = call.mock.calls.filter((item) => item[1] === 'Email/set')
    expect(emailSets).toHaveLength(0)
    const submissionMethod = callMany.mock.calls[0]?.[1][0]
    const args = submissionMethod?.[1] as {
      create: Record<string, unknown>
      onSuccessUpdateEmail: Record<string, Record<string, unknown>>
    }
    const submissionKey = Object.keys(args.create)[0]!
    expect(args.onSuccessUpdateEmail[`#${submissionKey}`]).toEqual({
      'mailboxIds/drafts-box': null,
      'mailboxIds/sent-box': true,
      'keywords/$draft': null,
      'keywords/$seen': true
    })
  })

  it('响应丢失后的 UI 新草稿参数不会绕过持久化提交恢复', async () => {
    const options = { existingSubmission: false, submissionNetworkFailure: true }
    const { service, callMany, getPendingEmailId } = createService(options)
    await expect(service.submitDraft('local-account', 'original-draft')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(getPendingEmailId()).toBe('original-draft')

    options.submissionNetworkFailure = false
    options.existingSubmission = true
    const recovered = await service.submitDraft('local-account', 'replacement-draft')
    expect(recovered).toMatchObject({ emailId: 'original-draft', submissionId: 'submission-existing' })
    expect(callMany).toHaveBeenCalledTimes(1)
    expect(getPendingEmailId()).toBeNull()
  })

  it('重试提交使用持久化的原草稿并修复归档状态', async () => {
    const { service, call, callMany, getPendingEmailId } = createService({
      existingSubmission: true,
      pendingEmailId: 'pending-draft'
    })
    const result = await service.submitDraft('local-account', 'new-draft-that-must-not-send')
    expect(result).toMatchObject({ emailId: 'pending-draft', submissionId: 'submission-existing', status: 'submitted' })
    expect(callMany).not.toHaveBeenCalled()
    expect(getPendingEmailId()).toBeNull()
    const archiveUpdate = call.mock.calls.find((item) => item[1] === 'Email/set' && (item[2] as Record<string, unknown>).update)
    expect(archiveUpdate?.[2]).toMatchObject({
      update: {
        'pending-draft': {
          mailboxIds: { 'sent-box': true },
          keywords: { '$seen': true }
        }
      }
    })
  })
})

describe('MailService 正文组合', () => {
  it('按顺序组合全部 JMAP 正文分段', async () => {
    const call = vi.fn(async () => ({
      accountId: 'remote-account',
      state: '1',
      list: [{
        id: 'email-1',
        threadId: 'thread-1',
        mailboxIds: { inbox: true },
        keywords: {},
        receivedAt: '2026-08-25T00:00:00Z',
        textBody: [{ partId: 't1' }, { partId: 't2' }],
        htmlBody: [{ partId: 'h1' }, { partId: 'h2' }],
        bodyValues: {
          t1: { value: '第一段' },
          t2: { value: '第二段' },
          h1: { value: '<p>第一段</p>' },
          h2: { value: '<p>第二段</p>' }
        }
      }]
    }))
    const client = { accountId: 'remote-account', call, supports: () => true, session: { capabilities: {}, accounts: {} } }
    const service = new MailService({ getClient: () => client } as unknown as AccountService)
    const detail = await service.getEmail('local-account', 'email-1')
    expect(detail.bodyText).toBe('第一段\n\n第二段')
    expect(detail.bodyHtml).toContain('第一段')
    expect(detail.bodyHtml).toContain('第二段')
  })
})
