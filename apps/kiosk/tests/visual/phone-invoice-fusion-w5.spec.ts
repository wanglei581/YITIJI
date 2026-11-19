import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'

/**
 * 手机填写开票信息（2026-11-19）。文件名带 fusion-w5，进 playwright.w5.config.ts，CI 的 test:browser:w5 会跑。
 * 接口在这里拦，不起后端。
 */

const RESOLVE = '/api/v1/kiosk/invoice-sessions/scene/resolve'
const SCENE = 'w5InvoiceScene_012345678'
const SESSION = 'w5-invoice-session'
const TOKEN = 'w5-invoice-submit-token'
const SUBMIT = `/api/v1/kiosk/invoice-sessions/${SESSION}/submit`
const COLD = '这个链接不能用来填写开票信息。请回到一体机，重新扫码。'
const EXPIRED = '这个二维码已经过期。请回到一体机，重新扫码。'
const ALREADY = '这份开票信息已经提交过了。请回到一体机查看。'
const SUBMITTED = '已提交。开好后，电子发票发到你填的邮箱。'
const BLOCKED = '这一单开不了发票。请回到一体机查看订单。'
const REFUNDED = '已退款的单，开不了发票。'

// 夹具日期相对现在算（返工包 P2c1b 第 17 条），不写死年份。页面不读这个字段，只保持接口形状。
function resolved() {
  return {
    status: 200,
    json: {
      success: true,
      data: { sessionId: SESSION, submitToken: TOKEN, orderKind: 'print', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), status: '等手机填写' },
    },
  }
}

function runtimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('requestfailed', (request) => {
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()} ${request.failure()?.errorText ?? ''}`)
    }
  })
  return errors
}

test('冷开票链接在 375 宽说明不能填写，没有税号框 @w5-mobile', async ({ page }) => {
  const errors = runtimeErrors(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/invoice/phone')
  const root = page.locator('main[data-kiosk-screen="phone-invoice"]')
  await expect(root).toHaveAttribute('data-kiosk-viewport', 'mobile')
  await expect(root).toHaveAttribute('data-phone-invoice-state', 'cold')
  await expect(root.getByRole('heading', { name: COLD, exact: true })).toBeVisible()
  await expect(root.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByText('工作人员')).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  // 期望值改动（返工包 P2c1b 第 7 条）：原先断言这里有一个「请回到一体机，重新扫码」按钮且够大，
  // 可它没有任何动作，点了没反应。下一步已经写在标题句里，这一屏不再放可点的东西。
  await expect(root.getByRole('button')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('开票短链兑换后个人不显示税号框，提交不带税号 @w5-mobile', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  await page.setViewportSize({ width: 375, height: 812 })
  api.respond('POST', RESOLVE, resolved())
  api.respond('POST', SUBMIT, {
    status: 200,
    json: { success: true, data: { status: '已提交', message: SUBMITTED, requestId: 'inv-w5' } },
  })
  await page.goto(`/k/i/${SCENE}`)
  await expect(page).toHaveURL((url) => url.pathname === '/invoice/phone')
  const fragment = new URLSearchParams(new URL(page.url()).hash.slice(1))
  expect(fragment.get('sessionId')).toBe(SESSION)
  expect(fragment.get('submitToken')).toBe(TOKEN)
  const root = page.locator('main[data-kiosk-screen="phone-invoice"]')
  await expect(root.getByRole('heading', { name: '用手机扫码填写开票信息', exact: true })).toBeVisible()
  await expect(root.getByText('税号。单位才要填。个人不用填税号。')).toBeVisible()
  await expect(root.locator('input[name="taxId"]')).toHaveCount(0)
  // 专用发票这一句接上公开的服务电话配置（夹具默认 18369161921、工作日 9:00–18:00）。
  await expect(root.getByText('需要专用发票请拨打服务电话 18369161921（工作日 9:00–18:00）', { exact: true })).toBeVisible()
  // 「这台屏幕不保存税号」属于一体机屏，不放到手机上。
  await expect(root.getByText('接收邮箱。电子发票发到这个邮箱。', { exact: true })).toBeVisible()
  await expect(page.getByText('这台屏幕不保存税号')).toHaveCount(0)
  await expect(page.getByText('工作人员')).toHaveCount(0)
  await root.getByRole('button', { name: '单位', exact: true }).click()
  await expect(root.locator('input[name="taxId"]')).toBeVisible()
  await root.getByRole('button', { name: '个人', exact: true }).click()
  await expect(root.locator('input[name="taxId"]')).toHaveCount(0)
  await root.getByRole('textbox', { name: /抬头/ }).fill('张三')
  await root.getByRole('textbox', { name: /接收邮箱/ }).fill('a@b.cn')
  const sent = page.waitForRequest((candidate) => candidate.method() === 'POST' && new URL(candidate.url()).pathname === SUBMIT)
  await root.getByRole('button', { name: '提交', exact: true }).click()
  expect((await sent).postDataJSON()).toEqual({
    submitToken: TOKEN,
    titleType: 'personal',
    title: '张三',
    email: 'a@b.cn',
  })
  await expect(root.getByRole('heading', { name: SUBMITTED, exact: true })).toBeVisible()
  await expect(root.getByText('a@b.cn')).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  expect(errors).toEqual([])
})

test('开票短链已提交过：停在中转页并说明回一体机查看 @w5-mobile', async ({ page, api }) => {
  api.respond('POST', RESOLVE, {
    status: 400,
    json: { success: false, error: { code: 'INVOICE_ALREADY_SUBMITTED', message: ALREADY } },
  })
  await page.goto(`/k/i/${SCENE}`)
  const root = page.locator('main[data-kiosk-screen="invoice-scene-entry"]')
  await expect(root).toHaveAttribute('data-phone-invoice-state', 'submitted')
  await expect(root.getByRole('heading', { name: ALREADY, exact: true })).toBeVisible()
  await expect(page).toHaveURL((url) => url.pathname === `/k/i/${SCENE}`)
  await expect(root.getByRole('button')).toHaveCount(0)
})

test('开票短链格式不对：不发兑换请求 @w5-mobile', async ({ page, api }) => {
  await page.goto('/k/i/not-a-scene')
  const root = page.locator('main[data-kiosk-screen="invoice-scene-entry"]')
  await expect(root.getByRole('heading', { name: EXPIRED, exact: true })).toBeVisible()
  expect(api.requestCount('POST', RESOLVE)).toBe(0)
  await expect(root.getByRole('button')).toHaveCount(0)
})

test('已退款的单提交后说明开不了，并给出原因 @w5-mobile', async ({ page, api }) => {
  api.respond('POST', SUBMIT, {
    status: 409,
    json: { success: false, error: { code: 'INVOICE_NOT_ALLOWED', message: REFUNDED } },
  })
  await page.goto(`/invoice/phone#sessionId=${SESSION}&submitToken=${TOKEN}`)
  const root = page.locator('main[data-kiosk-screen="phone-invoice"]')
  await root.getByRole('textbox', { name: /抬头/ }).fill('张三')
  await root.getByRole('textbox', { name: /接收邮箱/ }).fill('a@b.cn')
  await root.getByRole('button', { name: '提交', exact: true }).click()
  await expect(root).toHaveAttribute('data-phone-invoice-state', 'blocked')
  await expect(root.getByRole('heading', { name: BLOCKED, exact: true })).toBeVisible()
  await expect(root.getByText(REFUNDED)).toBeVisible()
  await expect(root.getByRole('button')).toHaveCount(0)
})

