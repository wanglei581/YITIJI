/**
 * 自助开票二期：一体机「我的订单」混排与「开发票扫码屏」（/me/print-orders、/me/orders/invoice）。
 * 视觉与文案对照触屏稿 docs/design/kiosk-touch-2026-10/pay-1113.js:472-569。
 */
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { attachMachinePricing, type MachineServicePrices } from '../fixtures/machine-pricing'
import { registerW6Api, W6_MEMBER_TOKEN } from './fixtures/fusion-w6-api'

const INVOICE_SESSIONS_PATH = '/api/v1/kiosk/invoice-sessions'
const SERVICE_ORDERS_PATH = '/api/v1/me/service-orders'
const PRINT_ORDERS_PATH = '/api/v1/me/print-orders'
const CTRL_TOKEN_1 = 'mem-only-ctrl-token-secret-111111'
const CTRL_TOKEN_2 = 'mem-only-ctrl-token-secret-222222'

function ok<T>(data: T, status = 200) {
  return { status, json: { success: true, data } }
}

function setupMachine(api: ApiRouter, bw: number, color: number, services: MachineServicePrices = {}): void {
  registerW6Api(api)
  attachMachinePricing(api, bw, color, services)
  api.respond('GET', '/api/v1/me/print-orders/timeline', ok({ items: [], nextCursor: null, total: 0 }))
  api.respond('GET', '/api/v1/me/feedback', ok({ items: [], nextCursor: null, total: 0 }))
}

async function loginTo(page: Page, path: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(path)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === path.split('?')[0])
}

function svcOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'svc-1',
    serviceKey: 'resume_optimize',
    serviceName: 'AI 简历优化',
    status: 'paid',
    amountCents: 100,
    paidAt: '2026-11-21T05:40:00.000Z',
    settledAt: null,
    refundedAt: null,
    refundReason: null,
    createdAt: '2026-11-21T05:40:00.000Z',
    canInvoice: true,
    invoiceStatus: 'none',
    invoiceRequestId: null,
    ...overrides,
  }
}

function printOrder(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    id: 'ptask-1',
    orderId: 'ord-print-1',
    orderNo: 'ORD-20261121-001',
    status: 'completed',
    fileName: '毕业生就业推荐表.pdf',
    createdAt: '2026-11-21T05:05:00.000Z',
    completedAt: '2026-11-21T05:06:00.000Z',
    copies: 1,
    colorMode: 'black_white',
    duplex: 'simplex',
    paperSize: 'A4',
    pageRange: 'all',
    amountCents: 200,
    payStatus: 'paid',
    paymentSource: 'offline',
    billablePages: 2,
    billingPageSource: 'pdf_lightweight_scan',
    pickupCode: null,
    reprintAllowed: false,
    reprintRemaining: null,
    reprintNotice: null,
    refundedAmountCents: 0,
    discountCents: 0,
    refundRequired: false,
    terminal: null,
    failureCode: null,
    canInvoice: true,
    invoiceStatus: 'none',
    invoiceRequestId: null,
    ...overrides,
  }
  if (!('payableAmountCents' in overrides) && typeof base['amountCents'] === 'number' && base['amountCents'] > 0) {
    const discount = typeof base['discountCents'] === 'number' && base['discountCents'] > 0 ? base['discountCents'] : 0
    base['payableAmountCents'] = Math.max(0, base['amountCents'] - discount)
  }
  return base
}

async function assertNoForbiddenCopy(page: Page): Promise<void> {
  const text = await page.locator('body').innerText()
  expect(text).not.toContain('¥')
  expect(text).not.toContain('工作人员')
}

async function assertNoInvoiceSecretsInStorage(page: Page, secrets: readonly string[]): Promise<void> {
  const dump = await page.evaluate(() => ({
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
    href: window.location.href,
  }))
  const combined = `${dump.local}\n${dump.session}\n${dump.href}`
  for (const secret of secrets) {
    expect(combined, `存储或 URL 不得包含敏感串 ${secret}`).not.toContain(secret)
  }
}

