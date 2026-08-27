import type { IpcError } from '@shared/types'

export class AppError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AppError'
    this.code = code
    this.retryable = retryable
  }
}

export function toIpcError(error: unknown): IpcError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable
    }
  }

  if (error instanceof Error) {
    return {
      code: 'UNEXPECTED_ERROR',
      message: '操作未完成，请稍后重试',
      retryable: true
    }
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: '发生未知错误',
    retryable: false
  }
}
