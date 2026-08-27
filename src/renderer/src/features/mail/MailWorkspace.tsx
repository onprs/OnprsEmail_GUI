import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Flag,
  Forward,
  Inbox,
  LoaderCircle,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Reply,
  Search,
  Send,
  Star,
  Trash2,
  X
} from 'lucide-react'
import { format, isThisYear, isToday } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { JMAP_SUBMISSION, type AccountSummary, type EmailDetail, type Mailbox } from '@shared/types'
import { createMailDocument } from '../../lib/mail-document'
import { errorMessage, unwrap } from '../../lib/api'
import { useAppStore } from '../../store/use-app-store'

interface MailWorkspaceProps {
  account: AccountSummary
  accounts: AccountSummary[]
  onAccountChange(accountId: string): void
}

const roleNames: Record<string, string> = {
  inbox: '收件箱',
  drafts: '草稿箱',
  sent: '已发送',
  archive: '归档',
  junk: '垃圾邮件',
  trash: '垃圾箱'
}

function mailboxIcon(mailbox: Mailbox): React.JSX.Element {
  if (mailbox.role === 'sent') return <Send size={17} />
  if (mailbox.role === 'trash') return <Trash2 size={17} />
  if (mailbox.role === 'archive') return <Archive size={17} />
  if (mailbox.role === 'junk') return <Flag size={17} />
  if (mailbox.role === 'drafts') return <FileText size={17} />
  return <Inbox size={17} />
}

function messageTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  if (isToday(date)) return format(date, 'HH:mm')
  if (isThisYear(date)) return format(date, 'M月d日', { locale: zhCN })
  return format(date, 'yyyy/M/d')
}

function fullTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return format(date, 'yyyy年M月d日 HH:mm', { locale: zhCN })
}

function addressLabel(detail: EmailDetail): string {
  const address = detail.from[0]
  return address?.name || address?.email || '未知发件人'
}

