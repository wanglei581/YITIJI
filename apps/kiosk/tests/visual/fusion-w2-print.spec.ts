import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'
import { FusionW2BinaryRoute } from './fixtures/fusion-w2-binary-route'
import { seedMaterialSession, setReactRouterState, W2_FILE, W2_ORDER, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'

const NOW = '2026-07-24T00:00:00.000Z'
const LATER = '2099-07-24T00:10:00.000Z'

function collectRuntimeErrors(page: Page, ignoredDocumentPath?: string): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (request.resourceType() === 'document' && new URL(request.url()).pathname === ignoredDocumentPath) return
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
    }
  })
  return errors
}

// 2026-08-18：打印预览 / 确认页新增依赖 GET /terminals/:id/capabilities —— 彩色与双面
// 改为按**本机**能力登记决定可用性（服务端 fail-closed 门禁的体验层镜像）。
// 这里给的是**未验证机器的生产默认态**：真实后端对一台没有任何 TerminalCapability 行的
// 终端就是这样回的（每个键都下发，但 configured=false）。Kiosk 只采信 configured=true 的行，
// 因此彩色/双面在默认夹具下保持禁用 —— 与放开之前的用户可见结果一致。
const UNVERIFIED_CAPABILITIES = [
  'document_print',
  'phone_upload',
  'cloud_upload',
  'usb_import',
  'material_pack',
  'scan',
  'copy',
  'id_photo',
  'format_convert',
  'signature_stamp',
  'color_print',
  'duplex_print',
].map((capabilityKey) => ({
  capabilityKey,
  status: 'not_verified',
  note: null,
  configured: false,
  updatedAt: null,
}))

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { terminalCode: 'KSK-001', capabilities: UNVERIFIED_CAPABILITIES },
  })
}

function registerPrice(api: ApiRouter): void {
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: {
      billingEnabled: true,
      items: [
        { serviceKey: 'print_bw_page', unitCents: 100, unit: 'page', description: '黑白打印' },
        { serviceKey: 'print_color_page', unitCents: 200, unit: 'page', description: '彩色打印' },
      ],
    },
  })
}

test('pickup scanner auto-submits once and Enter suffix is deduplicated @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let claimCount = 0
  let submittedCode = ''
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    claimCount += 1
    const body = route.request().postDataJSON() as { code?: string }
    submittedCode = body.code ?? ''
    // Keep the input mounted long enough to deliver the HID scanner's trailing
    // Enter. This makes the assertion exercise the submit lock instead of
    // passing only because the success screen replaced the input first.
    await new Promise(resolve => setTimeout(resolve, 150))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        released: false,
        orderId: 'w2-pickup-order',
        orderNo: 'ORD-W2-PICKUP',
        terminalId: 'KSK-001',
        amountCents: 100,
        priceLines: [],
        paymentSessionToken: 'w2-payment-session-token',
      }),
    })
  })

  await page.goto('/print/pickup-claim')
  const input = page.getByLabel('到机码输入框')
  await expect(page.locator('[data-w2-page="pickup-claim"]')).toBeVisible()
  await expect(page.getByText('等待扫码输入')).toBeVisible()
  await assertNoHorizontalOverflow(page)
  await input.pressSequentially('AB2C7M9P3K', { delay: 5 })
  await input.press('Enter')

  await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '进入现场支付' })).toBeVisible()
  expect(submittedCode).toBe('AB2C7M9P3K')
  expect(claimCount).toBe(1)
  expect(errors).toEqual([])
})

test('pickup controls remain readable in Windows landscape @pickup-landscape', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        released: false,
        orderId: 'w2-landscape-order',
        orderNo: 'ORD-W2-LANDSCAPE',
        terminalId: 'KSK-001',
        amountCents: 100,
        priceLines: [],
        paymentSessionToken: 'w2-landscape-payment-session-token',
      }),
    })
  })

  await page.goto('/print/pickup-claim')

  const input = page.getByLabel('到机码输入框')
  const submit = page.getByRole('button', { name: '确认取件' })
  const help = page.getByText('怎么找到机码？')
  await expect(input).toBeVisible()
  await expect(submit).toBeVisible()
  await expect(help).toBeVisible()
  await assertNoHorizontalOverflow(page)

  const [inputBox, submitBox] = await Promise.all([input.boundingBox(), submit.boundingBox()])
  expect(inputBox?.height ?? 0).toBeGreaterThanOrEqual(56)
  expect(submitBox?.height ?? 0).toBeGreaterThanOrEqual(56)
  const layout = await page.locator('.ui-kiosk-content').evaluate((node) => {
    const submitButton = node.querySelector<HTMLElement>('.pcp-submit')
    const contentRect = node.getBoundingClientRect()
    const submitRect = submitButton?.getBoundingClientRect()
    return {
      overflowY: node.scrollHeight - node.clientHeight,
      submitVisible: Boolean(submitRect && submitRect.top >= contentRect.top && submitRect.bottom <= contentRect.bottom),
    }
  })
  expect(layout.overflowY).toBeLessThanOrEqual(8)
  expect(layout.submitVisible).toBe(true)

  await input.fill('AB2C7M9P3K')
  const paymentButton = page.getByRole('button', { name: '进入现场支付' })
  await expect(paymentButton).toBeVisible()
  const successFits = await page.locator('.ui-kiosk-content').evaluate((node) => {
    const action = node.querySelector<HTMLElement>('.pcs-primary')
    const contentRect = node.getBoundingClientRect()
    const actionRect = action?.getBoundingClientRect()
    return Boolean(actionRect && actionRect.top >= contentRect.top && actionRect.bottom <= contentRect.bottom)
  })
  expect(successFits).toBe(true)
  expect(errors).toEqual([])
})

