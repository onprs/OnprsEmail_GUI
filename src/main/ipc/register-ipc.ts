import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { z, type ZodType } from 'zod'
import {
  accountConnectionSchema,
  accountRegistrationSchema,
  accountIdSchema,
  attachmentSaveSchema,
  composeSchema,
  contactSchema,
  emailActionSchema,
  emailPageSchema,
  externalUrlSchema,
  ingressConfigurationSchema,
  ingressPageSchema,
  settingsPatchSchema
} from '@shared/schemas'
import { IPC } from '@shared/ipc'
import type { IpcResult } from '@shared/types'
import { AppError, toIpcError } from '../errors'
import type { AppDatabase } from '../storage/database'
import type { AccountService } from '../services/account-service'
import type { IngressService } from '../services/ingress-service'
import type { MailService } from '../services/mail-service'
import type { SystemService } from '../services/system-service'

interface Services {
  database: AppDatabase
  accounts: AccountService
  mail: MailService
  ingress: IngressService
  system: SystemService
}

function validateSender(event: IpcMainInvokeEvent): boolean {
  const frameUrl = event.senderFrame?.url
  if (!frameUrl) return false
  try {
    const url = new URL(frameUrl)
    if (app.isPackaged) return url.protocol === 'app:' && url.hostname === 'bundle'
    return url.protocol === 'app:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  } catch {
    return false
  }
}

function register<TInput, TOutput>(
  channel: string,
  schema: ZodType<TInput> | null,
  handler: (input: TInput) => Promise<TOutput> | TOutput
): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (event, rawInput: unknown): Promise<IpcResult<TOutput>> => {
    try {
      if (!validateSender(event)) throw new AppError('INVALID_IPC_SENDER', '请求来源不受信任')
      const input = schema ? schema.parse(rawInput) : (rawInput as TInput)
      return { ok: true, data: await handler(input) }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          ok: false,
          error: { code: 'INVALID_INPUT', message: error.issues[0]?.message ?? '输入内容无效', retryable: false }
        }
      }
      return { ok: false, error: toIpcError(error) }
    }
  })
}

const pairSchema = z.object({ accountId: accountIdSchema, emailId: accountIdSchema })

export function registerIpcHandlers(services: Services): void {
  register(IPC.accountList, null, () => services.accounts.listAccounts())
  register(IPC.accountConnect, accountConnectionSchema, (input) => services.accounts.connect(input))
  register(IPC.accountRegister, accountRegistrationSchema, (input) => services.accounts.register(input))
  register(IPC.accountRegistrationCredentialStatus, null, () => services.accounts.getRegistrationCredentialStatus())
  register(IPC.accountRegistrationCredentialForget, null, () => services.accounts.forgetRegistrationCredential())
  register(IPC.accountRemove, z.object({ accountId: accountIdSchema }), ({ accountId }) =>
    services.accounts.remove(accountId)
  )

  register(IPC.mailboxList, z.object({ accountId: accountIdSchema }), ({ accountId }) =>
    services.mail.listMailboxes(accountId)
  )
  register(IPC.emailList, emailPageSchema, (input) => services.mail.listEmails(input))
  register(IPC.emailGet, pairSchema, ({ accountId, emailId }) => services.mail.getEmail(accountId, emailId))
  register(
    IPC.emailUpdate,
    z.object({ accountId: accountIdSchema, emailId: accountIdSchema, action: emailActionSchema }),
    ({ accountId, emailId, action }) => services.mail.updateEmail(accountId, emailId, action)
  )
  register(IPC.draftSave, composeSchema, (input) => services.mail.saveDraft(input))
  register(IPC.submissionSend, pairSchema, ({ accountId, emailId }) => services.mail.submitDraft(accountId, emailId))
  register(IPC.attachmentPick, z.object({ accountId: accountIdSchema }), ({ accountId }) =>
    services.mail.pickAttachments(accountId)
  )
  register(IPC.attachmentSave, attachmentSaveSchema, (input) => services.mail.saveAttachment(input))
  register(IPC.identityList, z.object({ accountId: accountIdSchema }), ({ accountId }) =>
    services.mail.listIdentities(accountId)
  )

  register(
    IPC.contactList,
    z.object({ accountId: accountIdSchema, search: z.string().max(500).optional() }),
    ({ accountId, search }) => services.mail.listContacts(accountId, search)
  )
  register(IPC.contactSave, contactSchema, (input) => services.mail.saveContact(input))
  register(
    IPC.contactDelete,
    z.object({ accountId: accountIdSchema, contactId: accountIdSchema }),
    ({ accountId, contactId }) => services.mail.deleteContact(accountId, contactId)
  )

  register(IPC.ingressConfigGet, null, () => services.ingress.getConfiguration())
  register(IPC.ingressConfigSet, ingressConfigurationSchema, (input) => services.ingress.configure(input))
  register(IPC.ingressConfigClear, null, () => services.ingress.clearConfiguration())
  register(IPC.ingressList, ingressPageSchema, (input) => services.ingress.listMessages(input))
  register(IPC.ingressGet, z.object({ id: z.number().int().positive() }), ({ id }) => services.ingress.getMessage(id))
  register(IPC.ingressDelete, z.object({ id: z.number().int().positive() }), ({ id }) =>
    services.ingress.deleteMessage(id)
  )
  register(IPC.ingressDeleteRecipient, z.object({ recipient: z.email().max(320) }), ({ recipient }) =>
    services.ingress.deleteRecipient(recipient)
  )
  register(
    IPC.ingressAttachmentSave,
    z.object({
      messageId: z.number().int().positive(),
      part: z.string().min(1).max(100),
      name: z.string().min(1).max(255),
      type: z.string().min(1).max(255)
    }),
    (input) => services.ingress.saveAttachment(input)
  )
  register(
    IPC.ingressRawSave,
    z.object({ messageId: z.number().int().positive(), subject: z.string().max(998) }),
    ({ messageId, subject }) => services.ingress.saveRaw(messageId, subject)
  )

  register(IPC.systemStatus, null, () => services.system.getStatus())
  register(IPC.settingsGet, null, () => services.database.getSettings())
  register(IPC.settingsUpdate, settingsPatchSchema, (patch) => {
    const settings = { ...services.database.getSettings(), ...patch }
    services.database.saveSettings(settings)
    return settings
  })
  register(IPC.externalOpen, z.object({ url: externalUrlSchema }), async ({ url }) => {
    await shell.openExternal(url)
  })
}
