import type { IpcResult } from '@shared/types'

export class UiError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable: boolean) {
    super(message)
    this.name = 'UiError'
    this.code = code
    this.retryable = retryable
  }
}

export function signalAuthenticationRequired(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('mail-authentication-required'))
}

export function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.data
  if (result.error.code === 'AUTHENTICATION_REQUIRED') signalAuthenticationRequired()
  throw new UiError(result.error.code, result.error.message, result.error.retryable)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作未完成，请稍后重试'
}
