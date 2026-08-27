import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const executablePath = process.env.ONPRS_MAIL_PACKAGED_EXECUTABLE
  ? resolve(process.env.ONPRS_MAIL_PACKAGED_EXECUTABLE)
  : resolve('release/win-unpacked/Onprs Mail.exe')

test('打包后的 Windows 应用可安全启动', async () => {
  test.skip(process.platform !== 'win32', 'Windows 打包测试仅在 Windows 执行')
  expect(existsSync(executablePath), '未生成 Windows 目录包，请先执行 npm run dist:dir').toBe(true)
  const userData = await mkdtemp(join(tmpdir(), 'onprs-mail-packaged-e2e-'))
  const electronApp = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      ONPRS_MAIL_TEST_USER_DATA: userData,
      ELECTRON_RENDERER_URL: 'http://127.0.0.1:9'
    }
  })
  try {
    const page = await electronApp.firstWindow()
    await expect(page).toHaveTitle('Onprs Mail')
    expect(page.url()).toBe('app://bundle/index.html')
    await expect(page.getByRole('heading', { name: '登录邮箱' })).toBeVisible()
    const bridgeAvailable = await page.evaluate(() => typeof (window as unknown as { mailApi?: unknown }).mailApi === 'object')
    expect(bridgeAvailable).toBe(true)
  } finally {
    await electronApp.close()
  }
})
