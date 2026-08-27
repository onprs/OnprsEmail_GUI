import { DatabaseSync } from 'node:sqlite'
import type { AccountSummary, AppSettings, IngressConfiguration } from '@shared/types'

export interface StoredAccount extends AccountSummary {
  encryptedSecret: Uint8Array | null
  sessionJson: string
}

export interface StoredIngressConfiguration extends IngressConfiguration {
  encryptedSecret: Uint8Array
}

export interface StoredRegistrationCredential {
  encryptedCode: Uint8Array | null
  revision: number
}

const defaultSettings: AppSettings = {
  theme: 'system',
  notifications: true,
  remoteImages: 'blocked',
  pageSize: 30
}

interface AccountRow {
  id: string
  email: string
  display_name: string
  server_url: string
  jmap_account_id: string
  capabilities_json: string
  session_json: string
  encrypted_secret: Uint8Array | null
  created_at: string
  last_connected_at: string
}

interface IngressRow {
  base_url: string
  api_version: number
  encrypted_secret: Uint8Array
}

interface RegistrationCredentialRow {
  encrypted_code: Uint8Array | null
  revision: number
}

export class AppDatabase {
  private readonly db: DatabaseSync

  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        server_url TEXT NOT NULL,
        jmap_account_id TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        session_json TEXT NOT NULL,
        encrypted_secret BLOB,
        created_at TEXT NOT NULL,
        last_connected_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_submissions (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        email_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ingress_configuration (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        base_url TEXT NOT NULL,
        api_version INTEGER NOT NULL DEFAULT 1,
        encrypted_secret BLOB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS registration_credential (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        encrypted_code BLOB,
        revision INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );

      INSERT OR IGNORE INTO registration_credential (id, encrypted_code, revision)
      VALUES (1, NULL, 0);
    `)
  }

  listAccounts(): StoredAccount[] {
    const rows = this.db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all() as unknown as AccountRow[]
    return rows.flatMap((row) => {
      try {
        return [this.mapAccount(row)]
      } catch {
        return []
      }
    })
  }

  getAccount(id: string): StoredAccount | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as unknown as AccountRow | undefined
    if (!row) return null
    try {
      return this.mapAccount(row)
    } catch {
      return null
    }
  }

  saveAccount(account: StoredAccount): void {
    this.db
      .prepare(
        `
        INSERT INTO accounts (
          id, email, display_name, server_url, jmap_account_id, capabilities_json,
          session_json, encrypted_secret, created_at, last_connected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          id = excluded.id,
          display_name = excluded.display_name,
          server_url = excluded.server_url,
          jmap_account_id = excluded.jmap_account_id,
          capabilities_json = excluded.capabilities_json,
          session_json = excluded.session_json,
          encrypted_secret = excluded.encrypted_secret,
          last_connected_at = excluded.last_connected_at
      `
      )
      .run(
        account.id,
        account.email,
        account.displayName,
        account.serverUrl,
        account.jmapAccountId,
        JSON.stringify(account.capabilities),
        account.sessionJson,
        account.encryptedSecret,
        account.createdAt,
        account.lastConnectedAt
      )
  }

  removeAccount(id: string): void {
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  }

  getPendingSubmissionEmailId(accountId: string): string | null {
    const row = this.db.prepare('SELECT email_id FROM pending_submissions WHERE account_id = ?').get(accountId) as
      { email_id?: string } | undefined
    return row?.email_id ?? null
  }

  savePendingSubmission(accountId: string, emailId: string): void {
    this.db
      .prepare(
        `
      INSERT INTO pending_submissions (account_id, email_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        email_id = excluded.email_id,
        created_at = excluded.created_at
    `
      )
      .run(accountId, emailId, new Date().toISOString())
  }

  clearPendingSubmission(accountId: string): void {
    this.db.prepare('DELETE FROM pending_submissions WHERE account_id = ?').run(accountId)
  }

  getIngressConfiguration(): StoredIngressConfiguration | null {
    const row = this.db
      .prepare('SELECT base_url, api_version, encrypted_secret FROM ingress_configuration WHERE id = 1')
      .get() as unknown as IngressRow | undefined
    if (!row) return null
    return {
      configured: true,
      baseUrl: row.base_url,
      apiVersion: row.api_version === 2 ? 2 : 1,
      encryptedSecret: row.encrypted_secret
    }
  }

  saveIngressConfiguration(configuration: StoredIngressConfiguration): void {
    this.db
      .prepare(
        `
        INSERT INTO ingress_configuration (id, base_url, api_version, encrypted_secret)
        VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          base_url = excluded.base_url,
          api_version = excluded.api_version,
          encrypted_secret = excluded.encrypted_secret
      `
      )
      .run(configuration.baseUrl, configuration.apiVersion, configuration.encryptedSecret)
  }

  clearIngressConfiguration(): void {
    this.db.prepare('DELETE FROM ingress_configuration WHERE id = 1').run()
  }

  getRegistrationCredential(): StoredRegistrationCredential {
    const row = this.db
      .prepare('SELECT encrypted_code, revision FROM registration_credential WHERE id = 1')
      .get() as unknown as RegistrationCredentialRow | undefined
    if (!row) throw new Error('注册码存储状态缺失')
    return { encryptedCode: row.encrypted_code, revision: row.revision }
  }

  replaceRegistrationCredential(expectedRevision: number, encryptedCode: Uint8Array | null): boolean {
    const result = this.db
      .prepare(
        `
        UPDATE registration_credential
        SET encrypted_code = ?, revision = revision + 1
        WHERE id = 1 AND revision = ?
      `
      )
      .run(encryptedCode, expectedRevision)
    return result.changes === 1
  }

  forgetRegistrationCredential(): void {
    this.db
      .prepare(
        `
        UPDATE registration_credential
        SET encrypted_code = NULL, revision = revision + 1
        WHERE id = 1
      `
      )
      .run()
  }

  getSettings(): AppSettings {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = 'app'").get() as unknown as
      { value_json: string } | undefined
    if (!row) return { ...defaultSettings }
    try {
      return { ...defaultSettings, ...(JSON.parse(row.value_json) as Partial<AppSettings>) }
    } catch {
      return { ...defaultSettings }
    }
  }

  saveSettings(settings: AppSettings): void {
    this.db
      .prepare(
        `
        INSERT INTO settings (key, value_json) VALUES ('app', ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
      `
      )
      .run(JSON.stringify(settings))
  }

  close(): void {
    this.db.close()
  }

  private mapAccount(row: AccountRow): StoredAccount {
    const capabilities = JSON.parse(row.capabilities_json) as unknown
    JSON.parse(row.session_json)
    if (!Array.isArray(capabilities) || !capabilities.every((capability) => typeof capability === 'string')) {
      throw new TypeError('账号能力数据无效')
    }
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      serverUrl: row.server_url,
      jmapAccountId: row.jmap_account_id,
      capabilities,
      sessionJson: row.session_json,
      encryptedSecret: row.encrypted_secret,
      createdAt: row.created_at,
      lastConnectedAt: row.last_connected_at,
      requiresAuthentication: row.encrypted_secret === null
    }
  }
}
