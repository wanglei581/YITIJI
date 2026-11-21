/**
 * 付款屏「手机上买过」owned 态（P2d2，照稿 pay-1113.js:609-615）：
 *   1. 登录会员有可用权益进入 /pay/resume、/pay/interview → 展示「这次不用再付 / 手机上买过这一次 / 用这一次」，不出收款码；
 *   2. 点击「用这一次」→ 调 POST /kiosk/service-orders/redeem-credit，写 serviceTrip 并直通下一步；
 *   3. 并发被抢走（409 VPAY_CREDIT_UNAVAILABLE）→ 展示诚实提示并自动切回现场扫码付款；
 *   4. 机器变免费（409 SERVICE_FREE_ON_THIS_TERMINAL）→ 刷新价目并免费直通；
 *   5. 查权益接口故障 → 安静降级回原扫码付款，不阻断；
 *   6. 扫描 /pay/scan 绝不查虚拟支付权益；
 *   7. owned 态点「返回」不消耗权益；
 *   8. miniapp_credit 订单退款态文案如实提示「这次权益已自动退回你的账号，下次还能继续用。」。
 */
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { attachMachinePricing, type MachineServicePrices } from '../fixtures/machine-pricing'
import {
  ORDER_A,
  SERVICE_ORDERS_PATH,
  apiError,
  ok,
  recordServiceOrderCalls,
  serviceOrderClosePath,
  serviceOrderPath,
  serviceOrderView,
} from '../fixtures/service-orders'
import { registerW6Api } from './fixtures/fusion-w6-api'

const TRIP_KEY = 'ai-job-print:service-trip:v1'
const CREDITS_PATH = '/api/v1/member/service-credits'
const REDEEM_PATH = '/api/v1/kiosk/service-orders/redeem-credit'

const payScreen = (page: Page) => page.locator('[data-qx-page="pay-service"]')
const primary = (page: Page) => page.getByTestId('pay-service-primary')

async function expectState(page: Page, state: string): Promise<void> {
  await expect(payScreen(page)).toHaveAttribute('data-qxt-state', state, { timeout: 15_000 })
}

function chargingMachine(api: ApiRouter, services: MachineServicePrices = { resume_optimize: 100, mock_interview: 100, scan: 100 }): void {
  registerW6Api(api)
  attachMachinePricing(api, 0, 0, services)
  api.respond('GET', '/api/v1/me/ai-consents/status', {
    status: 200,
    json: { success: true, data: [{ scope: 'resume_ai', granted: true }] },
  })
  api.respond('GET', '/api/v1/me/print-orders', {
    status: 200,
    json: { success: true, data: { items: [], total: 0 } },
  })
}

async function loginMemberAndGoto(page: Page, targetPath: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(targetPath)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  const expectedPath = targetPath.split('?')[0] ?? targetPath
  await page.waitForURL((url) => url.pathname === expectedPath, { timeout: 15_000 })
}

