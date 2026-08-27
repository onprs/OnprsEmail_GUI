import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountService } from '@main/services/account-service'
import type { AppDatabase, StoredAccount } from '@main/storage/database'
import type { CredentialStore } from '@main/storage/credential-store'
import type { AccountRegistrationInput, RegistrationCredentialInput } from '@shared/types'

const registrationCode = 'registration-code-1234567890-abcdef'

const session = {
  capabilities: {
    'urn:ietf:params:jmap:core': {},
    'urn:ietf:params:jmap:mail': {}
  },
  accounts: {
    remote: {
      name: '测试账号',
      accountCapabilities: { 'urn:ietf:params:jmap:mail': {} }
    }
  },
  primaryAccounts: { 'urn:ietf:params:jmap:mail': 'remote' },
  username: 'user@onprs.online',
  apiUrl: 'https://mail.onprs.online/jmap/',
  downloadUrl: 'https://mail.onprs.online/jmap/download/{accountId}/{blobId}/{name}?accept={type}',
  uploadUrl: 'https://mail.onprs.online/jmap/upload/{accountId}/',
  state: '1'
}

const localSession = {
  ...session,
  apiUrl: 'http://127.0.0.1:4010/jmap/',
  downloadUrl: 'http://127.0.0.1:4010/download/{accountId}/{blobId}/{name}',
  uploadUrl: 'http://127.0.0.1:4010/upload/{accountId}/'
}

const storedAccount: StoredAccount = {
  id: 'local',
  email: 'user@onprs.online',
  displayName: '测试用户',
  serverUrl: 'https://mail.onprs.online',
  jmapAccountId: 'remote',
  capabilities: ['urn:ietf:params:jmap:mail'],
  createdAt: '2026-08-25T00:00:00.000Z',
  lastConnectedAt: '2026-08-25T00:00:00.000Z',
  requiresAuthentication: false,
  encryptedSecret: new Uint8Array([1]),
  sessionJson: JSON.stringify(session)
}

function registrationInput(
  registrationCredential: RegistrationCredentialInput = {
    source: 'new',
    registrationCode,
    remember: true
  }
): AccountRegistrationInput {
  return {
    localPart: 'new.user',
    password: 'StrongPassword-1234',
    registrationCredential,
    displayName: '新用户',
    remember: true
  }
}

function mailboxVerificationResponse(): Response {
  return new Response(
    JSON.stringify({
      methodResponses: [['Mailbox/get', { accountId: 'remote', state: '1', list: [] }, 'verify']],
      sessionState: '1'
    }),
    { status: 200 }
  )
}

function successfulFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'new.user@onprs.online' }), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(localSession), { status: 200 }))
    .mockResolvedValueOnce(mailboxVerificationResponse())
}

function createDatabase(initialEncryptedCode: Uint8Array | null = null, initialRevision = 0) {
  let credential = { encryptedCode: initialEncryptedCode, revision: initialRevision }
  const saveAccount = vi.fn()
  const replaceRegistrationCredential = vi.fn((expectedRevision: number, encryptedCode: Uint8Array | null) => {
    if (credential.revision !== expectedRevision) return false
    credential = { encryptedCode, revision: credential.revision + 1 }
    return true
  })
  const forgetRegistrationCredential = vi.fn(() => {
    credential = { encryptedCode: null, revision: credential.revision + 1 }
  })
  const database = {
    listAccounts: () => [],
    saveAccount,
    getPendingSubmissionEmailId: () => null,
    getRegistrationCredential: () => ({ ...credential }),
    replaceRegistrationCredential,
    forgetRegistrationCredential
  } as unknown as AppDatabase
  return {
    database,
    saveAccount,
    replaceRegistrationCredential,
    forgetRegistrationCredential,
    readCredential: () => credential
  }
}

function createCredentials(decryptedCode = registrationCode) {
  const encrypt = vi.fn(() => new Uint8Array([7, 8, 9]))
  const decrypt = vi.fn(() => decryptedCode)
  return {
    credentials: { encrypt, decrypt } as unknown as CredentialStore,
    encrypt,
    decrypt
  }
}

function localService(database: AppDatabase, credentials: CredentialStore): AccountService {
  return new AccountService(database, credentials, { registrationServerUrl: 'http://127.0.0.1:4010' })
}

