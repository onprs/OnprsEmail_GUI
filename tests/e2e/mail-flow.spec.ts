import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { DesktopApi } from '@shared/types'

type MethodCall = [name: string, arguments_: Record<string, unknown>, callId: string]

const REGISTRATION_CODE = 'test-registration-code-1234567890abcdef'

function json(response: ServerResponse, payload: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

async function requestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function createJmapServer(options: { dropFirstSubmissionResponse?: boolean; dropRegistrationResponse?: boolean } = {}) {
  let origin = ''
  let acceptedSubmissionEmailId: string | null = null
  let submissionSetCount = 0
  let registrationCount = 0
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/.well-known/jmap') {
      json(response, {
        capabilities: {
          'urn:ietf:params:jmap:core': { maxCallsInRequest: 16 },
          'urn:ietf:params:jmap:mail': {},
          'urn:ietf:params:jmap:submission': {},
          'urn:ietf:params:jmap:contacts': {}
        },
        accounts: {
          account1: {
            name: '测试邮箱',
            isPersonal: true,
            isReadOnly: false,
            accountCapabilities: {
              'urn:ietf:params:jmap:mail': {},
              'urn:ietf:params:jmap:submission': {},
              'urn:ietf:params:jmap:contacts': {}
            }
          }
        },
        primaryAccounts: {
          'urn:ietf:params:jmap:mail': 'account1',
          'urn:ietf:params:jmap:submission': 'account1',
          'urn:ietf:params:jmap:contacts': 'account1'
        },
        username: 'user@onprs.online',
        apiUrl: `${origin}/jmap/`,
        downloadUrl: `${origin}/download/{accountId}/{blobId}/{name}?accept={type}`,
        uploadUrl: `${origin}/upload/{accountId}/`,
        state: 'session-1'
      })
      return
    }

    if (request.method === 'POST' && request.url === '/api/email-ingress/v2/accounts') {
      const payload = await requestBody(request)
      if (request.headers['x-registration-code'] !== REGISTRATION_CODE) {
        json(response, { error: 'Invalid registration code', code: 'registration_code_invalid' }, 401)
        return
      }
      registrationCount += 1
      if (options.dropRegistrationResponse && registrationCount === 1) {
        response.destroy()
        return
      }
      json(response, { email: `${String(payload.local_part)}@onprs.online` }, 201)
      return
    }

    if (request.method !== 'POST' || request.url !== '/jmap/') {
      response.writeHead(404).end()
      return
    }

    const payload = await requestBody(request)
    const calls = payload.methodCalls as MethodCall[]
    const droppedSubmission = calls.find(([name]) => name === 'EmailSubmission/set')
    if (options.dropFirstSubmissionResponse && droppedSubmission && submissionSetCount === 0) {
      const create = droppedSubmission[1].create as Record<string, { emailId?: string }>
      acceptedSubmissionEmailId = Object.values(create)[0]?.emailId ?? null
      submissionSetCount += 1
      response.destroy()
      return
    }
    const implicitResponses: unknown[] = []
    const methodResponses = calls.map(([name, args, callId]) => {
      if (name === 'Mailbox/get') {
        return [name, {
          accountId: 'account1',
          state: 'mailbox-1',
          list: [
            { id: 'inbox', name: 'Inbox', role: 'inbox', sortOrder: 1, totalEmails: 1, unreadEmails: 1, totalThreads: 1, unreadThreads: 1, isSubscribed: true, myRights: { mayReadItems: true, maySetSeen: true } },
            { id: 'drafts', name: 'Drafts', role: 'drafts', sortOrder: 2, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0, isSubscribed: true, myRights: { mayAddItems: true, mayRemoveItems: true } },
            { id: 'sent', name: 'Sent', role: 'sent', sortOrder: 3, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0, isSubscribed: true, myRights: { mayAddItems: true } },
            { id: 'trash', name: 'Trash', role: 'trash', sortOrder: 4, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0, isSubscribed: true, myRights: { mayAddItems: true } }
          ]
        }, callId]
      }
      if (name === 'Email/query') {
        return [name, { accountId: 'account1', queryState: 'query-1', canCalculateChanges: true, position: 0, ids: ['email-1'], total: 1 }, callId]
      }
      if (name === 'Email/get') {
        const requestedId = (args.ids as string[] | undefined)?.[0]
        if (requestedId === 'draft-created') {
          return [name, {
            accountId: 'account1',
            state: 'email-2',
            list: [{ id: 'draft-created', mailboxIds: { drafts: true }, keywords: { '$draft': true } }]
          }, callId]
        }
        return [name, {
          accountId: 'account1',
          state: 'email-1',
          list: [{
            id: 'email-1',
            threadId: 'thread-1',
            mailboxIds: { inbox: true },
            keywords: {},
            size: 1024,
            receivedAt: '2026-08-25T12:00:00Z',
            sentAt: '2026-08-25T11:59:00Z',
            from: [{ name: '系统通知', email: 'notice@example.com' }],
            to: [{ name: '测试用户', email: 'user@onprs.online' }],
            subject: '欢迎使用 Onprs Mail',
            preview: '这是一封用于验证桌面客户端完整流程的邮件。',
            hasAttachment: false,
            messageId: ['message-1@example.com'],
            textBody: [{ partId: 'text' }],
            htmlBody: [{ partId: 'html' }],
            bodyValues: {
              text: { value: '邮件正文已通过 JMAP 加载。' },
              html: { value: '<p><strong>邮件正文</strong>已通过 JMAP 加载。</p>' }
            },
            attachments: []
          }]
        }, callId]
      }
      if (name === 'Identity/get') {
        return [name, { accountId: 'account1', state: 'identity-1', list: [{ id: 'identity-1', name: '测试用户', email: 'user@onprs.online' }] }, callId]
      }
      if (name === 'Email/set') {
        const create = args.create as Record<string, unknown> | undefined
        const createId = create ? Object.keys(create)[0] : undefined
        return [name, {
          accountId: 'account1',
          oldState: 'email-1',
          newState: 'email-2',
          created: createId ? { [createId]: { id: 'draft-created' } } : undefined,
          updated: createId ? undefined : { 'email-1': null }
        }, callId]
      }
      if (name === 'EmailSubmission/query') {
        const emailIds = ((args.filter as { emailIds?: string[] } | undefined)?.emailIds ?? [])
        return [name, {
          accountId: 'account1',
          queryState: 'submission-1',
          canCalculateChanges: false,
          position: 0,
          ids: acceptedSubmissionEmailId && emailIds.includes(acceptedSubmissionEmailId) ? ['submission-created'] : []
        }, callId]
      }
      if (name === 'EmailSubmission/set') {
        const create = args.create as Record<string, { emailId?: string }>
        const createId = Object.keys(create)[0]!
        acceptedSubmissionEmailId = create[createId]?.emailId ?? null
        submissionSetCount += 1
        implicitResponses.push(['Email/set', {
          accountId: 'account1',
          oldState: 'email-2',
          newState: 'email-3',
          updated: { 'draft-created': null }
        }, callId])
        return [name, {
          accountId: 'account1',
          oldState: 'submission-1',
          newState: 'submission-2',
          created: { [createId]: { id: 'submission-created' } }
        }, callId]
      }
      return ['error', { type: 'unknownMethod', description: name }, callId]
    })
    json(response, { methodResponses: [...methodResponses, ...implicitResponses], sessionState: 'session-1' })
  })

  return {
    async listen(): Promise<string> {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('测试服务器启动失败')
      origin = `http://127.0.0.1:${address.port}`
      return origin
    },
    getSubmissionSetCount(): number {
      return submissionSetCount
    },
    getRegistrationCount(): number {
      return registrationCount
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  }
}

