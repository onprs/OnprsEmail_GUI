import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { DesktopApi, IpcResult } from '@shared/types'

function invoke<T>(channel: string, input?: unknown): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, input) as Promise<IpcResult<T>>
}

const api: DesktopApi = {
  listAccounts: () => invoke(IPC.accountList),
  connectAccount: (input) => invoke(IPC.accountConnect, input),
  registerAccount: (input) => invoke(IPC.accountRegister, input),
  getRegistrationCredentialStatus: () => invoke(IPC.accountRegistrationCredentialStatus),
  forgetRegistrationCredential: () => invoke(IPC.accountRegistrationCredentialForget),
  removeAccount: (accountId) => invoke(IPC.accountRemove, { accountId }),
  listMailboxes: (accountId) => invoke(IPC.mailboxList, { accountId }),
  listEmails: (input) => invoke(IPC.emailList, input),
  getEmail: (accountId, emailId) => invoke(IPC.emailGet, { accountId, emailId }),
  updateEmail: (accountId, emailId, action) => invoke(IPC.emailUpdate, { accountId, emailId, action }),
  saveDraft: (input) => invoke(IPC.draftSave, input),
  submitDraft: (accountId, emailId) => invoke(IPC.submissionSend, { accountId, emailId }),
  pickAttachments: (accountId) => invoke(IPC.attachmentPick, { accountId }),
  saveAttachment: (input) => invoke(IPC.attachmentSave, input),
  listIdentities: (accountId) => invoke(IPC.identityList, { accountId }),
  listContacts: (accountId, search) => invoke(IPC.contactList, { accountId, search }),
  saveContact: (input) => invoke(IPC.contactSave, input),
  deleteContact: (accountId, contactId) => invoke(IPC.contactDelete, { accountId, contactId }),
  getIngressConfiguration: () => invoke(IPC.ingressConfigGet),
  configureIngress: (input) => invoke(IPC.ingressConfigSet, input),
  clearIngressConfiguration: () => invoke(IPC.ingressConfigClear),
  listIngressMessages: (input) => invoke(IPC.ingressList, input),
  getIngressMessage: (id) => invoke(IPC.ingressGet, { id }),
  deleteIngressMessage: (id) => invoke(IPC.ingressDelete, { id }),
  deleteIngressRecipient: (recipient) => invoke(IPC.ingressDeleteRecipient, { recipient }),
  saveIngressAttachment: (input) => invoke(IPC.ingressAttachmentSave, input),
  saveIngressRaw: (messageId, subject) => invoke(IPC.ingressRawSave, { messageId, subject }),
  getSystemStatus: () => invoke(IPC.systemStatus),
  getSettings: () => invoke(IPC.settingsGet),
  updateSettings: (settings) => invoke(IPC.settingsUpdate, settings),
  openExternal: (url) => invoke(IPC.externalOpen, { url })
}

contextBridge.exposeInMainWorld('mailApi', api)