test('pickup manual fallback normalizes the displayed code before claiming @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let submittedCode = ''
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    submittedCode = (route.request().postDataJSON() as { code?: string }).code ?? ''
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        released: false,
        orderId: 'w2-manual-order',
        orderNo: 'ORD-W2-MANUAL',
        terminalId: 'KSK-001',
        amountCents: 100,
        priceLines: [],
        paymentSessionToken: 'w2-manual-payment-session-token',
      }),
    })
  })

  await page.goto('/print/pickup-claim')
  await page.getByLabel('到机码输入框').fill('ab-2c-7m-9p-3k')

  await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
  expect(submittedCode).toBe('AB2C7M9P3K')
  expect(errors).toEqual([])
})

// 2026-08-18：取件码改为 8 位纯数字，过渡期同时受理 10 位存量码。
// 这条守的是「两种长度共用一个输入框」引出的那个真实陷阱：存量码字符集含 2–9，
// 因此旧码前 8 位可能恰好全是数字（(8/31)^8 ≈ 1/50000）。若读满 8 位就提交，
// 这类已付费用户会被永久卡在「截断 → 认领失败 → 输入被清空」的循环里。
// 页面用 250ms 静默窗口区分两者：扫码器按键间隔约 5ms，10 位码 <100ms 读完，
// 永远不会命中 8 位分支。
test('pickup accepts 8-digit codes without truncating a legacy 10-char code @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  const submitted: string[] = []
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    submitted.push(JSON.parse(route.request().postData() ?? '{}').code)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        released: false,
        orderId: 'order-w2-digit',
        orderNo: 'ORD-W2-DIGIT',
        terminalId: 'KSK-001',
        taskStatus: 'awaiting_payment',
        printTaskStatus: 'awaiting_payment',
        amountCents: 100,
        priceLines: [],
        paymentSessionToken: 'w2-digit-payment-session-token',
      }),
    })
  })

  await page.goto('/print/pickup-claim')
  const input = page.getByLabel('到机码输入框')
  await expect(input).toBeVisible()
  // 纯数字码必须唤起数字键盘，而不是全键盘。
  await expect(input).toHaveAttribute('inputmode', 'numeric')

  // 前 8 位全为数字的存量码：逐字符输入，不得在第 8 位被提交。
  await input.pressSequentially('23456789', { delay: 5 })
  expect(submitted).toEqual([])
  await input.pressSequentially('AB', { delay: 5 })
  await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
  expect(submitted).toEqual(['23456789AB'])

  // 8 位新码：静默 250ms 后自动核销，无需按钮。
  await page.getByRole('button', { name: '再取一件' }).click()
  await input.pressSequentially('28491703', { delay: 5 })
  await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
  expect(submitted).toEqual(['23456789AB', '28491703'])
  expect(errors).toEqual([])
})

test('pickup invalid code is rejected, cleared, and ready for the next scan @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let claimCount = 0
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    claimCount += 1
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: { code: 'PICKUP_CODE_INVALID', message: '到机码无效或已过期' },
      }),
    })
  })

  await page.goto('/print/pickup-claim')
  const input = page.getByLabel('到机码输入框')
  await input.fill('AB2C7M9P3K')

  await expect(page.getByRole('alert')).toHaveText(/到机码无效或已过期/)
  await expect(input).toHaveValue('')
  await expect(input).toBeFocused()
  expect(claimCount).toBe(1)
  expect(errors).toEqual([])
})