test('在客户端创建邮箱并在响应丢失后恢复自动登录', async () => {
  const jmapServer = createJmapServer({ dropRegistrationResponse: true })
  const serverUrl = await jmapServer.listen()
  const userData = await mkdtemp(join(tmpdir(), 'onprs-mail-registration-e2e-'))
  const electronApp = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      ONPRS_MAIL_TEST_USER_DATA: userData,
      ONPRS_MAIL_TEST_REGISTRATION_SERVER_URL: serverUrl
    }
  })

  try {
    const page = await electronApp.firstWindow()
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1000, 680)
    })
    const backgroundImage = await page.locator('.account-setup').evaluate((element) => getComputedStyle(element).backgroundImage)
    expect(backgroundImage).toBe('none')

    await page.getByRole('tab', { name: '创建邮箱' }).click()
    await expect(page.getByRole('heading', { name: '创建邮箱' })).toBeVisible()
    await page.getByLabel('邮箱名').fill('new.user')
    await page.getByLabel('显示名称').fill('新用户')
    await page.getByLabel('密码', { exact: true }).fill('StrongPassword-1234')
    await page.getByLabel('确认密码').fill('StrongPassword-1234')
    await page.getByLabel('注册码', { exact: true }).fill(REGISTRATION_CODE)
    await expect(page.getByRole('button', { name: '连接设置' })).not.toBeVisible()
    const viewportFits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    expect(viewportFits).toBe(true)
    await mkdir('test-results', { recursive: true })
    await page.screenshot({ path: 'test-results/account-registration.png', fullPage: true })
    await page.getByRole('button', { name: '创建并登录' }).click()

    await expect(page.getByRole('button', { name: /收件箱/ })).toBeVisible()
    expect(jmapServer.getRegistrationCount()).toBe(1)
  } finally {
    await electronApp.close()
    await jmapServer.close()
  }
})

