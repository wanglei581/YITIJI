import { test, expect, type Page } from '@playwright/test'
import { checkAgreement } from './e2e/helpers'

const guideBody = '这个账号是平台代为开通的，暂时不能在这里自己验证手机号。'
const guideNext = '平台登记了你的手机号之后，回到登录页点「忘记密码」，用这个手机号收验证码、设置你自己的密码，验证就完成了。还没有登记，或者收不到验证码的，请联系平台运营，提交盖章的《账号联系人确认函》（写明联系人姓名和手机号）。'
const keptIntro = '，尚未完成本人验证。用户名和密码已登录成功，可以进入工作台。'
const keptFoot = '新账号初始密码由管理员交付。预留手机号尚不能用于短信登录；如需手机登录或找回，请联系管理员核对账号，按确认函联系人登记及本人短信重置流程办理。'
const noCodeHint = '收不到验证码？这个账号可能还没有登记手机号，请联系平台运营。'

function fixtureUser(available: boolean | undefined, phoneMasked?: string, verifiedAt: string | null = null) {
  return {
    id: 'phone-guide-partner',
    name: '测试机构',
    role: 'partner',
    orgId: 'guide-org',
    phoneVerifiedAt: verifiedAt,
    ...(phoneMasked ? { phoneMasked } : {}),
    ...(available === undefined ? {} : { phoneVerificationAvailable: available }),
  }
}

async function routePartner(page: Page, user: ReturnType<typeof fixtureUser>) {
  const requests: string[] = []
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    if (path === '/api/v1/auth/login') {
      await route.fulfill({ json: { success: true, data: { token: 'fixture-token', user } } })
      return
    }
    if (path === '/api/v1/auth/me') {
      await route.fulfill({
        json: {
          success: true,
          data: { userId: user.id, role: user.role, orgId: user.orgId, phoneMasked: user.phoneMasked, phoneVerifiedAt: user.phoneVerifiedAt },
        },
      })
      return
    }
    if (path === '/api/v1/auth/phone/code') {
      await route.fulfill({ json: { success: true, data: { sent: true, cooldownSeconds: 60 } } })
      return
    }
    await route.fulfill({ status: 503, json: { error: { code: 'FIXTURE_UNAVAILABLE', message: '测试数据暂不可用' } } })
  })
  return requests
}

async function submitPassword(page: Page) {
  await page.goto('/login')
  await page.locator('#partner-login-id').fill('guide-org')
  await page.locator('#partner-password').fill('fixture-password')
  await checkAgreement(page)
  await page.getByRole('button', { name: '登 录' }).click()
}

