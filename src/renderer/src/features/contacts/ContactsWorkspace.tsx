import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  ContactRound,
  LoaderCircle,
  Mail,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  UserRound,
  X
} from 'lucide-react'
import type { AccountSummary, Contact } from '@shared/types'
import { JMAP_SUBMISSION } from '@shared/types'
import { errorMessage, unwrap } from '../../lib/api'
import { useAppStore } from '../../store/use-app-store'

export function ContactsWorkspace({ account }: { account: AccountSummary }): React.JSX.Element {
  const queryClient = useQueryClient()
  const notify = useAppStore((state) => state.notify)
  const openCompose = useAppStore((state) => state.openCompose)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const canSubmit = account.capabilities.includes(JMAP_SUBMISSION)

  const contactsQuery = useQuery({
    queryKey: ['contacts', account.id, search],
    queryFn: async () => unwrap(await window.mailApi.listContacts(account.id, search || undefined))
  })
  const selected = contactsQuery.data?.find((contact) => contact.id === selectedId) ?? null

  const deleteContact = useMutation({
    mutationFn: async (contactId: string) => unwrap(await window.mailApi.deleteContact(account.id, contactId)),
    onSuccess: () => {
      setSelectedId(null)
      notify('联系人已删除', 'success')
      void queryClient.invalidateQueries({ queryKey: ['contacts', account.id] })
    },
    onError: (error) => notify(errorMessage(error), 'error')
  })

  return (
    <div className="contacts-workspace">
      <section className="contacts-list-pane">
        <div className="section-heading contacts-heading">
          <div>
            <h1>联系人</h1>
            <span>{contactsQuery.data?.length ?? 0} 位</span>
          </div>
          <button
            className="primary-icon-button"
            title="新建联系人"
            onClick={() => {
              setSelectedId(null)
              setEditing(true)
            }}
          >
            <Plus size={18} />
          </button>
        </div>
        <form
          className="mail-search contacts-search"
          onSubmit={(event) => {
            event.preventDefault()
            setSearch(searchDraft.trim())
          }}
        >
          <Search size={17} />
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="搜索联系人"
          />
          {searchDraft && (
            <button
              type="button"
              title="清除"
              onClick={() => {
                setSearchDraft('')
                setSearch('')
              }}
            >
              <X size={15} />
            </button>
          )}
        </form>
        <div className="contacts-list">
          {contactsQuery.isPending && (
            <div className="center-state">
              <LoaderCircle className="spin" size={23} />
              <span>正在同步联系人</span>
            </div>
          )}
          {contactsQuery.error && (
            <div className="center-state error-state">
              <ContactRound size={29} />
              <strong>无法加载联系人</strong>
              <span>{errorMessage(contactsQuery.error)}</span>
            </div>
          )}
          {contactsQuery.data?.length === 0 && (
            <div className="center-state">
              <ContactRound size={29} />
              <strong>通讯录为空</strong>
            </div>
          )}
          {contactsQuery.data?.map((contact) => (
            <button
              className={`contact-row ${selectedId === contact.id ? 'selected' : ''}`}
              key={contact.id}
              onClick={() => {
                setSelectedId(contact.id)
                setEditing(false)
              }}
            >
              <span className="contact-avatar">{contact.name.slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{contact.name}</strong>
                <small>{contact.emails[0] || '无邮箱地址'}</small>
              </span>
              {contact.company && <Building2 size={14} />}
            </button>
          ))}
        </div>
      </section>

      <section className="contact-detail-pane">
        {editing ? (
          <ContactEditor
            key={selected?.id ?? 'new'}
            account={account}
            contact={selected}
            onClose={() => setEditing(false)}
          />
        ) : selected ? (
          <div className="contact-profile">
            <div className="contact-profile-actions">
              <button className="secondary-button" onClick={() => setEditing(true)}>
                <UserRound size={16} />
                编辑
              </button>
              <button
                className="icon-button danger-hover"
                title="删除联系人"
                onClick={() => {
                  if (window.confirm(`确认删除联系人“${selected.name}”？`)) deleteContact.mutate(selected.id)
                }}
              >
                <Trash2 size={17} />
              </button>
            </div>
            <span className="contact-avatar profile-avatar">{selected.name.slice(0, 1).toUpperCase()}</span>
            <h1>{selected.name}</h1>
            {selected.company && <p>{selected.company}</p>}
            <div className="contact-fields">
              {selected.emails.map((email) => (
                <button
                  key={email}
                  onClick={() => openCompose({ to: [email] })}
                  disabled={!canSubmit}
                  title={canSubmit ? '撰写邮件' : '该账号没有发信权限'}
                >
                  <Mail size={17} />
                  <span>
                    <small>邮箱</small>
                    <strong>{email}</strong>
                  </span>
                  <Send size={16} />
                </button>
              ))}
              {selected.notes && (
                <div className="contact-note">
                  <small>备注</small>
                  <p>{selected.notes}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="reader-empty">
            <span className="reader-empty-icon">
              <ContactRound size={34} />
            </span>
            <strong>选择一位联系人</strong>
            <span>联系人信息将在这里显示</span>
          </div>
        )}
      </section>
    </div>
  )
}

function ContactEditor({
  account,
  contact,
  onClose
}: {
  account: AccountSummary
  contact: Contact | null
  onClose(): void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const notify = useAppStore((state) => state.notify)
  const [name, setName] = useState(contact?.name ?? '')
  const [email, setEmail] = useState(contact?.emails[0] ?? '')
  const [company, setCompany] = useState(contact?.company ?? '')
  const [notes, setNotes] = useState(contact?.notes ?? '')

  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await window.mailApi.saveContact({
          accountId: account.id,
          contactId: contact?.id,
          name,
          email,
          company,
          notes
        })
      ),
    onSuccess: () => {
      notify('联系人已保存', 'success')
      void queryClient.invalidateQueries({ queryKey: ['contacts', account.id] })
      onClose()
    },
    onError: (error) => notify(errorMessage(error), 'error')
  })

  return (
    <form
      className="contact-editor"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <header>
        <div>
          <h1>{contact ? '编辑联系人' : '新建联系人'}</h1>
          <span>{account.email}</span>
        </div>
        <button type="button" className="icon-button" title="关闭" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <label className="field-label" htmlFor="contact-name">
        姓名
      </label>
      <div className="input-with-icon">
        <UserRound size={17} />
        <input id="contact-name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
      </div>
      <label className="field-label" htmlFor="contact-email">
        邮箱
      </label>
      <div className="input-with-icon">
        <Mail size={17} />
        <input
          id="contact-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <label className="field-label" htmlFor="contact-company">
        组织
      </label>
      <div className="input-with-icon">
        <Building2 size={17} />
        <input id="contact-company" value={company} onChange={(event) => setCompany(event.target.value)} />
      </div>
      <label className="field-label" htmlFor="contact-notes">
        备注
      </label>
      <textarea id="contact-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} />
      <div className="contact-editor-actions">
        <button type="button" className="secondary-button" onClick={onClose}>
          取消
        </button>
        <button className="primary-button" type="submit" disabled={save.isPending}>
          {save.isPending ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存
        </button>
      </div>
    </form>
  )
}
