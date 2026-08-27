import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AccountSummary, AppSettings } from '@shared/types'
import { JMAP_SUBMISSION } from '@shared/types'
import { useAppStore } from '@renderer/store/use-app-store'
import { renderWithQuery } from './test-utils'

vi.mock('@renderer/components/AccountSetup', () => ({
  AccountSetup: ({ heading, initialEmail, onCancel }: { heading: string; initialEmail: string; onCancel(): void }) => (
    <section role="dialog" aria-label={heading}>
      <span>{initialEmail}</span>
      <button onClick={onCancel}>暂不登录</button>
    </section>
  )
}))
vi.mock('@renderer/features/mail/MailWorkspace', () => ({
  MailWorkspace: ({ account }: { account: AccountSummary }) => <div>{account.email}</div>
}))
vi.mock('@renderer/features/compose/ComposeDialog', () => ({ ComposeDialog: () => <div>撰写窗口</div> }))
vi.mock('@renderer/features/catch-all/CatchAllWorkspace', () => ({ CatchAllWorkspace: () => <div>全域收件</div> }))
vi.mock('@renderer/features/contacts/ContactsWorkspace', () => ({ ContactsWorkspace: () => <div>联系人</div> }))
vi.mock('@renderer/features/status/StatusWorkspace', () => ({ StatusWorkspace: () => <div>服务状态</div> }))
vi.mock('@renderer/features/settings/SettingsWorkspace', () => ({ SettingsWorkspace: () => <div>设置</div> }))

import { AppShell } from '@renderer/components/AppShell'

const settings: AppSettings = {
  theme: 'system',
  notifications: true,
  remoteImages: 'blocked',
  pageSize: 30
}

function authenticationAccount(id: string): AccountSummary {
  return {
    id,
    email: `${id}@onprs.online`,
    displayName: id,
    serverUrl: 'https://mail.onprs.online',
    jmapAccountId: `jmap-${id}`,
    capabilities: [JMAP_SUBMISSION],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastConnectedAt: '2026-01-01T00:00:00.000Z',
    requiresAuthentication: true
  }
}

describe('AppShell 认证提示', () => {
  it('切换账号后重新显示对应账号的认证提示', async () => {
    const accounts = [authenticationAccount('account-a'), authenticationAccount('account-b')]
    useAppStore.setState({ activeAccountId: 'account-a' })
    renderWithQuery(<AppShell accounts={accounts} settings={settings} />)

    const firstPrompt = await screen.findByRole('dialog', { name: '重新登录' })
    expect(firstPrompt).toHaveTextContent('account-a@onprs.online')
    fireEvent.click(screen.getByRole('button', { name: '暂不登录' }))
    expect(screen.queryByRole('dialog', { name: '重新登录' })).not.toBeInTheDocument()

    act(() => useAppStore.getState().setActiveAccount('account-b'))
    const secondPrompt = await screen.findByRole('dialog', { name: '重新登录' })
    expect(secondPrompt).toHaveTextContent('account-b@onprs.online')
    expect(secondPrompt).toBeVisible()
  })
})
