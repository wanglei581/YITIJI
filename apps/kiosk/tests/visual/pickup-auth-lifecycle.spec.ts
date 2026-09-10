import { test, expect } from '../fixtures/kiosk-test'
import { setReactRouterState } from './fixtures/fusion-w2-state'
const realSession = process.env.KIOSK_TEST_REAL_SESSION === '1'

// W2 exercises real page/helper lifecycles with controlled HTTP responses.
// Its fixed E2E terminal token does not prove token rotation.
for (const scenario of ['active', 'leave', 'privacy'] as const) {
  const leave = scenario !== 'active'
  test(`pickup refresh ${scenario} @w2`, async ({ page, api }) => {
    api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
      status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] },
    })
    api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
      status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
    })
    api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
      status: 200, json: { terminalCode: 'KSK-001', capabilities: [] },
    })
    let claims = 0
    let refreshes = 0
    let bootstraps = 0
    if (realSession) {
      await page.route('**/api/v1/terminals/session-token', async route => {
        bootstraps += 1
        await route.fulfill({ json: { sessionToken: 'initial-fixture' } })
      })
    }
    let releaseRefresh!: () => void
    const held = new Promise<void>(resolve => { releaseRefresh = resolve })
    await page.route('**/api/v1/terminals/session-token/refresh', async route => {
      refreshes += 1
      await held
      await route.fulfill({ json: { sessionToken: 'rotated-fixture' } })
    })
    await page.route('**/api/v1/print/jobs/claim-pickup', async route => {
      claims += 1
      expect(route.request().postDataJSON()).toEqual({ code: '12345678' })
      expect(route.request().headers()['x-terminal-id']).toBe('KSK-001')
      expect(route.request().headers()['x-terminal-session-token']).toBe(
        realSession ? (claims === 1 ? 'initial-fixture' : 'rotated-fixture') : 'playwright-terminal-session-fixture',
      )
      await route.fulfill(claims === 1
        ? { status: 401, json: { error: { code: 'TERMINAL_SESSION_INVALID', message: 'Expired fixture' } } }
        : { json: {
          released: false, orderId: 'lifecycle-order', orderNo: 'LIFECYCLE-OLD-ORDER',
          terminalId: 'KSK-001', amountCents: 100, priceLines: [],
          paymentSessionToken: 'lifecycle-payment',
        } })
    })
    try {
      await page.goto(`/print/pickup-claim${realSession ? `?boot_ticket=${'a'.repeat(48)}` : ''}`)
      if (realSession) {
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('terminal_session_token_v1'))).toBe('initial-fixture')
        expect(bootstraps).toBe(1)
      }
      await page.getByLabel('到机码输入框').fill('12345678')
      await expect.poll(() => refreshes).toBe(1)
      if (scenario === 'privacy') {
        await page.evaluate(() => {
          const raf = window.requestAnimationFrame
          const timeout = window.setTimeout
          window.requestAnimationFrame = () => 0
          window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
            delay === 250 ? 0 : timeout(callback, delay, ...args)) as typeof window.setTimeout
          window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
          window.requestAnimationFrame = raf
          window.setTimeout = timeout
        })
        await expect(page.getByTestId('session-guard-state-clearing')).toBeVisible()
        await expect(page.getByLabel('到机码输入框')).toHaveCount(0)
      } else if (leave) {
        await page.getByRole('button', { name: '返回打印扫描', exact: true }).click()
        if (scenario === 'leave') await expect(page).toHaveURL(/\/print-scan$/)
      }
      const refreshed = page.waitForResponse('**/api/v1/terminals/session-token/refresh')
      releaseRefresh()
      await refreshed
      if (leave) {
        // Wait for storage write after response parsing, then browser tasks/rendering.
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('terminal_session_token_v1'))).toBe('rotated-fixture')
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        expect(claims).toBe(1)
        if (scenario === 'leave') await expect(page).toHaveURL(/\/print-scan$/)
        else await expect(page.getByTestId('session-guard-state-clearing')).toBeVisible()
        await expect(page.getByText('LIFECYCLE-OLD-ORDER')).toHaveCount(0)
      } else {
        await expect(page.getByText('LIFECYCLE-OLD-ORDER')).toBeVisible()
        expect(claims).toBe(2)
      }
      expect(refreshes).toBe(1)
    } finally {
      releaseRefresh()
    }
  })
}

