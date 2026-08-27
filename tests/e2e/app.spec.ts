import { spawn } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('安全启动并显示账号接入页', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'onprs-mail-e2e-'))
  const electronApp = await electron.launch({
    args: ['.'],
    env: { ...process.env, ONPRS_MAIL_TEST_USER_DATA: userData }
  })

  try {
    const page = await electronApp.firstWindow()
    await expect(page).toHaveTitle('Onprs Mail')
    await expect(page.getByRole('heading', { name: '登录邮箱' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '创建邮箱' })).toBeVisible()
    await expect(page.getByLabel('邮箱地址')).toBeVisible()
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()

    const security = await page.evaluate(() => ({
      hasRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
      hasProcess: typeof (window as unknown as { process?: unknown }).process !== 'undefined',
      apiMethods: Object.keys((window as unknown as { mailApi: Record<string, unknown> }).mailApi).sort()
    }))
    expect(security.hasRequire).toBe(false)
    expect(security.hasProcess).toBe(false)
    expect(security.apiMethods).toContain('connectAccount')
    expect(security.apiMethods).toContain('registerAccount')
    expect(security.apiMethods).toContain('getRegistrationCredentialStatus')
    expect(security.apiMethods).toContain('forgetRegistrationCredential')
    expect(security.apiMethods).not.toContain('invoke')

    if (process.platform === 'win32') {
      const secondEnvironment: NodeJS.ProcessEnv = { ...process.env, ONPRS_MAIL_TEST_USER_DATA: userData }
      delete secondEnvironment.ELECTRON_RUN_AS_NODE
      const secondInstance = spawn(resolve('node_modules/electron/dist/electron.exe'), ['.'], {
        env: secondEnvironment,
        stdio: 'ignore'
      })
      const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
        const timeout = setTimeout(() => {
          secondInstance.kill()
          rejectExit(new Error('第二个应用实例未按预期退出'))
        }, 10_000)
        secondInstance.once('error', (error) => {
          clearTimeout(timeout)
          rejectExit(error)
        })
        secondInstance.once('exit', (code) => {
          clearTimeout(timeout)
          resolveExit(code)
        })
      })
      expect(exitCode).toBe(0)
      const windowState = await electronApp.evaluate(({ BrowserWindow }) => ({
        count: BrowserWindow.getAllWindows().length,
        visible: BrowserWindow.getAllWindows()[0]?.isVisible()
      }))
      expect(windowState).toEqual({ count: 1, visible: true })
    }

    await mkdir('test-results', { recursive: true })
    await page.screenshot({ path: 'test-results/account-setup.png', fullPage: true })
  } finally {
    await electronApp.close()
  }
})

test('创建表单直接反馈字段校验而不是静默禁用按钮', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'onprs-mail-validation-e2e-'))
  const electronApp = await electron.launch({
    args: ['.'],
    env: { ...process.env, ONPRS_MAIL_TEST_USER_DATA: userData }
  })

  try {
    const page = await electronApp.firstWindow()
    await page.getByRole('tab', { name: '创建邮箱' }).click()
    const submit = page.getByRole('button', { name: '创建并登录' })
    await expect(submit).toBeEnabled()

    await page.getByLabel('邮箱名').fill('new.user')
    await page.getByLabel('显示名称').fill('新用户')
    await page.getByLabel('密码', { exact: true }).fill('short-pass')
    await page.getByLabel('确认密码').fill('short-pass')
    await page.getByLabel('注册码', { exact: true }).fill('registration-code-1234567890-abcdef')
    await submit.click()

    const validationMessage = await page.getByLabel('密码', { exact: true }).evaluate(
      (input: HTMLInputElement) => input.validationMessage
    )
    expect(validationMessage.length).toBeGreaterThan(0)
    await expect(page.getByRole('heading', { name: '创建邮箱' })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
