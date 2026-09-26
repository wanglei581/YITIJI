// ============================================================
// print-confirm-price-truth — 确认页「展示的参数」必须等于「计价的参数」
//
// 起因（2026-08-18）：PrintConfirmPage 的参数摘要卡里，色彩模式那一行写死成 '黑白'，
// 而同页报价（unitCentsFor(config, params.colorMode)）和建单都读真实 params.colorMode。
// TerminalCapability 表里 color_print 长期零记录 → 彩色前端禁用 → 撞不到。
// 一旦管理员把某台终端的 color_print 标成 available，用户选彩色后就会
// 看到「色彩模式 黑白」、按 print_color_page 单价扣款、拿到彩色纸 ——
// 看到的和付的钱不一致且多付（资损 + 客诉），并直接违反 CLAUDE.md §9「不伪造能力」。
//
// 门禁形态（刻意不是「源码里必须出现某段字符串」）：
//   - 用真实组件在真实浏览器里渲染确认页；
//   - /orders/quote 的桩**按请求体里真实收到的 params.colorMode 计价**，
//     所以「页面用哪个色彩模式计价」是被观测出来的，不是被假设的；
//   - 断言：摘要卡展示的色彩模式 === 计价所用色彩模式对应的中文名，
//     且计费方式行显示的单价 === 价目表里该色彩模式的单价。
// 锁字面量的门禁一旦被重构就会被顺手改掉；这里锁的是两者「同源」这个行为。
//
// 第二条真相（2026-09-23）：用户确认的金额 === 建单时服务端重算的金额。
//   - 建单请求带 quotedAmountCents = 屏上确认的那一笔；
//   - 服务端 409 PRICE_CHANGED 时屏上换成服务端现价，**不自动重试建单**，等用户再点一次；
//   - 连点只建一次单；报价没回来不能建单；合并版先按最终文件报价、且只生成一次。
// ============================================================

import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'
import { W2_FILE, W2_ORDER, W2_PRINT_PARAMS, setReactRouterState } from './fixtures/fusion-w2-state'

const NOW = '2026-08-18T00:00:00.000Z'

/** 价目表：黑白 20 分/页、彩色 50 分/页（与生产 seed 的服务键一致）。 */
const UNIT_CENTS = { black_white: 20, color: 50 } as const
const SERVICE_KEY = { black_white: 'print_bw_page', color: 'print_color_page' } as const
/** 用户可见的色彩模式中文名 —— 本文件对「页面该说什么」的独立预期。 */
const COLOR_MODE_TEXT = { black_white: '黑白', color: '彩色' } as const

type ColorMode = keyof typeof UNIT_CENTS

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

/**
 * /orders/quote 的桩：**按请求体里真实收到的 colorMode 计价**，并把它记录下来。
 * 这样「页面按哪个色彩模式计价」是从线上观测到的事实，测试无需假设。
 */
async function routePricingQuote(page: Page, billablePages: number, seen: { colorMode?: string }): Promise<void> {
  await page.route('**/api/v1/orders/quote', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    const body = route.request().postDataJSON() as { params?: { colorMode?: string } }
    const colorMode = (body.params?.colorMode ?? 'black_white') as ColorMode
    seen.colorMode = colorMode
    const unitCents = UNIT_CENTS[colorMode] ?? UNIT_CENTS.black_white
    const amountCents = unitCents * billablePages
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        amountCents,
        billablePages,
        billingPageSource: 'detected',
        priceLines: [
          {
            serviceKey: SERVICE_KEY[colorMode] ?? SERVICE_KEY.black_white,
            description: colorMode === 'color' ? '彩色打印' : '黑白打印',
            unitCents,
            quantity: billablePages,
            amountCents,
          },
        ],
      }),
    })
  })
}

const yuan = (cents: number): string => `¥${(cents / 100).toFixed(2)}`

// 摘要卡的每一行都带 data-sum-row=<行名>，不依赖类名或 DOM 层级。
const summaryValue = (page: Page, label: string) => page.locator(`[data-sum-row="${label}"] .v`)

