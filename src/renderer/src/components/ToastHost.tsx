import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useAppStore } from '../store/use-app-store'

export function ToastHost(): React.JSX.Element {
  const toasts = useAppStore((state) => state.toasts)
  const dismiss = useAppStore((state) => state.dismissToast)
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? AlertCircle : Info
        return (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            <Icon size={17} />
            <span>{toast.message}</span>
            <button className="icon-button compact" title="关闭通知" onClick={() => dismiss(toast.id)}>
              <X size={15} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
