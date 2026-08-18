// ============================================================
// print-cashier-amount-truth — 收银台金额文案必须与「这笔钱会不会真被扣走」一致
//
// 起因（2026-08-18）：PrintCashierPage 的应付金额卡下面挂着一句常驻小字
// 「示例金额 · 以现场公示价为准」，而它正上方那个数是 formatCents(amountCents) ——
// amountCents 来自路由 state 里**服务端已建订单**的金额（确认页建单 / 继续上次 /
// 到机码核验，三个入口都是真单），且本页在 API_MODE !== 'http' 时直接进 GuardScreen，
// 没有任何演示 / mock 路径能走到这张卡。出码时服务端按 Order.amountCents 快照收款
// （online-payment.service：「金额快照自服务端订单，绝不信任前端」），回调金额与订单
// 不符即判失败；确认页那侧也已明说「实付以收银台为准」。
// 于是用户在真正要付的钱旁边被告知这只是「示例」，且被指向另一个价 —— 与 #711
// 同类（写死文案与旁边的真实数据互相打架），方向相反：那次显示错，这次免责声明错。
// 违反 CLAUDE.md §9「不伪造能力 / 页面不得陈述与实际不符的结论」。
//
// 门禁形态（刻意不锁「源码里必须出现某句话」）：
//   - 用真实组件在真实浏览器里渲染收银台，订单金额从路由 state 进、支付尝试金额从
//     POST /orders/:id/pay **观测**得到，所以「这台机器要收多少钱」是看出来的不是假设的；
//   - 断言页面展示的金额 === 该通道将要收取的金额，且这个数**在页面上任何位置**
//     都不得被称作示例 / 样例 / 仅供参考；
//   - 反向锁「非真实收款」这句话的条件性：只有 sandbox 测试支付通道才允许出现
//     「不会真实扣款」类措辞，真实通道（wechat/alipay）下不得出现。
// 锁字面量的门禁一旦被重构就会被顺手改掉；这里锁的是「文案 ↔ 是否真扣款」这个对应关系。
// ============================================================

import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { setReactRouterState, W2_FILE, W2_ORDER, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'

const NOW = '2026-08-18T00:00:00.000Z'
const LATER = '2099-08-18T00:10:00.000Z'

/** 「这个数只是个样子」类措辞 —— 真实订单金额旁边一律不许出现。 */
const SAMPLE_CLAIM = /示例|样例|仅供参考|参考金额|模拟金额/
/** 「按别的价收」类免责 —— 金额已随订单锁定后，指向另一个价就是假话。 */
const SUPERSEDED_CLAIM = /以.{0,12}(?:公示价|价目|价格).{0,6}为准/
/** 「不会真扣钱」类措辞 —— 只有 sandbox 测试通道才成立。 */
const NO_REAL_CHARGE_CLAIM = /不会真实扣款|非真实收款|不真实扣款/

const cashierState = {
  file: W2_FILE,
  params: W2_PRINT_PARAMS,
  source: 'document',
  ...W2_ORDER,
  priceLines: [
    { serviceKey: 'print_bw_page', description: '黑白打印', unitCents: 100, quantity: 2, subtotalCents: 200 },
  ],
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

function registerUnpaidOrder(api: ApiRouter, channel: string): void {
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: [channel] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, {
    status: 200,
    json: {
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      payStatus: 'unpaid',
      paymentSource: null,
      payChannel: null,
      amountCents: W2_ORDER.amountCents,
      paidAt: null,
      pickupCode: null,
      attempt: null,
    },
  })
}

/**
 * POST /orders/:id/pay 的桩：**回该通道实际将要收取的金额**（服务端行为是从
 * Order.amountCents 快照），并记录下来。这样「这笔支付要收多少」是观测值。
 */
async function routePayAttempt(page: Page, channel: string, seen: { chargeCents?: number }): Promise<void> {
  await page.route(`**/api/v1/orders/${W2_ORDER.orderId}/pay`, async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    const chargeCents = W2_ORDER.amountCents
    seen.chargeCents = chargeCents
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        attemptId: `truth-attempt-${channel}`,
        orderId: W2_ORDER.orderId,
        orderNo: W2_ORDER.orderNo,
        channel,
        amountCents: chargeCents,
        status: 'pending',
        qrCodeContent: `${channel}://truth-synthetic-qr`,
        expiresAt: LATER,
        orderPayStatus: 'paying',
        orderExpiresAt: LATER,
        createdAt: NOW,
      }),
    })
  })
}

