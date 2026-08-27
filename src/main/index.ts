import { existsSync, renameSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  net,
  protocol,
  session,
  shell
} from 'electron'
import { AppDatabase } from './storage/database'
import { CredentialStore } from './storage/credential-store'
import { AccountService } from './services/account-service'
import { MailService } from './services/mail-service'
import { IngressService } from './services/ingress-service'
import { SystemService } from './services/system-service'
import { registerIpcHandlers } from './ipc/register-ipc'

const currentDirectory = fileURLToPath(new URL('.', import.meta.url))
const testUserData = process.env.ONPRS_MAIL_TEST_USER_DATA
if (testUserData) app.setPath('userData', testUserData)
let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) app.quit()

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false
    }
  }
])

function resolveTestRegistrationServerUrl(): string | undefined {
  const value = process.env.ONPRS_MAIL_TEST_REGISTRATION_SERVER_URL
  if (!value || app.isPackaged || !testUserData) return undefined

  const url = new URL(value)
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('邮箱注册测试服务器必须使用本机回环地址')
  }
  return url.origin
}

function installApplicationProtocol(): void {
  const rendererRoot = normalize(join(currentDirectory, '../renderer'))
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    const relativePath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '')
    let candidate = normalize(join(rendererRoot, relativePath))
    if (!candidate.startsWith(`${rendererRoot}${sep}`) && candidate !== rendererRoot) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!existsSync(candidate)) candidate = join(rendererRoot, 'index.html')
    return net.fetch(pathToFileURL(candidate).toString())
  })
}

function titleBarColors(): { color: string; symbolColor: string } {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#1d211f', symbolColor: '#f0f4f1' }
    : { color: '#f4f6f3', symbolColor: '#252a27' }
}

function openApplicationDatabase(filePath: string): AppDatabase {
  try {
    return new AppDatabase(filePath)
  } catch (error) {
    const backupBase = `${filePath}.corrupt-${Date.now()}`
    for (const suffix of ['', '-wal', '-shm']) {
      const source = `${filePath}${suffix}`
      if (existsSync(source)) renameSync(source, `${backupBase}${suffix}`)
    }
    dialog.showErrorBox('本地数据已恢复', `无法读取原有本地数据库，已将其备份到：\n${backupBase}`)
    return new AppDatabase(filePath)
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171a18' : '#f4f6f3',
    title: 'Onprs Mail',
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay: process.platform === 'win32' ? { ...titleBarColors(), height: 44 } : false,
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocolName = new URL(url).protocol
      if (protocolName === 'https:' || protocolName === 'http:' || protocolName === 'mailto:') {
        setImmediate(() => void shell.openExternal(url))
      }
    } catch {
      // 非法地址保持拒绝，不传递给系统。
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, targetUrl) => {
    const currentUrl = window.webContents.getURL()
    if (targetUrl !== currentUrl) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())

  const developmentUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  if (developmentUrl) {
    void window.loadURL(developmentUrl)
  } else {
    void window.loadURL('app://bundle/index.html')
  }

  return window
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('online.onprs.mail.desktop')
    installApplicationProtocol()
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

    database = openApplicationDatabase(join(app.getPath('userData'), 'onprs-mail.db'))
    const credentials = new CredentialStore()
    const accounts = new AccountService(database, credentials, {
      registrationServerUrl: resolveTestRegistrationServerUrl()
    })
    const mail = new MailService(accounts)
    const ingress = new IngressService(database, credentials)
    const system = new SystemService(database)
    registerIpcHandlers({ database, accounts, mail, ingress, system })

    mainWindow = createMainWindow()
    nativeTheme.on('updated', () => {
      if (mainWindow && process.platform === 'win32') mainWindow.setTitleBarOverlay(titleBarColors())
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    database?.close()
    database = null
  })
}
