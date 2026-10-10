import { test, expect, type Page } from '@playwright/test'
import { checkAgreement } from './e2e/helpers'

const body = '这个账号由平台开通，还没有完成持有人确认，暂时不能在这里自己验证手机号。'
const nextStep = '请联系平台运营，提供盖章的机构确认函，由平台登记联系人手机号。登记后回到登录页点「忘记密码」，用这个手机号收验证码、设置你自己的密码，验证就完成了。'
const before = '在这之前，仍可用账号和密码登录、正常使用后台；手机号登录和自助找回密码暂时用不了。'

async function loginFixture(page: Page, ready: boolean | undefined, rejected = false) {
  const user = {
    id: 'phone-guide-partner', name: '测试机构', role: 'partner', orgId: 'guide-org',
    phoneMasked: '138****0000', phoneVerifiedAt: null,
    ...(ready === undefined ? {} : { phoneSelfVerifyReady: ready }),
  }
  const requests: string[] = []
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    if (path === '/api/v1/auth/login') {
      await route.fulfill({ json: { success: true, data: { token: 'fixture-token', user } } })
    } else if (path === '/api/v1/auth/me') {
      await route.fulfill({ json: { success: true, data: { userId: user.id, role: user.role, orgId: user.orgId, phoneSelfVerifyReady: ready } } })
    } else if (path === '/api/v1/auth/phone/code') {
      await route.fulfill(rejected
        ? { status: 409, json: { error: { code: 'ACCOUNT_PASSWORD_PROOF_NOT_READY', message: '旧信息需要重新确认' } } }
        : { json: { success: true, data: { sent: true, cooldownSeconds: 60 } } })
    } else {
      // 首页数据不在本用例范围，返回可处理的失败，避免误发真实请求。
      await route.fulfill({ status: 503, json: { error: { code: 'FIXTURE_UNAVAILABLE', message: '测试数据暂不可用' } } })
    }
  })
  await page.goto('/login')
  await page.locator('#partner-login-id').fill('guide-org')
  await page.locator('#partner-password').fill('fixture-password')
  await checkAgreement(page)
  await page.getByRole('button', { name: '登 录' }).click()
  const dialog = page.getByRole('dialog', { name: '手机号本人验证' })
  await expect(dialog).toBeVisible()
  return { dialog, requests }
}

for (const close of ['知道了，进入工作台', '稍后验证']) {
  test(`false 指路版无验证控件，${close}进入首页`, async ({ page }) => {
    const { dialog, requests } = await loginFixture(page, false)
    for (const copy of [body, nextStep, before]) await expect(dialog).toContainText(copy)
    await expect(dialog.locator('input')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '获取验证码' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '确认验证' })).toHaveCount(0)
    expect(requests).not.toContain('/api/v1/auth/phone/code')
    await dialog.getByRole('button', { name: close }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
    await expect(dialog).toHaveCount(0)
  })
}

for (const ready of [true, undefined]) {
  test(`${ready} 保留正常验证弹窗和成功发码`, async ({ page }) => {
    const { dialog, requests } = await loginFixture(page, ready)
    await expect(dialog.locator('#partner-phone-verify-code')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '确认验证' })).toBeVisible()
    await expect(dialog).not.toContainText(body)
    await dialog.getByRole('button', { name: '获取验证码' }).click()
    await expect(dialog.getByRole('button', { name: /\d+s 后重发/ })).toBeDisabled()
    expect(requests).toContain('/api/v1/auth/phone/code')
  })
}

test('旧登录信息发码遇到持有人证明 409 后切到指路版', async ({ page }) => {
  const { dialog } = await loginFixture(page, undefined, true)
  await dialog.getByRole('button', { name: '获取验证码' }).click()
  for (const copy of [body, nextStep, before]) await expect(dialog).toContainText(copy)
  await expect(dialog.locator('input')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '获取验证码' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '确认验证' })).toHaveCount(0)
  await dialog.getByRole('button', { name: '知道了，进入工作台' }).click()
  await expect(page).toHaveURL(/\/$/)
})
