import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { setReactRouterState, W2_ORDER } from './fixtures/fusion-w2-state'

const LATER = '2099-07-24T00:10:00.000Z'
const CASHIER_STATE = {
  ...W2_ORDER,
  source: 'document',
  priceLines: [{
    serviceKey: 'print_bw_page',
    description: '黑白打印',
    unitCents: 100,
    quantity: 2,
    subtotalCents: 200,
  }],
}

function registerShell(api: ApiRouter) {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
}

function payStatus(payStatus: string, attempt: null | Record<string, unknown> = null) {
  return {
    orderId: W2_ORDER.orderId,
    orderNo: W2_ORDER.orderNo,
    payStatus,
    paymentSource: payStatus === 'paid' ? 'wechat' : null,
    payChannel: payStatus === 'paid' ? 'wechat' : null,
    amountCents: W2_ORDER.amountCents,
    paidAt: payStatus === 'paid' ? '2026-09-07T00:00:00.000Z' : null,
    pickupCode: null,
    attempt,
  }
}

async function routeExactJson(
  page: Page,
  method: string,
  path: string,
  handler: (route: Route) => Promise<void>,
) {
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== method || new URL(route.request().url()).pathname !== path) {
      await route.fallback()
      return
    }
    await handler(route)
  })
}

test('cashier renders real channels and sends the selected channel in the pay payload @w2', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat', 'alipay'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })
  let payPayload: unknown = null
  await routeExactJson(page, 'POST', `/api/v1/orders/${W2_ORDER.orderId}/pay`, async (route) => {
    payPayload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        attemptId: 'qx-alipay-attempt',
        orderId: W2_ORDER.orderId,
        orderNo: W2_ORDER.orderNo,
        channel: 'alipay',
        amountCents: W2_ORDER.amountCents,
        status: 'pending',
        qrCodeContent: 'alipay://qx-cashier-test',
        expiresAt: LATER,
        orderPayStatus: 'paying',
        orderExpiresAt: LATER,
      }),
    })
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', CASHIER_STATE)
  await expect(page.locator('[data-qx-state="pending"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '微信支付' })).not.toHaveAttribute('data-active', 'true')
  await expect(page.getByRole('button', { name: '支付宝' })).not.toHaveAttribute('data-active', 'true')

  await page.getByRole('button', { name: '支付宝' }).click()
  await page.getByRole('button', { name: '手机扫屏幕上的码' }).click()
  await expect(page.locator('[data-qx-state="pending-qr"]')).toBeVisible()
  await expect(page.getByText('请使用支付宝扫码支付', { exact: true })).toBeVisible()
  expect(payPayload).toEqual({ channel: 'alipay' })
})

