import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ComposeDialog } from '@renderer/features/compose/ComposeDialog'
import { account, installMailApi, ok, renderWithQuery } from './test-utils'

const tiptap = vi.hoisted(() => {
  const chain = {
    focus: vi.fn(),
    toggleBold: vi.fn(),
    toggleItalic: vi.fn(),
    toggleBulletList: vi.fn(),
    toggleOrderedList: vi.fn(),
    toggleBlockquote: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    run: vi.fn(() => true)
  }
  for (const method of [
    'focus',
    'toggleBold',
    'toggleItalic',
    'toggleBulletList',
    'toggleOrderedList',
    'toggleBlockquote',
    'undo',
    'redo'
  ] as const) {
    chain[method].mockReturnValue(chain)
  }
  return {
    chain,
    editor: {
      setEditable: vi.fn(),
      getText: vi.fn(() => ''),
      getHTML: vi.fn(() => '<p></p>'),
      isActive: vi.fn(() => false),
      chain: vi.fn(() => chain),
      can: vi.fn(() => ({ chain: () => chain }))
    }
  }
})

vi.mock('@tiptap/react', () => ({
  useEditor: () => tiptap.editor,
  EditorContent: () => <div aria-label="邮件正文" />
}))
vi.mock('@tiptap/starter-kit', () => ({ default: {} }))

describe('发送恢复', () => {
  it('存在待确认草稿时直接确认发送状态，不重复创建草稿', async () => {
    const saveDraft = vi.fn()
    const submitDraft = vi.fn(async () =>
      ok({
        emailId: 'pending-draft',
        submissionId: 'submission-1',
        status: 'submitted' as const
      })
    )
    installMailApi({
      saveDraft,
      submitDraft,
      pickAttachments: vi.fn(async () => ok([]))
    })

    renderWithQuery(
      <ComposeDialog
        account={account({ pendingSubmissionEmailId: 'pending-draft' })}
        seed={{ mode: 'new', to: ['recipient@example.com'], subject: '待确认邮件' }}
      />
    )

    expect(screen.getByLabelText('收件人')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '确认发送状态' }))

    await waitFor(() => expect(submitDraft).toHaveBeenCalledWith('account-1', 'pending-draft'))
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('账号状态出现待确认草稿时立即切换到恢复流程', () => {
    installMailApi({
      saveDraft: vi.fn(),
      submitDraft: vi.fn(),
      pickAttachments: vi.fn(async () => ok([]))
    })
    const seed = { mode: 'new' as const, to: ['recipient@example.com'], subject: '状态更新测试' }
    const { rerender } = renderWithQuery(<ComposeDialog account={account()} seed={seed} />)

    expect(screen.getByRole('button', { name: '发送' })).toBeVisible()
    rerender(<ComposeDialog account={account({ pendingSubmissionEmailId: 'pending-from-account' })} seed={seed} />)

    expect(screen.getByRole('button', { name: '确认发送状态' })).toBeVisible()
    expect(screen.getByLabelText('收件人')).toBeDisabled()
  })

  it('不可重试错误后按主进程状态继续锁定待确认草稿', async () => {
    const pendingAccount = account({ pendingSubmissionEmailId: 'pending-after-error' })
    const listAccounts = vi.fn(async () => ok([pendingAccount]))
    installMailApi({
      listAccounts,
      saveDraft: vi.fn(async () => ok({ emailId: 'pending-after-error', updatedAt: '2026-01-01T00:00:00.000Z' })),
      submitDraft: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'JMAP_FORBIDDEN', message: '服务器拒绝查询提交状态', retryable: false }
      })),
      pickAttachments: vi.fn(async () => ok([]))
    })
    renderWithQuery(
      <ComposeDialog
        account={account()}
        seed={{ mode: 'new', to: ['recipient@example.com'], subject: '不可重试错误测试' }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(listAccounts).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: '确认发送状态' })).toBeVisible()
    expect(screen.getByLabelText('收件人')).toBeDisabled()
  })

  it('主进程确认已清除 pending 后解除恢复锁定', async () => {
    const listAccounts = vi.fn(async () => ok([account()]))
    installMailApi({
      listAccounts,
      saveDraft: vi.fn(),
      submitDraft: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'JMAP_FORBIDDEN', message: '服务器明确拒绝提交', retryable: false }
      })),
      pickAttachments: vi.fn(async () => ok([]))
    })
    renderWithQuery(
      <ComposeDialog
        account={account({ pendingSubmissionEmailId: 'cleared-pending' })}
        seed={{ mode: 'new', to: ['recipient@example.com'], subject: '清理状态测试' }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '确认发送状态' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeVisible())
    expect(listAccounts).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('收件人')).toBeEnabled()
  })

  it('账号状态读取失败时保守保持恢复锁定', async () => {
    const listAccounts = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'ACCOUNT_LIST_FAILED', message: '账号状态暂时无法读取', retryable: true }
    }))
    installMailApi({
      listAccounts,
      saveDraft: vi.fn(),
      submitDraft: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'NETWORK_ERROR', message: '连接邮件服务器失败', retryable: true }
      })),
      pickAttachments: vi.fn(async () => ok([]))
    })
    renderWithQuery(
      <ComposeDialog
        account={account({ pendingSubmissionEmailId: 'unknown-pending' })}
        seed={{ mode: 'new', to: ['recipient@example.com'], subject: '同步失败测试' }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '确认发送状态' }))

    await waitFor(() => expect(listAccounts).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: '确认发送状态' })).toBeVisible()
    expect(screen.getByLabelText('收件人')).toBeDisabled()
  })
})
