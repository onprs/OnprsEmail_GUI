import { useEffect, useMemo, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bold,
  FilePlus2,
  Italic,
  List,
  ListOrdered,
  LoaderCircle,
  Paperclip,
  Quote,
  Redo2,
  Save,
  Send,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import type { AccountSummary, ComposeInput, UploadedAttachment } from '@shared/types'
import type { ComposeSeed } from '../../store/use-app-store'
import { useAppStore } from '../../store/use-app-store'
import { errorMessage, signalAuthenticationRequired, UiError, unwrap } from '../../lib/api'

interface ComposeDialogProps {
  account: AccountSummary
  seed: ComposeSeed
}

function parseRecipients(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[;,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ]
}

export function ComposeDialog({ account, seed }: ComposeDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const closeCompose = useAppStore((state) => state.closeCompose)
  const notify = useAppStore((state) => state.notify)
  const [to, setTo] = useState(seed.to?.join(', ') ?? '')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [showCopies, setShowCopies] = useState(false)
  const [subject, setSubject] = useState(seed.subject ?? '')
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([])
  const [draftId, setDraftId] = useState(seed.draftId)
  const [pendingSubmissionOverride, setPendingSubmissionOverride] = useState<string | null | undefined>()
  const pendingSubmissionId =
    pendingSubmissionOverride === undefined ? (account.pendingSubmissionEmailId ?? null) : pendingSubmissionOverride
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const initialContent = useMemo(
    () =>
      seed.html ||
      (seed.text
        ? `<p>${seed.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<br>')}</p>`
        : '<p></p>'),
    [seed.html, seed.text]
  )
  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'compose-editor-content',
        'aria-label': '邮件正文'
      }
    }
  })

  useEffect(() => {
    editor?.setEditable(pendingSubmissionId === null)
  }, [editor, pendingSubmissionId])

  function buildInput(): ComposeInput {
    const text = editor?.getText({ blockSeparator: '\n' }) ?? seed.text ?? ''
    const html = editor?.getHTML() ?? seed.html ?? ''
    return {
      accountId: account.id,
      draftId,
      to: parseRecipients(to),
      cc: parseRecipients(cc),
      bcc: parseRecipients(bcc),
      subject: subject.trim(),
      text,
      html,
      attachments
    }
  }

  async function synchronizePendingSubmission(): Promise<void> {
    try {
      const accounts = unwrap(await window.mailApi.listAccounts())
      queryClient.setQueryData(['accounts'], accounts)
      const currentAccount = accounts.find((item) => item.id === account.id)
      setPendingSubmissionOverride(currentAccount?.pendingSubmissionEmailId ?? null)
    } catch {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    }
  }

  const saveDraft = useMutation({
    mutationFn: async () => unwrap(await window.mailApi.saveDraft(buildInput())),
    onSuccess: (result) => {
      setDraftId(result.emailId)
      setSavedAt(new Date(result.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
      notify(result.cleanupWarning ?? '草稿已保存', result.cleanupWarning ? 'info' : 'success')
      if (result.authenticationRequired) signalAuthenticationRequired()
      void queryClient.invalidateQueries({ queryKey: ['emails', account.id] })
    },
    onError: (error) => notify(errorMessage(error), 'error')
  })

  const sendMail = useMutation({
    mutationFn: async () => {
      if (pendingSubmissionId) {
        return unwrap(await window.mailApi.submitDraft(account.id, pendingSubmissionId))
      }
      const draft = unwrap(await window.mailApi.saveDraft(buildInput()))
      setDraftId(draft.emailId)
      setSavedAt(new Date(draft.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
      if (draft.authenticationRequired) {
        signalAuthenticationRequired()
        throw new UiError('AUTHENTICATION_REQUIRED', '新草稿已保存，请重新登录后确认发送', false)
      }
      setPendingSubmissionOverride(draft.emailId)
      const submission = unwrap(await window.mailApi.submitDraft(account.id, draft.emailId))
      return {
        ...submission,
        cleanupWarning: submission.cleanupWarning ?? draft.cleanupWarning
      }
    },
    onSuccess: (result) => {
      notify(result.cleanupWarning ?? '邮件已提交发送', result.cleanupWarning ? 'info' : 'success')
      setPendingSubmissionOverride(null)
      closeCompose()
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['emails', account.id] })
      void queryClient.invalidateQueries({ queryKey: ['mailboxes', account.id] })
    },
    onError: async (error) => {
      notify(errorMessage(error), 'error')
      await synchronizePendingSubmission()
      void queryClient.invalidateQueries({ queryKey: ['emails', account.id] })
    }
  })

  const upload = useMutation({
    mutationFn: async () => unwrap(await window.mailApi.pickAttachments(account.id)),
    onSuccess: (items) => setAttachments((current) => [...current, ...items]),
    onError: (error) => notify(errorMessage(error), 'error')
  })

  const submissionUncertain = pendingSubmissionId !== null
  const isBusy = saveDraft.isPending || sendMail.isPending || upload.isPending

  return (
    <div className="compose-backdrop" role="presentation">
      <section className="compose-window" role="dialog" aria-modal="true" aria-label="撰写邮件">
        <header className="compose-header">
          <div>
            <strong>{seed.mode === 'reply' ? '回复邮件' : seed.mode === 'forward' ? '转发邮件' : '新邮件'}</strong>
            <span>通过 {account.email} 发送</span>
          </div>
          <button className="icon-button" title="关闭撰写窗口" onClick={closeCompose} disabled={sendMail.isPending}>
            <X size={18} />
          </button>
        </header>

        <div className="compose-addresses">
          <div className="compose-field-row">
            <label htmlFor="compose-to">收件人</label>
            <input
              id="compose-to"
              type="text"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="邮箱地址，多个地址用逗号分隔"
              autoFocus
              disabled={submissionUncertain}
            />
            <button
              className="text-button"
              type="button"
              onClick={() => setShowCopies((value) => !value)}
              disabled={submissionUncertain}
            >
              抄送/密送
            </button>
          </div>
          {showCopies && (
            <>
              <div className="compose-field-row">
                <label htmlFor="compose-cc">抄送</label>
                <input
                  id="compose-cc"
                  type="text"
                  value={cc}
                  onChange={(event) => setCc(event.target.value)}
                  disabled={submissionUncertain}
                />
              </div>
              <div className="compose-field-row">
                <label htmlFor="compose-bcc">密送</label>
                <input
                  id="compose-bcc"
                  type="text"
                  value={bcc}
                  onChange={(event) => setBcc(event.target.value)}
                  disabled={submissionUncertain}
                />
              </div>
            </>
          )}
          <div className="compose-field-row">
            <label htmlFor="compose-subject">主题</label>
            <input
              id="compose-subject"
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={998}
              disabled={submissionUncertain}
            />
          </div>
        </div>

        <div
          className={`editor-toolbar ${submissionUncertain ? 'locked' : ''}`}
          aria-label="正文格式工具"
          aria-disabled={submissionUncertain}
          onClickCapture={(event) => {
            if (submissionUncertain) event.stopPropagation()
          }}
          onKeyDownCapture={(event) => {
            if (submissionUncertain) event.preventDefault()
          }}
        >
          <button
            className={`icon-button compact ${editor?.isActive('bold') ? 'active' : ''}`}
            title="粗体"
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold size={16} />
          </button>
          <button
            className={`icon-button compact ${editor?.isActive('italic') ? 'active' : ''}`}
            title="斜体"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic size={16} />
          </button>
          <span className="toolbar-divider" />
          <button
            className={`icon-button compact ${editor?.isActive('bulletList') ? 'active' : ''}`}
            title="项目列表"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List size={16} />
          </button>
          <button
            className={`icon-button compact ${editor?.isActive('orderedList') ? 'active' : ''}`}
            title="编号列表"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={16} />
          </button>
          <button
            className={`icon-button compact ${editor?.isActive('blockquote') ? 'active' : ''}`}
            title="引用"
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote size={16} />
          </button>
          <span className="toolbar-divider" />
          <button
            className="icon-button compact"
            title="撤销"
            disabled={!editor?.can().chain().focus().undo().run()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 size={16} />
          </button>
          <button
            className="icon-button compact"
            title="重做"
            disabled={!editor?.can().chain().focus().redo().run()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 size={16} />
          </button>
          <span className="toolbar-spacer" />
          <button
            className="icon-button compact"
            title="添加附件"
            onClick={() => upload.mutate()}
            disabled={isBusy || submissionUncertain}
          >
            {upload.isPending ? <LoaderCircle className="spin" size={16} /> : <Paperclip size={16} />}
          </button>
        </div>

        <EditorContent editor={editor} className="compose-editor" />

        {attachments.length > 0 && (
          <div className="compose-attachments">
            {attachments.map((attachment) => (
              <div className="compose-attachment" key={attachment.blobId}>
                <FilePlus2 size={16} />
                <span>{attachment.name}</span>
                <small>{Math.max(1, Math.round(attachment.size / 1024))} KB</small>
                <button
                  className="icon-button compact"
                  title="移除附件"
                  disabled={submissionUncertain}
                  onClick={() => setAttachments((items) => items.filter((item) => item.blobId !== attachment.blobId))}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <footer className="compose-footer">
          <button
            className="primary-button send-button"
            onClick={() => sendMail.mutate()}
            disabled={isBusy || (!submissionUncertain && !to.trim())}
          >
            {sendMail.isPending ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
            {sendMail.isPending ? '正在确认' : submissionUncertain ? '确认发送状态' : '发送'}
          </button>
          <button
            className="secondary-button"
            onClick={() => saveDraft.mutate()}
            disabled={isBusy || submissionUncertain}
          >
            {saveDraft.isPending ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
            保存草稿
          </button>
          {submissionUncertain ? (
            <span className="draft-status">发送状态待确认</span>
          ) : (
            savedAt && <span className="draft-status">已于 {savedAt} 保存</span>
          )}
          <span className="compose-footer-spacer" />
          <button className="icon-button danger-hover" title="关闭并保留服务端草稿" onClick={closeCompose}>
            <X size={18} />
          </button>
        </footer>
      </section>
    </div>
  )
}
