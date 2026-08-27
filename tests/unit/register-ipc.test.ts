import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@main/errors'
import type { AccountService } from '@main/services/account-service'
import type { IngressService } from '@main/services/ingress-service'
import type { MailService } from '@main/services/mail-service'
import type { SystemService } from '@main/services/system-service'
import type { AppDatabase } from '@main/storage/database'
import { IPC } from '@shared/ipc'

interface InvokeHandler {
  (event: IpcMainInvokeEvent, input?: unknown): Promise<unknown>
}

const electron = vi.hoisted(() => {
  const handlers = new Map<string, InvokeHandler>()
  return {
    app: { isPackaged: false },
    handlers,
    ipcMain: {
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
      handle: vi.fn((channel: string, handler: InvokeHandler) => handlers.set(channel, handler))
    },
    shell: { openExternal: vi.fn() }
  }
})

vi.mock('electron', () => ({
  app: electron.app,
  ipcMain: electron.ipcMain,
  shell: electron.shell
}))

import { registerIpcHandlers } from '@main/ipc/register-ipc'

function sender(url?: string): IpcMainInvokeEvent {
  return { senderFrame: url ? { url } : null } as unknown as IpcMainInvokeEvent
}

function handler(channel: string): InvokeHandler {
  const registered = electron.handlers.get(channel)
  if (!registered) throw new Error(`IPC 处理器未注册：${channel}`)
  return registered
}

function setup() {
  const account = {
    id: 'account-1',
    email: 'user@onprs.online',
    displayName: '测试账号',
    serverUrl: 'https://mail.onprs.online',
    jmapAccountId: 'jmap-account-1',
    capabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastConnectedAt: '2026-01-01T00:00:00.000Z',
    requiresAuthentication: false,
    pendingSubmissionEmailId: null
  }
  const accounts = {
    listAccounts: vi.fn(() => [account]),
    connect: vi.fn(async () => account)
  }
  registerIpcHandlers({
    database: {} as AppDatabase,
    accounts: accounts as unknown as AccountService,
    mail: {} as MailService,
    ingress: {} as IngressService,
    system: {} as SystemService
  })
  return { account, accounts }
}

describe('IPC 信任边界', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electron.handlers.clear()
    electron.app.isPackaged = false
  })

  it('为每个公开通道注册唯一处理器', () => {
    setup()
    expect(electron.handlers.size).toBe(Object.keys(IPC).length)
  })

  it('允许开发环境的本机来源并在调用服务前校验输入', async () => {
    const { account, accounts } = setup()
    const input = {
      email: 'user@onprs.online',
      password: 'test-password',
      serverUrl: 'https://mail.onprs.online',
      remember: false
    }

    await expect(handler(IPC.accountConnect)(sender('http://127.0.0.1:5173/index.html'), input)).resolves.toEqual({
      ok: true,
      data: account
    })
    expect(accounts.connect).toHaveBeenCalledWith(input)
  })

  it.each([undefined, 'https://attacker.example/', 'file:///C:/tmp/index.html'])(
    '拒绝不受信任的来源 %s',
    async (url) => {
      const { accounts } = setup()

      await expect(handler(IPC.accountList)(sender(url))).resolves.toEqual({
        ok: false,
        error: { code: 'INVALID_IPC_SENDER', message: '请求来源不受信任', retryable: false }
      })
      expect(accounts.listAccounts).not.toHaveBeenCalled()
    }
  )

  it('打包后只允许 app://bundle 来源', async () => {
    const { accounts } = setup()
    electron.app.isPackaged = true

    await expect(handler(IPC.accountList)(sender('app://bundle/index.html'))).resolves.toMatchObject({ ok: true })
    await expect(handler(IPC.accountList)(sender('app://other/index.html'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_IPC_SENDER' }
    })
    await expect(handler(IPC.accountList)(sender('http://localhost:5173/'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_IPC_SENDER' }
    })
    expect(accounts.listAccounts).toHaveBeenCalledTimes(1)
  })

  it('将 Schema 错误映射为 INVALID_INPUT 且不调用服务', async () => {
    const { accounts } = setup()

    await expect(
      handler(IPC.accountConnect)(sender('app://bundle/index.html'), {
        email: 'invalid-address',
        password: '',
        serverUrl: 'http://mail.onprs.online',
        remember: false
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT', retryable: false }
    })
    expect(accounts.connect).not.toHaveBeenCalled()
  })

  it('保留业务错误代码和重试属性', async () => {
    const { accounts } = setup()
    accounts.connect.mockRejectedValueOnce(new AppError('AUTHENTICATION_FAILED', '账号或密码错误', true))

    await expect(
      handler(IPC.accountConnect)(sender('app://bundle/index.html'), {
        email: 'user@onprs.online',
        password: 'wrong-password',
        serverUrl: 'https://mail.onprs.online',
        remember: false
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'AUTHENTICATION_FAILED', message: '账号或密码错误', retryable: true }
    })
  })
})