test('print confirm shows the same color mode it prices (color) @kiosk', async ({ page, api }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  registerShell(api, ['color_print'])
  const seen: { colorMode?: string } = {}
  await routePricingQuote(page, W2_FILE.pages, seen)

  await page.goto('/print/confirm')
  await setReactRouterState(page, '/print/confirm', {
    file: W2_FILE,
    params: { ...W2_PRINT_PARAMS, colorMode: 'color' },
    source: 'document',
  })

  await expect(page.locator('[data-w2-page="print-confirm"]')).toBeVisible()
  await expect(page.locator('[data-cost-calc]')).toHaveText(
    `${yuan(UNIT_CENTS.color)}/页 × ${W2_FILE.pages} 页`,
  )

  const pricedColorMode = seen.colorMode as ColorMode
  expect(pricedColorMode).toBe('color')
  await expect(summaryValue(page, '色彩模式')).toHaveText(COLOR_MODE_TEXT.color)
  await expect(summaryValue(page, '色彩模式')).not.toContainText(COLOR_MODE_TEXT.black_white)
  await expect(summaryValue(page, '打印份数')).toHaveText(`${W2_PRINT_PARAMS.copies} 份`)
  await expect(summaryValue(page, '单双面')).toHaveText('单面')
  expect(pageErrors).toEqual([])
})

test('print confirm blocks unverified color instead of quoting it @kiosk', async ({ page, api }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  registerShell(api, [])
  const seen: { colorMode?: string } = {}
  await routePricingQuote(page, W2_FILE.pages, seen)

  await page.goto('/print/confirm')
  await setReactRouterState(page, '/print/confirm', {
    file: W2_FILE,
    params: { ...W2_PRINT_PARAMS, colorMode: 'color' },
    source: 'document',
  })

  await expect(page.locator('[data-testid="print-confirm-state-capability-invalid-params"]')).toBeVisible()
  await expect(summaryValue(page, '色彩模式')).toContainText('彩色')
  await expect(summaryValue(page, '色彩模式')).toContainText('暂不可用')
  await expect(page.getByText('金额暂不可用')).toBeVisible()
  expect(seen.colorMode).toBeUndefined()
  expect(pageErrors).toEqual([])
})

// ── 动态价格二次确认 ─────────────────────────────────────────────────────────

const BW_LINE = 'print_bw_page'
const SA_TASK_ID = 'sa-price-task-001'
const MERGED_URL = '/api/v1/files/sa-merged-001/content?expires=4102444800000&sig=merged'

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
async function routeJobs(page: Page, replies: JobReply[]): Promise<Array<Record<string, unknown>>> {
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

/** 公示价按调用次序给：开页读到旧价，409 之后重读到新价（后台真实改价时就是这样）。 */
function registerPriceConfig(api: ApiRouter, units: number[]): void {
  api.respondWith('GET', '/api/v1/print/price-config', (n) => ({
    status: 200,
    json: {
      billingEnabled: true,
      items: [{ serviceKey: BW_LINE, unitCents: units[Math.min(n, units.length) - 1]!, unit: 'page', description: '黑白打印' }],
    },
  }))
}

/** 付费单建成后会进收银页；只挂收银页挂载时读的两条接口。 */
function registerCashier(api: ApiRouter, amountCents: number): void {
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, {
    status: 200,
    json: {
      orderId: W2_ORDER.orderId, orderNo: W2_ORDER.orderNo, payStatus: 'unpaid', paymentSource: null,
      payChannel: null, amountCents, paidAt: null, pickupCode: null, attempt: null,
    },
  })
}

async function openConfirm(page: Page, selfAssessment = false): Promise<void> {
  await page.goto('/print/confirm')
  if (selfAssessment) {
    await page.evaluate((taskId) => {
      window.sessionStorage.setItem('self_assessment_session_v1', JSON.stringify({ taskId, accessToken: 'sa-access-fixture' }))
    }, SA_TASK_ID)
  }
  await setReactRouterState(page, '/print/confirm', { file: W2_FILE, params: W2_PRINT_PARAMS, source: 'document' })
  await expect(page.locator('[data-w2-page="print-confirm"]')).toBeVisible()
}

const amountCard = (page: Page) => page.getByTestId('print-confirm-amount')
const originalConfirm = (page: Page) => page.getByRole('button', { name: /按以上设置打印原文件/ })
const reconfirm = (page: Page, cents: number, merged = false) =>
  page.getByRole('button', { name: `按新金额 ${yuan(cents)} 确认${merged ? '（合并版）' : ''}` })

