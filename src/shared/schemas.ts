import { z } from 'zod'

const idSchema = z.string().trim().min(1).max(512)
const httpsUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  }, '服务地址必须使用 HTTPS')

export const accountConnectionSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(4096),
  serverUrl: httpsUrlSchema,
  displayName: z.string().trim().max(120).optional(),
  remember: z.boolean()
})

const registrationCredentialSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('saved') }).strict(),
  z
    .object({
      source: z.literal('new'),
      registrationCode: z.string().trim().min(32, '注册码至少需要 32 个字符').max(4096),
      remember: z.boolean()
    })
    .strict()
])

export const accountRegistrationSchema = z.object({
  localPart: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, '邮箱名至少需要 3 个字符')
    .max(32, '邮箱名最多 32 个字符')
    .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, '邮箱名只能使用小写字母、数字、点、横线和下划线'),
  password: z.string().min(12, '密码至少需要 12 个字符').max(128),
  registrationCredential: registrationCredentialSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
  remember: z.boolean()
})

export const accountIdSchema = idSchema

export const emailPageSchema = z.object({
  accountId: idSchema,
  mailboxId: idSchema.optional(),
  search: z.string().trim().max(500).optional(),
  position: z.number().int().min(0).max(1_000_000),
  limit: z.number().int().min(1).max(100)
})

export const emailActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('read'), value: z.boolean() }),
  z.object({ type: z.literal('flagged'), value: z.boolean() }),
  z.object({ type: z.literal('move'), mailboxId: idSchema }),
  z.object({ type: z.literal('trash') }),
  z.object({ type: z.literal('destroy') })
])

const recipientSchema = z.email().max(320)
const uploadedAttachmentSchema = z.object({
  blobId: idSchema,
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
  size: z
    .number()
    .int()
    .min(0)
    .max(100 * 1024 * 1024)
})

export const composeSchema = z.object({
  accountId: idSchema,
  draftId: idSchema.optional(),
  to: z.array(recipientSchema).max(200),
  cc: z.array(recipientSchema).max(200),
  bcc: z.array(recipientSchema).max(200),
  subject: z.string().max(998),
  text: z.string().max(10_000_000),
  html: z.string().max(10_000_000),
  attachments: z.array(uploadedAttachmentSchema).max(30)
})

export const contactSchema = z.object({
  accountId: idSchema,
  contactId: idSchema.optional(),
  name: z.string().trim().min(1).max(200),
  email: recipientSchema,
  company: z.string().trim().max(200).optional(),
  notes: z.string().max(5000).optional()
})

export const ingressConfigurationSchema = z.object({
  baseUrl: httpsUrlSchema,
  secret: z.string().min(32, 'Ingress 令牌至少需要 32 个字符').max(4096)
})

export const ingressPageSchema = z.object({
  recipient: recipientSchema.optional(),
  search: z.string().trim().max(500).optional(),
  cursor: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100)
})

export const attachmentSaveSchema = z.object({
  accountId: idSchema,
  blobId: idSchema,
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(255)
})

export const settingsPatchSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    notifications: z.boolean(),
    remoteImages: z.enum(['blocked', 'allowed']),
    pageSize: z.number().int().min(10).max(100)
  })
  .partial()

export const externalUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  }, '不支持的链接协议')

export const jmapSessionSchema = z.object({
  capabilities: z.record(z.string(), z.unknown()),
  accounts: z.record(
    z.string(),
    z.object({
      name: z.string().optional(),
      isPersonal: z.boolean().optional(),
      isReadOnly: z.boolean().optional(),
      accountCapabilities: z.record(z.string(), z.unknown()).optional()
    })
  ),
  primaryAccounts: z.record(z.string(), z.string()),
  username: z.string(),
  apiUrl: z.url(),
  downloadUrl: z.string(),
  uploadUrl: z.string(),
  eventSourceUrl: z.string().optional(),
  state: z.string()
})

export const jmapResponseSchema = z.object({
  methodResponses: z.array(z.tuple([z.string(), z.unknown(), z.string()])),
  createdIds: z.record(z.string(), z.string()).optional(),
  sessionState: z.string().optional()
})