afterEach(() => vi.unstubAllGlobals())

describe('AccountService 邮箱创建与注册码存储', () => {
  it('首次创建成功后加密保存注册码并自动登录', async () => {
    const storage = createDatabase()
    const secureStorage = createCredentials()
    const fetchMock = successfulFetch()
    vi.stubGlobal('fetch', fetchMock)

    const result = await localService(storage.database, secureStorage.credentials).register(registrationInput())

    expect(result.account.email).toBe('new.user@onprs.online')
    expect(result.registrationCredentialUpdate).toBe('saved')
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:4010/api/email-ingress/v2/accounts')
    const registrationInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(registrationInit.headers).get('X-Registration-Code')).toBe(registrationCode)
    expect(String(registrationInit.body)).not.toContain(registrationCode)
    expect(secureStorage.encrypt).toHaveBeenCalledWith(registrationCode)
    expect(storage.replaceRegistrationCredential).toHaveBeenCalledWith(0, new Uint8Array([7, 8, 9]))
    expect(storage.saveAccount).toHaveBeenCalledOnce()
    expect(JSON.stringify(storage.saveAccount.mock.calls[0]?.[0])).not.toContain(registrationCode)
  })

  it('重启后只解密主进程保存值且注册输入无需明文注册码', async () => {
    const storage = createDatabase(new Uint8Array([4, 5, 6]), 3)
    const secureStorage = createCredentials()
    const fetchMock = successfulFetch()
    vi.stubGlobal('fetch', fetchMock)
    const service = localService(storage.database, secureStorage.credentials)

    expect(service.getRegistrationCredentialStatus()).toEqual({ hasSavedRegistrationCode: true })
    const result = await service.register(registrationInput({ source: 'saved' }))

    expect(result.account.email).toBe('new.user@onprs.online')
    expect(result.registrationCredentialUpdate).toBe('unchanged')
    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get('X-Registration-Code')).toBe(
      registrationCode
    )
    expect(storage.replaceRegistrationCredential).not.toHaveBeenCalled()
  })

  it('注册响应丢失后的恢复登录不保存未经确认的新注册码', async () => {
    const storage = createDatabase()
    const secureStorage = createCredentials()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('socket closed'))
      .mockResolvedValueOnce(new Response(JSON.stringify(localSession), { status: 200 }))
      .mockResolvedValueOnce(mailboxVerificationResponse())
    vi.stubGlobal('fetch', fetchMock)

    const result = await localService(storage.database, secureStorage.credentials).register(registrationInput())

    expect(result.account.email).toBe('new.user@onprs.online')
    expect(result.registrationCredentialUpdate).toBe('unconfirmed')
    expect(storage.replaceRegistrationCredential).not.toHaveBeenCalled()
  })

  it('重复响应恢复登录时不把候选注册码写入本机', async () => {
    const storage = createDatabase()
    const secureStorage = createCredentials()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '邮箱地址已被使用' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(localSession), { status: 200 }))
      .mockResolvedValueOnce(mailboxVerificationResponse())
    vi.stubGlobal('fetch', fetchMock)

    const result = await localService(storage.database, secureStorage.credentials).register(registrationInput())

    expect(result.account.email).toBe('new.user@onprs.online')
    expect(result.registrationCredentialUpdate).toBe('unconfirmed')
    expect(storage.replaceRegistrationCredential).not.toHaveBeenCalled()
  })

  it('明确的注册码无效机器码只清除参与请求的保存值', async () => {
    const storage = createDatabase(new Uint8Array([1]), 8)
    const secureStorage = createCredentials()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Invalid registration code', code: 'registration_code_invalid' }), {
          status: 401
        })
      )
    )

    await expect(
      localService(storage.database, secureStorage.credentials).register(registrationInput({ source: 'saved' }))
    ).rejects.toMatchObject({ code: 'REGISTRATION_CODE_INVALID' })
    expect(storage.replaceRegistrationCredential).toHaveBeenCalledWith(8, null)
    expect(storage.readCredential()).toEqual({ encryptedCode: null, revision: 9 })
  })

  it.each([401, 403])('代理层 HTTP %s 不会误删已保存注册码', async (status) => {
    const storage = createDatabase(new Uint8Array([1]), 2)
    const secureStorage = createCredentials()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status })))

    await expect(
      localService(storage.database, secureStorage.credentials).register(registrationInput({ source: 'saved' }))
    ).rejects.toMatchObject({ code: 'REGISTRATION_AUTHORIZATION_FAILED' })
    expect(storage.replaceRegistrationCredential).not.toHaveBeenCalled()
    expect(storage.readCredential()).toEqual({ encryptedCode: new Uint8Array([1]), revision: 2 })
  })

  it('无效的新候选注册码不会覆盖既有保存值', async () => {
    const storage = createDatabase(new Uint8Array([1]), 4)
    const secureStorage = createCredentials()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'registration_code_invalid' }), { status: 401 }))
    )

    await expect(
      localService(storage.database, secureStorage.credentials).register(registrationInput())
    ).rejects.toMatchObject({ code: 'REGISTRATION_CODE_INVALID' })
    expect(storage.replaceRegistrationCredential).not.toHaveBeenCalled()
    expect(storage.readCredential()).toEqual({ encryptedCode: new Uint8Array([1]), revision: 4 })
  })

  it('在途注册期间忘记注册码后不会被迟到的成功响应重新写回', async () => {
    const storage = createDatabase()
    const secureStorage = createCredentials()
    let resolveRegistration!: (response: Response) => void
    const registrationResponse = new Promise<Response>((resolve) => {
      resolveRegistration = resolve
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => registrationResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify(localSession), { status: 200 }))
      .mockResolvedValueOnce(mailboxVerificationResponse())
    vi.stubGlobal('fetch', fetchMock)
    const service = localService(storage.database, secureStorage.credentials)

    const pending = service.register(registrationInput())
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    service.forgetRegistrationCredential()
    resolveRegistration(new Response(JSON.stringify({ email: 'new.user@onprs.online' }), { status: 201 }))
    const result = await pending

    expect(result.registrationCredentialUpdate).toBe('unchanged')
    expect(storage.readCredential()).toEqual({ encryptedCode: null, revision: 1 })
  })

  it('同一进程同时只允许一个创建请求', async () => {
    const storage = createDatabase()
    const secureStorage = createCredentials()
    let resolveRegistration!: (response: Response) => void
    const registrationResponse = new Promise<Response>((resolve) => {
      resolveRegistration = resolve
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => registrationResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify(localSession), { status: 200 }))
      .mockResolvedValueOnce(mailboxVerificationResponse())
    vi.stubGlobal('fetch', fetchMock)
    const service = localService(storage.database, secureStorage.credentials)

    const pending = service.register(registrationInput())
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await expect(service.register(registrationInput())).rejects.toMatchObject({ code: 'REGISTRATION_IN_PROGRESS' })
    resolveRegistration(new Response(JSON.stringify({ email: 'new.user@onprs.online' }), { status: 201 }))
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('远端创建成功但本地注册码写入失败时仍完成自动登录', async () => {
    const storage = createDatabase()
    storage.replaceRegistrationCredential.mockImplementation(() => {
      throw new Error('disk full')
    })
    const secureStorage = createCredentials()
    vi.stubGlobal('fetch', successfulFetch())

    const result = await localService(storage.database, secureStorage.credentials).register(registrationInput())

    expect(result.account.email).toBe('new.user@onprs.online')
    expect(result.registrationCredentialUpdate).toBe('failed')
    expect(storage.saveAccount).toHaveBeenCalledOnce()
  })

  it.each([200, 202])('HTTP %s 即使邮箱匹配也不确认注册码保存', async (status) => {
    const storage = createDatabase()
    const secureStorage = createCredentials()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'new.user@onprs.online' }), { status }))
        .mockResolvedValueOnce(new Response(JSON.stringify(localSession), { status: 200 }))
        .mockResolvedValueOnce(mailboxVerificationResponse())
    )

    const result = await localService(storage.database, secureStorage.credentials).register(registrationInput())

    expect(result.account.email).toBe('new.user@onprs.online')
    expect(result.registrationCredentialUpdate).toBe('unconfirmed')
    expect(storage.replaceRegistrationCredential).not.toHaveBeenCalled()
  })

  it('已有保存值清除失败时报告本地更新失败并保留真实状态', async () => {
    const storage = createDatabase(new Uint8Array([1]), 6)
    storage.replaceRegistrationCredential.mockImplementation(() => {
      throw new Error('disk full')
    })
    const secureStorage = createCredentials()
    vi.stubGlobal('fetch', successfulFetch())

    const result = await localService(storage.database, secureStorage.credentials).register(
      registrationInput({
        source: 'new',
        registrationCode,
        remember: false
      })
    )

    expect(result.account.email).toBe('new.user@onprs.online')
    expect(result.registrationCredentialUpdate).toBe('failed')
    expect(storage.readCredential()).toEqual({ encryptedCode: new Uint8Array([1]), revision: 6 })
  })

  it('远端创建成功后即使自动登录失败也保留已确认的注册码状态', async () => {
    const storage = createDatabase()
    const secureStorage = createCredentials()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'new.user@onprs.online' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
    )

    await expect(
      localService(storage.database, secureStorage.credentials).register(registrationInput())
    ).rejects.toMatchObject({ code: 'ACCOUNT_CREATED_LOGIN_FAILED' })
    expect(storage.replaceRegistrationCredential).toHaveBeenCalledWith(0, new Uint8Array([7, 8, 9]))
  })

  it('安全存储预检失败时不会发出不可逆注册请求', async () => {
    const storage = createDatabase()
    const credentials = {
      encrypt: vi.fn(() => {
        throw new Error('DPAPI unavailable')
      })
    } as unknown as CredentialStore
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    await expect(localService(storage.database, credentials).register(registrationInput())).rejects.toThrow(
      'DPAPI unavailable'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('损坏或暂时无法解密的保存值不会被状态查询静默删除', () => {
    const storage = createDatabase(new Uint8Array([1]), 5)
    const credentials = {
      decrypt: vi.fn(() => {
        throw new Error('decrypt failed')
      })
    } as unknown as CredentialStore
    const service = localService(storage.database, credentials)

    expect(() => service.getRegistrationCredentialStatus()).toThrowError(/无法读取/)
    expect(storage.readCredential()).toEqual({ encryptedCode: new Uint8Array([1]), revision: 5 })
    service.forgetRegistrationCredential()
    expect(service.getRegistrationCredentialStatus()).toEqual({ hasSavedRegistrationCode: false })
  })

  it('正式注册目标固定且重复邮箱返回明确错误', async () => {
    const storage = createDatabase()
    const secureStorage = createCredentials()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '邮箱地址已被使用' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      new AccountService(storage.database, secureStorage.credentials).register(registrationInput())
    ).rejects.toMatchObject({ code: 'ACCOUNT_NAME_UNAVAILABLE' })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://mail.onprs.online/api/email-ingress/v2/accounts')
  })

  it('未配置响应不会被误报为临时故障', async () => {
    const storage = createDatabase()
    const secureStorage = createCredentials()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'Registration is not configured',
          code: 'registration_not_configured'
        }),
        { status: 503 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      new AccountService(storage.database, secureStorage.credentials).register(registrationInput())
    ).rejects.toMatchObject({ code: 'REGISTRATION_UNAVAILABLE', retryable: false })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('拒绝注册服务返回与请求不一致的邮箱地址且不保存候选值', async () => {
    const storage = createDatabase()
    const secureStorage = createCredentials()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'other@onprs.online' }), { status: 201 }))
    )

    await expect(
      localService(storage.database, secureStorage.credentials).register(registrationInput())
    ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION_RESPONSE' })
    expect(storage.replaceRegistrationCredential).not.toHaveBeenCalled()
  })
})

describe('AccountService 运行期认证状态', () => {
  it('服务器拒绝已保存凭据后要求重新登录并停止复用客户端', async () => {
    const database = {
      listAccounts: () => [storedAccount],
      getAccount: () => storedAccount,
      getPendingSubmissionEmailId: () => null
    } as unknown as AppDatabase
    const credentials = {
      decrypt: () => 'old-password'
    } as unknown as CredentialStore
    const service = new AccountService(database, credentials)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 401 })))

    await expect(
      service.getClient('local').call(['urn:ietf:params:jmap:core'], 'Mailbox/get', {})
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
    expect(service.listAccounts()[0]?.requiresAuthentication).toBe(true)
    expect(() => service.getClient('local')).toThrowError(/重新登录/)
  })
})
