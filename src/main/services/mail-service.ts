import { randomUUID } from 'node:crypto'
import { writeFile, readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { dialog } from 'electron'
import {
  JMAP_CONTACTS,
  JMAP_CORE,
  JMAP_MAIL,
  JMAP_SUBMISSION,
  type ComposeInput,
  type Contact,
  type ContactInput,
  type DraftResult,
  type EmailAction,
  type EmailAddress,
  type EmailAttachment,
  type EmailDetail,
  type EmailPage,
  type EmailPageInput,
  type EmailSummary,
  type Identity,
  type Mailbox,
  type SubmissionResult,
  type UploadedAttachment,
  type AttachmentSaveInput
} from '@shared/types'
import { AppError } from '../errors'
import { plainTextToHtml, sanitizeMailHtml } from '../security/mail-html'
import type { JmapClient } from '../jmap/jmap-client'
import type { AccountService } from './account-service'

interface GetResponse<T> {
  accountId: string
  state: string
  list: T[]
  notFound?: string[]
}

interface QueryResponse {
  accountId: string
  queryState: string
  canCalculateChanges: boolean
  position: number
  ids: string[]
  total?: number
}

interface SetResponse {
  accountId: string
  oldState: string
  newState: string
  created?: Record<string, { id: string } & Record<string, unknown>>
  updated?: Record<string, unknown> | null
  destroyed?: string[]
  notCreated?: Record<string, { type?: string; description?: string }>
  notUpdated?: Record<string, { type?: string; description?: string }>
  notDestroyed?: Record<string, { type?: string; description?: string }>
}

interface JmapBodyPart {
  partId?: string
  blobId?: string
  size?: number
  name?: string
  type?: string
  charset?: string
  disposition?: string
  cid?: string
  subParts?: JmapBodyPart[]
}

interface RawEmail {
  id: string
  threadId?: string
  mailboxIds?: Record<string, boolean>
  keywords?: Record<string, boolean>
  size?: number
  receivedAt?: string
  sentAt?: string
  from?: EmailAddress[]
  to?: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  replyTo?: EmailAddress[]
  subject?: string
  preview?: string
  hasAttachment?: boolean
  messageId?: string[]
  textBody?: JmapBodyPart[]
  htmlBody?: JmapBodyPart[]
  attachments?: JmapBodyPart[]
  bodyValues?: Record<string, { value?: string; isTruncated?: boolean }>
}

interface RawIdentity {
  id: string
  name?: string
  email?: string
  replyTo?: EmailAddress[]
  bcc?: EmailAddress[]
  mayDelete?: boolean
}

interface RawContact {
  id: string
  addressBookIds?: Record<string, boolean>
  name?: {
    full?: string
    components?: Array<{ value?: string }>
  }
  emails?: Record<string, { address?: string }>
  organizations?: Record<string, { name?: string }>
  notes?: string
}

function cleanAddressList(value: EmailAddress[] | undefined): EmailAddress[] {
  if (!value) return []
  return value
    .filter((address) => typeof address.email === 'string' && address.email.length > 0)
    .map((address) => ({ name: address.name ?? '', email: address.email }))
}

function collectBodyValues(parts: JmapBodyPart[] | undefined, values: RawEmail['bodyValues'], separator: string): string {
  if (!parts || !values) return ''
  const collected: string[] = []
  const visit = (items: JmapBodyPart[] | undefined): void => {
    for (const part of items ?? []) {
      if (part.partId && values[part.partId]?.value) collected.push(values[part.partId]?.value ?? '')
      visit(part.subParts)
    }
  }
  visit(parts)
  return collected.filter(Boolean).join(separator)
}

function mapSummary(raw: RawEmail): EmailSummary {
  const keywords = raw.keywords ?? {}
  return {
    id: raw.id,
    threadId: raw.threadId ?? raw.id,
    mailboxIds: Object.keys(raw.mailboxIds ?? {}).filter((id) => raw.mailboxIds?.[id]),
    from: cleanAddressList(raw.from),
    to: cleanAddressList(raw.to),
    subject: raw.subject?.trim() || '（无主题）',
    preview: raw.preview?.trim() ?? '',
    receivedAt: raw.receivedAt ?? raw.sentAt ?? new Date(0).toISOString(),
    sentAt: raw.sentAt ?? null,
    size: raw.size ?? 0,
    isUnread: !keywords.$seen,
    isFlagged: Boolean(keywords.$flagged),
    isDraft: Boolean(keywords.$draft),
    hasAttachment: Boolean(raw.hasAttachment || raw.attachments?.length)
  }
}

function mapAttachment(part: JmapBodyPart): EmailAttachment | null {
  if (!part.blobId) return null
  return {
    blobId: part.blobId,
    partId: part.partId ?? null,
    name: part.name || '附件',
    type: part.type || 'application/octet-stream',
    size: part.size ?? 0,
    cid: part.cid ?? null,
    disposition: part.disposition ?? null
  }
}

function parseSetError(response: SetResponse, kind: 'create' | 'update' | 'destroy'): void {
  const errors = kind === 'create' ? response.notCreated : kind === 'update' ? response.notUpdated : response.notDestroyed
  const first = errors ? Object.values(errors)[0] : undefined
  if (first) {
    throw new AppError(`JMAP_SET_${(first.type ?? 'FAILED').toUpperCase()}`, first.description ?? '邮件更新失败', first.type === 'serverFail')
  }
}

export class MailService {
  constructor(private readonly accounts: AccountService) {}

  async listMailboxes(accountId: string): Promise<Mailbox[]> {
    const client = this.accounts.getClient(accountId)
    const response = await client.call<GetResponse<Record<string, unknown>>>(
      [JMAP_CORE, JMAP_MAIL],
      'Mailbox/get',
      {
        accountId: client.accountId,
        ids: null,
        properties: [
          'id', 'name', 'parentId', 'role', 'sortOrder', 'totalEmails', 'unreadEmails',
          'totalThreads', 'unreadThreads', 'isSubscribed', 'myRights'
        ]
      }
    )

    return response.list
      .map((item) => ({
        id: String(item.id),
        name: typeof item.name === 'string' ? item.name : '未命名文件夹',
        parentId: typeof item.parentId === 'string' ? item.parentId : null,
        role: typeof item.role === 'string' ? item.role : null,
        sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 0,
        totalEmails: typeof item.totalEmails === 'number' ? item.totalEmails : 0,
        unreadEmails: typeof item.unreadEmails === 'number' ? item.unreadEmails : 0,
        totalThreads: typeof item.totalThreads === 'number' ? item.totalThreads : 0,
        unreadThreads: typeof item.unreadThreads === 'number' ? item.unreadThreads : 0,
        isSubscribed: item.isSubscribed !== false,
        myRights: typeof item.myRights === 'object' && item.myRights ? item.myRights as Record<string, boolean> : {}
      }))
      .sort((a, b) => {
        const roleOrder = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash']
        const aRole = a.role ? roleOrder.indexOf(a.role) : roleOrder.length
        const bRole = b.role ? roleOrder.indexOf(b.role) : roleOrder.length
        return (aRole < 0 ? roleOrder.length : aRole) - (bRole < 0 ? roleOrder.length : bRole) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN')
      })
  }

  async listEmails(input: EmailPageInput): Promise<EmailPage> {
    const client = this.accounts.getClient(input.accountId)
    const filter: Record<string, unknown> = {}
    if (input.mailboxId) filter.inMailbox = input.mailboxId
    if (input.search?.trim()) filter.text = input.search.trim()

    const query = await client.call<QueryResponse>(
      [JMAP_CORE, JMAP_MAIL],
      'Email/query',
      {
        accountId: client.accountId,
        filter,
        sort: [{ property: 'receivedAt', isAscending: false }],
        position: input.position,
        limit: input.limit,
        calculateTotal: true
      },
      'query'
    )

    if (query.ids.length === 0) {
      return {
        items: [],
        position: query.position,
        total: query.total ?? 0,
        hasMore: false,
        queryState: query.queryState
      }
    }

    const emails = await client.call<GetResponse<RawEmail>>(
      [JMAP_CORE, JMAP_MAIL],
      'Email/get',
      {
        accountId: client.accountId,
        ids: query.ids,
        properties: [
          'id', 'threadId', 'mailboxIds', 'keywords', 'size', 'receivedAt', 'sentAt',
          'from', 'to', 'subject', 'preview', 'hasAttachment'
        ]
      },
      'get'
    )
    const byId = new Map(emails.list.map((email) => [email.id, mapSummary(email)]))
    const items = query.ids.flatMap((id) => {
      const item = byId.get(id)
      return item ? [item] : []
    })
    const total = query.total ?? input.position + items.length
    return {
      items,
      position: query.position,
      total,
      hasMore: input.position + items.length < total,
      queryState: query.queryState
    }
  }

  async getEmail(accountId: string, emailId: string): Promise<EmailDetail> {
    const client = this.accounts.getClient(accountId)
    const response = await client.call<GetResponse<RawEmail>>(
      [JMAP_CORE, JMAP_MAIL],
      'Email/get',
      {
        accountId: client.accountId,
        ids: [emailId],
        properties: [
          'id', 'threadId', 'mailboxIds', 'keywords', 'size', 'receivedAt', 'sentAt',
          'from', 'to', 'cc', 'bcc', 'replyTo', 'subject', 'preview', 'hasAttachment',
          'messageId', 'textBody', 'htmlBody', 'attachments', 'bodyValues'
        ],
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
        maxBodyValueBytes: 10_000_000
      }
    )
    const raw = response.list[0]
    if (!raw) throw new AppError('EMAIL_NOT_FOUND', '这封邮件已不存在')
    const summary = mapSummary(raw)
    const bodyText = collectBodyValues(raw.textBody, raw.bodyValues, '\n\n')
    const rawHtml = collectBodyValues(raw.htmlBody, raw.bodyValues, '<div></div>')
    const attachments = (raw.attachments ?? []).flatMap((part) => {
      const attachment = mapAttachment(part)
      return attachment ? [attachment] : []
    })
    return {
      ...summary,
      cc: cleanAddressList(raw.cc),
      bcc: cleanAddressList(raw.bcc),
      replyTo: cleanAddressList(raw.replyTo),
      bodyText,
      bodyHtml: sanitizeMailHtml(rawHtml || plainTextToHtml(bodyText || raw.preview || '')),
      attachments,
      messageId: raw.messageId ?? []
    }
  }

  async updateEmail(accountId: string, emailId: string, action: EmailAction): Promise<void> {
    const client = this.accounts.getClient(accountId)
    if (action.type === 'destroy') {
      const result = await client.call<SetResponse>([JMAP_CORE, JMAP_MAIL], 'Email/set', {
        accountId: client.accountId,
        destroy: [emailId]
      })
      parseSetError(result, 'destroy')
      return
    }

    let patch: Record<string, unknown>
    if (action.type === 'read') {
      patch = { 'keywords/$seen': action.value ? true : null }
    } else if (action.type === 'flagged') {
      patch = { 'keywords/$flagged': action.value ? true : null }
    } else if (action.type === 'move') {
      patch = { mailboxIds: { [action.mailboxId]: true } }
    } else {
      const trash = (await this.listMailboxes(accountId)).find((mailbox) => mailbox.role === 'trash')
      if (!trash) throw new AppError('TRASH_MAILBOX_UNAVAILABLE', '服务器没有可用的垃圾箱')
      patch = { mailboxIds: { [trash.id]: true }, 'keywords/$seen': true }
    }

    const result = await client.call<SetResponse>([JMAP_CORE, JMAP_MAIL], 'Email/set', {
      accountId: client.accountId,
      update: { [emailId]: patch }
    })
    parseSetError(result, 'update')
  }

  async listIdentities(accountId: string): Promise<Identity[]> {
    const client = this.accounts.getClient(accountId)
    if (!client.supports(JMAP_SUBMISSION)) {
      throw new AppError('SUBMISSION_UNAVAILABLE', '该账号没有 JMAP 发信权限')
    }
    const response = await client.call<GetResponse<RawIdentity>>(
      [JMAP_CORE, JMAP_SUBMISSION],
      'Identity/get',
      { accountId: client.accountId, ids: null }
    )
    return response.list.map((identity) => ({
      id: identity.id,
      name: identity.name ?? '',
      email: identity.email ?? '',
      replyTo: cleanAddressList(identity.replyTo),
      bcc: cleanAddressList(identity.bcc),
      mayDelete: Boolean(identity.mayDelete)
    }))
  }

  async saveDraft(input: ComposeInput): Promise<DraftResult> {
    const client = this.accounts.getClient(input.accountId)
    const identities = await this.listIdentities(input.accountId)
    const identity = identities[0]
    if (!identity) throw new AppError('IDENTITY_UNAVAILABLE', '账号没有可用的发信身份')
    const mailboxes = await this.listMailboxes(input.accountId)
    const drafts = mailboxes.find((mailbox) => mailbox.role === 'drafts')
    if (!drafts) throw new AppError('DRAFTS_MAILBOX_UNAVAILABLE', '服务器没有可用的草稿箱')

    const email = this.composeEmail(input, identity, drafts.id)
    const createId = `draft-${randomUUID()}`
    const result = await client.call<SetResponse>([JMAP_CORE, JMAP_MAIL], 'Email/set', {
      accountId: client.accountId,
      create: { [createId]: email }
    })
    parseSetError(result, 'create')
    const emailId = result.created?.[createId]?.id
    if (!emailId) throw new AppError('DRAFT_CREATE_FAILED', '服务器没有返回草稿编号')

    let cleanupWarning: string | undefined
    let authenticationRequired = false
    if (input.draftId) {
      try {
        const cleanup = await client.call<SetResponse>([JMAP_CORE, JMAP_MAIL], 'Email/set', {
          accountId: client.accountId,
          destroy: [input.draftId]
        }, 'cleanup')
        if (Object.keys(cleanup.notDestroyed ?? {}).length > 0) cleanupWarning = '新草稿已保存，但旧草稿未能自动清理'
      } catch (error) {
        cleanupWarning = '新草稿已保存，但旧草稿未能自动清理'
        authenticationRequired = error instanceof AppError && error.code === 'AUTHENTICATION_REQUIRED'
      }
    }
    return { emailId, updatedAt: new Date().toISOString(), cleanupWarning, authenticationRequired }
  }

  async submitDraft(accountId: string, emailId: string): Promise<SubmissionResult> {
    const pendingEmailId = this.accounts.getPendingSubmissionEmailId(accountId) ?? emailId
    this.accounts.savePendingSubmission(accountId, pendingEmailId)
    const client = this.accounts.getClient(accountId)
    if (!client.supports(JMAP_SUBMISSION)) {
      this.accounts.clearPendingSubmission(accountId)
      throw new AppError('SUBMISSION_UNAVAILABLE', '该账号没有 JMAP 发信权限')
    }

    const mailboxes = await this.listMailboxes(accountId)
    const drafts = mailboxes.find((mailbox) => mailbox.role === 'drafts')
    const sent = mailboxes.find((mailbox) => mailbox.role === 'sent')
    if (!drafts) {
      this.accounts.clearPendingSubmission(accountId)
      throw new AppError('DRAFTS_MAILBOX_UNAVAILABLE', '服务器没有可用的草稿箱')
    }
    if (!sent) {
      this.accounts.clearPendingSubmission(accountId)
      throw new AppError('SENT_MAILBOX_UNAVAILABLE', '服务器没有可用的已发送邮箱')
    }

    const existingSubmission = await client.call<QueryResponse>([JMAP_CORE, JMAP_SUBMISSION], 'EmailSubmission/query', {
      accountId: client.accountId,
      filter: { emailIds: [pendingEmailId] },
      position: 0,
      limit: 1
    }, 'recover')
    if (existingSubmission.ids[0]) {
      const cleanupWarning = await this.archiveSubmittedEmail(client, pendingEmailId, drafts.id, sent.id)
      this.accounts.clearPendingSubmission(accountId)
      return { emailId: pendingEmailId, submissionId: existingSubmission.ids[0], status: 'submitted', cleanupWarning }
    }

    const identities = await this.listIdentities(accountId)
    const identity = identities[0]
    if (!identity) {
      this.accounts.clearPendingSubmission(accountId)
      throw new AppError('IDENTITY_UNAVAILABLE', '账号没有可用的发信身份')
    }

    const submissionKey = `submission-${randomUUID()}`
    const methodCalls = await client.callMany(
      [JMAP_CORE, JMAP_MAIL, JMAP_SUBMISSION],
      [['EmailSubmission/set', {
        accountId: client.accountId,
        create: {
          [submissionKey]: {
            identityId: identity.id,
            emailId: pendingEmailId
          }
        },
        onSuccessUpdateEmail: {
          [`#${submissionKey}`]: {
            [`mailboxIds/${drafts.id}`]: null,
            [`mailboxIds/${sent.id}`]: true,
            'keywords/$draft': null,
            'keywords/$seen': true
          }
        }
      }, 'submit']],
      { timeoutMs: 60_000 }
    )
    const primary = methodCalls.find(([name, , callId]) => callId === 'submit' && name !== 'Email/set')
    if (!primary) throw new AppError('SUBMISSION_RESPONSE_MISSING', '服务器没有返回邮件提交结果', true)
    if (primary[0] === 'error') {
      this.accounts.clearPendingSubmission(accountId)
      const details = primary[1] as { type?: string; description?: string }
      throw new AppError(`JMAP_${(details.type ?? 'SUBMISSION_FAILED').toUpperCase()}`, details.description ?? '邮件提交失败', details.type === 'serverFail')
    }
    const submission = primary[1] as SetResponse
    try {
      parseSetError(submission, 'create')
    } catch (error) {
      this.accounts.clearPendingSubmission(accountId)
      throw error
    }
    const submissionId = submission.created?.[submissionKey]?.id
    if (!submissionId) throw new AppError('SUBMISSION_CREATE_FAILED', '服务器没有确认邮件提交状态', true)

    const implicitUpdate = methodCalls.find(([name, , callId]) => name === 'Email/set' && callId === 'submit')
    const implicitErrors = implicitUpdate?.[1] as SetResponse | undefined
    let cleanupWarning: string | undefined
    if (!implicitUpdate || Object.keys(implicitErrors?.notUpdated ?? {}).length > 0) {
      cleanupWarning = await this.archiveSubmittedEmail(client, pendingEmailId, drafts.id, sent.id)
    }

    this.accounts.clearPendingSubmission(accountId)
    return { emailId: pendingEmailId, submissionId, status: 'submitted', cleanupWarning }
  }

  private async archiveSubmittedEmail(client: JmapClient, emailId: string, draftsId: string, sentId: string): Promise<string | undefined> {
    try {
      const email = await client.call<GetResponse<{ id: string; mailboxIds?: Record<string, boolean>; keywords?: Record<string, boolean> }>>(
        [JMAP_CORE, JMAP_MAIL],
        'Email/get',
        { accountId: client.accountId, ids: [emailId], properties: ['id', 'mailboxIds', 'keywords'] },
        'archive-get'
      )
      const current = email.list[0]
      if (!current) return '邮件已发送，但服务端未能找到待归档邮件'
      const mailboxIds = { ...(current.mailboxIds ?? {}), [sentId]: true }
      delete mailboxIds[draftsId]
      const keywords: Record<string, boolean> = { ...(current.keywords ?? {}), '$seen': true }
      delete keywords.$draft
      const result = await client.call<SetResponse>([JMAP_CORE, JMAP_MAIL], 'Email/set', {
        accountId: client.accountId,
        update: { [emailId]: { mailboxIds, keywords } }
      }, 'archive-set')
      parseSetError(result, 'update')
      return undefined
    } catch (error) {
      if (error instanceof AppError && error.code === 'AUTHENTICATION_REQUIRED') throw error
      return '邮件已发送，但服务端未完成草稿归档'
    }
  }

  async pickAttachments(accountId: string): Promise<UploadedAttachment[]> {
    const client = this.accounts.getClient(accountId)
    const result = await dialog.showOpenDialog({
      title: '选择附件',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '所有文件', extensions: ['*'] }]
    })
    if (result.canceled) return []

    const uploaded: UploadedAttachment[] = []
    for (const filePath of result.filePaths) {
      const data = await readFile(filePath)
      if (data.byteLength > 50 * 1024 * 1024) {
        throw new AppError('ATTACHMENT_TOO_LARGE', `附件 ${basename(filePath)} 超过服务器 50 MB 限制`)
      }
      uploaded.push(await client.upload(data, basename(filePath), 'application/octet-stream'))
    }
    return uploaded
  }

  async saveAttachment(input: AttachmentSaveInput): Promise<boolean> {
    const client = this.accounts.getClient(input.accountId)
    const result = await dialog.showSaveDialog({ title: '保存附件', defaultPath: input.name })
    if (result.canceled || !result.filePath) return false
    const data = await client.download(input.blobId, input.name, input.type)
    await writeFile(result.filePath, data)
    return true
  }

  async listContacts(accountId: string, search = ''): Promise<Contact[]> {
    const client = this.accounts.getClient(accountId)
    if (!client.supports(JMAP_CONTACTS)) {
      throw new AppError('CONTACTS_UNAVAILABLE', '该账号没有 JMAP 联系人权限')
    }
    const query = await client.call<QueryResponse>([JMAP_CORE, JMAP_CONTACTS], 'ContactCard/query', {
      accountId: client.accountId,
      filter: search.trim() ? { text: search.trim() } : {},
      sort: [{ property: 'name', isAscending: true }],
      position: 0,
      limit: 200
    })
    if (!query.ids.length) return []
    const cards = await client.call<GetResponse<RawContact>>([JMAP_CORE, JMAP_CONTACTS], 'ContactCard/get', {
      accountId: client.accountId,
      ids: query.ids
    })
    return cards.list.map((card) => this.mapContact(card))
  }

  async saveContact(input: ContactInput): Promise<Contact> {
    const client = this.accounts.getClient(input.accountId)
    if (!client.supports(JMAP_CONTACTS)) {
      throw new AppError('CONTACTS_UNAVAILABLE', '该账号没有 JMAP 联系人权限')
    }
    const addressBooks = await client.call<GetResponse<{ id: string }>>([JMAP_CORE, JMAP_CONTACTS], 'AddressBook/get', {
      accountId: client.accountId,
      ids: null,
      properties: ['id']
    })
    const addressBook = addressBooks.list[0]
    if (!addressBook) throw new AppError('ADDRESS_BOOK_UNAVAILABLE', '服务器没有可用的通讯录')

    const card = {
      '@type': 'Card',
      version: '1.0',
      kind: 'individual',
      addressBookIds: { [addressBook.id]: true },
      name: { '@type': 'Name', full: input.name },
      emails: {
        primary: { '@type': 'EmailAddress', address: input.email, contexts: { work: true } }
      },
      organizations: input.company ? {
        primary: { '@type': 'Organization', name: input.company }
      } : {},
      notes: input.notes ?? ''
    }

    if (input.contactId) {
      const response = await client.call<SetResponse>([JMAP_CORE, JMAP_CONTACTS], 'ContactCard/set', {
        accountId: client.accountId,
        update: { [input.contactId]: card }
      })
      parseSetError(response, 'update')
      return { id: input.contactId, addressBookIds: [addressBook.id], name: input.name, emails: [input.email], company: input.company ?? '', notes: input.notes ?? '' }
    }

    const createKey = `contact-${randomUUID()}`
    const response = await client.call<SetResponse>([JMAP_CORE, JMAP_CONTACTS], 'ContactCard/set', {
      accountId: client.accountId,
      create: { [createKey]: card }
    })
    parseSetError(response, 'create')
    const id = response.created?.[createKey]?.id
    if (!id) throw new AppError('CONTACT_CREATE_FAILED', '服务器没有返回联系人编号')
    return { id, addressBookIds: [addressBook.id], name: input.name, emails: [input.email], company: input.company ?? '', notes: input.notes ?? '' }
  }

  async deleteContact(accountId: string, contactId: string): Promise<void> {
    const client = this.accounts.getClient(accountId)
    const response = await client.call<SetResponse>([JMAP_CORE, JMAP_CONTACTS], 'ContactCard/set', {
      accountId: client.accountId,
      destroy: [contactId]
    })
    parseSetError(response, 'destroy')
  }

  private composeEmail(input: ComposeInput, identity: Identity, draftsMailboxId: string): Record<string, unknown> {
    const html = sanitizeMailHtml(input.html || plainTextToHtml(input.text))
    return {
      mailboxIds: { [draftsMailboxId]: true },
      keywords: { $draft: true, $seen: true },
      from: [{ name: identity.name, email: identity.email }],
      to: input.to.map((email) => ({ email })),
      cc: input.cc.map((email) => ({ email })),
      bcc: input.bcc.map((email) => ({ email })),
      subject: input.subject,
      textBody: [{ partId: 'text', type: 'text/plain' }],
      htmlBody: [{ partId: 'html', type: 'text/html' }],
      bodyValues: {
        text: { value: input.text },
        html: { value: html }
      },
      attachments: input.attachments.map((attachment) => ({
        blobId: attachment.blobId,
        type: attachment.type,
        name: attachment.name,
        size: attachment.size,
        disposition: 'attachment'
      }))
    }
  }

  private mapContact(card: RawContact): Contact {
    const name = card.name?.full
      || card.name?.components?.map((component) => component.value ?? '').filter(Boolean).join(' ')
      || '未命名联系人'
    const emails = Object.values(card.emails ?? {}).flatMap((email) => email.address ? [email.address] : [])
    const company = Object.values(card.organizations ?? {}).map((organization) => organization.name ?? '').find(Boolean) ?? ''
    return {
      id: card.id,
      addressBookIds: Object.keys(card.addressBookIds ?? {}).filter((id) => card.addressBookIds?.[id]),
      name,
      emails,
      company,
      notes: card.notes ?? ''
    }
  }
}