export function MailWorkspace({ account, accounts, onAccountChange }: MailWorkspaceProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const activeMailboxId = useAppStore((state) => state.activeMailboxId)
  const setActiveMailbox = useAppStore((state) => state.setActiveMailbox)
  const selectedEmailId = useAppStore((state) => state.selectedEmailId)
  const setSelectedEmail = useAppStore((state) => state.setSelectedEmail)
  const openCompose = useAppStore((state) => state.openCompose)
  const notify = useAppStore((state) => state.notify)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState(0)
  const [remoteImagesAllowedFor, setRemoteImagesAllowedFor] = useState<{ accountId: string; emailId: string } | null>(
    null
  )
  const canSubmit = account.capabilities.includes(JMAP_SUBMISSION)

  const mailboxesQuery = useQuery({
    queryKey: ['mailboxes', account.id],
    queryFn: async () => unwrap(await window.mailApi.listMailboxes(account.id))
  })
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: async () => unwrap(await window.mailApi.getSettings())
  })
  const pageSize = settingsQuery.data?.pageSize ?? 30
  const emailsQuery = useQuery({
    queryKey: ['emails', account.id, activeMailboxId, search, position, pageSize],
    queryFn: async () =>
      unwrap(
        await window.mailApi.listEmails({
          accountId: account.id,
          mailboxId: activeMailboxId ?? undefined,
          search: search || undefined,
          position,
          limit: pageSize
        })
      ),
    enabled: Boolean(activeMailboxId)
  })
  const detailQuery = useQuery({
    queryKey: ['email', account.id, selectedEmailId],
    queryFn: async () => unwrap(await window.mailApi.getEmail(account.id, selectedEmailId!)),
    enabled: Boolean(selectedEmailId)
  })

  useEffect(() => {
    if (!activeMailboxId && mailboxesQuery.data?.length) {
      setActiveMailbox(
        mailboxesQuery.data.find((mailbox) => mailbox.role === 'inbox')?.id ?? mailboxesQuery.data[0]!.id
      )
    }
  }, [activeMailboxId, mailboxesQuery.data, setActiveMailbox])

  function selectMailbox(mailboxId: string): void {
    setPosition(0)
    setActiveMailbox(mailboxId)
  }

  function applySearch(value: string): void {
    setPosition(0)
    setSelectedEmail(null)
    setSearch(value)
  }

  const allowRemoteImages =
    settingsQuery.data?.remoteImages === 'allowed' ||
    (remoteImagesAllowedFor?.accountId === account.id && remoteImagesAllowedFor.emailId === selectedEmailId)

  const actionMutation = useMutation({
    mutationFn: async ({
      emailId,
      action
    }: {
      emailId: string
      action: Parameters<typeof window.mailApi.updateEmail>[2]
    }) => {
      unwrap(await window.mailApi.updateEmail(account.id, emailId, action))
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['emails', account.id] }),
        queryClient.invalidateQueries({ queryKey: ['mailboxes', account.id] }),
        queryClient.invalidateQueries({ queryKey: ['email', account.id, selectedEmailId] })
      ])
    },
    onError: (error) => notify(errorMessage(error), 'error')
  })

  const saveAttachment = useMutation({
    mutationFn: async (attachment: EmailDetail['attachments'][number]) =>
      unwrap(
        await window.mailApi.saveAttachment({
          accountId: account.id,
          blobId: attachment.blobId,
          name: attachment.name,
          type: attachment.type
        })
      ),
    onSuccess: (saved) => saved && notify('附件已保存', 'success'),
    onError: (error) => notify(errorMessage(error), 'error')
  })

  const selectedMailbox = mailboxesQuery.data?.find((mailbox) => mailbox.id === activeMailboxId)
  const mailDocument = useMemo(
    () => (detailQuery.data ? createMailDocument(detailQuery.data.bodyHtml, allowRemoteImages) : ''),
    [detailQuery.data, allowRemoteImages]
  )

  function selectMessage(emailId: string, unread: boolean): void {
    setSelectedEmail(emailId)
    if (unread) actionMutation.mutate({ emailId, action: { type: 'read', value: true } })
  }

  function reply(detail: EmailDetail): void {
    const replyAddress = detail.replyTo[0] ?? detail.from[0]
    const subject = /^re:/i.test(detail.subject) ? detail.subject : `Re: ${detail.subject}`
    openCompose({
      mode: 'reply',
      to: replyAddress?.email ? [replyAddress.email] : [],
      subject,
      html: `<p></p><blockquote>${detail.bodyHtml}</blockquote>`,
      text: `\n\n${detail.bodyText
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}`
    })
  }

  function forward(detail: EmailDetail): void {
    const subject = /^fwd:/i.test(detail.subject) ? detail.subject : `Fwd: ${detail.subject}`
    openCompose({
      mode: 'forward',
      subject,
      html: `<p></p><blockquote>${detail.bodyHtml}</blockquote>`,
      text: `\n\n${detail.bodyText}`
    })
  }

  return (
    <div className="mail-workspace">
      <aside className="mailbox-pane">
        <div className="account-switcher-wrap">
          <select
            className="account-switcher"
            value={account.id}
            onChange={(event) => onAccountChange(event.target.value)}
            aria-label="当前邮箱账号"
          >
            {accounts.map((item) => (
              <option value={item.id} key={item.id}>
                {item.displayName} · {item.email}
              </option>
            ))}
          </select>
        </div>
        <button
          className="primary-button mailbox-compose"
          disabled={!canSubmit}
          title={canSubmit ? '写邮件' : '此账号没有发信权限'}
          onClick={() => openCompose()}
        >
          <Send size={17} />
          写邮件
        </button>
        <div className="mailbox-list" aria-label="邮件文件夹">
          {mailboxesQuery.isPending && (
            <div className="sidebar-loading">
              <LoaderCircle className="spin" size={18} />
            </div>
          )}
          {mailboxesQuery.error && (
            <div className="sidebar-error">
              <strong>文件夹无法加载</strong>
              <span>{errorMessage(mailboxesQuery.error)}</span>
              <button className="secondary-button" onClick={() => void mailboxesQuery.refetch()}>
                重试
              </button>
            </div>
          )}
          {mailboxesQuery.data?.map((mailbox) => (
            <button
              key={mailbox.id}
              className={`mailbox-row ${mailbox.id === activeMailboxId ? 'active' : ''}`}
              onClick={() => selectMailbox(mailbox.id)}
            >
              {mailboxIcon(mailbox)}
              <span>{mailbox.role ? (roleNames[mailbox.role] ?? mailbox.name) : mailbox.name}</span>
              {mailbox.unreadEmails > 0 && (
                <strong>{mailbox.unreadEmails > 999 ? '999+' : mailbox.unreadEmails}</strong>
              )}
            </button>
          ))}
        </div>
        <div className="mailbox-account-meta">
          <span>{account.email}</span>
          <span>{mailboxesQuery.data?.reduce((count, mailbox) => count + mailbox.totalEmails, 0) ?? 0} 封邮件</span>
        </div>
      </aside>

      <section className="message-pane">
        <div className="message-pane-header">
          <div>
            <h2>
              {search
                ? '搜索结果'
                : selectedMailbox?.role
                  ? (roleNames[selectedMailbox.role] ?? selectedMailbox.name)
                  : (selectedMailbox?.name ?? '邮件')}
            </h2>
            <span>{emailsQuery.data?.total ?? selectedMailbox?.totalEmails ?? 0} 封</span>
          </div>
          <button
            className="icon-button"
            title="刷新邮件"
            onClick={() => void emailsQuery.refetch()}
            disabled={emailsQuery.isFetching}
          >
            <RefreshCw className={emailsQuery.isFetching ? 'spin' : ''} size={17} />
          </button>
        </div>
        <form
          className="mail-search"
          onSubmit={(event) => {
            event.preventDefault()
            applySearch(searchDraft.trim())
          }}
        >
          <Search size={17} />
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="搜索邮件"
            aria-label="搜索邮件"
          />
          {searchDraft && (
            <button
              type="button"
              title="清除搜索"
              onClick={() => {
                setSearchDraft('')
                applySearch('')
              }}
            >
              <X size={15} />
            </button>
          )}
        </form>

        <div className="message-list">
          {emailsQuery.isPending && activeMailboxId && (
            <div className="center-state">
              <LoaderCircle className="spin" size={23} />
              <span>正在同步邮件</span>
            </div>
          )}
          {emailsQuery.error && (
            <div className="center-state error-state">
              <MailOpen size={28} />
              <strong>无法加载邮件</strong>
              <span>{errorMessage(emailsQuery.error)}</span>
              <button className="secondary-button" onClick={() => void emailsQuery.refetch()}>
                重试
              </button>
            </div>
          )}
          {emailsQuery.data?.items.length === 0 && (
            <div className="center-state">
              <MailOpen size={30} />
              <strong>{search ? '没有匹配的邮件' : '这里还没有邮件'}</strong>
            </div>
          )}
          {emailsQuery.data?.items.map((email) => {
            const sender = email.from[0]
            const senderName = sender?.name || sender?.email || '未知发件人'
            return (
              <button
                key={email.id}
                className={`message-row ${email.isUnread ? 'unread' : ''} ${selectedEmailId === email.id ? 'selected' : ''}`}
                onClick={() => selectMessage(email.id, email.isUnread)}
              >
                <span className="sender-avatar">{senderName.slice(0, 1).toUpperCase()}</span>
                <span className="message-row-content">
                  <span className="message-row-top">
                    <strong>{senderName}</strong>
                    <time>{messageTime(email.receivedAt)}</time>
                  </span>
                  <span className="message-subject">{email.subject}</span>
                  <span className="message-preview">{email.preview || '无正文预览'}</span>
                </span>
                <span className="message-indicators">
                  {email.hasAttachment && <Paperclip size={13} />}
                  {email.isFlagged && <Star size={13} fill="currentColor" />}
                  {email.isUnread && <span className="unread-dot" />}
                </span>
              </button>
            )
          })}
        </div>

        {emailsQuery.data && emailsQuery.data.total > pageSize && (
          <div className="pagination-bar">
            <button
              className="icon-button compact"
              title="上一页"
              disabled={position === 0}
              onClick={() => setPosition(Math.max(0, position - pageSize))}
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              {position + 1}-{Math.min(position + pageSize, emailsQuery.data.total)} / {emailsQuery.data.total}
            </span>
            <button
              className="icon-button compact"
              title="下一页"
              disabled={!emailsQuery.data.hasMore}
              onClick={() => setPosition(position + pageSize)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        )}
      </section>

      <section className="reader-pane">
        {!selectedEmailId && (
          <div className="reader-empty">
            <span className="reader-empty-icon">
              <MailOpen size={34} />
            </span>
            <strong>选择一封邮件</strong>
            <span>邮件内容将在这里显示</span>
          </div>
        )}
        {detailQuery.isPending && selectedEmailId && (
          <div className="center-state fill">
            <LoaderCircle className="spin" size={23} />
            <span>正在打开邮件</span>
          </div>
        )}
        {detailQuery.error && (
          <div className="center-state fill error-state">
            <MailOpen size={29} />
            <strong>邮件无法打开</strong>
            <span>{errorMessage(detailQuery.error)}</span>
          </div>
        )}
        {detailQuery.data && (
          <>
            <div className="reader-toolbar">
              <div className="reader-toolbar-group">
                <button
                  className="icon-button"
                  title="回复"
                  disabled={!canSubmit}
                  onClick={() => reply(detailQuery.data)}
                >
                  <Reply size={18} />
                </button>
                <button
                  className="icon-button"
                  title="转发"
                  disabled={!canSubmit}
                  onClick={() => forward(detailQuery.data)}
                >
                  <Forward size={18} />
                </button>
                <button
                  className="icon-button"
                  title={detailQuery.data.isFlagged ? '取消星标' : '添加星标'}
                  onClick={() =>
                    actionMutation.mutate({
                      emailId: detailQuery.data.id,
                      action: { type: 'flagged', value: !detailQuery.data.isFlagged }
                    })
                  }
                >
                  <Star size={18} fill={detailQuery.data.isFlagged ? 'currentColor' : 'none'} />
                </button>
              </div>
              <div className="reader-toolbar-group">
                <select
                  className="move-select"
                  value=""
                  aria-label="移动邮件"
                  onChange={(event) =>
                    event.target.value &&
                    actionMutation.mutate({
                      emailId: detailQuery.data.id,
                      action: { type: 'move', mailboxId: event.target.value }
                    })
                  }
                >
                  <option value="">移动到</option>
                  {mailboxesQuery.data
                    ?.filter((mailbox) => !detailQuery.data.mailboxIds.includes(mailbox.id))
                    .map((mailbox) => (
                      <option value={mailbox.id} key={mailbox.id}>
                        {mailbox.role ? (roleNames[mailbox.role] ?? mailbox.name) : mailbox.name}
                      </option>
                    ))}
                </select>
                <button
                  className="icon-button danger-hover"
                  title="移到垃圾箱"
                  onClick={() => actionMutation.mutate({ emailId: detailQuery.data.id, action: { type: 'trash' } })}
                >
                  <Trash2 size={18} />
                </button>
                <button className="icon-button" title="更多操作">
                  <MoreHorizontal size={18} />
                </button>
              </div>
            </div>
            <div className="reader-scroll">
              <header className="message-header">
                <h1>{detailQuery.data.subject}</h1>
                <div className="message-sender-line">
                  <span className="sender-avatar large">
                    {addressLabel(detailQuery.data).slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{addressLabel(detailQuery.data)}</strong>
                    <span>{detailQuery.data.from[0]?.email}</span>
                    <span>
                      发送给 {detailQuery.data.to.map((address) => address.name || address.email).join('、') || '我'}
                    </span>
                  </div>
                  <time>{fullTime(detailQuery.data.receivedAt)}</time>
                </div>
              </header>

              {!allowRemoteImages && detailQuery.data.bodyHtml.includes('<img') && (
                <button
                  className="remote-image-banner"
                  onClick={() => setRemoteImagesAllowedFor({ accountId: account.id, emailId: detailQuery.data.id })}
                >
                  <span>远程图片已阻止</span>
                  <strong>显示图片</strong>
                </button>
              )}

              <iframe className="mail-body-frame" title="邮件正文" sandbox="allow-popups" srcDoc={mailDocument} />

              {detailQuery.data.attachments.length > 0 && (
                <section className="attachment-section">
                  <h3>{detailQuery.data.attachments.length} 个附件</h3>
                  <div className="attachment-list">
                    {detailQuery.data.attachments.map((attachment) => (
                      <button
                        key={`${attachment.blobId}-${attachment.name}`}
                        className="attachment-row"
                        onClick={() => saveAttachment.mutate(attachment)}
                      >
                        <span className="attachment-icon">
                          <FileText size={19} />
                        </span>
                        <span>
                          <strong>{attachment.name}</strong>
                          <small>{Math.max(1, Math.round(attachment.size / 1024))} KB</small>
                        </span>
                        <Download size={17} />
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <div className="reader-reply-actions">
                <button className="secondary-button" disabled={!canSubmit} onClick={() => reply(detailQuery.data)}>
                  <Reply size={17} />
                  回复
                </button>
                <button className="secondary-button" disabled={!canSubmit} onClick={() => forward(detailQuery.data)}>
                  <Forward size={17} />
                  转发
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