for (const scenario of [
  { name: '0 to paid', fromUnit: 0, toUnit: 30 },
  { name: 'price increase', fromUnit: 20, toUnit: 30 },
  { name: 'price decrease', fromUnit: 50, toUnit: 20 },
] as const) {
  test(`price change (${scenario.name}) shows the server quote and needs a second explicit confirm @kiosk`, async ({ page, api }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const from = scenario.fromUnit * W2_FILE.pages
    const to = scenario.toUnit * W2_FILE.pages
    registerShell(api, [])
    registerPriceConfig(api, [scenario.fromUnit, scenario.toUnit])
    registerCashier(api, to)
    const quotes = await routeQuote(page, () => ({ unitCents: scenario.fromUnit, pages: W2_FILE.pages }))
    const jobs = await routeJobs(page, [{ status: 409, unitCents: scenario.toUnit }, { status: 201, unitCents: scenario.toUnit }])

    await openConfirm(page)
    await expect(amountCard(page)).toHaveText(yuan(from))
    await originalConfirm(page).click()

    // 409 之后：屏上换成服务端现价，明确说没建单，按钮写明新金额；停在确认页。
    await expect(page.getByRole('alert')).toContainText(`你确认的是 ${yuan(from)}，现在应付 ${yuan(to)}`)
    await expect(page.getByRole('alert')).toContainText('本次没有建单，也没有扣款')
    await expect(amountCard(page)).toHaveText(yuan(to))
    await expect(page.locator('[data-cost-calc]')).toHaveText(`${yuan(scenario.toUnit)}/页 × ${W2_FILE.pages} 页`)
    await expect(page.getByTestId('print-confirm-state-quoted')).toBeVisible()
    await expect(reconfirm(page, to)).toBeEnabled()
    // 公示价随之重读：权益卡不得拿开页时的旧价对比新报价，误报「本屏报价已不是现价」。
    await expect.poll(() => api.requestCount('GET', '/api/v1/print/price-config')).toBeGreaterThanOrEqual(2)
    await expect(page.getByText('本屏报价已不是现价')).toHaveCount(0)
    // 不自动重试：等一会儿仍只有一次建单请求，也没有为 409 再去报价（现价取自 409 本身）。
    await page.waitForTimeout(800)
    expect(jobs).toHaveLength(1)
    expect(quotes).toHaveLength(1)
    expect(jobs[0]?.['quotedAmountCents']).toBe(from)
    await expect(page).toHaveURL(/\/print\/confirm/)

    await reconfirm(page, to).click()
    await page.waitForURL('**/print/cashier')
    expect(jobs).toHaveLength(2)
    expect(jobs[1]?.['quotedAmountCents']).toBe(to)
    expect(jobs[1]?.['fileUrl']).toBe(W2_FILE.fileUrl)
    expect(pageErrors).toEqual([])
  })
}

test('rapid repeated confirm sends exactly one create request @kiosk', async ({ page, api }) => {
  registerShell(api, [])
  registerCashier(api, 40)
  await routeQuote(page, () => ({ unitCents: 20, pages: W2_FILE.pages }))
  const jobs = await routeJobs(page, [{ status: 201, unitCents: 20, delayMs: 400 }])

  await openConfirm(page)
  await expect(originalConfirm(page)).toBeEnabled()
  // 同一任务里连点三次：React 在微任务里才重渲染，按钮还没变灰，只能靠同步在途锁挡住。
  await originalConfirm(page).evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
    button.click()
  })
  await page.waitForURL('**/print/cashier')
  expect(jobs).toHaveLength(1)
  expect(jobs[0]?.['quotedAmountCents']).toBe(40)
})

test('confirm cannot create an order while the quote is failed or still loading @kiosk', async ({ page, api }) => {
  registerShell(api, [])
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  await routeQuote(page, async (_url, n) => {
    if (n === 1) return 'fail'
    await held
    return { unitCents: 20, pages: W2_FILE.pages }
  })
  const jobs = await routeJobs(page, [{ status: 201, unitCents: 20 }])

  await openConfirm(page)
  await expect(page.getByTestId('print-confirm-state-quote-failed')).toBeVisible()
  await expect(originalConfirm(page)).toHaveCount(0)
  await page.getByRole('button', { name: '重新报价' }).click()
  await expect(page.getByTestId('print-confirm-state-quoting')).toBeVisible()
  const pending = page.getByRole('button', { name: '获取报价后可继续' })
  await expect(pending).toBeDisabled()
  await pending.evaluate((button: HTMLButtonElement) => button.click())
  expect(jobs).toHaveLength(0)
  release()
  await expect(originalConfirm(page)).toBeEnabled()
  await expect(amountCard(page)).toHaveText(yuan(40))
  expect(jobs).toHaveLength(0)
})