test('cashier exposes a failed channel request and retries the real endpoint @w2', async ({ page, api }) => {
  registerShell(api)
  api.respondWith('GET', '/api/v1/payment/channels', (requestNumber: number) => requestNumber === 1
    ? { status: 503, json: { error: { code: 'CHANNELS_UNAVAILABLE', message: '支付通道服务暂不可用' } } }
    : { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', CASHIER_STATE)
  await expect(page.locator('[data-qx-state="channel-failed"]')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('支付通道服务暂不可用')
  await page.getByRole('button', { name: '重新读取支付通道' }).click()
  await expect(page.locator('[data-qx-state="channel-selected"]')).toBeVisible()
  expect(api.requestCount('GET', '/api/v1/payment/channels')).toBe(2)
})

test('code-pay success cannot release print before pay-status reaches paid @w2', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respondWith('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, (requestNumber: number) => requestNumber === 1
    ? { status: 200, json: payStatus('unpaid') }
    : { status: 200, json: payStatus('paying', {
        attemptId: 'qx-code-attempt', channel: 'wechat', status: 'pending', qrCodeContent: null, expiresAt: null,
      }) })
  let codePayPayload: unknown = null
  let releaseRequests = 0
  await routeExactJson(page, 'POST', `/api/v1/orders/${W2_ORDER.orderId}/code-pay`, async (route) => {
    codePayPayload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ attemptId: 'qx-code-attempt', status: 'success' }),
    })
  })
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1/print/jobs/${W2_ORDER.orderId}/release`) {
      releaseRequests += 1
    }
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', { ...CASHIER_STATE, taskId: undefined })
  await page.getByRole('button', { name: '出示手机付款码' }).click()
  await page.getByLabel('付款码输入区（内容不显示）').pressSequentially('123456789012345678')

  await expect(page.locator('[data-qx-state="awaiting-code-confirmation"]')).toBeVisible()
  await expect(page).toHaveURL(/\/print\/cashier$/)
  expect(codePayPayload).toEqual({ channel: 'wechat', authCode: '123456789012345678' })
  expect(releaseRequests).toBe(0)
})

test('cashier keeps a server terminal state visible when channel loading fails @w2', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', {
    status: 503,
    json: { error: { code: 'CHANNELS_UNAVAILABLE', message: '支付通道服务暂不可用' } },
  })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, {
    status: 200,
    json: payStatus('refunded', {
      attemptId: 'qx-refunded-attempt', channel: 'wechat', status: 'success', qrCodeContent: null, expiresAt: null,
    }),
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', CASHIER_STATE)
  await expect(page.locator('[data-qx-state="refunded"]')).toBeVisible()
  await expect(page.getByText('这一单已经退款', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始打印' })).toHaveCount(0)
})

test('cashier 1080x1920 controls satisfy scaled hit targets and dispatch pointer events @w2', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat', 'alipay'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', CASHIER_STATE)
  await expect(page.locator('[data-qx-state="pending"]')).toBeVisible()
  await expect(page.locator('.cashier-qx-route button')).toHaveCount(6)
  await page.getByRole('button', { name: '微信支付' }).click()
  await expect(page.locator('[data-qx-state="channel-selected"]')).toBeVisible()

  const measurements = await page.locator('.cashier-qx-route').evaluate((routeRoot) => {
    const stage = routeRoot.closest<HTMLElement>('[data-kiosk-stage]') ?? routeRoot.closest<HTMLElement>('.kiosk-stage')
    const stageRect = stage?.getBoundingClientRect() ?? routeRoot.getBoundingClientRect()
    const scale = stageRect.width / 1080 || 1
    const controls = [...routeRoot.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')]
    return controls.map((control) => {
      const rect = control.getBoundingClientRect()
      const inset = Math.min(2, rect.width / 4, rect.height / 4)
      const points = [
        [rect.left + inset, rect.top + inset],
        [rect.right - inset, rect.top + inset],
        [rect.left + inset, rect.bottom - inset],
        [rect.right - inset, rect.bottom - inset],
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
      ] as const
      const hits = points.map(([x, y]) => document.elementFromPoint(x, y))
      let pointerEvents = 0
      const onPointerDown = () => { pointerEvents += 1 }
      control.addEventListener('pointerdown', onPointerDown)
      for (const hit of hits) hit?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      control.removeEventListener('pointerdown', onPointerDown)
      return {
        label: control.innerText.trim(),
        cssWidth: rect.width / scale,
        cssHeight: rect.height / scale,
        allPointsHit: hits.every((hit) => hit === control || Boolean(hit && control.contains(hit))),
        pointerEvents,
      }
    })
  })
  expect(measurements).toHaveLength(5)
  for (const control of measurements) {
    expect(control.cssWidth, `${control.label} width`).toBeGreaterThanOrEqual(48)
    expect(control.cssHeight, `${control.label} height`).toBeGreaterThanOrEqual(48)
    expect(control.allPointsHit, `${control.label} full target hit`).toBe(true)
    expect(control.pointerEvents, `${control.label} pointer dispatch`).toBe(5)
  }

  await page.screenshot({ path: '../../test-results/cashier-qx/runtime-channel-selected-1080x1920.png', fullPage: true })
})
