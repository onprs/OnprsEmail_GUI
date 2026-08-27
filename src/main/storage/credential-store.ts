import { safeStorage } from 'electron'
import { AppError } from '../errors'

export class CredentialStore {
  encrypt(secret: string): Uint8Array {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new AppError('SECURE_STORAGE_UNAVAILABLE', '系统安全存储当前不可用，无法记住账号')
    }
    return safeStorage.encryptString(secret)
  }

  decrypt(encrypted: Uint8Array): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new AppError('SECURE_STORAGE_UNAVAILABLE', '系统安全存储当前不可用，无法恢复账号')
    }
    try {
      return safeStorage.decryptString(Buffer.from(encrypted))
    } catch (error) {
      throw new AppError('CREDENTIAL_DECRYPT_FAILED', '账号凭据无法解密，请重新登录', false, { cause: error })
    }
  }
}