test.describe('我的订单与自助开票扫码屏 @kiosk', () => {
  test('收费机「我的订单」混排全状态、筛选诚实不丢服务单、打印单可开票且零 ¥ / 零工作人员 @kiosk', async ({ page, api }) => {
    setupMachine(api, 100, 200, { resume_optimize: 100, mock_interview: 100, scan: 100 })
    const services = [
      svcOrder({ id: 'svc-paid', serviceKey: 'resume_optimize', serviceName: 'AI 简历优化', status: 'paid', amountCents: 100, createdAt: '2026-11-21T05:40:00.000Z', paidAt: '2026-11-21T05:40:00.000Z', canInvoice: true, invoiceStatus: 'none' }),
      svcOrder({ id: 'svc-returned', serviceKey: 'mock_interview', serviceName: 'AI 模拟面试', status: 'consumed', amountCents: 200, createdAt: '2026-11-21T05:30:00.000Z', paidAt: '2026-11-21T05:30:00.000Z', canInvoice: true, invoiceStatus: 'returned', invoiceRequestId: 'req-ret' }),
      svcOrder({ id: 'svc-submitted', serviceKey: 'resume_optimize', serviceName: 'AI 简历优化', status: 'paid', amountCents: 150, createdAt: '2026-11-21T05:20:00.000Z', paidAt: '2026-11-21T05:20:00.000Z', canInvoice: false, invoiceStatus: 'submitted', invoiceRequestId: 'req-sub' }),
      svcOrder({ id: 'svc-issued', serviceKey: 'mock_interview', serviceName: 'AI 模拟面试', status: 'consumed', amountCents: 300, createdAt: '2026-11-21T05:10:00.000Z', paidAt: '2026-11-21T05:10:00.000Z', canInvoice: false, invoiceStatus: 'issued', invoiceRequestId: 'req-iss' }),
      svcOrder({ id: 'svc-refunding', serviceKey: 'scan', serviceName: '扫描', status: 'refunding', amountCents: 100, createdAt: '2026-11-21T04:50:00.000Z', paidAt: '2026-11-21T04:50:00.000Z', canInvoice: false, invoiceStatus: 'none' }),
      svcOrder({ id: 'svc-refunded', serviceKey: 'scan', serviceName: '扫描', status: 'refunded', amountCents: 100, createdAt: '2026-11-21T04:20:00.000Z', refundedAt: '2026-11-21T04:21:00.000Z', canInvoice: false, invoiceStatus: 'none' }),
    ]
    const prints = [
      printOrder({ id: 'pt-paid', orderId: 'ord-pt-1', fileName: '毕业生就业推荐表.pdf', amountCents: 200, createdAt: '2026-11-21T05:25:00.000Z', canInvoice: true, invoiceStatus: 'none' }),
      printOrder({ id: 'pt-issued', orderId: 'ord-pt-2', fileName: '成绩单-2026春.pdf', amountCents: 600, createdAt: '2026-11-21T04:40:00.000Z', canInvoice: false, invoiceStatus: 'issued', invoiceRequestId: 'req-pt-iss' }),
    ]
    api.respond('GET', SERVICE_ORDERS_PATH, ok({ items: services, nextCursor: null, total: services.length }))
    api.respond('GET', PRINT_ORDERS_PATH, ok({ items: prints, nextCursor: null, total: prints.length }))

    await loginTo(page, '/me/print-orders')
    await expect(page.getByRole('heading', { name: '我的订单', exact: true })).toBeVisible()
    await expect(page.locator('.qxt-eyebrow')).toHaveText('我的 · 订单')
    await expect(page.locator('.qxt-band')).toContainText('共 8 条')

    // 按 createdAt 新到旧混排：05:40 服务单 → 05:30 服务单 → 05:25 打印单 → ...
    const allCards = page.locator('[data-testid="member-assets-list"] > .me-line')
    await expect(allCards).toHaveCount(8)
    await expect(allCards.nth(0)).toContainText('AI 简历优化')
    await expect(allCards.nth(0)).toContainText('已付款 · 1.00 元')
    await expect(allCards.nth(0).getByRole('button', { name: /开发票/ })).toBeVisible()

    await expect(allCards.nth(1)).toContainText('开票申请被退回 · 2.00 元')
    await expect(allCards.nth(1).getByRole('button', { name: /开发票/ })).toBeVisible()

    await expect(allCards.nth(2)).toContainText('毕业生就业推荐表.pdf')
    await expect(allCards.nth(2)).toContainText('2.00 元')
    await expect(allCards.nth(2).getByRole('button', { name: /开发票/ })).toBeVisible()

    await expect(allCards.nth(3)).toContainText('已提交开票 · 1.50 元 · 电子发票开好后发到邮箱')
    await expect(allCards.nth(3).getByRole('button', { name: /开发票/ })).toHaveCount(0)

    await expect(allCards.nth(4)).toContainText('发票已开 · 3.00 元 · 电子发票已发到邮箱')
    await expect(allCards.nth(4).getByRole('button', { name: /开发票/ })).toHaveCount(0)

    await expect(allCards.nth(5)).toContainText('退款处理中 · 1.00 元')
    await expect(allCards.nth(5).getByRole('button', { name: /开发票/ })).toHaveCount(0)

    await expect(allCards.nth(6)).toContainText('成绩单-2026春.pdf')
    await expect(allCards.nth(6)).toContainText('发票已开 · 电子发票已发到邮箱')
    await expect(allCards.nth(6).getByRole('button', { name: /开发票/ })).toHaveCount(0)

    await expect(allCards.nth(7)).toContainText('已退款 · 1.00 元 · 已退回原付款账户，到账时间以支付渠道为准')
    await expect(allCards.nth(7).getByRole('button', { name: /开发票/ })).toHaveCount(0)

    await assertNoForbiddenCopy(page)
    await expect(page.locator('body')).not.toContainText('免费试运营')

    // 筛选诚实匹配，不丢服务单
    await page.getByRole('button', { name: '进行中', exact: true }).click()
    await expect(allCards).toHaveCount(1)
    await expect(allCards.first()).toContainText('退款处理中 · 1.00 元')

    await page.getByRole('button', { name: '已取消', exact: true }).click()
    await expect(allCards).toHaveCount(1)
    await expect(allCards.first()).toContainText('已退款 · 1.00 元')

    await page.getByRole('button', { name: '已完成', exact: true }).click()
    await expect(allCards).toHaveCount(6)
  })

  test('无打印单但有服务单：正常展示服务单列表，不误显示「还没有打印订单」空态 @kiosk', async ({ page, api }) => {
    setupMachine(api, 100, 200, { resume_optimize: 100 })
    api.respond('GET', PRINT_ORDERS_PATH, ok({ items: [], nextCursor: null, total: 0 }))
    api.respond('GET', SERVICE_ORDERS_PATH, ok({ items: [svcOrder({ id: 'svc-only' })], nextCursor: null, total: 1 }))

    await loginTo(page, '/me/print-orders')
    await expect(page.getByRole('heading', { name: '我的订单', exact: true })).toBeVisible()
    await expect(page.locator('.qxt-band')).toContainText('共 1 条')
    await expect(page.getByText('还没有打印订单')).toHaveCount(0)
    await expect(page.getByTestId('member-service-order')).toHaveCount(1)
    await expect(page.getByTestId('service-order-invoice-svc-only')).toBeVisible()
    await assertNoForbiddenCopy(page)
  })

  test('点「开发票」出码 → 隐私零输入零存储 → 轮询变「已提交」立停轮询 → 返回刷新见「已提交开票」 @kiosk', async ({ page, api }) => {
    await page.clock.install()
    setupMachine(api, 100, 200, { resume_optimize: 100 })
    let submitted = false
    api.respond('GET', PRINT_ORDERS_PATH, ok({ items: [], nextCursor: null, total: 0 }))
    api.respondWith('GET', SERVICE_ORDERS_PATH, () => ok({
      items: [svcOrder({
        id: 'svc-flow-1',
        canInvoice: !submitted,
        invoiceStatus: submitted ? 'submitted' : 'none',
        invoiceRequestId: submitted ? 'req-flow-1' : null,
      })],
      nextCursor: null,
      total: 1,
    }))

    let createBody: Record<string, unknown> | null = null
    let createAuth = ''
    let pollCtrlHeader = ''
    let pollCount = 0

    await page.route(/\/api\/v1\/kiosk\/invoice-sessions(?:\/[^/?#]+)?$/, async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      if (req.method() === 'POST' && url.pathname === INVOICE_SESSIONS_PATH) {
        createBody = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>
        createAuth = req.headers()['authorization'] ?? ''
        const nowMs = await page.evaluate(() => Date.now())
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              sessionId: 'inv-sess-1',
              sceneToken: 'sceneToken0123456789abcd',
              codeUrl: 'http://127.0.0.1:4177/k/i/sceneToken0123456789abcd',
              controlToken: CTRL_TOKEN_1,
              expiresAt: new Date(nowMs + 600_000).toISOString(),
              status: '等手机填写',
            },
          }),
        })
        return
      }
      if (req.method() === 'GET' && url.pathname === `${INVOICE_SESSIONS_PATH}/inv-sess-1`) {
        pollCount += 1
        pollCtrlHeader = req.headers()['x-invoice-control'] ?? ''
        const status = pollCount >= 2 ? '已提交' : '等手机填写'
        if (status === '已提交') submitted = true
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { status } }),
        })
        return
      }
      await route.continue()
    })

    await loginTo(page, '/me/print-orders')
    await page.getByTestId('service-order-invoice-svc-flow-1').click()
    await page.waitForURL((url) => url.pathname === '/me/orders/invoice')

    const screen = page.locator('[data-qx-page="my-orders-invoice"]')
    await expect(screen).toHaveAttribute('data-qxt-state', 'waiting')
    expect(createBody).toEqual({ orderKind: 'service', orderId: 'svc-flow-1' })
    expect(createAuth).toBe(`Bearer ${W6_MEMBER_TOKEN}`)

    await expect(screen).toContainText('我的 · 订单')
    await expect(screen).toContainText('用手机扫码填写开票信息')
    await expect(screen).toContainText('这一单 1.00 元。开好后，电子发票发到你填的邮箱。')
    await expect(screen.locator('.qxt-status')).toContainText('等手机填写')
    await expect(screen).toContainText('手机扫码')
    await expect(screen).toContainText('填写开票信息')
    await expect(screen).toContainText('发票发到邮箱')
    await expect(screen).toContainText('手机上要填的三项')
    await expect(screen).toContainText('抬头。个人写姓名，单位写单位名称。')
    await expect(screen).toContainText('税号。单位才要填。个人不用填税号。')
    await expect(screen).toContainText('接收邮箱。电子发票发到这个邮箱。这台屏幕不保存税号。')
    await expect(screen).toContainText('在手机上填写并提交。没付成或已退款的单，开不了发票。')
    await expect(page.getByTestId('invoice-qr-code').locator('svg')).toBeVisible()
    await expect(page.locator('.qxt-dock').getByRole('button', { name: '返回订单', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '问小青：发票发到哪' })).toBeVisible()
    await expect(page.getByTestId('invoice-primary-btn')).toHaveText('填好了，返回订单')

    // 硬隐私红线：无输入框、无 storage / URL 泄露
    await expect(page.locator('input, textarea, form')).toHaveCount(0)
    await assertNoInvoiceSecretsInStorage(page, [CTRL_TOKEN_1, '91000000MA0000000N', 'taxId'])
    await assertNoForbiddenCopy(page)

    // 轮询 2 次后变「已提交」
    await page.clock.runFor(6_500)
    await expect(screen).toHaveAttribute('data-qxt-state', 'submitted')
    expect(pollCtrlHeader).toBe(CTRL_TOKEN_1)
    await expect(screen.locator('.qxt-status')).toContainText('已提交')
    await expect(page.getByTestId('invoice-submitted-banner')).toContainText('开票信息已提交。开好后，电子发票发到你填的邮箱。')
    await expect(page.getByTestId('invoice-qr-code')).toHaveCount(0)

    // 变为已提交后必须立停轮询
    const frozenCount = pollCount
    await page.clock.runFor(12_000)
    expect(pollCount, '已提交后不得继续轮询').toBe(frozenCount)

    // 点主按钮回我的订单，刷新后可见「已提交开票」且无开发票按钮
    await page.getByTestId('invoice-primary-btn').click()
    await page.waitForURL((url) => url.pathname === '/me/print-orders')
    const svcRow = page.getByTestId('member-service-order').first()
    await expect(svcRow).toContainText('已提交开票 · 1.00 元 · 电子发票开好后发到邮箱')
    await expect(svcRow.getByRole('button', { name: /开发票/ })).toHaveCount(0)
  })

  test('打印单点「开发票」携带 orderKind=print 与真实 orderId 出码 @kiosk', async ({ page, api }) => {
    setupMachine(api, 100, 200)
    api.respond('GET', SERVICE_ORDERS_PATH, ok({ items: [], nextCursor: null, total: 0 }))
    api.respond('GET', PRINT_ORDERS_PATH, ok({
      items: [printOrder({ id: 'pt-inv-1', orderId: 'ord-print-real-99', amountCents: 200, canInvoice: true, invoiceStatus: 'none' })],
      nextCursor: null,
      total: 1,
    }))
    let createdPayload: Record<string, unknown> | null = null
    await page.route(/\/api\/v1\/kiosk\/invoice-sessions(?:\/[^/?#]+)?$/, async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        createdPayload = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              sessionId: 'inv-print-1',
              sceneToken: 'scenePrint0123456789abcd',
              codeUrl: 'http://127.0.0.1:4177/k/i/scenePrint0123456789abcd',
              controlToken: CTRL_TOKEN_1,
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
              status: '等手机填写',
            },
          }),
        })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { status: '等手机填写' } }) })
    })

    await loginTo(page, '/me/print-orders')
    await page.getByTestId('print-order-invoice-pt-inv-1').click()
    await page.waitForURL((url) => url.pathname === '/me/orders/invoice')
    await expect(page.locator('[data-qx-page="my-orders-invoice"]')).toHaveAttribute('data-qxt-state', 'waiting')
    expect(createdPayload).toEqual({ orderKind: 'print', orderId: 'ord-print-real-99' })
    await expect(page.locator('.qxt-band')).toContainText('这一单 2.00 元')
  })

  test('二维码过期隐藏失效码、停轮询，点「重新生成开票码」重新出码 @kiosk', async ({ page, api }) => {
    await page.clock.install()
    setupMachine(api, 100, 200, { resume_optimize: 100 })
    api.respond('GET', PRINT_ORDERS_PATH, ok({ items: [], nextCursor: null, total: 0 }))
    api.respond('GET', SERVICE_ORDERS_PATH, ok({ items: [svcOrder({ id: 'svc-exp-1' })], nextCursor: null, total: 1 }))

    let createCalls = 0
    let pollCalls = 0
    await page.route(/\/api\/v1\/kiosk\/invoice-sessions(?:\/[^/?#]+)?$/, async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      if (req.method() === 'POST' && url.pathname === INVOICE_SESSIONS_PATH) {
        createCalls += 1
        const nowMs = await page.evaluate(() => Date.now())
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              sessionId: `inv-exp-${createCalls}`,
              sceneToken: `sceneExp${createCalls}0123456789abcdef`,
              codeUrl: `http://127.0.0.1:4177/k/i/sceneExp${createCalls}0123456789abcdef`,
              controlToken: createCalls === 1 ? CTRL_TOKEN_1 : CTRL_TOKEN_2,
              expiresAt: new Date(nowMs + 600_000).toISOString(),
              status: '等手机填写',
            },
          }),
        })
        return
      }
      if (req.method() === 'GET') {
        pollCalls += 1
        const status = url.pathname.endsWith('/inv-exp-1') ? '已过期' : '等手机填写'
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { status } }),
        })
        return
      }
      await route.continue()
    })

    await loginTo(page, '/me/print-orders')
    await page.getByTestId('service-order-invoice-svc-exp-1').click()
    const screen = page.locator('[data-qx-page="my-orders-invoice"]')
    await expect(screen).toHaveAttribute('data-qxt-state', 'waiting')

    await page.clock.runFor(3_500)
    await expect(screen).toHaveAttribute('data-qxt-state', 'expired')
    await expect(screen.locator('.qxt-status')).toContainText('已过期')
    await expect(page.getByTestId('invoice-qr-code')).toHaveCount(0)
    await expect(page.getByTestId('invoice-primary-btn')).toHaveText('重新生成开票码')

    const frozenPolls = pollCalls
    await page.clock.runFor(10_000)
    expect(pollCalls, '过期后不得继续轮询').toBe(frozenPolls)

    await page.getByTestId('invoice-primary-btn').click()
    await expect(screen).toHaveAttribute('data-qxt-state', 'waiting')
    expect(createCalls).toBe(2)
    await expect(page.getByTestId('invoice-qr-code').locator('svg')).toBeVisible()
    await expect(page.getByTestId('invoice-primary-btn')).toHaveText('填好了，返回订单')
    await assertNoInvoiceSecretsInStorage(page, [CTRL_TOKEN_1, CTRL_TOKEN_2])
  })

  test('轮询遇 429 尊重 Retry-After 退避并显示温和提示，退避后恢复收敛 @kiosk', async ({ page, api }) => {
    await page.clock.install()
    setupMachine(api, 100, 200, { resume_optimize: 100 })
    api.respond('GET', PRINT_ORDERS_PATH, ok({ items: [], nextCursor: null, total: 0 }))
    api.respond('GET', SERVICE_ORDERS_PATH, ok({ items: [svcOrder({ id: 'svc-429' })], nextCursor: null, total: 1 }))

    let polls = 0
    await page.route(/\/api\/v1\/kiosk\/invoice-sessions(?:\/[^/?#]+)?$/, async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const nowMs = await page.evaluate(() => Date.now())
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              sessionId: 'inv-429',
              sceneToken: 'scene4290123456789abcdef',
              codeUrl: 'http://127.0.0.1:4177/k/i/scene4290123456789abcdef',
              controlToken: CTRL_TOKEN_1,
              expiresAt: new Date(nowMs + 600_000).toISOString(),
              status: '等手机填写',
            },
          }),
        })
        return
      }
      polls += 1
      if (polls === 1) {
        await route.fulfill({
          status: 429,
          headers: { 'Retry-After': '15' },
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: '请求太频繁' } }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { status: '已提交' } }),
      })
    })

    await loginTo(page, '/me/print-orders')
    await page.getByTestId('service-order-invoice-svc-429').click()
    const screen = page.locator('[data-qx-page="my-orders-invoice"]')
    await expect(screen).toHaveAttribute('data-qxt-state', 'waiting')

    await page.clock.runFor(3_500)
    expect(polls).toBe(1)
    await expect(page.getByTestId('invoice-rate-limit')).toBeVisible()

    // 15 秒退避窗口内不发新请求
    await page.clock.runFor(10_000)
    expect(polls).toBe(1)

    // 过 15 秒退避后恢复并收口为已提交
    await page.clock.runFor(6_000)
    expect(polls).toBe(2)
    await expect(screen).toHaveAttribute('data-qxt-state', 'submitted')
  })

  test('免费机保持原「打印订单」、无目标单展示免费兜底屏、服务端拒单如实展示原因 @kiosk', async ({ page, api }) => {
    setupMachine(api, 0, 0)
    api.respond('GET', SERVICE_ORDERS_PATH, ok({ items: [], nextCursor: null, total: 0 }))
    api.respond('GET', PRINT_ORDERS_PATH, ok({
      items: [printOrder({ id: 'pt-free-1', orderId: 'ord-free-1', amountCents: 0, paymentSource: 'free', canInvoice: undefined, invoiceStatus: undefined })],
      nextCursor: null,
      total: 1,
    }))

    await loginTo(page, '/me/print-orders')
    await expect(page.getByRole('heading', { name: '打印订单', exact: true })).toBeVisible()
    await expect(page.locator('.qxt-eyebrow')).toHaveText('我的 · 打印订单')
    await expect(page.locator('.qxt-band')).toContainText('共 1 条已产生打印任务的单')

    // 免费机无目标单直接进 /me/orders/invoice → 免费兜底屏
    await page.evaluate(() => {
      window.history.pushState({}, '', '/me/orders/invoice')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    const screen = page.locator('[data-qx-page="my-orders-invoice"]')
    await expect(screen).toHaveAttribute('data-qxt-state', 'free')
    await expect(screen).toContainText('这台机器免费，没有需要开发票的订单')
    await expect(screen.locator('.qxt-status')).toContainText('不收费')
    await expect(page.getByTestId('invoice-primary-btn')).toHaveText('返回')
    await assertNoForbiddenCopy(page)

    // 后端 INVOICE_NOT_ALLOWED（已退款）→ 如实展示中文原因句
    await page.route(/\/api\/v1\/kiosk\/invoice-sessions(?:\/[^/?#]+)?$/, async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'INVOICE_NOT_ALLOWED', message: '已退款的单，开不了发票。' } }),
      })
    })
    await page.evaluate(() => {
      window.history.pushState({}, '', '/me/orders/invoice?kind=service&id=svc-refunded')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(screen).toHaveAttribute('data-qxt-state', 'blocked')
    await expect(page.getByTestId('invoice-blocked-reason')).toContainText('已退款的单，开不了发票。')
  })

  test('跨点位历史收费单在免费机上仍可展示「我的订单」并正常出码开票，离开立停轮询 @kiosk', async ({ page, api }) => {
    await page.clock.install()
    // 本机是免费机（全 0）
    setupMachine(api, 0, 0)
    api.respond('GET', PRINT_ORDERS_PATH, ok({ items: [], nextCursor: null, total: 0 }))
    api.respond('GET', SERVICE_ORDERS_PATH, ok({
      items: [svcOrder({ id: 'svc-cross-site', serviceName: 'AI 简历优化', amountCents: 100, canInvoice: true, invoiceStatus: 'none' })],
      nextCursor: null,
      total: 1,
    }))
    let pollCalls = 0
    await page.route(/\/api\/v1\/kiosk\/invoice-sessions(?:\/[^/?#]+)?$/, async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const nowMs = await page.evaluate(() => Date.now())
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              sessionId: 'inv-cross-1',
              sceneToken: 'sceneCross0123456789abcd',
              codeUrl: 'http://127.0.0.1:4177/k/i/sceneCross0123456789abcd',
              controlToken: CTRL_TOKEN_1,
              expiresAt: new Date(nowMs + 600_000).toISOString(),
              status: '等手机填写',
            },
          }),
        })
        return
      }
      pollCalls += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { status: '等手机填写' } }),
      })
    })

    await loginTo(page, '/me/print-orders')
    await expect(page.getByRole('heading', { name: '我的订单', exact: true })).toBeVisible()
    await page.getByTestId('service-order-invoice-svc-cross-site').click()
    const screen = page.locator('[data-qx-page="my-orders-invoice"]')
    await expect(screen).toHaveAttribute('data-qxt-state', 'waiting')
    await expect(page.getByTestId('invoice-qr-code').locator('svg')).toBeVisible()

    // 返回订单立停轮询
    await page.clock.runFor(3_500)
    expect(pollCalls).toBe(1)
    await page.locator('.qxt-dock').getByRole('button', { name: '返回订单', exact: true }).click()
    await page.waitForURL((url) => url.pathname === '/me/print-orders')
    const afterLeave = pollCalls
    await page.clock.runFor(10_000)
    expect(pollCalls, '离开开票屏后不得继续轮询').toBe(afterLeave)
    await assertNoInvoiceSecretsInStorage(page, [CTRL_TOKEN_1])
  })

  test('部分抵扣打印单订单行、展开详单与开票屏三处统一展示抵扣后实付且无 ¥，全额抵扣不显示开发票按钮 @kiosk', async ({ page, api }) => {
    setupMachine(api, 100, 200, { resume_optimize: 100 })
    api.respond('GET', SERVICE_ORDERS_PATH, ok({ items: [], nextCursor: null, total: 0 }))
    api.respond('GET', PRINT_ORDERS_PATH, ok({
      items: [
        printOrder({
          id: 'pt-partial-disc',
          orderId: 'ord-partial-disc',
          fileName: '部分抵扣打印单.pdf',
          amountCents: 200,
          discountCents: 100,
          payableAmountCents: 100,
          payStatus: 'paid',
          paymentSource: 'offline',
          canInvoice: true,
          invoiceStatus: 'none',
          createdAt: '2026-11-21T05:30:00.000Z',
        }),
        printOrder({
          id: 'pt-full-disc',
          orderId: 'ord-full-disc',
          fileName: '全额抵扣打印单.pdf',
          amountCents: 200,
          discountCents: 200,
          payableAmountCents: 0,
          payStatus: 'paid',
          paymentSource: 'offline',
          canInvoice: false,
          invoiceStatus: 'none',
          createdAt: '2026-11-21T05:20:00.000Z',
        }),
      ],
      nextCursor: null,
      total: 2,
    }))

    await page.route(/\/api\/v1\/kiosk\/invoice-sessions(?:\/[^/?#]+)?$/, async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              sessionId: 'inv-disc-1',
              sceneToken: 'sceneDisc0123456789abcde',
              codeUrl: 'http://127.0.0.1:4177/k/i/sceneDisc0123456789abcde',
              controlToken: CTRL_TOKEN_1,
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
              status: '等手机填写',
            },
          }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { status: '等手机填写' } }),
      })
    })

    await loginTo(page, '/me/print-orders')
    const partialCard = page.getByTestId('member-assets-order').filter({ hasText: '部分抵扣打印单.pdf' })
    await expect(partialCard).toContainText('1.00 元 · 已支付（线下收款）')
    await expect(partialCard).not.toContainText('2.00 元')
    await expect(page.getByTestId('print-order-invoice-pt-partial-disc')).toBeVisible()

    // 显式展开部分抵扣单详单：下单金额 2.00 元 / 优惠抵扣 1.00 元 / 实付 1.00 元，零 ¥、零「未记录」
    await partialCard.getByRole('button', { name: '查看订单详单 部分抵扣打印单.pdf' }).click()
    const partialSummary = partialCard.locator('.me-payment-summary')
    await expect(partialSummary.locator('.me-payment-row', { hasText: '下单金额' })).toContainText('2.00 元')
    await expect(partialSummary.locator('.me-payment-row', { hasText: '优惠/权益抵扣' })).toContainText('1.00 元')
    await expect(partialSummary.locator('.me-payment-row', { hasText: '已退款' })).toContainText('0.00 元')
    await expect(partialSummary.locator('.me-payment-row', { hasText: '实付' })).toContainText('1.00 元')
    await expect(partialSummary).not.toContainText('未记录')
    await expect(partialSummary).not.toContainText('没有单独记下实付')
    await assertNoForbiddenCopy(page)

    // 显式展开全额抵扣单详单：实付 0.00 元，无「开发票」按钮、零 ¥
    const fullCard = page.getByTestId('member-assets-order').filter({ hasText: '全额抵扣打印单.pdf' })
    await expect(fullCard).toContainText('0.00 元 · 已支付（线下收款）')
    await expect(page.getByTestId('print-order-invoice-pt-full-disc')).toHaveCount(0)
    await fullCard.getByRole('button', { name: '查看订单详单 全额抵扣打印单.pdf' }).click()
    const fullSummary = fullCard.locator('.me-payment-summary')
    await expect(fullSummary.locator('.me-payment-row', { hasText: '下单金额' })).toContainText('2.00 元')
    await expect(fullSummary.locator('.me-payment-row', { hasText: '优惠/权益抵扣' })).toContainText('2.00 元')
    await expect(fullSummary.locator('.me-payment-row', { hasText: '实付' })).toContainText('0.00 元')
    await expect(fullSummary).not.toContainText('未记录')
    await assertNoForbiddenCopy(page)

    await page.getByTestId('print-order-invoice-pt-partial-disc').click()
    await page.waitForURL((url) => url.pathname === '/me/orders/invoice')
    const screen = page.locator('[data-qx-page="my-orders-invoice"]')
    await expect(screen).toHaveAttribute('data-qxt-state', 'waiting')
    await expect(screen.locator('.qxt-band')).toContainText('这一单 1.00 元。开好后，电子发票发到你填的邮箱。')
    await expect(screen.locator('.qxt-band')).not.toContainText('2.00 元')
    await assertNoForbiddenCopy(page)
  })

  test('轮询遇 429 返回 120 秒 Retry-After 时绝不截短至 60 秒，满 120 秒后恢复收敛 @kiosk', async ({ page, api }) => {
    await page.clock.install()
    setupMachine(api, 100, 200, { resume_optimize: 100 })
    api.respond('GET', PRINT_ORDERS_PATH, ok({ items: [], nextCursor: null, total: 0 }))
    api.respond('GET', SERVICE_ORDERS_PATH, ok({ items: [svcOrder({ id: 'svc-429-120' })], nextCursor: null, total: 1 }))

    let polls = 0
    await page.route(/\/api\/v1\/kiosk\/invoice-sessions(?:\/[^/?#]+)?$/, async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const nowMs = await page.evaluate(() => Date.now())
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              sessionId: 'inv-429-120',
              sceneToken: 'scene4291200123456789abc',
              codeUrl: 'http://127.0.0.1:4177/k/i/scene4291200123456789abc',
              controlToken: CTRL_TOKEN_1,
              expiresAt: new Date(nowMs + 600_000).toISOString(),
              status: '等手机填写',
            },
          }),
        })
        return
      }
      polls += 1
      if (polls === 1) {
        await route.fulfill({
          status: 429,
          headers: { 'Retry-After': '120' },
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: '请求太频繁' } }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { status: '已提交' } }),
      })
    })

    await loginTo(page, '/me/print-orders')
    await page.getByTestId('service-order-invoice-svc-429-120').click()
    const screen = page.locator('[data-qx-page="my-orders-invoice"]')
    await expect(screen).toHaveAttribute('data-qxt-state', 'waiting')

    await page.clock.runFor(3_500)
    expect(polls).toBe(1)
    await expect(page.getByTestId('invoice-rate-limit')).toBeVisible()

    // 过 65 秒（超过旧 60 秒上限）与 115 秒内都不得提前重发
    await page.clock.runFor(65_000)
    expect(polls, '120 秒 Retry-After 不得被截短到 60 秒').toBe(1)
    await page.clock.runFor(50_000)
    expect(polls, '115 秒内仍应遵守服务端 120 秒退避').toBe(1)

    // 满 120 秒后自动恢复并收口为已提交
    await page.clock.runFor(10_000)
    expect(polls).toBe(2)
    await expect(screen).toHaveAttribute('data-qxt-state', 'submitted')
  })

  test('跨用户切换与挂起分页竞态：A 发起加载更多后会话失效换 B 登录，同 SPA 堆释放 A 旧分页绝不混入 B 列表 @kiosk', async ({ page, api }) => {
    setupMachine(api, 100, 200, { resume_optimize: 100 })
    api.respond('POST', '/api/v1/member/auth/logout', ok({ loggedOut: true }))

    // A 有一条进行中的打印单，便于 5 秒自动刷新返回 401 触发同 SPA 内存态登出（不整页重载，A 的挂起 Promise 真实留在同一堆里）
    let printCallsA = 0
    await page.route(/\/api\/v1\/me\/print-orders(?:\?.*)?$/, async (route) => {
      const auth = route.request().headers()['authorization'] ?? ''
      if (auth === 'Bearer token-user-A') {
        printCallsA += 1
        if (printCallsA === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                items: [printOrder({ id: 'pt-A-active', status: 'printing', amountCents: 0, paymentSource: 'free', canInvoice: undefined, invoiceStatus: undefined })],
                nextCursor: null,
                total: 1,
              },
            }),
          })
          return
        }
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: '登录已失效' } }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { items: [], nextCursor: null, total: 0 } }),
      })
    })

    let releaseAPage2: (() => void) | null = null
    const aPage2Started = new Promise<void>((resolveStarted) => {
      void page.route(/\/api\/v1\/me\/service-orders(?:\?.*)?$/, async (route) => {
        const req = route.request()
        const auth = req.headers()['authorization'] ?? ''
        const url = new URL(req.url())
        const cursor = url.searchParams.get('cursor')
        if (auth === 'Bearer token-user-A' && !cursor) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                items: [svcOrder({ id: 'svc-A-1', serviceName: 'AI 简历优化', amountCents: 100 })],
                nextCursor: 'cursor-A-1',
                total: 2,
              },
            }),
          })
          return
        }
        if (auth === 'Bearer token-user-A' && cursor === 'cursor-A-1') {
          resolveStarted()
          await new Promise<void>((resolveHold) => { releaseAPage2 = resolveHold })
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                items: [svcOrder({ id: 'svc-A-2-PRIVATE', serviceName: 'AI 模拟面试', amountCents: 300 })],
                nextCursor: null,
                total: 99,
              },
            }),
          })
          return
        }
        if (auth === 'Bearer token-user-B' && !cursor) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                items: [svcOrder({ id: 'svc-B-1', serviceName: '扫描', amountCents: 200 })],
                nextCursor: null,
                total: 1,
              },
            }),
          })
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { items: [], nextCursor: null, total: 0 } }),
        })
      })
    })

    // 首次登录返回用户 A，二次登录返回用户 B
    let loginSeq = 0
    await page.route('**/api/v1/member/auth/login', async (route) => {
      loginSeq += 1
      const isA = loginSeq === 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            token: isA ? 'token-user-A' : 'token-user-B',
            user: isA
              ? { id: 'enduser-A', phoneMasked: '138****0001', nickname: '用户A' }
              : { id: 'enduser-B', phoneMasked: '139****0002', nickname: '用户B' },
          },
        }),
      })
    })

    await loginTo(page, '/me/print-orders')
    await expect(page.getByTestId('service-order-invoice-svc-A-1')).toBeVisible()
    await page.getByRole('button', { name: '加载更多服务单', exact: true }).click()
    await aPage2Started

    // 等待自动刷新收到 401 → AuthProvider 同页清会话并 SPA 跳回 /login（A 的挂起 Promise 仍在同一 JS 堆）
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 12_000 })

    // 换 B 登录，SPA 返回 /me/print-orders
    await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
    await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
    for (const d of '13900139002') await page.getByRole('button', { name: d, exact: true }).click()
    await page.getByRole('button', { name: '收起键盘', exact: true }).click()
    await page.getByRole('button', { name: '获取验证码', exact: true }).click()
    await page.getByRole('button', { name: '短信验证码', exact: true }).click()
    for (const d of '123456') await page.getByRole('button', { name: d, exact: true }).click()
    await page.getByRole('button', { name: '收起键盘', exact: true }).click()
    await page.getByRole('button', { name: '确认登录', exact: true }).click()
    await page.waitForURL((url) => url.pathname === '/me/print-orders', { timeout: 10_000 })

    // B 首页先返回
    await expect(page.getByTestId('service-order-invoice-svc-B-1')).toBeVisible()
    await expect(page.locator('.qxt-band')).toContainText('共 1 条')

    // 释放 A 仍在同一 JS 堆中的晚到分页响应，断言绝不混入 B 列表也不覆盖 total
    releaseAPage2?.()
    await page.waitForTimeout(300)
    await expect(page.getByTestId('member-service-order')).toHaveCount(1)
    await expect(page.getByTestId('service-order-invoice-svc-B-1')).toBeVisible()
    await expect(page.getByTestId('service-order-invoice-svc-A-2-PRIVATE')).toHaveCount(0)
    await expect(page.locator('.qxt-band')).toContainText('共 1 条')
  })
})