test('首次成功后加密保存注册码并在重启后自动使用', async () => {
  const jmapServer = createJmapServer()
  const serverUrl = await jmapServer.listen()
  const userData = await mkdtemp(join(tmpdir(), 'onprs-mail-registration-storage-e2e-'))
  const environment = {
    ...process.env,
    ONPRS_MAIL_TEST_USER_DATA: userData,
    ONPRS_MAIL_TEST_REGISTRATION_SERVER_URL: serverUrl
  }
  let electronApp = await electron.launch({ args: ['.'], env: environment })

  try {
    let page = await electronApp.firstWindow()
    await page.getByRole('tab', { name: '创建邮箱' }).click()
    await page.getByLabel('邮箱名').fill('first.user')
    await page.getByLabel('显示名称').fill('首个用户')
    await page.getByLabel('密码', { exact: true }).fill('StrongPassword-1234')
    await page.getByLabel('确认密码').fill('StrongPassword-1234')
    await page.getByLabel('注册码', { exact: true }).fill(REGISTRATION_CODE)
    await page.getByRole('button', { name: '创建并登录' }).click()
    await expect(page.getByRole('button', { name: /收件箱/ })).toBeVisible()

    const localState = await page.evaluate(async () => (
      window as unknown as { mailApi: DesktopApi }
    ).mailApi.getRegistrationCredentialStatus())
    expect(localState).toEqual({ ok: true, data: { hasSavedRegistrationCode: true } })
    expect(JSON.stringify(localState)).not.toContain(REGISTRATION_CODE)

    await electronApp.close()
    electronApp = await electron.launch({ args: ['.'], env: environment })
    page = await electronApp.firstWindow()
    await expect(page.getByRole('button', { name: '设置' })).toBeVisible()
    await page.getByRole('button', { name: '设置' }).click()
    await page.getByRole('button', { name: '添加账号' }).click()
    await page.getByRole('tab', { name: '创建邮箱' }).click()
    await expect(page.getByText('已安全保存在此设备')).toBeVisible()
    await expect(page.getByLabel('注册码', { exact: true })).toHaveCount(0)
    await page.getByLabel('邮箱名').fill('second.user')
    await page.getByLabel('显示名称').fill('第二个用户')
    await page.getByLabel('密码', { exact: true }).fill('AnotherPassword-1234')
    await page.getByLabel('确认密码').fill('AnotherPassword-1234')
    await page.getByRole('button', { name: '创建并登录' }).click()
    await expect(page.getByText('second.user@onprs.online')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(jmapServer.getRegistrationCount()).toBe(2)

    await page.getByRole('button', { name: '添加账号' }).click()
    await page.getByRole('tab', { name: '创建邮箱' }).click()
    await expect(page.getByText('已安全保存在此设备')).toBeVisible()
    await page.getByTitle('更换注册码').click()
    await expect(page.getByLabel('注册码', { exact: true })).toBeVisible()
    await page.getByTitle('继续使用已保存的注册码').click()
    await expect(page.getByText('已安全保存在此设备')).toBeVisible()
    page.once('dialog', (dialog) => { void dialog.accept() })
    await page.getByTitle('忘记本机注册码').click()
    await expect(page.getByLabel('注册码', { exact: true })).toBeVisible()
    const forgottenState = await page.evaluate(async () => (
      window as unknown as { mailApi: DesktopApi }
    ).mailApi.getRegistrationCredentialStatus())
    expect(forgottenState).toEqual({ ok: true, data: { hasSavedRegistrationCode: false } })
    await page.getByTitle('关闭').click()

    await electronApp.close()
    electronApp = await electron.launch({ args: ['.'], env: environment })
    page = await electronApp.firstWindow()
    await page.getByRole('button', { name: '设置' }).click()
    await page.getByRole('button', { name: '添加账号' }).click()
    await page.getByRole('tab', { name: '创建邮箱' }).click()
    await expect(page.getByLabel('注册码', { exact: true })).toBeVisible()
    await page.getByTitle('关闭').click()
    await page.getByRole('button', { name: '邮件', exact: true }).click()
    await expect(page.getByRole('button', { name: /收件箱/ })).toBeVisible()
  } finally {
    await electronApp.close().catch(() => undefined)
    await jmapServer.close()
  }

  const databaseFiles = (await readdir(userData)).filter((name) => name.startsWith('onprs-mail.db'))
  for (const name of databaseFiles) {
    const contents = await readFile(join(userData, name))
    expect(contents.includes(Buffer.from(REGISTRATION_CODE))).toBe(false)
  }
})

test('完成登录、阅读和发信闭环', async () => {
  const jmapServer = createJmapServer()
  const serverUrl = await jmapServer.listen()
  const userData = await mkdtemp(join(tmpdir(), 'onprs-mail-flow-e2e-'))
  const electronApp = await electron.launch({ args: ['.'], env: { ...process.env, ONPRS_MAIL_TEST_USER_DATA: userData } })

  try {
    const page = await electronApp.firstWindow()
    await page.getByLabel('邮箱地址').fill('user@onprs.online')
    await page.getByLabel('密码').fill('test-password')
    await page.getByRole('button', { name: '连接设置' }).click()
    await page.getByLabel('服务器地址').fill(serverUrl)
    await page.getByRole('button', { name: '登录', exact: true }).click()

    await expect(page.getByRole('button', { name: /收件箱/ })).toBeVisible()
    await expect(page.getByText('欢迎使用 Onprs Mail')).toBeVisible()
    await page.getByText('欢迎使用 Onprs Mail').click()
    await expect(page.getByRole('heading', { name: '欢迎使用 Onprs Mail' })).toBeVisible()

    await expect(page.frameLocator('.mail-body-frame').getByText('邮件正文')).toBeVisible()

    await page.locator('.mailbox-compose').click()
    await page.getByLabel('收件人').fill('recipient@example.com')
    await page.getByLabel('主题').fill('桌面端发信测试')
    await page.locator('.compose-editor-content').fill('这封邮件由测试 JMAP 服务提交。')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('邮件已提交发送')).toBeVisible()

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1000, 680)
    })
    await page.waitForTimeout(200)
    const viewportFits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    expect(viewportFits).toBe(true)

    await mkdir('test-results', { recursive: true })
    await page.screenshot({ path: 'test-results/mail-workspace.png', fullPage: true })
  } finally {
    await electronApp.close()
    await jmapServer.close()
  }
})