/** 确认页 POST /orders/quote；金额与 W2_ORDER / 价目夹具对齐。 */
function registerQuote(api: ApiRouter, opts?: { amountCents?: number; billablePages?: number; unitCents?: number }): void {
  const billablePages = opts?.billablePages ?? 2
  const unitCents = opts?.unitCents ?? 100
  const amountCents = opts?.amountCents ?? billablePages * unitCents
  api.respond('POST', '/api/v1/orders/quote', {
    status: 200,
    json: {
      amountCents,
      billablePages,
      billingPageSource: 'detected',
      priceLines: [
        {
          serviceKey: 'print_bw_page',
          description: '黑白打印',
          unitCents,
          quantity: billablePages,
          amountCents,
        },
      ],
    },
  })
}

async function expectHealthy(page: Page, errors: string[], marker?: string): Promise<void> {
  await expect(page.locator('[data-kiosk-presentation="fusion-youth"]').first()).toBeVisible()
  if (marker) await expect(page.locator(`[data-w2-page="${marker}"]`)).toBeVisible()
  await assertNoHorizontalOverflow(page)
  expect(errors).toEqual([])
}

async function routeExactJson(
  page: Page,
  method: string,
  path: string,
  handler: (route: Route) => Promise<void>,
): Promise<void> {
  await page.route(`**${path}`, async (route) => {
    const request = route.request()
    if (request.method() !== method || new URL(request.url()).pathname !== path) {
      await route.fallback()
      return
    }
    await handler(route)
  })
}

function materialTask(kind: 'inspection' | 'normalize_a4' | 'pii_scan') {
  const checks = kind === 'inspection'
    ? { pageCount: 2, canPrint: true, messages: [] }
    : kind === 'normalize_a4'
      ? { targetPaperSize: 'A4', canNormalize: true, messages: [] }
      : undefined
  return {
    id: `w2-${kind}`,
    kind,
    status: 'completed',
    requesterMode: 'anonymous',
    accessToken: 'raw-w2-fixture-token',
    sourceFileId: W2_FILE.fileId,
    resultFileId: null,
    endUserId: null,
    params: {},
    result: checks ? { mode: 'real', checks } : { mode: 'real' },
    errorCode: null,
    errorMessage: null,
    expiresAt: LATER,
    createdAt: NOW,
    updatedAt: NOW,
    ...(kind === 'pii_scan' ? { piiFindings: [] } : {}),
  }
}

const cashierState = {
  file: W2_FILE,
  params: W2_PRINT_PARAMS,
  source: 'document',
  ...W2_ORDER,
  priceLines: [{
    serviceKey: 'print_bw_page', description: '黑白打印', unitCents: 100, quantity: 2, subtotalCents: 200,
  }],
}

function payStatus(payStatus: string, attempt: null | Record<string, unknown> = null, pickupCode: string | null = null) {
  return {
    orderId: W2_ORDER.orderId,
    orderNo: W2_ORDER.orderNo,
    payStatus,
    paymentSource: payStatus === 'paid' ? 'wechat' : null,
    payChannel: payStatus === 'paid' ? 'wechat' : null,
    amountCents: W2_ORDER.amountCents,
    paidAt: payStatus === 'paid' ? NOW : null,
    pickupCode,
    attempt,
  }
}

test('print intake keeps three upload sources and a separate scan CTA @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: {
      capabilities: [
        {
          capabilityKey: 'scan',
          status: 'available',
          note: null,
          configured: true,
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  })

  await page.goto('/print/upload?source=document')
  for (const label of ['选择文件 桌面验证', '扫码上传 手机/浏览器', 'U盘导入 本机未配置']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('button', { name: /扫描原件/ })).toBeVisible()
  await expectHealthy(page, errors, 'print-upload')

  await page.getByRole('button', { name: /扫描原件/ }).click()
  await page.waitForURL('**/scan/start')
  await expect(page.getByRole('heading', { name: '材料扫描' })).toBeVisible()
  await expectHealthy(page, errors)
})

test('material checks reach review without exposing anonymous access tokens @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  await routeExactJson(page, 'POST', '/api/v1/materials/tasks', async (route) => {
    const body = route.request().postDataJSON() as { kind?: string }
    if (!['inspection', 'normalize_a4', 'pii_scan'].includes(body.kind ?? '')) {
      await route.abort('blockedbyclient')
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: materialTask(body.kind as 'inspection' | 'normalize_a4' | 'pii_scan') }) })
  })

  await page.goto('/print/material-check')
  await setReactRouterState(page, '/print/material-check', { file: W2_FILE, source: 'document' })
  await expect(page.getByText('可以继续设置打印参数', { exact: true })).toBeVisible()
  await expect(page.getByText('raw-w2-fixture-token')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-material-check')
})