for (const close of ['进入工作台', '关闭提示并进入工作台']) {
  test(`没登记手机号且 false：指路弹窗，点「${close}」进入工作台`, async ({ page }) => {
    const requests = await routePartner(page, fixtureUser(false))
    await submitPassword(page)
    const dialog = page.getByRole('dialog', { name: '账号已登录' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(guideBody)
    await expect(dialog).toContainText(guideNext)
    await expect(dialog.locator('input')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '获取验证码' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '确认验证' })).toHaveCount(0)
    const body = await page.locator('body').innerText()
    expect(body).not.toContain('undefined')
    expect(body).not.toContain('预留手机号为')
    expect(body).not.toContain(keptFoot)
    expect(body.split(guideBody).length - 1).toBe(1)
    expect(body.split(guideNext).length - 1).toBe(1)
    expect(requests).not.toContain('/api/v1/auth/phone/code')
    await dialog.getByRole('button', { name: close, exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
    await expect(dialog).toHaveCount(0)
    expect(requests).not.toContain('/api/v1/auth/phone/code')
  })
}

test('没登记手机号且 true：不弹，直接进工作台', async ({ page }) => {
  await routePartner(page, fixtureUser(true))
  await submitPassword(page)
  await page.waitForURL(/\/$/, { timeout: 15_000 })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
})

test('没登记手机号且回包没有 phoneVerificationAvailable：不弹，直接进工作台', async ({ page }) => {
  await routePartner(page, fixtureUser(undefined))
  await submitPassword(page)
  await page.waitForURL(/\/$/, { timeout: 15_000 })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
})

test('已验证且 false：不弹，直接进工作台', async ({ page }) => {
  await routePartner(page, fixtureUser(false, '138****0000', '2026-10-10T00:00:00.000Z'))
  await submitPassword(page)
  await page.waitForURL(/\/$/, { timeout: 15_000 })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
})

test('有手机号、未验证且 false：仍是 10/24 账号已登录原文', async ({ page }) => {
  const requests = await routePartner(page, fixtureUser(false, '138****0000'))
  await submitPassword(page)
  const dialog = page.getByRole('dialog', { name: '账号已登录' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('账号 测试机构 预留手机号为 138****0000')
  await expect(dialog).toContainText(keptIntro)
  await expect(dialog).toContainText(keptFoot)
  await expect(dialog).not.toContainText(guideBody)
  await expect(dialog).not.toContainText(guideNext)
  await expect(dialog.locator('#partner-phone-verify-code')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '进入工作台', exact: true })).toBeVisible()
  expect(requests).not.toContain('/api/v1/auth/phone/code')
})

test('有手机号、未验证且 true：验证码表单照旧', async ({ page }) => {
  const requests = await routePartner(page, fixtureUser(true, '138****0000'))
  await submitPassword(page)
  const dialog = page.getByRole('dialog', { name: '手机号本人验证' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('#partner-phone-verify-code')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '确认验证' })).toBeVisible()
  await expect(dialog).toContainText('账号 测试机构 预留手机号为 138****0000')
  await expect(dialog).toContainText(keptIntro)
  await expect(dialog).not.toContainText(keptFoot)
  await expect(dialog).not.toContainText(guideBody)
  await dialog.getByRole('button', { name: '获取验证码' }).click()
  await expect(dialog.getByRole('button', { name: /\d+s 后重发/ })).toBeDisabled()
  expect(requests).toContain('/api/v1/auth/phone/code')
})

test('找回密码填码步说明收不到验证码找谁，第一步和第三步没有', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/password/reset/start') {
      await route.fulfill({ json: { success: true, data: { sent: true, cooldownSeconds: 60 } } })
      return
    }
    if (path === '/api/v1/auth/password/reset/verify') {
      await route.fulfill({ json: { success: true, data: { resetTicket: 'fixture-reset-ticket' } } })
      return
    }
    await route.fulfill({ status: 503, json: { error: { code: 'FIXTURE_UNAVAILABLE', message: '测试数据暂不可用' } } })
  })
  await page.goto('/login')
  await expect(page.locator('body')).not.toContainText(noCodeHint)
  await page.getByRole('button', { name: '忘记密码？找回 / 重置' }).click()
  const dialog = page.getByRole('dialog', { name: '找回密码' })
  await expect(dialog).toBeVisible()
  await expect(dialog).not.toContainText(noCodeHint)
  await dialog.locator('#partner-reset-identity').fill('任意机构账号')
  await checkAgreement(dialog)
  await dialog.getByRole('button', { name: '发送验证码' }).click()
  await expect(dialog.locator('#partner-reset-code')).toBeVisible()
  await expect(dialog.getByText(noCodeHint, { exact: true })).toBeVisible()
  const body = await page.locator('body').innerText()
  expect(body.split(noCodeHint).length - 1).toBe(1)
  const afterResend = await dialog.evaluate((root, hint) => {
    const resend = root.querySelector('.c-resend')
    const hintNode = [...root.querySelectorAll('.c-hint')].find((node) => node.textContent?.includes(hint))
    if (!resend || !hintNode) return false
    return Boolean(resend.compareDocumentPosition(hintNode) & Node.DOCUMENT_POSITION_FOLLOWING)
  }, noCodeHint)
  expect(afterResend).toBe(true)
  await dialog.locator('#partner-reset-code').fill('123456')
  await dialog.getByRole('button', { name: '校验验证码' }).click()
  await expect(dialog.locator('#partner-reset-password')).toBeVisible()
  await expect(dialog).not.toContainText(noCodeHint)
  await expect(page.locator('body')).not.toContainText(noCodeHint)
})
