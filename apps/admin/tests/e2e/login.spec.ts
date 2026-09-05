import { expect, test } from '@playwright/test'
import { openAnonymous, settleAdminPage } from './helpers/open'

test.describe('登录页（mock 口径：密码登录旁路任意账号可进）', () => {
  test('未勾选协议时拦截登录，文案为中文', async ({ page }) => {
    const guards = await openAnonymous(page, '/login')
    await expect(page.getByRole('heading', { name: /值守每一台终端/ })).toBeVisible()
    await page.locator('#admin-login-id').fill('admin')
    await page.locator('#admin-password').fill('Password123!')
    await page.getByRole('button', { name: '登 录' }).click()
    await expect(page.getByText('请先阅读并同意用户服务协议和隐私政策')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
    await settleAdminPage(page, guards)
  })

  test('勾选协议后密码登录进入工作台', async ({ page }) => {
    await openAnonymous(page, '/login')
    await page.locator('#admin-login-id').fill('e2e-admin')
    await page.locator('#admin-password').fill('Password123!')
    await page.locator('.c-agree .box').click()
    await page.getByRole('button', { name: '登 录' }).click()
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 })
    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible()
    await expect(page.getByText('当前为 mock 模式')).toBeVisible()
  })

  test('验证码登录在 mock 下给出中文原因，不静默', async ({ page }) => {
    await openAnonymous(page, '/login')
    await page.getByRole('button', { name: '验证码登录' }).click()
    await page.locator('.c-agree .box').click()
    await page.locator('#admin-sms-phone').fill('13800138000')
    await page.getByRole('button', { name: '获取验证码' }).click()
    await expect(page.getByText('当前为 mock 模式，该操作需要连接真实后端')).toBeVisible()
  })

  test('打开用户服务协议弹窗', async ({ page }) => {
    await openAnonymous(page, '/login')
    await page.getByRole('link', { name: /用户服务协议/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})
