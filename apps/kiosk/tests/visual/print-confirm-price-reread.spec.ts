// 确认页重读价目。从 print-confirm-price-truth.spec.ts 拆出，
// 原文件只留 2026-11-19 之前已有的用例。夹具与原文件同一套。

import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { KIOSK_CONFIG_PATH, withMachinePricing } from '../fixtures/machine-pricing'
import { test, expect } from '../fixtures/kiosk-test'
import { RECRUITMENT_HOSTING_ON, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'
import { W2_FILE, W2_ORDER, W2_PRINT_PARAMS, writePrintHandoff } from './fixtures/fusion-w2-state'

const NOW = '2026-08-18T00:00:00.000Z'

/** 价目表：黑白 20 分/页、彩色 50 分/页（与生产 seed 的服务键一致）。 */
const UNIT_CENTS = { black_white: 20, color: 50 } as const
const SERVICE_KEY = { black_white: 'print_bw_page', color: 'print_color_page' } as const


const CAPABILITY_KEYS = [
  'document_print', 'phone_upload', 'cloud_upload', 'usb_import', 'material_pack',
  'scan', 'copy', 'id_photo', 'format_convert', 'signature_stamp',
  'color_print', 'duplex_print',
]

function capabilities(available: string[]): unknown {
  return {
    terminalCode: 'KSK-001',
    capabilities: CAPABILITY_KEYS.map((capabilityKey) =>
      available.includes(capabilityKey)
        ? { capabilityKey, status: 'available', note: null, configured: true, updatedAt: NOW }
        : { capabilityKey, status: 'not_verified', note: null, configured: false, updatedAt: null },
    ),
  }
}

function registerShell(api: ApiRouter, available: string[]): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', { status: 200, json: capabilities(available) })
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: {
      billingEnabled: true,
      items: [
        { serviceKey: SERVICE_KEY.black_white, unitCents: UNIT_CENTS.black_white, unit: 'page', description: '黑白打印' },
        { serviceKey: SERVICE_KEY.color, unitCents: UNIT_CENTS.color, unit: 'page', description: '彩色打印' },
      ],
    },
  })
}

const yuan = (cents: number): string => `¥${(cents / 100).toFixed(2)}`

async function expectConfirmAmount(page: Page, cents: number): Promise<void> {
  const amount = (cents / 100).toFixed(2)
  await expect(amountCard(page)).toHaveText(amount)
  await expect(amountCard(page).locator('..')).toHaveText(`应付 ${amount} 元`)
}

const BW_LINE = 'print_bw_page'
const SA_TASK_ID = 'sa-price-task-001'


function quoteJson(unitCents: number, pages: number): unknown {
  return {
    amountCents: unitCents * pages,
    billablePages: pages,
    billingPageSource: 'detected',
    priceLines: [{ serviceKey: BW_LINE, unitCents, quantity: pages, subtotalCents: unitCents * pages }],
  }
}

/** /orders/quote 桩：reply 可以返回 Promise，用来把某一次报价压住不回。 */
async function routeQuote(
  page: Page,
  reply: (fileUrl: string, n: number) => Promise<{ unitCents: number; pages: number } | 'fail'> | { unitCents: number; pages: number } | 'fail',
): Promise<string[]> {
  const seen: string[] = []
  await page.route('**/api/v1/orders/quote', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    const fileUrl = (route.request().postDataJSON() as { fileUrl?: string }).fileUrl ?? ''
    seen.push(fileUrl)
    const result = await reply(fileUrl, seen.length)
    await route.fulfill(result === 'fail'
      ? { status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: '报价服务暂不可用' } }) }
      : { status: 200, contentType: 'application/json', body: JSON.stringify(quoteJson(result.unitCents, result.pages)) })
  })
  return seen
}

type JobReply = { status: 409 | 201; unitCents: number; pages?: number; delayMs?: number }