for (const scenario of ['active-refresh', 'leave-refresh', 'leave-success', 'privacy-refresh'] as const) {
  const leave = scenario !== 'active-refresh'
  const lateSuccess = scenario === 'leave-success'
  test(`pickup release ${scenario} @w2`, async ({ page, api }) => {
    api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
      status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] },
    })
    api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
      status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
    })
    api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
    api.respond('GET', '/api/v1/orders/lifecycle-order/pay-status', {
      status: 200, json: {
        orderId: 'lifecycle-order', orderNo: 'LIFECYCLE-ORDER', payStatus: 'paid',
        paymentSource: 'wechat', payChannel: 'wechat', amountCents: 100,
        paidAt: '2026-09-10T00:00:00Z', pickupCode: null, attempt: null,
      },
    })
    api.respond('GET', '/api/v1/print/jobs/lifecycle-task', {
      status: 200, json: { taskId: 'lifecycle-task', status: 'pending' },
    })
    let releases = 0
    let refreshes = 0
    let releaseRefresh!: () => void
    const held = new Promise<void>(resolve => { releaseRefresh = resolve })
    await page.route('**/api/v1/terminals/session-token', route =>
      route.fulfill({ json: { sessionToken: 'initial-fixture' } }))
    await page.route('**/api/v1/terminals/session-token/refresh', async route => {
      // A reload with a stored token refreshes before the order release.
      if (releases === 0) {
        await route.fulfill({ json: { sessionToken: 'initial-fixture' } })
        return
      }
      refreshes += 1
      await held
      await route.fulfill({ json: { sessionToken: 'rotated-fixture' } })
    })
    await page.route('**/api/v1/print/jobs/lifecycle-order/release', async route => {
      releases += 1
      const headers = route.request().headers()
      expect(headers['x-terminal-id']).toBe('KSK-001')
      expect(headers['x-payment-session-token']).toBe('lifecycle-payment')
      expect(headers['x-terminal-session-token']).toBe(realSession
        ? (releases === 1 ? 'initial-fixture' : 'rotated-fixture')
        : 'playwright-terminal-session-fixture')
      if (lateSuccess) await held
      await route.fulfill(releases === 1 && !lateSuccess
        ? { status: 401, json: { error: { code: 'TERMINAL_SESSION_INVALID' } } }
        : { json: { taskId: 'lifecycle-task', orderId: 'lifecycle-order', paymentSessionToken: 'lifecycle-payment' } })
    })
    try {
      await page.goto(`/print/cashier${realSession ? `?boot_ticket=${'b'.repeat(48)}` : ''}`)
      if (realSession) {
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('terminal_session_token_v1'))).toBe('initial-fixture')
      }
      await setReactRouterState(page, '/print/cashier', {
        orderId: 'lifecycle-order', orderNo: 'LIFECYCLE-ORDER',
        amountCents: 100, priceLines: [], paymentSessionToken: 'lifecycle-payment',
      })
      await expect.poll(() => lateSuccess ? releases : refreshes).toBe(1)
      if (scenario === 'privacy-refresh') {
        await page.evaluate(() => {
          const raf = window.requestAnimationFrame
          const timeout = window.setTimeout
          window.requestAnimationFrame = () => 0
          window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
            delay === 250 ? 0 : timeout(callback, delay, ...args)) as typeof window.setTimeout
          window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
          window.requestAnimationFrame = raf
          window.setTimeout = timeout
        })
        await expect(page.getByTestId('session-guard-state-clearing')).toBeVisible()
        await expect(page.getByRole('button', { name: '返回我的打印订单', exact: true })).toHaveCount(0)
      } else if (leave) {
        await page.getByRole('button', { name: '返回我的打印订单', exact: true }).click()
        await expect(page).not.toHaveURL(/\/print\/cashier/)
      }
      const response = page.waitForResponse(lateSuccess
        ? '**/api/v1/print/jobs/lifecycle-order/release'
        : '**/api/v1/terminals/session-token/refresh')
      releaseRefresh()
      await response
      if (leave) {
        if (!lateSuccess) {
          await expect.poll(() => page.evaluate(() => sessionStorage.getItem('terminal_session_token_v1'))).toBe('rotated-fixture')
        }
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        expect(releases).toBe(1)
        await expect(page).not.toHaveURL(/\/print\/progress/)
      } else {
        await expect(page).toHaveURL(/\/print\/progress/)
        expect(releases).toBe(2)
      }
      expect(refreshes).toBe(lateSuccess ? 0 : 1)
    } finally {
      releaseRefresh()
    }
  })
}
