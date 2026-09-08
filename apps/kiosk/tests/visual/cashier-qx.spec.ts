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
  // 原先逐字钉「支付通道服务暂不可用」。文案已改成
  // 「服务暂时不可用，请稍后重试或联系现场工作人员」—— 更好（多给了下一步动作）。
  // 改成钉**不变量**而不是句子：必须说了不可用，且必须给出可执行的下一步。
  // 逐字钉整句会让每次文案打磨都变成一次假红，作者就会去改断言而不是看页面。
  {
    const alertText = (await page.getByRole('alert').innerText()).replace(/\s+/g, '')
    expect(alertText, '通道拉取失败时必须明说不可用').toMatch(/不可用|失败/)
    expect(alertText, '必须给出可执行的下一步，而不是只报故障').toMatch(/重试|稍后|工作人员/)
  }
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
  // 付款码链路现在多一步**对账**（先 reconcile 再决定能否放行），
  // 这是付款安全上的加强，不是回归。缺这条 mock 时 ApiRouter 会以
  // 「Unhandled API requests: POST /api/v1/orders/:id/pay/reconcile」失败。
  api.respond('POST', `/api/v1/orders/${W2_ORDER.orderId}/pay/reconcile`, {
    status: 200,
    json: { success: true, data: { status: 'pending' } },
  })
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
  // 按钮文案已从「出示手机付款码」改成「扫付款码 / 出示你的付款码」。
  // 用正则匹配可见文案，不逐字钉整块（那块是两行文案拼的）。
  await page.getByRole('button', { name: /出示你的付款码/ }).click()
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
  // 原先写的是 toHaveCount(6)。那个 6 是在**「退出支付」还缺失时**数出来的 ——
  // 等于把一个缺陷写成了期望值；后来按钮补回来（人工走查发现的），本该当场变红，
  // 可这个 spec 那时哪个 playwright config 都没匹配到，一条都没跑过。
  //
  // 改成钉**必须存在的出口**：数量可以随产品增减，「能选通道」和「能退出去」不能少。
  for (const required of ['微信支付', '支付宝', '返回确认页', '退出支付']) {
    await expect(
      page.getByRole('button', { name: required }),
      `收银台必须保留「${required}」—— 少了它用户会被困在付款页`,
    ).toHaveCount(1)
  }
  await page.getByRole('button', { name: '微信支付' }).click()
  await expect(page.locator('[data-qx-state="channel-selected"]')).toBeVisible()

  const measurements = await page.locator('.cashier-qx-route').evaluate((routeRoot) => {
    const stage = routeRoot.closest<HTMLElement>('[data-kiosk-stage]') ?? routeRoot.closest<HTMLElement>('.kiosk-stage')
    const stageRect = stage?.getBoundingClientRect() ?? routeRoot.getBoundingClientRect()
    const scale = stageRect.width / 1080 || 1
    const controls = [...routeRoot.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')]
    return controls.map((control) => {
      const rect = control.getBoundingClientRect()
      // 角点必须落在**圆角之内**。原先固定 inset = 2px，而按钮 border-radius 是 8px ——
      // 距角 2px 的点在圆角外面，elementFromPoint 必然返回父容器
      // （实测 blocker 是 .cashier-qx-picker-options 与 .qx-ctabar，都是按钮自己的父元素，
      //  不是任何遮挡层）。于是这条断言恒假：它测的是圆角，不是可触达性。
      // 按半径取内缩，探点才真正落在控件上。
      const radius = Number.parseFloat(getComputedStyle(control).borderTopLeftRadius) || 0
      const inset = Math.min(Math.max(2, radius), rect.width / 4, rect.height / 4)
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
  // 原先写死 5。收银台补回「退出支付」后变成 6 —— 又一个把当时状态当期望的魔法数字。
  // 改成钉「每一个可点控件都要满足触控要求」，数量交给上面按名字的存在性断言去管。
  expect(measurements.length, '收银台必须至少有通道选择 + 两个出口').toBeGreaterThanOrEqual(4)
  for (const control of measurements) {
    expect(control.cssWidth, `${control.label} width`).toBeGreaterThanOrEqual(48)
    expect(control.cssHeight, `${control.label} height`).toBeGreaterThanOrEqual(48)
    expect(control.allPointsHit, `${control.label} full target hit`).toBe(true)
    expect(control.pointerEvents, `${control.label} pointer dispatch`).toBe(5)
  }

  await page.screenshot({ path: '../../test-results/cashier-qx/runtime-channel-selected-1080x1920.png', fullPage: true })
})