test('merged self-assessment file is quoted before submit, generated once, and ignores late quotes @kiosk', async ({ page, api }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  registerShell(api, [])
  registerCashier(api, 120)
  let appendCalls = 0
  await page.route(`**/api/v1/resume/self-assessment/${SA_TASK_ID}/append`, async (route: Route) => {
    appendCalls += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fileId: 'sa-merged-001', filename: 'w2-sample-self-assessment.pdf', sizeBytes: 4096, pageCount: 6,
        appendixPageCount: 4, signedUrl: '/w2-fixtures/sample-visible.pdf', expiresAt: '2099-01-01T00:00:00.000Z', printFileUrl: MERGED_URL,
      }),
    })
  })
  let releaseMerged: () => void = () => undefined
  const mergedHeld = new Promise<void>((resolve) => { releaseMerged = resolve })
  let mergedQuotes = 0
  const quotes = await routeQuote(page, async (fileUrl) => {
    if (fileUrl !== MERGED_URL) return { unitCents: 20, pages: W2_FILE.pages }
    mergedQuotes += 1
    // 第一次合并版报价压住不回，模拟「用户已经改回原文件之后才到的迟到响应」。
    if (mergedQuotes === 1) await mergedHeld
    return { unitCents: 20, pages: 6 }
  })
  const jobs = await routeJobs(page, [{ status: 201, unitCents: 20, pages: 6 }])

  await openConfirm(page, true)
  await expect(amountCard(page)).toHaveText(yuan(40))
  const mergeToggle = page.getByRole('checkbox', { name: /附加自我探索/ })
  await mergeToggle.check()
  await page.getByRole('button', { name: '打印合并版（简历+自我探索）' }).click()

  // 第一次点击只生成合并版并去报价，不建单；合并版报价未回之前不能提交。
  await expect.poll(() => appendCalls).toBe(1)
  await expect(page.getByTestId('print-confirm-state-quoting')).toBeVisible()
  expect(jobs).toHaveLength(0)

  // 改回原文件：原文件重新报价；随后放出的迟到合并版报价不得覆盖屏上价格。
  await mergeToggle.uncheck()
  await expect(amountCard(page)).toHaveText(yuan(40))
  releaseMerged()
  await expect.poll(() => quotes.filter((url) => url === MERGED_URL).length).toBe(1)
  await page.waitForTimeout(400)
  await expect(amountCard(page)).toHaveText(yuan(40))
  await expect(page.getByRole('alert')).toHaveCount(0)

  // 再勾上：复用已生成的合并版（不重复生成），按最终文件报价并要求再确认一次。
  await mergeToggle.check()
  await expect(amountCard(page)).toHaveText(yuan(120))
  await expect(page.getByRole('alert')).toContainText('已生成合并版')
  await reconfirm(page, 120, true).click()
  await page.waitForURL('**/print/cashier')
  expect(appendCalls).toBe(1)
  expect(jobs).toHaveLength(1)
  expect(jobs[0]?.['fileUrl']).toBe(MERGED_URL)
  expect(jobs[0]?.['quotedAmountCents']).toBe(120)
  expect(pageErrors).toEqual([])
})

for (const viewport of [
  { name: '1080x1920', width: 1080, height: 1920 },
  { name: '390x844', width: 390, height: 844 },
] as const) {
  test(`price-changed notice and reconfirm control fit the ${viewport.name} viewport @kiosk`, async ({ page, api }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    registerShell(api, [])
    registerPriceConfig(api, [20, 30])
    await routeQuote(page, () => ({ unitCents: 20, pages: W2_FILE.pages }))
    await routeJobs(page, [{ status: 409, unitCents: 30 }])

    await openConfirm(page)
    await expect(originalConfirm(page)).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath(`before-confirm-${viewport.name}.png`) })
    await originalConfirm(page).click()
    const button = reconfirm(page, 60)
    await expect(button).toBeEnabled()
    await assertNoHorizontalOverflow(page)

    const alert = page.getByRole('alert')
    await alert.scrollIntoViewIfNeeded()
    await expect(alert).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: testInfo.outputPath(`price-changed-alert-${viewport.name}.png`) })
    await button.scrollIntoViewIfNeeded()
    await expect(button).toBeInViewport({ ratio: 1 })
    const box = await button.boundingBox()
    expect(box, '再确认按钮必须可见可点').not.toBeNull()
    // 主按钮 ≥56 CSS px；全屏路由是 1080×1920 舞台等比缩放（fusion-w6 同款折算），屏上 px 要除回缩放比。
    const stage = page.locator('.kiosk-stage')
    const transform = await stage.count() ? await stage.evaluate((element) => getComputedStyle(element).transform) : 'none'
    const scale = transform === 'none' ? 1 : Number(transform.match(/^matrix\(([^,]+)/)?.[1] ?? 1)
    testInfo.annotations.push({ type: 'reconfirm-button', description: `${viewport.name} scale=${scale} box=${JSON.stringify(box)}` })
    expect(box!.height / scale).toBeGreaterThanOrEqual(56)
    await page.screenshot({ path: testInfo.outputPath(`price-changed-reconfirm-${viewport.name}.png`) })
  })
}