test('material check failure exposes its real retry action @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('POST', '/api/v1/materials/tasks', {
    status: 503,
    json: { success: false, error: { code: 'MATERIAL_UNAVAILABLE', message: '材料服务暂不可用' } },
  })

  await page.goto('/print/material-check')
  await setReactRouterState(page, '/print/material-check', { file: W2_FILE, source: 'document' })
  await expect(page.getByRole('heading', { name: '材料检查未完成' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试检查' })).toBeVisible()
  await expectHealthy(page, errors, 'print-material-check')
})

test('direct preview restores the material session and completes the PDF response @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page, W2_FILE.fileUrl)
  registerShell(api)
  registerPrice(api)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  await seedMaterialSession(page)

  await page.goto('/print/preview')
  await expect(page.getByTitle(`${W2_FILE.name} 预览`)).toBeVisible()
  await expect.poll(() => page.locator(`iframe[src="${W2_FILE.fileUrl}"]`).count()).toBe(1)
  binary.assertPdfCompleted()
  await expectHealthy(page, errors, 'print-preview')
})

// ── 彩色 / 双面按终端能力开放（2026-08-18）────────────────────────────────────
// 硬件（奔图 CM2800/CM2820）支持彩色与自动双面，但**驱动映射未在每台真机验证过**。
// 误放的代价是用户按彩色付费拿到黑白纸，所以放行必须按台、显式、可审计。
// 这两个用例锁住闸门的两端：未登记必须禁用且理由诚实；登记 available 后必须真的可选。

function capabilitiesWith(overrides: Record<string, string>): unknown {
  return {
    terminalCode: 'KSK-001',
    capabilities: UNVERIFIED_CAPABILITIES.map((row) =>
      overrides[row.capabilityKey]
        ? { ...row, status: overrides[row.capabilityKey], configured: true, updatedAt: NOW }
        : row,
    ),
  }
}

test('unverified terminal disables color and duplex with an honest reason @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api) // 默认即「未登记」态
  registerPrice(api)
  await seedMaterialSession(page)

  await page.goto('/print/preview')
  const preview = page.locator('[data-w2-page="print-preview"]')

  // 理由必须说「本机尚未通过真机验证」，不能说「不支持」—— 硬件确实支持，说不支持是谎报。
  await expect(preview.getByText(/本机彩色打印尚未通过真机验证/)).toBeVisible()
  await expect(preview.getByText(/本机自动双面尚未通过真机验证/)).toBeVisible()
  await expect(preview.getByText(/不支持/)).toHaveCount(0)

  // 禁用态必须是**可聚焦的 aria-disabled**，不是原生 disabled ——
  // 原生 disabled 的按钮拿不到焦点，读屏和键盘用户根本读不到 aria-describedby 里的原因。
  const colorBtn = preview.getByRole('button', { name: '彩色', exact: true })
  await expect(colorBtn).toHaveAttribute('aria-disabled', 'true')
  await expect(colorBtn).not.toHaveAttribute('disabled', /.*/)
  await expect(colorBtn).toHaveAttribute('aria-describedby', 'print-color-capability-note')
  // 真的能聚焦（这才是选 aria-disabled 而不是 disabled 的全部意义）
  await colorBtn.focus()
  await expect(colorBtn).toBeFocused()

  const duplexBtn = preview.getByRole('button', { name: '双面（长边）', exact: true })
  await expect(duplexBtn).toHaveAttribute('aria-disabled', 'true')
  await expect(duplexBtn).not.toHaveAttribute('disabled', /.*/)
  await duplexBtn.focus()
  await expect(duplexBtn).toBeFocused()

  // 点下去不得选中：仍停在黑白 / 单面。
  // force:true 绕过 Playwright 的 actionability —— 这里要证的正是「用户硬点也选不上」。
  await colorBtn.click({ force: true })
  await duplexBtn.click({ force: true })
  await expect(preview.getByRole('button', { name: '黑白', exact: true })).toHaveClass(/bg-primary-600/)
  await expect(preview.getByRole('button', { name: '单面', exact: true })).toHaveClass(/bg-primary-600/)

  await expectHealthy(page, errors, 'print-preview')
})

test('terminal verified for color and duplex can actually select them @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  // 管理员在该终端真机验过后显式配成 available —— 唯一的放行路径。
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: capabilitiesWith({ color_print: 'available', duplex_print: 'available' }),
  })
  await seedMaterialSession(page)

  await page.goto('/print/preview')
  const preview = page.locator('[data-w2-page="print-preview"]')

  const colorBtn = preview.getByRole('button', { name: '彩色', exact: true })
  await expect(colorBtn).not.toHaveAttribute('aria-disabled', 'true')
  await expect(preview.getByText(/尚未通过真机验证/)).toHaveCount(0)

  await colorBtn.click()
  await expect(colorBtn).toHaveClass(/bg-primary-600/)

  const duplexBtn = preview.getByRole('button', { name: '双面（长边）', exact: true })
  await duplexBtn.click()
  await expect(duplexBtn).toHaveClass(/bg-primary-600/)

  await expectHealthy(page, errors, 'print-preview')
})

