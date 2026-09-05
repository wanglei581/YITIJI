import { test, expect } from '@playwright/test'
import { collectPageFaults, assertPageHonest, checkAgreement } from './helpers'

test.describe('登录页（mock 口径）', () => {
  test('未勾选协议时密码登录被拦截，中文原因可见', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '合作机构登录' })).toBeVisible()

    await page.locator('#partner-login-id').fill('demo-org')
    await page.locator('#partner-password').fill('any-password')
    await page.getByRole('button', { name: '登 录' }).click()

    await expect(page.getByRole('alert')).toContainText('请先阅读并同意用户服务协议和隐私政策')
    await expect(page).toHaveURL(/\/login/)
    await assertPageHonest(page, errors)
  })

  test('勾选协议后密码登录进入工作台（mock 任意密码即成功）', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.locator('#partner-login-id').fill('demo-org')
    await page.locator('#partner-password').fill('any-password')
    await checkAgreement(page)
    await page.getByRole('button', { name: '登 录' }).click()
    await page.waitForURL(/\/$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
  })

  test('显示/隐藏密码、记住账号、打开法律文档', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    const password = page.locator('#partner-password')
    await password.fill('secret')
    await expect(password).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: '显示密码' }).click()
    await expect(password).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: '隐藏密码' }).click()
    await expect(password).toHaveAttribute('type', 'password')

    await page.getByRole('checkbox', { name: '记住账号' }).click()
    await expect(page.getByRole('checkbox', { name: '记住账号' })).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('link', { name: '《用户服务协议》' }).click()
    await expect(page.getByRole('dialog', { name: '用户服务协议' })).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).click()
    await expect(page.getByRole('dialog', { name: '用户服务协议' })).toHaveCount(0)

    await page.getByRole('link', { name: '《隐私政策》' }).click()
    await expect(page.getByRole('dialog', { name: '隐私政策' })).toBeVisible()
  })

  test('验证码登录在 mock 下给出中文原因，不静默', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '验证码登录' }).click()
    await page.getByLabel('手机号').fill('13800138000')
    await checkAgreement(page)
    await page.getByRole('button', { name: '获取验证码' }).click()
    await expect(page.getByRole('alert')).toContainText('演示模式')
    await expect(page.getByRole('alert')).toContainText('短信')
  })

  test('忘记密码在 mock 下给出中文原因', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /忘记密码/ }).click()
    const dialog = page.getByRole('dialog', { name: '找回密码' })
    await expect(dialog).toBeVisible()
    await checkAgreement(dialog)
    await dialog.getByLabel(/机构账号/).fill('demo-org')
    await dialog.getByRole('button', { name: '发送验证码' }).click()
    await expect(dialog.getByRole('alert')).toContainText('演示模式')
    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect(dialog).toHaveCount(0)
  })
})
