import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, LoaderCircle } from 'lucide-react'
import { unwrap } from './lib/api'
import { useAppStore } from './store/use-app-store'
import { AccountSetup } from './components/AccountSetup'
import { AppShell } from './components/AppShell'
import { ToastHost } from './components/ToastHost'

export function App(): React.JSX.Element {
  const queryClient = useQueryClient()
  const activeAccountId = useAppStore((state) => state.activeAccountId)
  const setActiveAccount = useAppStore((state) => state.setActiveAccount)
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => unwrap(await window.mailApi.listAccounts())
  })
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: async () => unwrap(await window.mailApi.getSettings())
  })

  useEffect(() => {
    const theme = settingsQuery.data?.theme ?? 'system'
    document.documentElement.dataset.theme = theme
  }, [settingsQuery.data?.theme])

  useEffect(() => {
    const refreshAccounts = (): void => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    }
    window.addEventListener('mail-authentication-required', refreshAccounts)
    return () => window.removeEventListener('mail-authentication-required', refreshAccounts)
  }, [queryClient])

  useEffect(() => {
    const accounts = accountsQuery.data ?? []
    if (!activeAccountId && accounts[0]) setActiveAccount(accounts[0].id)
    if (activeAccountId && !accounts.some((account) => account.id === activeAccountId)) {
      setActiveAccount(accounts[0]?.id ?? null)
    }
  }, [accountsQuery.data, activeAccountId, setActiveAccount])

  if (accountsQuery.isPending || settingsQuery.isPending) {
    return (
      <div className="app-loading">
        <LoaderCircle className="spin" size={24} />
        <span>正在打开邮箱</span>
      </div>
    )
  }

  if (accountsQuery.error || settingsQuery.error) {
    return (
      <div className="app-loading error-state">
        <AlertCircle size={28} />
        <strong>应用数据无法读取</strong>
        <span>{accountsQuery.error instanceof Error ? accountsQuery.error.message : settingsQuery.error instanceof Error ? settingsQuery.error.message : '请重试'}</span>
        <button className="secondary-button" onClick={() => { void accountsQuery.refetch(); void settingsQuery.refetch() }}>重试</button>
      </div>
    )
  }

  if (!accountsQuery.data?.length) {
    return (
      <>
        <AccountSetup onConnected={(account) => setActiveAccount(account.id)} />
        <ToastHost />
      </>
    )
  }

  return (
    <>
      <AppShell accounts={accountsQuery.data} settings={settingsQuery.data!} />
      <ToastHost />
    </>
  )
}