/** POST /print/jobs 桩：按顺序给出 409 PRICE_CHANGED（服务端同款 details 串）或建单成功；记录每次请求体。 */
async function routeJobs(
  page: Page,
  replies: JobReply[],
  onConflict?: () => void,
): Promise<Array<Record<string, unknown>>> {
  const bodies: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/print/jobs', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    const reply = replies[Math.min(bodies.length, replies.length) - 1]!
    if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs))
    const pages = reply.pages ?? W2_FILE.pages
    const amountCents = reply.unitCents * pages
    if (reply.status === 409) onConflict?.()
    await route.fulfill(reply.status === 409
      ? {
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: {
              code: 'PRICE_CHANGED',
              message: `价格已更新，当前应付 ${(amountCents / 100).toFixed(2)} 元。本次未建单、未扣款，请核对新价格后再确认。`,
              details: [`currentAmountCents=${amountCents}`, `billablePages=${pages}`, `line=${BW_LINE}:${reply.unitCents}:${pages}:${amountCents}`],
            },
          }),
        }
      : {
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            taskId: W2_ORDER.taskId, status: 'pending', createdAt: NOW, orderId: W2_ORDER.orderId, orderNo: W2_ORDER.orderNo,
            amountCents, payStatus: 'unpaid', billablePages: pages, billingPageSource: 'detected',
            priceLines: [{ serviceKey: BW_LINE, unitCents: reply.unitCents, quantity: pages, subtotalCents: amountCents }],
            paymentSessionToken: W2_ORDER.paymentSessionToken, hasEndUser: false,
          }),
        })
  })
  return bodies
}

/**
 * 公示价在本机配置上：开页读到旧价，409 发出之后的下一次配置读取才是新价。
 * 旧价目接口仍登记，避免没人接的请求；页面不再用它决定屏上价格。
 * failNext 时，409 之后的配置读取失败，用来守「重读失败只说没取到」。
 */
function registerPriceConfig(api: ApiRouter, units: number[], failNext = false): { markChanged: () => void } {
  let changed = false
  const color = units.every((unit) => unit === 0) ? 0 : UNIT_CENTS.color
  api.respondWith('GET', KIOSK_CONFIG_PATH, () => {
    if (changed && failNext) return { status: 503, json: {} }
    const bw = changed ? units[units.length - 1]! : units[0]!
    return {
      status: 200,
      json: withMachinePricing(terminalConfigWithHosting(RECRUITMENT_HOSTING_ON, 'price-truth'), bw, color),
    }
  })
  api.respondWith('GET', '/api/v1/print/price-config', (n) => ({
    status: 200,
    json: {
      billingEnabled: true,
      items: [{ serviceKey: BW_LINE, unitCents: units[Math.min(n, units.length) - 1]!, unit: 'page', description: '黑白打印' }],
    },
  }))
  return { markChanged: () => { changed = true } }
}

async function openConfirm(page: Page, selfAssessment = false): Promise<void> {
  await page.goto('/print/confirm')
  if (selfAssessment) {
    await page.evaluate((taskId) => {
      window.sessionStorage.setItem('self_assessment_session_v1', JSON.stringify({ taskId, accessToken: 'sa-access-fixture' }))
    }, SA_TASK_ID)
  }
  await writePrintHandoff(page, { printParams: W2_PRINT_PARAMS, materialCheck: null })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-w2-page="print-confirm"]')).toBeVisible()
}

const amountCard = (page: Page) => page.getByTestId('print-confirm-amount')
const originalConfirm = (page: Page) => page.getByRole('button', { name: /^(去付款|确认并打印)$/ })
const reconfirm = (page: Page, cents: number, merged = false) =>
  page.getByRole('button', { name: `按新金额 ${yuan(cents)} 确认${merged ? '（合并版）' : ''}` })

const MEMBER_TOKEN = 'confirm-member-token'

/** 会员短信登录，以及登录后外壳、确认页会读的会员接口。 */
function registerMemberLogin(api: ApiRouter): void {
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 200,
    json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } },
  })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: { success: true, data: { token: MEMBER_TOKEN, user: { id: 'member-confirm', phoneMasked: '138****8000', nickname: '确认页会员' } } },
  })
  api.respond('POST', '/api/v1/member/auth/logout', { status: 200, json: { success: true, data: { loggedOut: true } } })
  api.respond('GET', '/api/v1/me/pending-tasks', { status: 200, json: { success: true, data: [] } })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/me/benefits', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
}