// 2026-08-18：/print/params 下线为兼容重定向。该页每个可编辑控件都与 /print/preview 重复，
// 且全站零运行时导航指向它——用户只能手敲 URL 才到得了。原用例断言的「参数页本地估价」
// 已按预览页既定口径退场（实付金额由确认页 POST /orders/quote 出）。
test('retired params route redirects into preview with real printer fixtures @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  await seedMaterialSession(page)

  await page.goto('/print/params')
  await expect(page).toHaveURL(/\/print\/preview$/)
  const preview = page.locator('[data-w2-page="print-preview"]')
  await expect(preview.getByText('已配置打印机', { exact: true })).toBeVisible()
  await expect(preview.getByText('打印机在线', { exact: true })).toBeVisible()
  await expectHealthy(page, errors, 'print-preview')
})

test('paid print-job amount routes confirmation to cashier @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: W2_ORDER.amountCents, billablePages: 2, unitCents: 100 })
  api.respond('POST', '/api/v1/print/jobs', {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'pending',
      createdAt: NOW,
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      amountCents: W2_ORDER.amountCents,
      payStatus: 'unpaid',
      priceLines: cashierState.priceLines,
      billablePages: 2,
      billingPageSource: 'detected',
      paymentSessionToken: W2_ORDER.paymentSessionToken,
    },
  })
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })
  await seedMaterialSession(page)

  await page.goto('/print/confirm')
  await expect(page.getByText('¥1.00/页 × 2 页', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /按以上设置打印原文件/ }).click()
  await page.waitForURL('**/print/cashier')
  await expect(page.getByText('¥2.00', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(W2_ORDER.paymentSessionToken)).toHaveCount(0)
  await expectHealthy(page, errors, 'print-cashier')
})

test('cashier renders a pending QR without exposing its session token @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })
  api.respond('POST', `/api/v1/orders/${W2_ORDER.orderId}/pay`, {
    status: 200,
    json: {
      attemptId: 'w2-attempt-pending', orderId: W2_ORDER.orderId, orderNo: W2_ORDER.orderNo,
      channel: 'wechat', amountCents: 200, status: 'pending', qrCodeContent: 'weixin://w2-synthetic-qr',
      expiresAt: LATER, orderPayStatus: 'paying', orderExpiresAt: LATER,
    },
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', cashierState)
  await page.getByRole('button', { name: '屏上收款码' }).click()
  await expect(page.getByText('请扫码支付', { exact: true })).toBeVisible()
  await expect(page.locator('svg').filter({ has: page.locator('path') })).not.toHaveCount(0)
  await expect(page.getByText(W2_ORDER.paymentSessionToken)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '等待支付…' })).toBeDisabled()
  await expectHealthy(page, errors, 'print-cashier')
})

for (const scenario of [
  // unpaid + attempt.failed → canReissue：主按钮是「重新支付」，不得出现可点的「开始打印」。
  { name: 'failed attempt', status: 'unpaid', attempt: { attemptId: 'w2-failed', channel: 'wechat', status: 'failed', qrCodeContent: null, expiresAt: null }, copy: '付款码支付未完成', primary: 'reissue' as const },
  // 订单终态 closed/refunded → canReissue=false：主按钮保持禁用的「等待支付…」。
  { name: 'closed order', status: 'closed', attempt: { attemptId: 'w2-closed', channel: 'wechat', status: 'expired', qrCodeContent: null, expiresAt: null }, copy: '订单已超时关闭', primary: 'waiting' as const },
  { name: 'refunded order', status: 'refunded', attempt: { attemptId: 'w2-refunded', channel: 'wechat', status: 'success', qrCodeContent: null, expiresAt: null }, copy: '订单已退款', primary: 'waiting' as const },
] as const) {
  test(`cashier keeps ${scenario.name} out of print fulfillment @w2`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)
    api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
    api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, {
      status: 200,
      json: payStatus(scenario.status, scenario.attempt),
    })

    await page.goto('/print/cashier')
    await setReactRouterState(page, '/print/cashier', cashierState)
    await expect(page.getByText(scenario.copy, { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/print\/cashier$/)
    await expect(page.getByRole('button', { name: '开始打印' })).toHaveCount(0)
    if (scenario.primary === 'reissue') {
      await expect(page.getByRole('button', { name: '重新支付' }).first()).toBeVisible()
    } else {
      await expect(page.getByRole('button', { name: '等待支付…' })).toBeDisabled()
    }
    await expectHealthy(page, errors, 'print-cashier')
  })
}

