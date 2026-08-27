import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AtSign,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
  X
} from 'lucide-react'
import type { AccountSummary } from '@shared/types'
import { UiError, errorMessage, unwrap } from '../lib/api'
import { useAppStore } from '../store/use-app-store'

interface AccountSetupProps {
  onConnected?(account: AccountSummary): void
  onCancel?(): void
  compact?: boolean
  initialEmail?: string
  initialServerUrl?: string
  initialDisplayName?: string
  heading?: string
  allowRegistration?: boolean
}

type SetupMode = 'login' | 'register'

export function AccountSetup({
  onConnected,
  onCancel,
  compact = false,
  initialEmail = '',
  initialServerUrl = 'https://mail.onprs.online',
  initialDisplayName = '',
  heading,
  allowRegistration = !compact
}: AccountSetupProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const notify = useAppStore((state) => state.notify)
  const [mode, setMode] = useState<SetupMode>('login')
  const [email, setEmail] = useState(initialEmail)
  const [localPart, setLocalPart] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [registrationCode, setRegistrationCode] = useState('')
  const [rememberRegistrationCode, setRememberRegistrationCode] = useState(true)
  const [replaceStoredRegistrationCode, setReplaceStoredRegistrationCode] = useState(false)
  const [serverUrl, setServerUrl] = useState(initialServerUrl)
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [advanced, setAdvanced] = useState(false)

  const registrationCredentialQuery = useQuery({
    queryKey: ['registration-credential-status'],
    queryFn: async () => unwrap(await window.mailApi.getRegistrationCredentialStatus()),
    enabled: mode === 'register'
  })
  const useStoredRegistrationCode =
    registrationCredentialQuery.data?.hasSavedRegistrationCode === true && !replaceStoredRegistrationCode

  function connected(account: AccountSummary): void {
    void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    onConnected?.(account)
  }

  const connect = useMutation({
    mutationFn: async () =>
      unwrap(
        await window.mailApi.connectAccount({
          email: email.trim(),
          password,
          serverUrl: serverUrl.trim(),
          displayName: displayName.trim() || undefined,
          remember
        })
      ),
    onSuccess: connected
  })

  const register = useMutation({
    mutationFn: async () => {
      if (password !== confirmPassword) throw new Error('两次输入的密码不一致')
      return unwrap(
        await window.mailApi.registerAccount({
          localPart: localPart.trim().toLowerCase(),
          password,
          registrationCredential: useStoredRegistrationCode
            ? { source: 'saved' }
            : { source: 'new', registrationCode: registrationCode.trim(), remember: rememberRegistrationCode },
          displayName: displayName.trim() || undefined,
          remember
        })
      )
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['registration-credential-status'] })
      if (result.registrationCredentialUpdate === 'failed') {
        notify('邮箱已创建，但本机注册码状态更新失败', 'info')
      } else if (result.registrationCredentialUpdate === 'unconfirmed') {
        notify('已恢复邮箱登录，但注册码未保存', 'info')
      }
      connected(result.account)
    },
    onError: (error) => {
      if (error instanceof UiError && error.code === 'REGISTRATION_CODE_INVALID' && useStoredRegistrationCode) {
        setReplaceStoredRegistrationCode(true)
        setRegistrationCode('')
      }
      void queryClient.invalidateQueries({ queryKey: ['registration-credential-status'] })
    }
  })

  const forgetRegistrationCredential = useMutation({
    mutationFn: async () => unwrap(await window.mailApi.forgetRegistrationCredential()),
    onSuccess: () => {
      setReplaceStoredRegistrationCode(false)
      setRegistrationCode('')
      register.reset()
      queryClient.setQueryData(['registration-credential-status'], { hasSavedRegistrationCode: false })
    },
    onError: (error) => notify(errorMessage(error), 'error')
  })

  const activeMutation = mode === 'login' ? connect : register
  const isPending = activeMutation.isPending
  const registrationStatusBlocking =
    mode === 'register' &&
    !replaceStoredRegistrationCode &&
    (registrationCredentialQuery.isPending || registrationCredentialQuery.isError)

  function switchMode(nextMode: SetupMode): void {
    setMode(nextMode)
    setPassword('')
    setConfirmPassword('')
    setShowPassword(false)
    setReplaceStoredRegistrationCode(false)
    connect.reset()
    register.reset()
  }

  function submit(): void {
    if (mode === 'login') connect.mutate()
    else register.mutate()
  }

  const title = heading ?? (compact && !allowRegistration ? '添加邮箱账号' : mode === 'login' ? '登录邮箱' : '创建邮箱')
  const subtitle = mode === 'login' ? '使用 Onprs 邮箱账号登录' : '创建你的 @onprs.online 邮箱地址'

  return (
    <div className={compact ? 'account-setup compact-setup' : 'account-setup'}>
      {!compact && (
        <div className="setup-brand">
          <span className="brand-mark">
            <Mail size={25} strokeWidth={1.8} />
          </span>
          <span>Onprs Mail</span>
        </div>
      )}
      <form
        className={`setup-form ${mode === 'register' ? 'registration-form' : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {allowRegistration && (
          <div className="setup-mode-switch" role="tablist" aria-label="账号接入方式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={mode === 'login' ? 'active' : ''}
              onClick={() => switchMode('login')}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              className={mode === 'register' ? 'active' : ''}
              onClick={() => switchMode('register')}
            >
              创建邮箱
            </button>
          </div>
        )}

        <div className="setup-heading-row">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {onCancel && (
            <button type="button" className="icon-button" title="关闭" onClick={onCancel}>
              <X size={18} />
            </button>
          )}
        </div>

        {mode === 'login' ? (
          <>
            <label className="field-label" htmlFor="account-email">
              邮箱地址
            </label>
            <div className="input-with-icon">
              <Mail size={17} />
              <input
                id="account-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@onprs.online"
                autoComplete="username"
                required
                autoFocus
              />
            </div>
          </>
        ) : (
          <>
            <label className="field-label" htmlFor="account-local-part">
              邮箱名
            </label>
            <div className="input-with-icon account-name-input">
              <AtSign size={17} />
              <input
                id="account-local-part"
                value={localPart}
                onChange={(event) => setLocalPart(event.target.value.toLowerCase())}
                placeholder="name"
                autoComplete="username"
                minLength={3}
                maxLength={32}
                pattern="[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?"
                required
                autoFocus
              />
              <span>@onprs.online</span>
            </div>

            <label className="field-label" htmlFor="registration-display-name">
              显示名称
            </label>
            <div className="input-with-icon">
              <UserRound size={17} />
              <input
                id="registration-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={120}
                required
              />
            </div>
          </>
        )}

        <label className="field-label" htmlFor="account-password">
          密码
        </label>
        <div className="input-with-icon password-input">
          <LockKeyhole size={17} />
          <input
            id="account-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 12 : 1}
            maxLength={mode === 'register' ? 128 : 4096}
            required
          />
          <button
            type="button"
            className="input-action"
            title={showPassword ? '隐藏密码' : '显示密码'}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>

        {mode === 'register' && (
          <>
            <label className="field-label" htmlFor="account-confirm-password">
              确认密码
            </label>
            <div className="input-with-icon">
              <LockKeyhole size={17} />
              <input
                id="account-confirm-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </div>

            <label className="field-label" htmlFor="registration-code">
              注册码
            </label>
            {replaceStoredRegistrationCode ||
            (!registrationCredentialQuery.isPending &&
              !registrationCredentialQuery.isError &&
              !registrationCredentialQuery.data?.hasSavedRegistrationCode) ? (
              <>
                <div className="input-with-icon">
                  <KeyRound size={17} />
                  <input
                    id="registration-code"
                    type="password"
                    value={registrationCode}
                    onChange={(event) => setRegistrationCode(event.target.value)}
                    autoComplete="one-time-code"
                    minLength={32}
                    maxLength={4096}
                    required
                  />
                  {registrationCredentialQuery.data?.hasSavedRegistrationCode && (
                    <button
                      type="button"
                      className="input-action"
                      title="继续使用已保存的注册码"
                      onClick={() => {
                        setReplaceStoredRegistrationCode(false)
                        setRegistrationCode('')
                        register.reset()
                      }}
                    >
                      <X size={17} />
                    </button>
                  )}
                </div>
                <label className="check-row registration-code-remember">
                  <input
                    type="checkbox"
                    checked={rememberRegistrationCode}
                    onChange={(event) => setRememberRegistrationCode(event.target.checked)}
                  />
                  <span>创建成功后在此设备上记住注册码</span>
                </label>
              </>
            ) : registrationCredentialQuery.isPending ? (
              <div className="registration-code-status" aria-live="polite">
                <LoaderCircle className="spin" size={17} />
                <span>正在读取本机注册码</span>
              </div>
            ) : registrationCredentialQuery.isError ? (
              <div className="registration-code-error" role="alert">
                <span>{errorMessage(registrationCredentialQuery.error)}</span>
                <div>
                  <button
                    type="button"
                    className="icon-button"
                    title="重新读取注册码"
                    onClick={() => {
                      void registrationCredentialQuery.refetch()
                    }}
                  >
                    <RefreshCw size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    title="重新输入注册码"
                    onClick={() => setReplaceStoredRegistrationCode(true)}
                  >
                    <KeyRound size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button danger-hover"
                    title="忘记本机注册码"
                    disabled={forgetRegistrationCredential.isPending}
                    onClick={() => {
                      if (window.confirm('确认忘记本机保存的注册码？下次创建邮箱时需要重新输入。')) {
                        forgetRegistrationCredential.mutate()
                      }
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="registration-code-status">
                <ShieldCheck size={17} />
                <span>已安全保存在此设备</span>
                <button
                  type="button"
                  className="icon-button"
                  title="更换注册码"
                  onClick={() => {
                    setReplaceStoredRegistrationCode(true)
                    register.reset()
                  }}
                >
                  <RefreshCw size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button danger-hover"
                  title="忘记本机注册码"
                  disabled={forgetRegistrationCredential.isPending}
                  onClick={() => {
                    if (window.confirm('确认忘记本机保存的注册码？下次创建邮箱时需要重新输入。')) {
                      forgetRegistrationCredential.mutate()
                    }
                  }}
                >
                  {forgetRegistrationCredential.isPending ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Trash2 size={16} />
                  )}
                </button>
              </div>
            )}
          </>
        )}

        {mode === 'login' && (
          <button type="button" className="text-button setup-advanced" onClick={() => setAdvanced((value) => !value)}>
            <Server size={15} />
            {advanced ? '收起连接设置' : '连接设置'}
          </button>
        )}

        {mode === 'login' && advanced && (
          <div className="advanced-fields">
            <label className="field-label" htmlFor="server-url">
              服务器地址
            </label>
            <input
              id="server-url"
              type="url"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              required
            />
            <label className="field-label" htmlFor="display-name">
              显示名称
            </label>
            <input
              id="display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={120}
            />
          </div>
        )}

        <label className="check-row">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span>在此设备上记住账号</span>
        </label>

        {activeMutation.error && (
          <div className="form-error" role="alert">
            {errorMessage(activeMutation.error)}
          </div>
        )}

        <button
          className="primary-button setup-submit"
          type="submit"
          disabled={isPending || registrationStatusBlocking}
        >
          {isPending ? (
            <LoaderCircle className="spin" size={17} />
          ) : mode === 'login' ? (
            <LockKeyhole size={17} />
          ) : (
            <Mail size={17} />
          )}
          {isPending ? (mode === 'login' ? '正在登录' : '正在创建') : mode === 'login' ? '登录' : '创建并登录'}
        </button>
      </form>
      {!compact && <div className="setup-footer">JMAP · HTTPS</div>}
    </div>
  )
}