test('提交时二维码已经过期：说明过期并让人回一体机重新扫码，表单收起 @w5-mobile', async ({ page, api }) => {
  api.respond('POST', SUBMIT, {
    status: 400,
    json: { success: false, error: { code: 'INVOICE_SCENE_UNUSABLE', message: EXPIRED } },
  })
  await page.goto(`/invoice/phone#sessionId=${SESSION}&submitToken=${TOKEN}`)
  const root = page.locator('main[data-kiosk-screen="phone-invoice"]')
  await root.getByRole('textbox', { name: /抬头/ }).fill('张三')
  await root.getByRole('textbox', { name: /接收邮箱/ }).fill('a@b.cn')
  await root.getByRole('button', { name: '提交', exact: true }).click()
  await expect(root).toHaveAttribute('data-phone-invoice-state', 'expired')
  await expect(root.getByRole('heading', { name: EXPIRED, exact: true })).toBeVisible()
  await expect(root.getByRole('textbox')).toHaveCount(0)
  await expect(root.getByRole('button')).toHaveCount(0)
})

test('抬头填错时服务端的中文句子留在表单上，可以改了再交 @w5-mobile', async ({ page, api }) => {
  api.respond('POST', SUBMIT, {
    status: 400,
    json: { success: false, error: { code: 'INVOICE_TITLE_INVALID', message: '抬头请控制在 80 个字以内。' } },
  })
  await page.goto(`/invoice/phone#sessionId=${SESSION}&submitToken=${TOKEN}`)
  const root = page.locator('main[data-kiosk-screen="phone-invoice"]')
  await root.getByRole('textbox', { name: /抬头/ }).fill('张三')
  await root.getByRole('textbox', { name: /接收邮箱/ }).fill('a@b.cn')
  await root.getByRole('button', { name: '提交', exact: true }).click()
  await expect(root.getByRole('alert')).toHaveText('抬头请控制在 80 个字以内。')
  await expect(root).toHaveAttribute('data-phone-invoice-state', 'form')
  await expect(root.getByRole('button', { name: '提交', exact: true })).toBeEnabled()
})