test('only a paid cashier response enters print progress @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('paid') })
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: { taskId: W2_ORDER.taskId, status: 'pending' },
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', cashierState)
  await page.waitForURL('**/print/progress')
  await expectHealthy(page, errors, 'print-progress')
})

test('print polling reaches done and pickup code comes from the paid response @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let polls = 0
  await routeExactJson(page, 'GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, async (route) => {
    const status = ['pending', 'printing', 'completed'][Math.min(polls, 2)]
    polls += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ taskId: W2_ORDER.taskId, status }) })
  })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, {
    status: 200,
    json: payStatus('paid', null, 'W2-PICKUP-7391'),
  })

  await page.goto('/print/progress')
  await setReactRouterState(page, '/print/progress', cashierState)
  await page.waitForURL('**/print/done', { timeout: 10_000 })
  await expect(page.getByText('W2-PICKUP-7391', { exact: true })).toBeVisible()
  await expectHealthy(page, errors, 'print-done')
})

test('failed print status displays only the safe user reason and no pickup code @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'failed',
      errorMessage: 'agent stack and local path must stay hidden',
      failureReasonForUser: '打印机暂时离线，请联系现场工作人员',
    },
  })

  await page.goto('/print/progress')
  await setReactRouterState(page, '/print/progress', cashierState)
  await page.waitForURL('**/print/done')
  await expect(page.getByText('打印机暂时离线，请联系现场工作人员', { exact: true })).toBeVisible()
  await expect(page.getByText('agent stack and local path must stay hidden')).toHaveCount(0)
  await expect(page.getByText('取件凭证码')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-done')
})

// ============================================================
// S2 权益卡六态（V6 原型 P06 s4，06-print-workbench.html:914-919）
//
// 每一态都由**真实数据**判定，测试也只通过真实端点响应来触发：
//   guest             — 未登录（不发 /me/benefits）
//   price_unavailable — POST /orders/quote 失败
//   repriced          — /print/price-config 单价 ≠ 本单报价单价
//   not_applicable    — 报价应付 0 元（服务端对免费单拒绝核销）
//   available / none  — 登录后 GET /me/benefits 的真实内容
//   error             — GET /me/benefits 失败（诚实态：不许滑成「没有权益」）
//
// 反向验证：每条用例断言 data-benefit-state 的**精确取值**，并断言互斥态不出现。
// 判定错一态，属性值就不同，用例即失败。
// ============================================================

const W2_MEMBER_TOKEN = 'w2-benefit-memory-token'
const W2_MEMBER_PHONE = '13800138000'
const W2_MEMBER_CODE = '123456'

function registerMemberLogin(api: ApiRouter): void {
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 200,
    json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } },
  })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: {
      success: true,
      data: {
        token: W2_MEMBER_TOKEN,
        user: { id: 'member-w2-benefit', phoneMasked: '138****8000', nickname: '权益验收用户' },
      },
    },
  })
  api.respond('GET', '/api/v1/me/pending-tasks', { status: 200, json: { success: true, data: [] } })
  // 登录后外壳会预取收藏；与权益卡无关，但必须登记，否则 ApiRouter 判为未处理请求。
  api.respond('GET', '/api/v1/me/favorites', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
}

/**
 * 通过真实可见 UI 登录。
 *
 * 登录会触发 AuthContext.clearKioskSensitiveSession()（公共终端切换身份即清上一位用户的
 * 敏感材料，是产品既定行为），所以打印材料上下文必须在登录**之后**再送进来。
 */
async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of W2_MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of W2_MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

/**
 * 客户端软跳转（pushState + popstate），**不重载文档**。
 *
 * 必须不重载：Kiosk 会话是纯内存态，reload 即登出（setReactRouterState 会 reload，
 * 因此不能用在登录后的用例里）。这里只驱动 React Router 既有的 popstate 监听，
 * 不改动任何应用代码。
 */
async function softNavigate(page: Page, path: string, usr: unknown): Promise<void> {
  await page.evaluate(
    ({ nextPath, state }) => {
      window.history.pushState({ usr: state, key: 'w2-benefit-fixture', idx: 1 }, '', nextPath)
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    },
    { nextPath: path, state: usr },
  )
}

function benefitGrant(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'grant-001',
    benefitType: 'coupon',
    title: '打印体验券',
    description: null,
    quantityTotal: 3,
    quantityRemaining: 2,
    status: 'active',
    sourceType: 'platform',
    validFrom: null,
    validUntil: null,
    createdAt: NOW,
    ...overrides,
  }
}

