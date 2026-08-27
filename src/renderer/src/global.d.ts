import type { DesktopApi } from '@shared/types'

declare global {
  interface Window {
    mailApi: DesktopApi
  }
}

export {}
