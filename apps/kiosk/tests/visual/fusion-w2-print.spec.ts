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

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
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
  api.respond('GET', '/api/v1/kiosk/device/status', {
    status: 200,
    json: { data: { scanner: { status: 'ready', online: true, busy: false } } },
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

test('direct params restore real printer and server price fixtures @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  await seedMaterialSession(page)

  await page.goto('/print/params')
  await expect(page.getByText('已配置打印机', { exact: true })).toBeVisible()
  await expect(page.getByText('在线', { exact: true })).toBeVisible()
  await expect(page.getByText('¥2.00', { exact: true })).toHaveCount(2)
  await expectHealthy(page, errors, 'print-params')
})

test('paid print-job amount routes confirmation to cashier @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
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
  { name: 'failed attempt', status: 'unpaid', attempt: { attemptId: 'w2-failed', channel: 'wechat', status: 'failed', qrCodeContent: null, expiresAt: null }, copy: '付款码支付未完成' },
  { name: 'closed order', status: 'closed', attempt: { attemptId: 'w2-closed', channel: 'wechat', status: 'expired', qrCodeContent: null, expiresAt: null }, copy: '订单已超时关闭' },
  { name: 'refunded order', status: 'refunded', attempt: { attemptId: 'w2-refunded', channel: 'wechat', status: 'success', qrCodeContent: null, expiresAt: null }, copy: '订单已退款' },
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
    await expect(page.getByRole('button', { name: '等待支付…' })).toBeDisabled()
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