function registerBenefits(api: ApiRouter, items: Record<string, unknown>[]): void {
  api.respond('GET', '/api/v1/me/benefits', {
    status: 200,
    json: { success: true, data: { items, nextCursor: null, total: items.length } },
  })
}

const CONFIRM_STATE = { file: W2_FILE, params: W2_PRINT_PARAMS, source: 'document' }

const benefitCard = (page: Page) => page.locator('[data-benefit-state]')

test('benefit card reports 未认领身份 for a guest and never fabricates a discount @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })
  await seedMaterialSession(page)

  await page.goto('/print/confirm')
  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'guest')
  await expect(page.getByRole('button', { name: '去登录查看我的权益' })).toBeVisible()
  // 反向：游客态不得出现核销 CTA，也不得出现任何抵扣结论。
  await expect(page.locator('[data-benefit-redeem]')).toHaveCount(0)
  await expect(page.getByText('已抵扣')).toHaveCount(0)
  await expect(page.getByText('¥2.00', { exact: true }).first()).toBeVisible()
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card survives the AI-down state and stays decoupled from 材料体检 @w2', async ({ page, api }) => {
  // V6 原型 06-print-workbench.html:895 —— 权益卡 data-when="default first ai-down"：
  // AI 材料体检不可用（ai-down）**不会**关掉权益卡；只有 device-off 才收起可选项。
  // 这里用「无 materialCheck 的确认页上下文」复现 ai-down：体检结论缺席，
  // 但价目、核价与权益仍必须照常工作（原型 :946「体检与预填中断 · 预览、参数、核价、出纸都不受影响」）。
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })

  await page.goto('/print/confirm')
  await setReactRouterState(page, '/print/confirm', CONFIRM_STATE)
  // 体检摘要缺席（ai-down），但权益卡与金额都在。
  await expect(page.getByText('隐私检查摘要')).toHaveCount(0)
  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'guest')
  await expect(page.getByText('¥2.00', { exact: true }).first()).toBeVisible()
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card reports 价目拉不到 when the quote fails and shows no amount @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  api.respond('POST', '/api/v1/orders/quote', {
    status: 500,
    json: { success: false, error: { code: 'PRICE_CONFIG_UNAVAILABLE', message: 'no active price config' } },
  })
  await seedMaterialSession(page)

  await page.goto('/print/confirm')
  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'price_unavailable')
  await expect(page.getByText('本机没能取到现行价目', { exact: true })).toBeVisible()
  // 反向：报价失败时既不显示金额，也不给出任何「有可用 / 已用完」结论。
  await expect(page.getByText('¥2.00')).toHaveCount(0)
  await expect(page.locator('[data-benefit-redeem]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /按以上设置打印原文件/ })).toBeDisabled()
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card reports 后台刚调价 when quote and price-config disagree @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  // 公示价 1.20 元/页，本单报价单价 1.00 元/页 —— 两次真实读取不一致 = 后台改过价。
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: {
      billingEnabled: true,
      items: [{ serviceKey: 'print_bw_page', unitCents: 120, unit: 'page', description: '黑白打印' }],
    },
  })
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })
  await seedMaterialSession(page)

  await page.goto('/print/confirm')
  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'repriced')
  await expect(page.getByText('本单报价单价 ¥1.00，现行公示单价 ¥1.20')).toBeVisible()
  // 反向：调价态不得退化成「未认领身份」，也不得给出任何权益结论。
  await expect(benefitCard(page)).not.toHaveAttribute('data-benefit-state', 'guest')
  await expect(page.locator('[data-benefit-redeem]')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card reports 本单不适用 for a zero-amount order @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  // 免费试运营价目：公示价与报价单价一致（同为 0），排除「调价」干扰，只留「免费单」。
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: {
      billingEnabled: true,
      items: [{ serviceKey: 'print_bw_page', unitCents: 0, unit: 'page', description: '免费试运营' }],
    },
  })
  registerQuote(api, { amountCents: 0, billablePages: 2, unitCents: 0 })
  await seedMaterialSession(page)

  await page.goto('/print/confirm')
  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'not_applicable')
  await expect(page.getByText('本单无需权益抵扣', { exact: true })).toBeVisible()
  // 反向：免费单不得摆出核销入口，也不得声称权益被消耗。
  await expect(page.locator('[data-benefit-redeem]')).toHaveCount(0)
  await expect(page.getByText('已抵扣')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card lists usable grants but keeps redemption disabled and focusable @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })
  registerMemberLogin(api)
  registerBenefits(api, [
    benefitGrant({ id: 'grant-usable', title: '打印体验券', quantityRemaining: 2, quantityTotal: 3 }),
    // 政策资格提示不在服务端 REDEEMABLE 白名单内，必须被挡掉（不能算成「有可用」）。
    benefitGrant({ id: 'grant-hint', benefitType: 'subsidy_eligibility_hint', title: '就业补贴资格提示' }),
  ])

  await loginThroughVisibleUi(page, '/print/confirm')
  await softNavigate(page, '/print/confirm', CONFIRM_STATE)

  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'available')
  await expect(page.getByText('你有 1 项权益在有效期内', { exact: true })).toBeVisible()
  await expect(page.getByText('打印体验券', { exact: true })).toBeVisible()
  // 反向：不可核销的政策资格提示不得混进可用列表。
  await expect(page.getByText('就业补贴资格提示')).toHaveCount(0)

  // 核销 CTA：真 button + aria-disabled，保留焦点（不能用 disabled 属性），原因常驻可见。
  const redeem = page.locator('[data-benefit-redeem="disabled"]')
  await expect(redeem).toBeVisible()
  await expect(redeem).toHaveAttribute('aria-disabled', 'true')
  // 必须是 aria-disabled 而非 disabled 属性：disabled 会把按钮踢出 Tab 序列，
  // 变成读屏用户完全摸不到的死控件。.disabled IDL 属性直接反映内容属性是否存在。
  await expect(redeem).toHaveJSProperty('disabled', false)
  await redeem.focus()
  await expect(redeem).toBeFocused()
  await expect(page.locator('#print-benefit-redeem-reason')).toBeVisible()
  await expect(page.getByText(/本轮只展示、不核销/)).toBeVisible()

  // 资损防线：不得伪造抵扣，应付金额保持报价原值。
  await expect(page.getByText('已抵扣')).toHaveCount(0)
  await expect(page.getByText('¥0.00')).toHaveCount(0)
  await expect(page.getByText('¥2.00', { exact: true }).first()).toBeVisible()
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card reports 已用完/过期 when no grant passes the server preconditions @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })
  registerMemberLogin(api)
  // 每条 grant 只违反**一条**服务端前置条件，其余字段全部合格 —— 这样任何一条校验
  // 被删掉，都会有对应的券漏进「有可用」，用例即失败（逐条可反向验证）。
  registerBenefits(api, [
    // 仅 status 不合格（对应服务端 BENEFIT_NOT_ACTIVE）
    benefitGrant({ id: 'grant-revoked', status: 'revoked', quantityRemaining: 2, title: '已撤销的券' }),
    // 仅 validUntil 已过（BENEFIT_EXPIRED）
    benefitGrant({ id: 'grant-expired', validUntil: '2020-01-01T00:00:00.000Z', title: '过期的券' }),
    // 仅 validFrom 未到（BENEFIT_NOT_STARTED）
    benefitGrant({ id: 'grant-future', validFrom: '2099-01-01T00:00:00.000Z', title: '未生效的券' }),
    // 仅余额为 0（BENEFIT_USED_UP）
    benefitGrant({ id: 'grant-used', quantityRemaining: 0, title: '已用完的券' }),
    // 仅额度为空（BENEFIT_NOT_QUANTIFIED）
    benefitGrant({ id: 'grant-unquantified', quantityRemaining: null, quantityTotal: null, title: '无额度的券' }),
    // 仅类型不在白名单（BENEFIT_NOT_REDEEMABLE）
    benefitGrant({ id: 'grant-hint', benefitType: 'subsidy_eligibility_hint', title: '就业补贴资格提示' }),
  ])

  await loginThroughVisibleUi(page, '/print/confirm')
  await softNavigate(page, '/print/confirm', CONFIRM_STATE)

  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'none')
  await expect(page.getByText('当前没有可核销的权益', { exact: true })).toBeVisible()
  // 反向：任何一条被服务端明确会拒的券都不得出现在卡里，也不得出现核销 CTA。
  for (const blocked of ['已撤销的券', '过期的券', '未生效的券', '已用完的券', '无额度的券', '就业补贴资格提示']) {
    await expect(page.getByText(blocked)).toHaveCount(0)
  }
  await expect(page.locator('[data-benefit-redeem]')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card says 读不出来 instead of 没有权益 when /me/benefits fails @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/benefits', {
    status: 500,
    json: { success: false, error: { code: 'INTERNAL_ERROR', message: 'synthetic failure' } },
  })

  await loginThroughVisibleUi(page, '/print/confirm')
  await softNavigate(page, '/print/confirm', CONFIRM_STATE)

  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'error')
  await expect(page.getByText('权益暂时读不出来', { exact: true })).toBeVisible()
  // 反向：读取失败绝不能显示成「没有可核销的权益」。
  await expect(page.getByText('当前没有可核销的权益')).toHaveCount(0)
  await expect(page.locator('[data-benefit-redeem]')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-confirm')
})
