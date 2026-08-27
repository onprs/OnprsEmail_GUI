import { lazy, Suspense, useEffect, useState } from 'react'
import {
  Activity,
  ContactRound,
  Inbox,
  Mail,
  LoaderCircle,
  PenLine,
  Radar,
  Settings
} from 'lucide-react'
import { JMAP_SUBMISSION, type AccountSummary, type AppSettings, type AppView } from '@shared/types'
import { useAppStore } from '../store/use-app-store'
import { AccountSetup } from './AccountSetup'

const MailWorkspace = lazy(() => import('../features/mail/MailWorkspace').then((module) => ({ default: module.MailWorkspace })))
const ComposeDialog = lazy(() => import('../features/compose/ComposeDialog').then((module) => ({ default: module.ComposeDialog })))
const CatchAllWorkspace = lazy(() => import('../features/catch-all/CatchAllWorkspace').then((module) => ({ default: module.CatchAllWorkspace })))
const ContactsWorkspace = lazy(() => import('../features/contacts/ContactsWorkspace').then((module) => ({ default: module.ContactsWorkspace })))
const StatusWorkspace = lazy(() => import('../features/status/StatusWorkspace').then((module) => ({ default: module.StatusWorkspace })))
const SettingsWorkspace = lazy(() => import('../features/settings/SettingsWorkspace').then((module) => ({ default: module.SettingsWorkspace })))

interface AppShellProps {
  accounts: AccountSummary[]
  settings: AppSettings
}

const navigation: Array<{ view: AppView; label: string; icon: typeof Mail }> = [
  { view: 'mail', label: '邮件', icon: Inbox },
  { view: 'catch-all', label: '全域收件', icon: Radar },
  { view: 'contacts', label: '联系人', icon: ContactRound },
  { view: 'status', label: '服务状态', icon: Activity }
]

export function AppShell({ accounts, settings }: AppShellProps): React.JSX.Element {
  const view = useAppStore((state) => state.view)
  const setView = useAppStore((state) => state.setView)
  const activeAccountId = useAppStore((state) => state.activeAccountId)
  const setActiveAccount = useAppStore((state) => state.setActiveAccount)
  const openCompose = useAppStore((state) => state.openCompose)
  const compose = useAppStore((state) => state.compose)
  const [authenticationDismissed, setAuthenticationDismissed] = useState(false)
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? accounts[0]
  const canSubmit = Boolean(activeAccount?.capabilities.includes(JMAP_SUBMISSION))

  useEffect(() => {
    if (activeAccount?.requiresAuthentication) setAuthenticationDismissed(false)
  }, [activeAccount?.id, activeAccount?.requiresAuthentication])

  return (
    <div className="app-frame">
      <header className="title-bar">
        <div className="title-brand">
          <span className="brand-mark small"><Mail size={18} /></span>
          <span>Onprs Mail</span>
        </div>
        <div className="title-context">{navigation.find((item) => item.view === view)?.label ?? '设置'}</div>
      </header>

      <div className="application-body">
        <nav className="navigation-rail" aria-label="主导航">
          <button className="compose-rail-button" title={canSubmit ? '写邮件' : '此账号没有发信权限'} disabled={!canSubmit} onClick={() => openCompose()}>
            <PenLine size={20} />
          </button>
          <div className="nav-group">
            {navigation.map((item) => {
              const Icon = item.icon
              return (
                <button
                  className={`rail-button ${view === item.view ? 'active' : ''}`}
                  key={item.view}
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => setView(item.view)}
                >
                  <Icon size={20} />
                </button>
              )
            })}
          </div>
          <div className="rail-spacer" />
          <button
            className={`rail-button ${view === 'settings' ? 'active' : ''}`}
            title="设置"
            aria-label="设置"
            onClick={() => setView('settings')}
          >
            <Settings size={20} />
          </button>
          <button className="account-avatar" title={activeAccount?.email} aria-label="切换账号">
            {(activeAccount?.displayName || activeAccount?.email || '?').slice(0, 1).toUpperCase()}
          </button>
        </nav>

        <main className="workspace-root">
          <Suspense fallback={<div className="center-state fill"><LoaderCircle className="spin" size={22} /><span>正在打开</span></div>}>
            {view === 'mail' && activeAccount && <MailWorkspace account={activeAccount} accounts={accounts} onAccountChange={setActiveAccount} />}
            {view === 'catch-all' && <CatchAllWorkspace />}
            {view === 'contacts' && activeAccount && <ContactsWorkspace account={activeAccount} />}
            {view === 'status' && <StatusWorkspace />}
            {view === 'settings' && <SettingsWorkspace accounts={accounts} settings={settings} />}
          </Suspense>
        </main>
      </div>

      {compose && activeAccount && (
        <Suspense fallback={null}>
          <ComposeDialog account={activeAccount} seed={compose} />
        </Suspense>
      )}

      {activeAccount?.requiresAuthentication && !authenticationDismissed && (
        <div className="modal-backdrop">
          <div className="settings-modal">
            <AccountSetup
              compact
              heading="重新登录"
              initialEmail={activeAccount.email}
              initialServerUrl={activeAccount.serverUrl}
              initialDisplayName={activeAccount.displayName}
              onCancel={() => setAuthenticationDismissed(true)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