test('提交响应丢失后使用持久化草稿恢复且不重复发信', async () => {
  const jmapServer = createJmapServer({ dropFirstSubmissionResponse: true })
  const serverUrl = await jmapServer.listen()
  const userData = await mkdtemp(join(tmpdir(), 'onprs-mail-recovery-e2e-'))
  const electronApp = await electron.launch({ args: ['.'], env: { ...process.env, ONPRS_MAIL_TEST_USER_DATA: userData } })

  try {
    const page = await electronApp.firstWindow()
    await page.getByLabel('邮箱地址').fill('user@onprs.online')
    await page.getByLabel('密码').fill('test-password')
    await page.getByRole('button', { name: '连接设置' }).click()
    await page.getByLabel('服务器地址').fill(serverUrl)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page.locator('.mailbox-compose')).toBeVisible()

    await page.locator('.mailbox-compose').click()
    await page.getByLabel('收件人').fill('recipient@example.com')
    await page.getByLabel('主题').fill('断线恢复测试')
    await page.locator('.compose-editor-content').fill('服务端接受后断开响应。')
    await page.getByRole('button', { name: '发送', exact: true }).click()

    await expect(page.getByText('连接邮件服务器失败，请检查网络后重试')).toBeVisible()
    await expect(page.getByRole('button', { name: '确认发送状态' })).toBeVisible()
    await page.waitForTimeout(200)
    await page.getByTitle('关闭撰写窗口').click()
    await expect(page.getByRole('dialog', { name: '撰写邮件' })).not.toBeVisible()

    await page.locator('.mailbox-compose').click()
    await expect(page.getByRole('button', { name: '确认发送状态' })).toBeVisible()
    await page.getByRole('button', { name: '确认发送状态' }).click()
    await expect(page.getByText('邮件已提交发送')).toBeVisible()
    expect(jmapServer.getSubmissionSetCount()).toBe(1)
  } finally {
    await electronApp.close()
    await jmapServer.close()
  }
})
