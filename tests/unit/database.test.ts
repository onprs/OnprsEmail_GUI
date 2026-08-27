import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase, type StoredAccount } from '@main/storage/database'

const temporaryDirectories: string[] = []

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'onprs-mail-database-test-'))
  temporaryDirectories.push(directory)
  return join(directory, 'onprs-mail.db')
}

const storedAccount: StoredAccount = {
  id: 'local-account',
  email: 'user@onprs.online',
  displayName: '测试用户',
  serverUrl: 'https://mail.onprs.online',
  jmapAccountId: 'remote-account',
  capabilities: ['urn:ietf:params:jmap:mail'],
  createdAt: '2026-08-27T00:00:00.000Z',
  lastConnectedAt: '2026-08-27T00:00:00.000Z',
  requiresAuthentication: false,
  encryptedSecret: new Uint8Array([9]),
  sessionJson: JSON.stringify({ state: 'test' })
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('AppDatabase 注册码版本存储', () => {
  it('为旧数据库迁移单例记录且不影响既有账号', async () => {
    const filePath = await databasePath()
    const initial = new AppDatabase(filePath)
    initial.saveAccount(storedAccount)
    initial.close()

    const legacy = new DatabaseSync(filePath)
    legacy.exec('DROP TABLE registration_credential')
    legacy.close()

    const migrated = new AppDatabase(filePath)
    expect(migrated.listAccounts()).toHaveLength(1)
    expect(migrated.listAccounts()[0]?.email).toBe('user@onprs.online')
    expect(migrated.getRegistrationCredential()).toEqual({ encryptedCode: null, revision: 0 })
    migrated.close()
  })

  it('使用实际 SQLite 比较并交换且忘记操作推进版本', async () => {
    const filePath = await databasePath()
    const database = new AppDatabase(filePath)

    expect(database.replaceRegistrationCredential(0, new Uint8Array([1, 2, 3]))).toBe(true)
    expect(database.getRegistrationCredential()).toEqual({
      encryptedCode: new Uint8Array([1, 2, 3]),
      revision: 1
    })
    expect(database.replaceRegistrationCredential(0, new Uint8Array([4, 5, 6]))).toBe(false)
    expect(database.getRegistrationCredential().encryptedCode).toEqual(new Uint8Array([1, 2, 3]))

    database.forgetRegistrationCredential()
    expect(database.getRegistrationCredential()).toEqual({ encryptedCode: null, revision: 2 })
    expect(database.replaceRegistrationCredential(1, new Uint8Array([7, 8, 9]))).toBe(false)
    database.close()

    const reopened = new AppDatabase(filePath)
    expect(reopened.getRegistrationCredential()).toEqual({ encryptedCode: null, revision: 2 })
    reopened.close()
  })
})