/** 用屏幕键盘走可见的手机号 + 验证码登录，再等回跳。不整页刷新，内存里的令牌还在。 */
async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => `${url.pathname}${url.search}` === returnTo)
}

// 价格连改两次：第一次 409 把屏上换成中间价，公示价也已经变成更新的单价。
// 这两句不能同时在：409 让用户按新金额再确认，权益卡却说不要按本屏金额付款。
test('two price changes do not show confirm-new-amount and do-not-pay together @kiosk', async ({ page, api }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const pages = W2_FILE.pages
  const first = 20 * pages
  const mid = 30 * pages
  const latest = 40 * pages
  registerShell(api, [])
  // 开页公示价 20；409 发出后公示价变成 40（第二次改价），与 409 带回的 30 不是同一个数。
  const prices = registerPriceConfig(api, [20, 40])
  await routeQuote(page, () => ({ unitCents: 20, pages }))
  const jobs = await routeJobs(
    page,
    [{ status: 409, unitCents: 30 }, { status: 409, unitCents: 40 }],
    prices.markChanged,
  )

  await openConfirm(page)
  await expectConfirmAmount(page, first)
  await expect(originalConfirm(page)).toBeEnabled()
  await originalConfirm(page).click()

  await expect(page.getByRole('alert')).toContainText(`你确认的是 ${yuan(first)}，现在应付 ${yuan(mid)}`)
  await expect(page.getByRole('alert')).toContainText('请核对新金额后再点确认')
  await expect(reconfirm(page, mid)).toBeEnabled()
  await expect(page.getByText('按新金额')).toHaveCount(1)
  await expect(page.getByText('不要按本屏金额付款')).toHaveCount(0)
  await expect(page.getByText('本屏报价已不是现价')).toHaveCount(0)
  await expect(page.getByText('请返回上一步重新核价')).toHaveCount(0)
  expect(jobs).toHaveLength(1)
  expect(jobs[0]?.['quotedAmountCents']).toBe(first)

  await reconfirm(page, mid).click()
  await expect(page.getByRole('alert')).toContainText(`你确认的是 ${yuan(mid)}，现在应付 ${yuan(latest)}`)
  await expect(page.getByRole('alert')).toContainText('请核对新金额后再点确认')
  await expect(reconfirm(page, latest)).toBeEnabled()
  await expect(page.getByText('不要按本屏金额付款')).toHaveCount(0)
  await expect(page.getByText('本屏报价已不是现价')).toHaveCount(0)
  expect(jobs).toHaveLength(2)
  expect(jobs[1]?.['quotedAmountCents']).toBe(mid)
  await expect(page).toHaveURL(/\/print\/confirm/)
  expect(pageErrors).toEqual([])
})

// 第二次 409：公示价已经是 50 分/页，屏上现价是 409 带回的 40 分/页。
// 上面那条第二次两边都是 40，拆掉「信任屏上现价」也不会红。这里必须仍只留核对句。
test('second price change trusts the on-screen unit when the public unit differs @kiosk', async ({ page, api }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const pages = W2_FILE.pages
  const first = 20 * pages
  const mid = 30 * pages
  const latest = 40 * pages
  registerShell(api, [])
  const prices = registerPriceConfig(api, [20, 50])
  await routeQuote(page, () => ({ unitCents: 20, pages }))
  const jobs = await routeJobs(
    page,
    [{ status: 409, unitCents: 30 }, { status: 409, unitCents: 40 }],
    prices.markChanged,
  )

  await openConfirm(page)
  await expectConfirmAmount(page, first)
  await originalConfirm(page).click()
  await expect(reconfirm(page, mid)).toBeEnabled()
  await reconfirm(page, mid).click()

  await expect(page.getByRole('alert')).toContainText(`你确认的是 ${yuan(mid)}，现在应付 ${yuan(latest)}`)
  await expect(page.getByRole('alert')).toContainText('请核对新金额后再点确认')
  await expect(reconfirm(page, latest)).toBeEnabled()
  await expect(page.getByText('不要按本屏金额付款')).toHaveCount(0)
  await expect(page.getByText('本屏报价已不是现价')).toHaveCount(0)
  expect(jobs).toHaveLength(2)
  expect(jobs[1]?.['quotedAmountCents']).toBe(mid)
  await expect(page).toHaveURL(/\/print\/confirm/)
  expect(pageErrors).toEqual([])
})

