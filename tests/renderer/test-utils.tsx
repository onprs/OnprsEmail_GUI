import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { AccountSummary, DesktopApi, IpcResult } from '@shared/types'

export function account(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: 'account-1',
    email: 'user@onprs.online',
    displayName: '测试账号',
    serverUrl: 'https://mail.onprs.online',
    jmapAccountId: 'jmap-account-1',
    capabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastConnectedAt: '2026-01-01T00:00:00.000Z',
    requiresAuthentication: false,
    ...overrides
  }
}

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

export function installMailApi(api: Partial<DesktopApi>): void {
  Object.defineProperty(window, 'mailApi', {
    configurable: true,
    value: api as DesktopApi
  })
}

export function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false }
    }
  })
  const view = render(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  })
  return { queryClient, ...view }
}
