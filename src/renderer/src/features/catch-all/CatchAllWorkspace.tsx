import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  Inbox,
  KeyRound,
  Link2,
  LoaderCircle,
  MailOpen,
  Radar,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import { format } from 'date-fns'
import type { IngressMessageDetail } from '@shared/types'
import { createMailDocument } from '../../lib/mail-document'
import { errorMessage, unwrap } from '../../lib/api'
import { useAppStore } from '../../store/use-app-store'

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>')
}

function ingressTime(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return format(date, 'MM-dd HH:mm')
}

export function CatchAllWorkspace(): React.JSX.Element {
  const queryClient = useQueryClient()
  const notify = useAppStore((state) => state.notify)
  const [recipient, setRecipient] = useState<string | undefined>()
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [remoteImagesAllowedForId, setRemoteImagesAllowedForId] = useState<number | null>(null)

  const configurationQuery = useQuery({
    queryKey: ['ingress-configuration'],
    queryFn: async () => unwrap(await window.mailApi.getIngressConfiguration())
  })
  const messagesQuery = useQuery({
    queryKey: ['ingress-messages', recipient, search],
    queryFn: async () => unwrap(await window.mailApi.listIngressMessages({ recipient, search: search || undefined, limit: 100 })),
    enabled: configurationQuery.data?.configured === true
  })
  const detailQuery = useQuery({
    queryKey: ['ingress-message', selectedId],
    queryFn: async () => unwrap(await window.mailApi.getIngressMessage(selectedId!)),
    enabled: selectedId !== null
  })

  useEffect(() => {
    setSelectedId(null)
  }, [recipient, search])

  const deleteMessage = useMutation({
    mutationFn: async (id: number) => unwrap(await window.mailApi.deleteIngressMessage(id)),
    onSuccess: () => {
      setSelectedId(null)
      notify('邮件已删除', 'success')
      void queryClient.invalidateQueries({ queryKey: ['ingress-messages'] })
    },
    onError: (error) => notify(errorMessage(error), 'error')
  })
  const deleteRecipient = useMutation({
    mutationFn: async (address: string) => unwrap(await window.mailApi.deleteIngressRecipient(address)),
    onSuccess: () => {
      setRecipient(undefined)
      setSelectedId(null)
      notify('该地址的邮件已清理', 'success')
      void queryClient.invalidateQueries({ queryKey: ['ingress-messages'] })
    },
    onError: (error) => notify(errorMessage(error), 'error')
  })
  const saveRaw = useMutation({
    mutationFn: async (detail: IngressMessageDetail) => unwrap(await window.mailApi.saveIngressRaw(detail.id, detail.subject)),
    onSuccess: (saved) => saved && notify('原始邮件已保存', 'success'),
    onError: (error) => notify(errorMessage(error), 'error')
  })
  const saveAttachment = useMutation({
    mutationFn: async ({ detail, attachment }: { detail: IngressMessageDetail; attachment: IngressMessageDetail['attachments'][number] }) => unwrap(await window.mailApi.saveIngressAttachment({
      messageId: detail.id,
      part: attachment.part,
      name: attachment.name,
      type: attachment.type
    })),
    onSuccess: (saved) => saved && notify('附件已保存', 'success'),
    onError: (error) => notify(errorMessage(error), 'error')
  })

  const allowRemoteImages = detailQuery.data !== undefined && remoteImagesAllowedForId === detailQuery.data.id
  const document = useMemo(() => {
    const detail = detailQuery.data
    if (!detail) return ''
    return createMailDocument(detail.bodyHtml || `<p>${escapeText(detail.bodyText)}</p>`, allowRemoteImages)
  }, [detailQuery.data, allowRemoteImages])

  if (configurationQuery.isPending) {
    return <div className="center-state fill"><LoaderCircle className="spin" size={24} /><span>正在读取全域收件设置</span></div>
  }

  if (!configurationQuery.data?.configured) {
    return <IngressSetup />
  }

  return (
    <div className="catchall-workspace">
      <aside className="recipient-pane">
        <div className="section-heading compact-heading">
          <div><h1>全域收件</h1><span>Catch-all 地址流</span></div>
          <span className="version-badge">API v{configurationQuery.data.apiVersion}</span>
        </div>
        <button className={`recipient-all ${!recipient ? 'active' : ''}`} onClick={() => setRecipient(undefined)}>
          <Radar size={17} />
          <span>所有地址</span>
          <strong>{messagesQuery.data?.items.length ?? 0}</strong>
        </button>
        <div className="recipient-list">
          {messagesQuery.data?.recipients.map((item) => (
            <button className={`recipient-row ${recipient === item.address ? 'active' : ''}`} key={item.address} onClick={() => setRecipient(item.address)}>
              <span className="recipient-avatar">{item.address.slice(0, 1).toUpperCase()}</span>
              <span><strong>{item.address.split('@')[0]}</strong><small>@{item.address.split('@')[1]}</small></span>
              <b>{item.count}</b>
            </button>
          ))}
        </div>
        {recipient && (
          <button className="danger-text-button recipient-clear" onClick={() => {
            if (window.confirm(`确认删除 ${recipient} 的全部全域收件邮件？此操作无法撤销。`)) deleteRecipient.mutate(recipient)
          }} disabled={deleteRecipient.isPending}>
            <Trash2 size={15} />清理此地址
          </button>
        )}
      </aside>

      <section className="message-pane ingress-message-pane">
        <div className="message-pane-header">
          <div><h2>{recipient ? recipient.split('@')[0] : '最近邮件'}</h2><span>{messagesQuery.data?.items.length ?? 0} 封</span></div>
          <button className="icon-button" title="刷新" onClick={() => void messagesQuery.refetch()}><RefreshCw className={messagesQuery.isFetching ? 'spin' : ''} size={17} /></button>
        </div>
        <form className="mail-search" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()) }}>
          <Search size={17} />
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索全域收件" />
          {searchDraft && <button type="button" title="清除" onClick={() => { setSearchDraft(''); setSearch('') }}><X size={15} /></button>}
        </form>
        <div className="message-list">
          {messagesQuery.isPending && <div className="center-state"><LoaderCircle className="spin" size={23} /><span>正在加载</span></div>}
          {messagesQuery.error && <div className="center-state error-state"><Inbox size={28} /><strong>无法加载邮件</strong><span>{errorMessage(messagesQuery.error)}</span></div>}
          {messagesQuery.data?.items.length === 0 && <div className="center-state"><Inbox size={29} /><strong>没有收到邮件</strong></div>}
          {messagesQuery.data?.items.map((message) => (
            <button className={`message-row ingress-row ${selectedId === message.id ? 'selected' : ''}`} key={message.id} onClick={() => setSelectedId(message.id)}>
              <span className="sender-avatar">{(message.from || '?').slice(0, 1).toUpperCase()}</span>
              <span className="message-row-content">
                <span className="message-row-top"><strong>{message.from || '未知发件人'}</strong><time>{ingressTime(message.createdAt)}</time></span>
                <span className="message-subject">{message.subject}</span>
                <span className="message-preview">{message.preview || message.to}</span>
              </span>
              {message.otpCode && <span className="otp-indicator"><KeyRound size={12} />{message.otpCode}</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="reader-pane ingress-reader">
        {!selectedId && <div className="reader-empty"><span className="reader-empty-icon"><Radar size={34} /></span><strong>选择一封邮件</strong><span>验证码与邮件内容将在这里显示</span></div>}
        {detailQuery.isPending && selectedId && <div className="center-state fill"><LoaderCircle className="spin" size={23} /></div>}
        {detailQuery.error && <div className="center-state fill error-state"><MailOpen size={29} /><strong>邮件无法打开</strong><span>{errorMessage(detailQuery.error)}</span></div>}
        {detailQuery.data && (
          <>
            <div className="reader-toolbar">
              <div className="ingress-route"><ShieldCheck size={16} /><span>投递至 {detailQuery.data.to}</span></div>
              <div className="reader-toolbar-group">
                <button className="icon-button" title="保存原始邮件" disabled={messagesQuery.data?.apiVersion !== 2} onClick={() => saveRaw.mutate(detailQuery.data)}><Download size={18} /></button>
                <button className="icon-button danger-hover" title="删除邮件" disabled={messagesQuery.data?.apiVersion !== 2} onClick={() => {
                  if (window.confirm('确认永久删除这封全域收件邮件？')) deleteMessage.mutate(detailQuery.data.id)
                }}><Trash2 size={18} /></button>
              </div>
            </div>
            <div className="reader-scroll">
              <header className="message-header ingress-header">
                <h1>{detailQuery.data.subject}</h1>
                <div className="message-sender-line">
                  <span className="sender-avatar large">{detailQuery.data.from.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{detailQuery.data.from}</strong><span>发送给 {detailQuery.data.to}</span></div>
                  <time>{new Date(detailQuery.data.createdAt * 1000).toLocaleString('zh-CN')}</time>
                </div>
              </header>

              {detailQuery.data.otpCode && <OtpPanel detail={detailQuery.data} onCopied={() => notify('验证码已复制', 'success')} />}

              {detailQuery.data.links.length > 0 && (
                <section className="detected-links">
                  <h3><Link2 size={16} />检测到的链接</h3>
                  {detailQuery.data.links.slice(0, 8).map((link) => {
                    let host = link
                    try { host = new URL(link).hostname } catch { /* 保留原始地址 */ }
                    return <button key={link} onClick={() => void window.mailApi.openExternal(link)}><span>{host}</span><small>{link}</small><ExternalLink size={15} /></button>
                  })}
                </section>
              )}

              {!allowRemoteImages && detailQuery.data.bodyHtml.includes('<img') && <button className="remote-image-banner" onClick={() => setRemoteImagesAllowedForId(detailQuery.data.id)}><span>远程图片已阻止</span><strong>显示图片</strong></button>}
              <iframe className="mail-body-frame" title="邮件正文" sandbox="allow-popups" srcDoc={document} />

              {detailQuery.data.attachments.length > 0 && (
                <section className="attachment-section">
                  <h3>{detailQuery.data.attachments.length} 个附件</h3>
                  <div className="attachment-list">
                    {detailQuery.data.attachments.map((attachment) => (
                      <button
                        className="attachment-row"
                        key={attachment.part}
                        onClick={() => saveAttachment.mutate({ detail: detailQuery.data, attachment })}
                      >
                        <span className="attachment-icon"><FileText size={19} /></span>
                        <span><strong>{attachment.name}</strong><small>{Math.max(1, Math.round(attachment.size / 1024))} KB</small></span>
                        <Download size={17} />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function OtpPanel({ detail, onCopied }: { detail: IngressMessageDetail; onCopied(): void }): React.JSX.Element {
  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(detail.otpCode)
    onCopied()
  }
  return (
    <section className="otp-panel">
      <div><KeyRound size={18} /><span>检测到的验证码</span></div>
      <strong>{detail.otpCode}</strong>
      <button className="secondary-button" onClick={() => void copy()}><Clipboard size={16} />复制</button>
    </section>
  )
}

function IngressSetup(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [baseUrl, setBaseUrl] = useState('https://mail.onprs.online')
  const [secret, setSecret] = useState('')
  const configure = useMutation({
    mutationFn: async () => unwrap(await window.mailApi.configureIngress({ baseUrl, secret })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ingress-configuration'] })
    }
  })

  return (
    <div className="feature-setup">
      <div className="feature-setup-icon"><Radar size={29} /></div>
      <h1>连接全域收件</h1>
      <p>使用服务器 Ingress 令牌访问 Catch-all 邮件</p>
      <form onSubmit={(event) => { event.preventDefault(); configure.mutate() }}>
        <label className="field-label" htmlFor="ingress-url">服务地址</label>
        <div className="input-with-icon"><Server size={17} /><input id="ingress-url" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required /></div>
        <label className="field-label" htmlFor="ingress-secret">Ingress 令牌</label>
        <div className="input-with-icon"><KeyRound size={17} /><input id="ingress-secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} minLength={32} required autoComplete="off" /></div>
        {configure.error && <div className="form-error">{errorMessage(configure.error)}</div>}
        <button className="primary-button" type="submit" disabled={configure.isPending || !secret}>
          {configure.isPending ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}
          {configure.isPending ? '正在验证' : '连接服务'}
        </button>
      </form>
    </div>
  )
}
