import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { IngressMessageDetail, IngressPageInput } from '@shared/types'
import { CatchAllWorkspace } from '@renderer/features/catch-all/CatchAllWorkspace'
import { installMailApi, ok, renderWithQuery } from './test-utils'

const detail: IngressMessageDetail = {
  id: 1,
  messageId: 'message-1@example.com',
  from: 'sender@example.com',
  to: 'alpha@onprs.online',
  subject: '全域收件测试',
  preview: '测试正文',
  otpCode: '123456',
  hasHtml: true,
  createdAt: 1_787_000_000,
  isRead: false,
  bodyText: '测试正文',
  bodyHtml: '<p>测试正文</p>',
  links: [],
  attachments: []
}

describe('全域收件筛选', () => {
  it('切换收件地址时清除当前选中的邮件', async () => {
    const listMessages = vi.fn(async (_input: IngressPageInput) =>
      ok({
        items: [detail],
        recipients: [
          { address: 'alpha@onprs.online', count: 1, latestAt: detail.createdAt },
          { address: 'beta@onprs.online', count: 1, latestAt: detail.createdAt }
        ],
        nextCursor: null,
        apiVersion: 2 as const
      })
    )
    installMailApi({
      getIngressConfiguration: vi.fn(async () =>
        ok({ configured: true, baseUrl: 'https://mail.onprs.online', apiVersion: 2 as const })
      ),
      listIngressMessages: listMessages,
      getIngressMessage: vi.fn(async () => ok(detail)),
      deleteIngressMessage: vi.fn(),
      deleteIngressRecipient: vi.fn(),
      saveIngressRaw: vi.fn(),
      saveIngressAttachment: vi.fn(),
      openExternal: vi.fn()
    })
    renderWithQuery(<CatchAllWorkspace />)

    fireEvent.click(await screen.findByRole('button', { name: /全域收件测试/ }))
    expect(await screen.findByRole('heading', { name: '全域收件测试' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /beta.*onprs\.online/i }))
    expect(screen.getByText('选择一封邮件')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '全域收件测试' })).not.toBeInTheDocument()
  })
})
