import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  Database,
  EyeOff,
  Info,
  Laptop,
  LoaderCircle,
  Mail,
  Moon,
  Plus,
  Radar,
  ShieldCheck,
  Sun,
  Trash2,
  X
} from 'lucide-react'
import type { AccountSummary, AppSettings, ThemeMode } from '@shared/types'
import { errorMessage, unwrap } from '../../lib/api'
import { useAppStore } from '../../store/use-app-store'
import { AccountSetup } from '../../components/AccountSetup'

interface SettingsWorkspaceProps {
  accounts: AccountSummary[]
  settings: AppSettings
}

export function SettingsWorkspace({ accounts, settings }: SettingsWorkspaceProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const notify = useAppStore((state) => state.notify)
  const setActiveAccount = useAppStore((state) => state.setActiveAccount)
  const [showAccountSetup, setShowAccountSetup] = useState(false)
  const ingressQuery = useQuery({
    queryKey: ['ingress-configuration'],
    queryFn: async () => unwrap(await window.mailApi.getIngressConfiguration())
  })

  const update = useMutation({
    mutationFn: async (patch: Partial<AppSettings>) => unwrap(await window.mailApi.updateSettings(patch)),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings'], updated)
      document.documentElement.dataset.theme = updated.theme
    },
    onError: (error) => notify(errorMessage(error), 'error')
  })
  const removeAccount = useMutation({
    mutationFn: async (accountId: string) => unwrap(await window.mailApi.removeAccount(accountId)),
    onSuccess: async (_value, accountId) => {
      const remaining = accounts.filter((account) => account.id !== accountId)
      setActiveAccount(remaining[0]?.id ?? null)
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      notify('账号已从此设备移除', 'success')
    },
    onError: (error) => notify(errorMessage(error), 'error')
  })
  const clearIngress = useMutation({
    mutationFn: async () => unwrap(await window.mailApi.clearIngressConfiguration()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ingress-configuration'] })
      notify('全域收件连接已移除', 'success')
    },
    onError: (error) => notify(errorMessage(error), 'error')
  })

  function setTheme(theme: ThemeMode): void {
    update.mutate({ theme })
  }

  return (
    <div className="settings-layout">
      <header className="page-header"><div><h1>设置</h1><p>账号、外观与隐私</p></div></header>

      <section className="settings-section">
        <div className="settings-section-heading"><div><h2>邮箱账号</h2><p>{accounts.length} 个已连接账号</p></div><button className="secondary-button" onClick={() => setShowAccountSetup(true)}><Plus size={16} />添加账号</button></div>
        <div className="settings-account-list">
          {accounts.map((account) => (
            <div className="settings-account-row" key={account.id}>
              <span className="account-avatar static">{account.displayName.slice(0, 1).toUpperCase()}</span>
              <div><strong>{account.displayName}</strong><span>{account.email}</span></div>
              <span className={`connection-state ${account.requiresAuthentication ? 'warning' : ''}`}><ShieldCheck size={14} />{account.requiresAuthentication ? '需要重新登录' : '安全存储'}</span>
              <button className="icon-button danger-hover" title="移除此账号" disabled={removeAccount.isPending} onClick={() => {
                if (window.confirm(`确认从此设备移除 ${account.email}？服务器邮件不会被删除。`)) removeAccount.mutate(account.id)
              }}><Trash2 size={17} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading"><div><h2>外观</h2><p>跟随系统或固定主题</p></div></div>
        <div className="setting-row">
          <div className="setting-label"><Laptop size={18} /><span><strong>主题</strong><small>应用界面颜色</small></span></div>
          <div className="segmented-control" role="group" aria-label="主题">
            <button className={settings.theme === 'system' ? 'active' : ''} onClick={() => setTheme('system')}><Laptop size={15} />系统</button>
            <button className={settings.theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}><Sun size={15} />浅色</button>
            <button className={settings.theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}><Moon size={15} />深色</button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading"><div><h2>通知与隐私</h2><p>控制新邮件提醒和外部资源</p></div></div>
        <label className="setting-row clickable">
          <div className="setting-label"><Bell size={18} /><span><strong>桌面通知</strong><small>收到新邮件时显示系统通知</small></span></div>
          <input className="switch" type="checkbox" checked={settings.notifications} onChange={(event) => update.mutate({ notifications: event.target.checked })} />
        </label>
        <label className="setting-row clickable">
          <div className="setting-label"><EyeOff size={18} /><span><strong>默认阻止远程图片</strong><small>减少邮件跟踪和隐私泄露</small></span></div>
          <input className="switch" type="checkbox" checked={settings.remoteImages === 'blocked'} onChange={(event) => update.mutate({ remoteImages: event.target.checked ? 'blocked' : 'allowed' })} />
        </label>
        <div className="setting-row">
          <div className="setting-label"><Database size={18} /><span><strong>每页邮件数</strong><small>服务端分页大小</small></span></div>
          <select value={settings.pageSize} onChange={(event) => update.mutate({ pageSize: Number(event.target.value) })}><option value={20}>20</option><option value={30}>30</option><option value={50}>50</option><option value={100}>100</option></select>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading"><div><h2>全域收件</h2><p>Ingress Catch-all 数据源</p></div></div>
        <div className="setting-row">
          <div className="setting-label"><Radar size={18} /><span><strong>{ingressQuery.data?.configured ? '已连接' : '未连接'}</strong><small>{ingressQuery.data?.baseUrl ?? '在全域收件页面连接'}</small></span></div>
          {ingressQuery.data?.configured && <button className="danger-text-button" onClick={() => {
            if (window.confirm('确认断开全域收件连接？本地保存的令牌将被删除。')) clearIngress.mutate()
          }} disabled={clearIngress.isPending}>{clearIngress.isPending ? <LoaderCircle className="spin" size={15} /> : <X size={15} />}断开连接</button>}
        </div>
      </section>

      <section className="settings-section about-section">
        <div className="setting-row"><div className="setting-label"><Info size={18} /><span><strong>Onprs Mail</strong><small>版本 0.1.1 · Electron JMAP 客户端</small></span></div><Mail size={20} /></div>
      </section>

      {showAccountSetup && <div className="modal-backdrop"><div className="settings-modal" role="dialog" aria-modal="true" aria-label="添加邮箱账号"><AccountSetup compact allowRegistration onCancel={() => setShowAccountSetup(false)} onConnected={(account) => { setActiveAccount(account.id); setShowAccountSetup(false) }} /></div></div>}
    </div>
  )
}
