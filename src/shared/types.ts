export const JMAP_CORE = 'urn:ietf:params:jmap:core'
export const JMAP_MAIL = 'urn:ietf:params:jmap:mail'
export const JMAP_SUBMISSION = 'urn:ietf:params:jmap:submission'
export const JMAP_CONTACTS = 'urn:ietf:params:jmap:contacts'
export const JMAP_QUOTA = 'urn:ietf:params:jmap:quota'

export type AppView = 'mail' | 'catch-all' | 'contacts' | 'status' | 'settings'
export type ThemeMode = 'system' | 'light' | 'dark'

export interface IpcError {
  code: string
  message: string
  retryable: boolean
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

export interface AccountConnectionInput {
  email: string
  password: string
  serverUrl: string
  displayName?: string
  remember: boolean
}

export type RegistrationCredentialInput =
  { source: 'saved' } | { source: 'new'; registrationCode: string; remember: boolean }

export interface AccountRegistrationInput {
  localPart: string
  password: string
  registrationCredential: RegistrationCredentialInput
  displayName?: string
  remember: boolean
}

export interface RegistrationCredentialStatus {
  hasSavedRegistrationCode: boolean
}

export type RegistrationCredentialUpdate = 'saved' | 'cleared' | 'unchanged' | 'unconfirmed' | 'failed'

export interface AccountRegistrationResult {
  account: AccountSummary
  registrationCredentialUpdate: RegistrationCredentialUpdate
}

export interface AccountSummary {
  id: string
  email: string
  displayName: string
  serverUrl: string
  jmapAccountId: string
  capabilities: string[]
  createdAt: string
  lastConnectedAt: string
  requiresAuthentication: boolean
  pendingSubmissionEmailId?: string
}

export interface EmailAddress {
  name: string
  email: string
}

export interface Mailbox {
  id: string
  name: string
  parentId: string | null
  role: string | null
  sortOrder: number
  totalEmails: number
  unreadEmails: number
  totalThreads: number
  unreadThreads: number
  isSubscribed: boolean
  myRights: Record<string, boolean>
}

export interface EmailAttachment {
  blobId: string
  partId: string | null
  name: string
  type: string
  size: number
  cid: string | null
  disposition: string | null
}

export interface EmailSummary {
  id: string
  threadId: string
  mailboxIds: string[]
  from: EmailAddress[]
  to: EmailAddress[]
  subject: string
  preview: string
  receivedAt: string
  sentAt: string | null
  size: number
  isUnread: boolean
  isFlagged: boolean
  isDraft: boolean
  hasAttachment: boolean
}

export interface EmailDetail extends EmailSummary {
  cc: EmailAddress[]
  bcc: EmailAddress[]
  replyTo: EmailAddress[]
  bodyText: string
  bodyHtml: string
  attachments: EmailAttachment[]
  messageId: string[]
}

export interface EmailPageInput {
  accountId: string
  mailboxId?: string
  search?: string
  position: number
  limit: number
}

export interface EmailPage {
  items: EmailSummary[]
  position: number
  total: number
  hasMore: boolean
  queryState: string
}

export type EmailAction =
  | { type: 'read'; value: boolean }
  | { type: 'flagged'; value: boolean }
  | { type: 'move'; mailboxId: string }
  | { type: 'trash' }
  | { type: 'destroy' }

export interface UploadedAttachment {
  blobId: string
  name: string
  type: string
  size: number
}

export interface ComposeInput {
  accountId: string
  draftId?: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html: string
  attachments: UploadedAttachment[]
}

export interface DraftResult {
  emailId: string
  updatedAt: string
  cleanupWarning?: string
  authenticationRequired?: boolean
}

export interface SubmissionResult {
  emailId: string
  submissionId: string
  status: 'submitted'
  cleanupWarning?: string
}

export interface Identity {
  id: string
  name: string
  email: string
  replyTo: EmailAddress[]
  bcc: EmailAddress[]
  mayDelete: boolean
}

export interface Contact {
  id: string
  addressBookIds: string[]
  name: string
  emails: string[]
  company: string
  notes: string
}

export interface ContactInput {
  accountId: string
  contactId?: string
  name: string
  email: string
  company?: string
  notes?: string
}

export interface IngressConfigurationInput {
  baseUrl: string
  secret: string
}

export interface IngressConfiguration {
  configured: boolean
  baseUrl: string
  apiVersion: 1 | 2
}

export interface IngressRecipient {
  address: string
  count: number
  latestAt: number
}

export interface IngressMessageSummary {
  id: number
  messageId: string
  from: string
  to: string
  subject: string
  preview: string
  otpCode: string
  hasHtml: boolean
  createdAt: number
  isRead: boolean
}

export interface IngressMessageDetail extends IngressMessageSummary {
  bodyText: string
  bodyHtml: string
  links: string[]
  attachments: Array<{
    part: string
    name: string
    type: string
    size: number
  }>
}

export interface IngressAttachmentSaveInput {
  messageId: number
  part: string
  name: string
  type: string
}

export interface IngressPageInput {
  recipient?: string
  search?: string
  cursor?: number
  limit: number
}

export interface IngressPage {
  items: IngressMessageSummary[]
  recipients: IngressRecipient[]
  nextCursor: number | null
  apiVersion: 1 | 2
}

export interface ServiceCheck {
  id: string
  name: string
  status: 'healthy' | 'warning' | 'offline'
  detail: string
  latencyMs: number | null
}

export interface SystemStatus {
  checkedAt: string
  checks: ServiceCheck[]
}

export interface AppSettings {
  theme: ThemeMode
  notifications: boolean
  remoteImages: 'blocked' | 'allowed'
  pageSize: number
}

export interface AttachmentSaveInput {
  accountId: string
  blobId: string
  name: string
  type: string
}

export interface DesktopApi {
  listAccounts(): Promise<IpcResult<AccountSummary[]>>
  connectAccount(input: AccountConnectionInput): Promise<IpcResult<AccountSummary>>
  registerAccount(input: AccountRegistrationInput): Promise<IpcResult<AccountRegistrationResult>>
  getRegistrationCredentialStatus(): Promise<IpcResult<RegistrationCredentialStatus>>
  forgetRegistrationCredential(): Promise<IpcResult<void>>
  removeAccount(accountId: string): Promise<IpcResult<void>>
  listMailboxes(accountId: string): Promise<IpcResult<Mailbox[]>>
  listEmails(input: EmailPageInput): Promise<IpcResult<EmailPage>>
  getEmail(accountId: string, emailId: string): Promise<IpcResult<EmailDetail>>
  updateEmail(accountId: string, emailId: string, action: EmailAction): Promise<IpcResult<void>>
  saveDraft(input: ComposeInput): Promise<IpcResult<DraftResult>>
  submitDraft(accountId: string, emailId: string): Promise<IpcResult<SubmissionResult>>
  pickAttachments(accountId: string): Promise<IpcResult<UploadedAttachment[]>>
  saveAttachment(input: AttachmentSaveInput): Promise<IpcResult<boolean>>
  listIdentities(accountId: string): Promise<IpcResult<Identity[]>>
  listContacts(accountId: string, search?: string): Promise<IpcResult<Contact[]>>
  saveContact(input: ContactInput): Promise<IpcResult<Contact>>
  deleteContact(accountId: string, contactId: string): Promise<IpcResult<void>>
  getIngressConfiguration(): Promise<IpcResult<IngressConfiguration>>
  configureIngress(input: IngressConfigurationInput): Promise<IpcResult<IngressConfiguration>>
  clearIngressConfiguration(): Promise<IpcResult<void>>
  listIngressMessages(input: IngressPageInput): Promise<IpcResult<IngressPage>>
  getIngressMessage(id: number): Promise<IpcResult<IngressMessageDetail>>
  deleteIngressMessage(id: number): Promise<IpcResult<void>>
  deleteIngressRecipient(recipient: string): Promise<IpcResult<void>>
  saveIngressAttachment(input: IngressAttachmentSaveInput): Promise<IpcResult<boolean>>
  saveIngressRaw(messageId: number, subject: string): Promise<IpcResult<boolean>>
  getSystemStatus(): Promise<IpcResult<SystemStatus>>
  getSettings(): Promise<IpcResult<AppSettings>>
  updateSettings(settings: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
  openExternal(url: string): Promise<IpcResult<void>>
}