const yuan = (cents: number): string => `¥${(cents / 100).toFixed(2)}`

const cashierPage = (page: Page) => page.locator('[data-w2-page="print-cashier"]')
const amountValue = (page: Page) => page.locator('[data-cashier-amount]')
const amountNote = (page: Page) => page.locator('[data-cashier-amount-note]')

async function openCashier(page: Page): Promise<void> {
  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', cashierState)
  await expect(cashierPage(page)).toBeVisible()
}

for (const scenario of [
  // 真实通道，用户还没选支付方式：金额卡先于任何支付尝试渲染，谎话在这里就已经挂上了。
  { name: 'real channel before any attempt', channel: 'wechat', issue: false },
  // 真实通道 + 已出屏上收款码：这就是用户真的举着手机要扫的那一刻。
  { name: 'real channel with an issued QR', channel: 'wechat', issue: true },
] as const) {
  test(`cashier never labels a real order amount as a sample (${scenario.name}) @kiosk`, async ({ page, api }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    registerShell(api)
    registerUnpaidOrder(api, scenario.channel)
    const seen: { chargeCents?: number } = {}
    await routePayAttempt(page, scenario.channel, seen)

    await openCashier(page)
    if (scenario.issue) {
      await page.getByRole('button', { name: '屏上收款码' }).click()
      await expect(page.getByText('请扫码支付', { exact: true })).toBeVisible()
      // ① 该通道实际将要收取的金额（观测值，来自出码响应）。
      expect(seen.chargeCents).toBe(W2_ORDER.amountCents)
    }

    // ② 核心断言：页面上确实出现了这个真实金额，且它在页面任何位置都不得被称作
    //    示例 / 样例 / 仅供参考。**刻意不依赖下面那些 data- 钩子** —— 钩子被重构掉时
    //    这条仍然成立，常驻写死那句话时它必红：用户正要为这个数付钱。
    const visibleText = await cashierPage(page).innerText()
    expect(visibleText).toMatch(yuan(W2_ORDER.amountCents))
    expect(visibleText).not.toMatch(SAMPLE_CLAIM)

    // ③ 展示的金额 === 订单金额（= 出码时被快照去收的那个数）。
    await expect(amountValue(page)).toHaveText(yuan(W2_ORDER.amountCents))

    // ④ 金额已随订单锁定，不得再把用户指向「另一个价」。
    await expect(amountNote(page)).not.toHaveText(SUPERSEDED_CLAIM)
    // ⑤ 正向：必须说明这是本单实付。
    await expect(amountNote(page)).toContainText('实付')
    await expect(amountNote(page)).toHaveAttribute('data-cashier-amount-note', 'real')

    // ⑥ 真实通道下不得出现「不会真实扣款」—— 那句话只属于 sandbox。
    expect(visibleText).not.toMatch(NO_REAL_CHARGE_CLAIM)

    expect(pageErrors).toEqual([])
  })
}

test('cashier discloses that the sandbox test channel takes no real money @kiosk', async ({ page, api }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  registerShell(api)
  registerUnpaidOrder(api, 'sandbox')
  const seen: { chargeCents?: number } = {}
  await routePayAttempt(page, 'sandbox', seen)

  await openCashier(page)
  await page.getByRole('button', { name: '屏上收款码' }).click()
  await expect(page.getByText('请扫码支付', { exact: true })).toBeVisible()

  // 即便在 sandbox，这个数也不是「示例金额」——sandbox 只是不真收款，不是「金额是编的」。
  const visibleText = await cashierPage(page).innerText()
  expect(visibleText).not.toMatch(SAMPLE_CLAIM)

  // 金额本身仍是订单真金额。
  expect(seen.chargeCents).toBe(W2_ORDER.amountCents)
  await expect(amountValue(page)).toHaveText(yuan(W2_ORDER.amountCents))

  // 「不会真实扣款」这句话必须**在这条路径上出现**，证明它是条件性的而不是常驻。
  await expect(amountNote(page)).toHaveAttribute('data-cashier-amount-note', 'sandbox')
  await expect(amountNote(page)).toHaveText(NO_REAL_CHARGE_CLAIM)

  expect(pageErrors).toEqual([])
})
