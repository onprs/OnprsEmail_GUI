import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  CheckCircle2,
  ExternalLink,
  Globe2,
  LoaderCircle,
  RefreshCw,
  Server,
  TriangleAlert,
  WifiOff
} from 'lucide-react'
import { errorMessage, unwrap } from '../../lib/api'

const serviceLinks = [
  { label: 'Stalwart 管理后台', url: 'https://mail.onprs.online' },
  { label: 'SnappyMail 网页邮箱', url: 'https://use-mail.onprs.online' }
]

export function StatusWorkspace(): React.JSX.Element {
  const statusQuery = useQuery({
    queryKey: ['system-status'],
    queryFn: async () => unwrap(await window.mailApi.getSystemStatus()),
    refetchInterval: 60_000
  })

  return (
    <div className="settings-layout status-layout">
      <header className="page-header">
        <div>
          <h1>服务状态</h1>
          <p>Onprs 邮件基础设施</p>
        </div>
        <button
          className="secondary-button"
          onClick={() => void statusQuery.refetch()}
          disabled={statusQuery.isFetching}
        >
          <RefreshCw className={statusQuery.isFetching ? 'spin' : ''} size={16} />
          重新检查
        </button>
      </header>

      <section className="settings-section status-overview">
        <div className="status-summary">
          <span className="status-summary-icon">
            <Activity size={24} />
          </span>
          <div>
            <strong>
              {statusQuery.data?.checks.every((check) => check.status === 'healthy')
                ? '所有服务运行正常'
                : '部分服务需要检查'}
            </strong>
            <span>
              {statusQuery.data
                ? `检查于 ${new Date(statusQuery.data.checkedAt).toLocaleTimeString('zh-CN')}`
                : '正在获取状态'}
            </span>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>连接检查</h2>
            <p>公网服务与邮件路由</p>
          </div>
        </div>
        {statusQuery.isPending && (
          <div className="status-loading">
            <LoaderCircle className="spin" size={22} />
            正在检查服务
          </div>
        )}
        {statusQuery.error && <div className="form-error">{errorMessage(statusQuery.error)}</div>}
        <div className="service-check-list">
          {statusQuery.data?.checks.map((check) => {
            const Icon =
              check.status === 'healthy' ? CheckCircle2 : check.status === 'warning' ? TriangleAlert : WifiOff
            return (
              <div className={`service-check service-${check.status}`} key={check.id}>
                <span className="service-check-icon">
                  <Icon size={19} />
                </span>
                <div>
                  <strong>{check.name}</strong>
                  <span>{check.detail}</span>
                </div>
                <time>{check.latencyMs === null ? '—' : `${check.latencyMs} ms`}</time>
              </div>
            )
          })}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>管理入口</h2>
            <p>在系统浏览器中安全打开</p>
          </div>
        </div>
        <div className="external-link-list">
          {serviceLinks.map((link) => (
            <button key={link.url} onClick={() => void window.mailApi.openExternal(link.url)}>
              {link.url.includes('use-mail') ? <Globe2 size={18} /> : <Server size={18} />}
              <span>
                <strong>{link.label}</strong>
                <small>{link.url}</small>
              </span>
              <ExternalLink size={16} />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
