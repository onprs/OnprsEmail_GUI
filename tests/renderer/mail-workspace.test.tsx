import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EmailDetail, EmailPageInput, Mailbox } from '@shared/types'
import { MailWorkspace } from '@renderer/features/mail/MailWorkspace'
import { useAppStore } from '@renderer/store/use-app-store'
import { account, installMailApi, ok, renderWithQuery } from './test-utils'

const mailboxes: Mailbox[] = [
  {
    id: 'inbox',
    name: 'Inbox',
    parentId: null,
    role: 'inbox',
    sortOrder: 1,
    totalEmails: 60,
    unreadEmails: 0,
    totalThreads: 60,
    unreadThreads: 0,
    isSubscribed: true,
    myRights: { mayReadItems: true }
  },
  {
    id: 'archive',
    name: 'Archive',
    parentId: null,
    role: 'archive',
    sortOrder: 2,
    totalEmails: 60,
    unreadEmails: 0,
    totalThreads: 60,
    unreadThreads: 0,
    isSubscribed: true,
    myRights: { mayReadItems: true }
  }
]

function detail(id: string): EmailDetail {
  const subject = id.includes('search') ? '归档搜索结果' : id.startsWith('archive') ? '归档邮件' : '收件箱邮件'
  return {
    id,
    threadId: `thread-${id}`,
    mailboxIds: [id.startsWith('archive') ? 'archive' : 'inbox'],
    from: [{ name: '系统通知', email: 'notice@example.com' }],
    to: [{ name: '测试账号', email: 'user@onprs.online' }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject,
    preview: subject,
    receivedAt: '2026-01-01T00:00:00.000Z',
    sentAt: '2026-01-01T00:00:00.000Z',
    size: 128,
    isUnread: false,
    isFlagged: false,
    isDraft: false,
    hasAttachment: false,
    bodyText: subject,
    bodyHtml: `<p>${subject}</p>`,
    attachments: [],
    messageId: [`${id}@example.com`]
  }
}

describe('邮件列表状态', () => {
  it('切换邮箱和提交搜索时重置分页及已选邮件', async () => {
    const listEmails = vi.fn(async (input: EmailPageInput) => {
      const suffix = input.search ? 'search' : 'all'
      const id = `${input.mailboxId}-${input.position}-${suffix}`
      return ok({
        items: [
          {
            ...detail(id),
            cc: undefined,
            bcc: undefined,
            replyTo: undefined,
            bodyText: undefined,
            bodyHtml: undefined,
            attachments: undefined,
            messageId: undefined
          }
        ],
        position: input.position,
        total: 60,
        hasMore: input.position === 0,
        queryState: 'query-state'
      })
    })
    installMailApi({
      listMailboxes: vi.fn(async () => ok(mailboxes)),
      getSettings: vi.fn(async () =>
        ok({ theme: 'system' as const, notifications: true, remoteImages: 'blocked' as const, pageSize: 30 })
      ),
      listEmails,
      getEmail: vi.fn(async (_accountId, emailId) => ok(detail(emailId))),
      updateEmail: vi.fn(async () => ok(undefined)),
      saveAttachment: vi.fn(async () => ok(false))
    })
    useAppStore.setState({ activeAccountId: 'account-1', activeMailboxId: null, selectedEmailId: null })

    renderWithQuery(<MailWorkspace account={account()} accounts={[account()]} onAccountChange={vi.fn()} />)

    expect(await screen.findByRole('button', { name: /收件箱邮件/ })).toBeVisible()
    fireEvent.click(screen.getByTitle('下一页'))
    await waitFor(() =>
      expect(listEmails).toHaveBeenCalledWith(expect.objectContaining({ mailboxId: 'inbox', position: 30 }))
    )

    fireEvent.click(screen.getByRole('button', { name: '归档' }))
    await waitFor(() =>
      expect(listEmails).toHaveBeenCalledWith(expect.objectContaining({ mailboxId: 'archive', position: 0 }))
    )

    fireEvent.click(await screen.findByRole('button', { name: /归档邮件/ }))
    expect(await screen.findByRole('heading', { name: '归档邮件' })).toBeVisible()

    fireEvent.change(screen.getByLabelText('搜索邮件'), { target: { value: '关键字' } })
    fireEvent.submit(screen.getByLabelText('搜索邮件').closest('form')!)
    await waitFor(() =>
      expect(listEmails).toHaveBeenCalledWith(
        expect.objectContaining({
          mailboxId: 'archive',
          search: '关键字',
          position: 0
        })
      )
    )
    expect(screen.queryByRole('heading', { name: '归档邮件' })).not.toBeInTheDocument()
    expect(screen.getByText('选择一封邮件')).toBeVisible()
  })
})