function readyMachinePrice() {
  return {
    status: 200,
    json: withMachinePricing(terminalConfigWithHosting(RECRUITMENT_HOSTING_ON, 'price-truth'), 20, UNIT_CENTS.color),
  }
}

// 开页第一次读公示价失败（没有 409）：报价接口已经带回金额，也不能拿它顶上。
// 确认（去付款）不可点；出路是页面原有的「重新报价」，读回来之后金额和确认才出现。
for (const failure of ['http-500', 'timedout'] as const) {
  test(`first price read ${failure} hides the server quote until a reread succeeds @kiosk`, async ({ page, api }) => {
    registerShell(api, [])
    let reads = 0
    api.respondWith('GET', KIOSK_CONFIG_PATH, () => {
      reads += 1
      if (reads === 1) {
        return failure === 'timedout'
          ? { abort: 'timedout' as const }
          : { status: 500, json: { success: false, error: { code: 'INTERNAL', message: '当前应付 0.40 元' } } }
      }
      return readyMachinePrice()
    })
    await routeQuote(page, () => ({ unitCents: 20, pages: W2_FILE.pages }))
    const jobs = await routeJobs(page, [{ status: 201, unitCents: 20 }])

    await openConfirm(page)
    await expect(page.getByText('本机没能取到现行价目', { exact: true }).first()).toBeVisible()
    await expect(page.getByTestId('print-confirm-state-quoted')).toBeVisible()
    const failedText = await page.locator('[data-w2-page="print-confirm"]').innerText()
    expect(failedText, failedText).not.toMatch(/[¥￥]\s*\d|\d+\.\d{2}\s*元|免费试运营|\/页/)
    await expect(page.getByTestId('print-confirm-amount')).toHaveCount(0)
    await expect(page.locator('[data-benefit-state="repriced"]')).toHaveCount(0)
    await expect(page.locator('[data-free-pricing="true"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(去付款|确认并打印)$/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /按新金额/ })).toHaveCount(0)
    const retry = page.getByRole('button', { name: '重新报价' })
    await expect(retry).toBeEnabled()
    await retry.click()
    await expectConfirmAmount(page, 20 * W2_FILE.pages)
    await expect(originalConfirm(page)).toBeEnabled()
    expect(jobs).toHaveLength(0)
    expect(reads).toBeGreaterThanOrEqual(2)
  })
}

// 已登录、权益接口失败、公示价也失败、报价已就绪且不是 0：金额藏起来之后，
// 不能再点「按实际原价继续」建单。出路是就地「重新报价」，读回来才恢复原按钮。
test('signed-in benefit failure hides the amount and blocks ordering until the price reread @kiosk', async ({ page, api }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  registerShell(api, [])
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/benefits', {
    status: 500,
    json: { success: false, error: { code: 'INTERNAL', message: '当前应付 0.40 元' } },
  })
  let releasePrice = false
  api.respondWith('GET', KIOSK_CONFIG_PATH, () => (
    releasePrice
      ? readyMachinePrice()
      : { status: 500, json: { success: false, error: { code: 'INTERNAL', message: '当前应付 0.40 元' } } }
  ))
  await routeQuote(page, () => ({ unitCents: 20, pages: W2_FILE.pages }))
  const jobs = await routeJobs(page, [{ status: 201, unitCents: 20 }])

  await page.goto('/print/confirm')
  await writePrintHandoff(page, { printParams: W2_PRINT_PARAMS, materialCheck: null })
  await loginThroughVisibleUi(page, '/print/confirm')

  await expect(page.getByTestId('print-confirm-state-benefit-unverified')).toBeVisible()
  await expect(page.getByText('本机没能取到现行价目', { exact: true }).first()).toBeVisible()
  const failedText = await page.locator('[data-w2-page="print-confirm"]').innerText()
  expect(failedText, failedText).not.toMatch(/[¥￥]\s*\d|\d+\.\d{2}\s*元|免费试运营|\/页/)
  await expect(page.getByTestId('print-confirm-amount')).toHaveCount(0)
  const orderButton = page.getByRole('button', { name: /按实际原价继续|去付款|确认并打印|按新金额|确认打印|打印合并版|按以上设置打印/ })
  const orderCount = await orderButton.count()
  for (let index = 0; index < orderCount; index += 1) {
    await expect(orderButton.nth(index)).toBeDisabled()
    await orderButton.nth(index).evaluate((button) => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
  }
  expect(jobs).toHaveLength(0)
  const retry = page.getByRole('button', { name: '重新报价', exact: true })
  await expect(retry).toBeEnabled()
  releasePrice = true
  await retry.click()
  await expectConfirmAmount(page, 20 * W2_FILE.pages)
  await expect(page.getByRole('button', { name: '按实际原价继续', exact: true })).toBeEnabled()
  expect(jobs).toHaveLength(0)
  await expect(page).toHaveURL(/\/print\/confirm/)
  expect(pageErrors).toEqual([])
})

// 报价已经是 0、公示价却没读到：提醒条和须知必须同一句，而且不说免费也不说付费。
test('zero quote with a failed price read uses one neutral stay line @kiosk', async ({ page, api }) => {
  registerShell(api, [])
  api.respondWith('GET', KIOSK_CONFIG_PATH, () => ({
    status: 500,
    json: { success: false, error: { code: 'INTERNAL', message: '免费试运营，付费任务完成支付后开始' } },
  }))
  await routeQuote(page, () => ({ unitCents: 0, pages: W2_FILE.pages }))
  await openConfirm(page)
  await expect(page.getByRole('button', { name: '重新报价', exact: true })).toBeVisible()
  await page.locator('.pcf-notes > summary').click()
  const remind = page.locator('.qxt-remind span')
  const note = page.locator('.pcf-notes li').filter({ hasText: /留在机器旁|没能取到现行价目/ })
  await expect(remind).toHaveText('本机没能取到现行价目')
  await expect(note).toHaveText('本机没能取到现行价目')
  await expect(remind).not.toContainText('免费')
  await expect(remind).not.toContainText('付费')
  await expect(note).not.toContainText('免费')
  await expect(note).not.toContainText('付费')
})
for (const failure of ['http-500', 'timedout'] as const) {
  test(`first quote ${failure} shows no amount and retries in place @kiosk`, async ({ page, api }) => {
    registerShell(api, [])
    registerPriceConfig(api, [20])
    let attempts = 0
    await page.route('**/api/v1/orders/quote', async (route: Route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback()
        return
      }
      attempts += 1
      if (attempts === 1) {
        if (failure === 'timedout') {
          await route.abort('timedout')
          return
        }
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'INTERNAL', message: '当前应付 0.40 元' } }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(quoteJson(20, W2_FILE.pages)),
      })
    })
    const jobs = await routeJobs(page, [{ status: 201, unitCents: 20 }])

    await openConfirm(page)
    await expect(page.getByTestId('print-confirm-state-quote-failed')).toBeVisible()
    await expect(page.getByText('这一次没有拿到报价')).toBeVisible()
    await expect(page.getByText('确认前不显示金额')).toBeVisible()
    const failedText = await page.locator('[data-w2-page="print-confirm"]').innerText()
    expect(failedText, failedText).not.toMatch(/[¥￥]\s*\d|\d+\.\d{2}\s*元|免费试运营|\/页/)
    await expect(page.getByTestId('print-confirm-amount')).toHaveCount(0)
    await expect(page.locator('[data-free-pricing="true"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(去付款|确认并打印)$/ })).toHaveCount(0)
    const retry = page.getByRole('button', { name: '重新报价' })
    await expect(retry).toBeEnabled()
    await retry.click()
    await expectConfirmAmount(page, 20 * W2_FILE.pages)
    await expect(originalConfirm(page)).toBeEnabled()
    expect(jobs).toHaveLength(0)
    expect(attempts).toBe(2)
  })
}