test.describe('付款屏「手机上买过」owned 态 @kiosk', () => {
  test('简历优化 owned 态照稿展示，点「用这一次」原子核销并直通下一步 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    api.respond('GET', CREDITS_PATH, {
      status: 200,
      json: { items: [{ serviceKind: 'resume_optimize', createdAt: new Date().toISOString() }] },
    })
    const creditOrder = {
      ...ORDER_A,
      id: 'vpcord_owned_resume_1',
      serviceKey: 'resume_optimize' as const,
      amountCents: 0,
      provider: 'wechat' as const,
      createdAt: Date.now(),
    }
    const redeemedView = serviceOrderView(creditOrder, {
      provider: 'miniapp_credit',
      amountCents: 0,
      status: 'paid',
      paidAt: new Date().toISOString(),
      qrCodeContent: null,
    })
    let redeemReqAuth = ''
    let redeemBody: Record<string, unknown> | null = null
    await page.route((url) => url.pathname === REDEEM_PATH, async (route) => {
      redeemReqAuth = route.request().headers()['authorization'] ?? ''
      redeemBody = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok(redeemedView).json),
      })
    })
    const calls = recordServiceOrderCalls(page)

    await loginMemberAndGoto(page, '/pay/resume?next=optimize&back=report')
    await expectState(page, 'owned')

    const screen = payScreen(page)
    await expect(screen).toContainText('这一次 · AI 简历优化')
    await expect(screen).toContainText('这次不用再付')
    await expect(screen).toContainText('手机上买过这一次')
    await expect(page.getByTestId('pay-service-owned-line')).toContainText(
      '这次直接用，屏上不出收款码。点「用这一次」之后，这一趟就开始。',
    )
    await expect(screen).toContainText('付一次管这一趟：这一趟的改写都包含，不再另收费。打印另按页计价。')
    await expect(page.getByTestId('pay-service-qr')).toHaveCount(0)
    await expect(primary(page)).toHaveText('用这一次')
    await expect(page.getByRole('button', { name: '返回', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '问小青：这一次怎么付' })).toBeVisible()
    expect(calls.filter((c) => c.method === 'POST' && c.path === SERVICE_ORDERS_PATH)).toHaveLength(0)

    await primary(page).click()
    await expect(page).toHaveURL(/\/resume\/optimize$/, { timeout: 15_000 })
    expect(redeemReqAuth).toMatch(/^Bearer .+/)
    expect(redeemBody).toMatchObject({ serviceKey: 'resume_optimize' })
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TRIP_KEY)).toContain(creditOrder.id)
  })

  test('模拟面试 owned 态点「返回」不核销不扣权益 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    api.respond('GET', CREDITS_PATH, {
      status: 200,
      json: { items: [{ serviceKind: 'mock_interview', createdAt: new Date().toISOString() }] },
    })
    let redeemCalls = 0
    await page.route((url) => url.pathname === REDEEM_PATH, async (route) => {
      redeemCalls += 1
      await route.fulfill({ status: 500, body: '{}' })
    })

    await loginMemberAndGoto(page, '/pay/interview?next=setup&back=setup')
    await expectState(page, 'owned')
    await expect(payScreen(page)).toContainText('这一次 · AI 模拟面试')
    await expect(payScreen(page)).toContainText('这次不用再付')
    await expect(payScreen(page)).toContainText('付一次管这一趟：这一场练习包含，不再另收费。')
    await expect(primary(page)).toHaveText('用这一次')

    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page).toHaveURL(/\/interview\?stage=setup$/, { timeout: 15_000 })
    expect(redeemCalls).toBe(0)
  })

  test('点「用这一次」权益并发被抢走（409 VPAY_CREDIT_UNAVAILABLE）：诚实提示并切回现场扫码 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    api.respond('GET', CREDITS_PATH, {
      status: 200,
      json: { items: [{ serviceKind: 'resume_optimize', createdAt: new Date().toISOString() }] },
    })
    const cashOrder = { ...ORDER_A, createdAt: Date.now() }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(cashOrder)))
    api.respondWith('GET', serviceOrderPath(cashOrder.id), () => ok(serviceOrderView(cashOrder)))
    api.respondWith('POST', serviceOrderClosePath(cashOrder.id), () =>
      ok(serviceOrderView(cashOrder, { status: 'closed', closeReason: 'user_cancelled' })),
    )
    api.respond('POST', REDEEM_PATH, apiError(409, 'VPAY_CREDIT_UNAVAILABLE', '当前没有可用的小程序权益'))

    await loginMemberAndGoto(page, '/pay/resume?next=optimize&back=report')
    await expectState(page, 'owned')

    await primary(page).click()
    await expectState(page, 'wait')
    await expect(page.getByTestId('pay-service-credit-notice')).toContainText(
      '这张权益刚被用掉或已退回，下面改为现场扫码支付',
    )
    await expect(page.getByTestId('pay-service-qr')).toBeVisible()
  })

  test('点「用这一次」机器刚改为免费（409 SERVICE_FREE_ON_THIS_TERMINAL）：刷新价目并免费直通 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    api.respond('GET', CREDITS_PATH, {
      status: 200,
      json: { items: [{ serviceKind: 'resume_optimize', createdAt: new Date().toISOString() }] },
    })
    api.respond('POST', REDEEM_PATH, apiError(409, 'SERVICE_FREE_ON_THIS_TERMINAL', '这台机器这一项不向个人收费'))

    await loginMemberAndGoto(page, '/pay/resume?next=optimize&back=report')
    await expectState(page, 'owned')

    attachMachinePricing(api, 0, 0, { resume_optimize: 0, mock_interview: 0, scan: 0 })
    await primary(page).click()
    await expect(page).toHaveURL(/\/resume\/optimize$/, { timeout: 15_000 })
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TRIP_KEY)).toBeNull()
  })

  test('查权益接口故障（500）：安静降级回原扫码付款，不阻断用户 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    api.respond('GET', CREDITS_PATH, { status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'boom' } } })
    const cashOrder = { ...ORDER_A, createdAt: Date.now() }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(cashOrder)))
    api.respondWith('GET', serviceOrderPath(cashOrder.id), () => ok(serviceOrderView(cashOrder)))

    await loginMemberAndGoto(page, '/pay/resume?next=optimize&back=report')
    await expectState(page, 'wait')
    await expect(page.getByTestId('pay-service-qr')).toBeVisible()
    await expect(page.getByTestId('pay-service-credit-notice')).toHaveCount(0)
  })

  test('扫描 /pay/scan 绝不查询虚拟支付权益，直接进入扫码付款 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    let creditChecks = 0
    await page.route((url) => url.pathname === CREDITS_PATH, async (route) => {
      creditChecks += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ serviceKind: 'resume_optimize', createdAt: new Date().toISOString() }] }),
      })
    })
    const scanOrder = { ...ORDER_A, id: 'svc_scan_cash_1', serviceKey: 'scan' as const, createdAt: Date.now() }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(scanOrder)))
    api.respondWith('GET', serviceOrderPath(scanOrder.id), () => ok(serviceOrderView(scanOrder)))

    await loginMemberAndGoto(page, '/pay/scan?next=settings&back=how')
    await expectState(page, 'wait')
    expect(creditChecks).toBe(0)
  })

  test('miniapp_credit 服务单退回态文案如实提示退回账号，不误导为银行卡退款 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    api.respond('GET', CREDITS_PATH, { status: 200, json: { items: [] } })
    const creditOrder = { ...ORDER_A, id: 'vpcord_refunded_1', createdAt: Date.now() }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(creditOrder)))
    // 模拟建单后切到已退回的小程序权益单视图（via close returning refunded miniapp_credit view）
    api.respondWith('GET', serviceOrderPath(creditOrder.id), () =>
      ok(serviceOrderView(creditOrder, {
        provider: 'miniapp_credit',
        amountCents: 0,
        status: 'refunded',
        refundReason: '优化稿没做出来',
        refundedAt: new Date().toISOString(),
        qrCodeContent: null,
      })),
    )

    await page.goto('/pay/resume?next=optimize&back=report')
    await expectState(page, 'refund')
    await expect(page.getByTestId('pay-service-line')).toHaveText('这次权益已自动退回你的账号，下次还能继续用。')
    await expect(payScreen(page)).not.toContainText('钱已经退回原付款账户')
  })

  test('同一拍连续双击「用这一次」：同步防重入锁严格只发 1 次 redeem-credit @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    api.respond('GET', CREDITS_PATH, {
      status: 200,
      json: {
        items: [
          { serviceKind: 'resume_optimize', createdAt: new Date().toISOString() },
          { serviceKind: 'resume_optimize', createdAt: new Date().toISOString() },
        ],
      },
    })
    const creditOrder = {
      ...ORDER_A,
      id: 'vpcord_dblclick_1',
      serviceKey: 'resume_optimize' as const,
      amountCents: 0,
      provider: 'wechat' as const,
      createdAt: Date.now(),
    }
    const redeemedView = serviceOrderView(creditOrder, {
      provider: 'miniapp_credit',
      amountCents: 0,
      status: 'paid',
      paidAt: new Date().toISOString(),
      qrCodeContent: null,
    })
    let redeemCalls = 0
    let releaseRedeem!: () => void
    const gate = new Promise<void>((resolve) => { releaseRedeem = resolve })
    let firstArrived!: () => void
    const arrived = new Promise<void>((resolve) => { firstArrived = resolve })
    await page.route((url) => url.pathname === REDEEM_PATH, async (route) => {
      redeemCalls += 1
      if (redeemCalls === 1) firstArrived()
      await gate
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok(redeemedView).json),
      })
    })

    await loginMemberAndGoto(page, '/pay/resume?next=optimize&back=report')
    await expectState(page, 'owned')

    // 模拟同一拍连续两次同步触发点击（在 React 尚未重绘 busy 之前）
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="pay-service-primary"]') as HTMLButtonElement | null
      if (!btn) throw new Error('missing primary button')
      btn.click()
      btn.click()
    })
    await arrived
    await page.waitForTimeout(100)
    releaseRedeem()

    await expect(page).toHaveURL(/\/resume\/optimize$/, { timeout: 15_000 })
    expect(redeemCalls).toBe(1)
  })

  test('核销延迟期间点底栏离开付款页：晚到核销单自动调 /close 退回权益且不留 sessionStorage @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    api.respond('GET', CREDITS_PATH, {
      status: 200,
      json: { items: [{ serviceKind: 'resume_optimize', createdAt: new Date().toISOString() }] },
    })
    const lateOrder = {
      ...ORDER_A,
      id: 'vpcord_late_leave_1',
      serviceKey: 'resume_optimize' as const,
      amountCents: 0,
      provider: 'wechat' as const,
      createdAt: Date.now(),
    }
    const redeemedView = serviceOrderView(lateOrder, {
      provider: 'miniapp_credit',
      amountCents: 0,
      status: 'paid',
      paidAt: new Date().toISOString(),
      qrCodeContent: null,
    })
    let releaseRedeem!: () => void
    const redeemGate = new Promise<void>((resolve) => { releaseRedeem = resolve })
    let redeemArrived!: () => void
    const arrived = new Promise<void>((resolve) => { redeemArrived = resolve })
    await page.route((url) => url.pathname === REDEEM_PATH, async (route) => {
      redeemArrived()
      await redeemGate
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok(redeemedView).json),
      })
    })
    let closeCalls = 0
    await page.route((url) => url.pathname === serviceOrderClosePath(lateOrder.id), async (route) => {
      closeCalls += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok(serviceOrderView(lateOrder, {
          provider: 'miniapp_credit',
          amountCents: 0,
          status: 'refunded',
          refundReason: '用户离开付款页',
          refundedAt: new Date().toISOString(),
          qrCodeContent: null,
        })).json),
      })
    })

    await loginMemberAndGoto(page, '/pay/resume?next=optimize&back=report')
    await expectState(page, 'owned')

    await primary(page).click()
    await arrived
    // 点击底栏「首页」离开付款页
    await page.locator('nav').getByRole('button', { name: '首页' }).click()
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })

    // 此时晚到的核销响应返回：绝不跳转 /resume/optimize，必须自动发 1 次 /close 并保持 sessionStorage 干净
    releaseRedeem()
    await expect.poll(() => closeCalls, { timeout: 10_000 }).toBe(1)
    await expect(page).toHaveURL(/\/$/)
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TRIP_KEY)).toBeNull()
  })

  test('切用户场景：前一位会员延迟返回的权益绝不把后一位无权益会员的页面改成 owned @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    let releaseFirstCredits!: () => void
    const firstCreditsGate = new Promise<void>((resolve) => { releaseFirstCredits = resolve })
    let creditsReqCount = 0
    let firstCreditsArrived!: () => void
    const firstArrived = new Promise<void>((resolve) => { firstCreditsArrived = resolve })
    await page.route((url) => url.pathname === CREDITS_PATH, async (route) => {
      creditsReqCount += 1
      const idx = creditsReqCount
      if (idx === 1) {
        firstCreditsArrived()
        await firstCreditsGate
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [{ serviceKind: 'resume_optimize', createdAt: new Date().toISOString() }] }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      })
    })
    const cashOrder = { ...ORDER_A, id: 'svc_user_b_cash_1', createdAt: Date.now() }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(cashOrder)))
    api.respondWith('GET', serviceOrderPath(cashOrder.id), () => ok(serviceOrderView(cashOrder)))

    // 用户 A 登录进入付款页，其查权益请求被延迟
    await loginMemberAndGoto(page, '/pay/resume?next=optimize&back=report')
    await firstArrived
    // 切换为无权益的游客/另一位用户重新进入付款页
    await page.evaluate(() => {
      window.sessionStorage.clear()
      window.localStorage.clear()
    })
    await page.goto('/pay/resume?next=optimize&back=report')
    await expectState(page, 'wait')

    // 放行用户 A 的延迟权益响应：当前用户绝不能被翻成 owned
    releaseFirstCredits()
    await page.waitForTimeout(300)
    await expectState(page, 'wait')
    await expect(page.getByTestId('pay-service-qr')).toBeVisible()
  })
})
