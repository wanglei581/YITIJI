/**
 * 付款屏（稿 pay-1113.js 的 pay-service，P2e-1）：收费机器上的六态、返回关单、重载找回、清场作废、
 * 管理员关单、按本地时钟超时、轮询限额、两种渠道句、不出现「如需退款请拨打服务电话」。
 *
 * 后端只用 ApiRouter 造 ServiceOrderView 的真实形状；服务端的建单、入账、退款由
 * services/api 的 verify:service-orders 与 verify:service-order-sandbox-simulate 覆盖。
 */
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { attachMachinePricing, KIOSK_CONFIG_PATH, type MachineServicePrices } from '../fixtures/machine-pricing'
import {
  ORDER_A,
  ORDER_B,
  ORDER_WECHAT,
  SERVICE_ORDERS_PATH,
  SERVICE_PAY_TTL_MS,
  apiError,
  ok,
  recordServiceOrderCalls,
  serviceOrderClosePath,
  serviceOrderPath,
  serviceOrderView,
  type FixtureOrder,
} from '../fixtures/service-orders'
import { registerW6Api } from './fixtures/fusion-w6-api'

const TRIP_KEY = 'ai-job-print:service-trip:v1'
const RESUME_TRIP = '付一次管这一趟：这一趟的改写都包含，不再另收费。打印另按页计价。'
const WAIT_BACK = '返回后，万一已经付了，会自动退回原付款账户，到账时间以支付渠道为准。'
const TIMEOUT_FULL = '没收到这一次的钱；万一已经扣了，会自动退回原付款账户，到账时间以支付渠道为准。'

const payScreen = (page: Page) => page.locator('[data-qx-page="pay-service"]')
const primary = (page: Page) => page.getByTestId('pay-service-primary')

async function expectState(page: Page, state: string): Promise<void> {
  await expect(payScreen(page)).toHaveAttribute('data-qxt-state', state, { timeout: 15_000 })
}

/** 收费的机器：个人收费开、用户自付、不是公共点位。三项价按用例给，打印价沿用 W6 夹具不收。 */
function chargingMachine(api: ApiRouter, services: MachineServicePrices = { resume_optimize: 100 }): void {
  registerW6Api(api)
  attachMachinePricing(api, 0, 0, services)
}

/** 收费机器上不许出现打印收银台那句「如需退款，请拨打服务电话」：和「自动退回」不是一个说法。 */
async function expectNoForbiddenCopy(page: Page): Promise<void> {
  const text = await page.locator('body').innerText()
  expect(text).not.toContain('如需退款')
  expect(text).not.toContain('本机不提供自助退款')
  expect(text).not.toContain('微信或支付宝')
  expect(text).not.toContain('¥')
  expect(text).not.toContain('免费试运营')
}

function respondOrder(api: ApiRouter, order: FixtureOrder, view: (n: number) => Record<string, unknown> = () => serviceOrderView(order)): void {
  api.respondWith('GET', serviceOrderPath(order.id), (n) => ok(view(n)))
  api.respondWith('POST', serviceOrderClosePath(order.id), () => ok(serviceOrderView(order, { status: 'closed', closeReason: 'user_cancelled' })))
}

test.describe('付款屏 @kiosk', () => {
  test('等待：进屏即出码，金额、服务名、这一趟、沙箱渠道句、剩余时间照稿 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    const order = { ...ORDER_A, createdAt: Date.now() }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    respondOrder(api, order)
    const calls = recordServiceOrderCalls(page)

    await page.goto('/pay/resume?next=optimize&back=report')
    await expectState(page, 'wait')
    const screen = payScreen(page)
    await expect(screen).toContainText('这一次 · AI 简历优化')
    await expect(screen).toContainText('请完成这一次支付')
    await expect(page.getByTestId('pay-service-channel')).toContainText('测试支付通道 · 非真实收款')
    await expect(page.getByTestId('pay-service-channel')).toContainText(`这一次 1.00 元。${RESUME_TRIP}`)
    await expect(page.getByTestId('pay-service-amount')).toHaveText('1.00 元')
    await expect(page.getByTestId('pay-service-qr')).toContainText('这一次：AI 简历优化 · 1.00 元')
    await expect(page.getByTestId('pay-service-remain')).toContainText(/收款码 5 分钟内有效。还剩 [45]:\d\d。付好了才会开始。/)
    await expect(page.getByTestId('pay-service-remain')).toContainText(WAIT_BACK)
    await expect(page.getByTestId('pay-service-qr-code').locator('svg')).toBeVisible()
    await expect(primary(page)).toHaveText('刷新付款结果')
    await expect(page.getByRole('button', { name: '不付了，返回' })).toBeVisible()
    await expectNoForbiddenCopy(page)

    const creates = calls.filter((call) => call.method === 'POST' && call.path === SERVICE_ORDERS_PATH)
    expect(creates).toHaveLength(1)
    expect(creates[0]?.body).toMatchObject({ serviceKey: 'resume_optimize' })
    expect(String(creates[0]?.body?.kioskSessionId ?? '')).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('渠道照实写：微信单写「请用微信扫这张码」，面试 TRIP 句照稿 @kiosk', async ({ page, api }) => {
    chargingMachine(api, { mock_interview: 50 })
    const order = { ...ORDER_WECHAT, createdAt: Date.now() }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    respondOrder(api, order)
    const calls = recordServiceOrderCalls(page)

    await page.goto('/pay/interview')
    await expectState(page, 'wait')
    await expect(page.getByTestId('pay-service-channel')).toContainText('请用微信扫这张码')
    await expect(page.getByTestId('pay-service-channel')).toContainText('这一次 0.50 元。付一次管这一趟：这一场练习包含，不再另收费。')
    await expect(page.getByTestId('pay-service-channel')).not.toContainText('测试支付通道')
    await expect(payScreen(page)).toContainText('这一次 · AI 模拟面试')
    await expectNoForbiddenCopy(page)
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({ serviceKey: 'mock_interview' })
  })

  test('核实中：点「刷新付款结果」带 refresh=1，渠道没确认到账时写核实句 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    const order = { ...ORDER_A, createdAt: Date.now() }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    respondOrder(api, order)
    await page.route((url) => url.pathname === serviceOrderPath(order.id) && url.searchParams.get('refresh') === '1', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ok(serviceOrderView(order, { checking: true })).json) }))
    const calls = recordServiceOrderCalls(page)

    await page.goto('/pay/resume')
    await expectState(page, 'wait')
    await expect(page.getByTestId('pay-service-checking')).toHaveCount(0)
    // 刚建的单离上一次核实不到 10 秒：先等够，再点。
    await page.waitForTimeout(10_200)
    await primary(page).click()
    await expectState(page, 'check')
    await expect(page.getByTestId('pay-service-checking')).toHaveText('正在向支付渠道核实这一次的结果。这一次还没有确认到账。')
    expect(calls.some((call) => call.method === 'GET' && call.refresh)).toBe(true)
    await expectNoForbiddenCopy(page)
  })

  test('付好了：写「付好了，马上开始」，停一会儿自动去下一步，不关单 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    const order = { ...ORDER_A, createdAt: Date.now() }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    respondOrder(api, order, () => serviceOrderView(order, { status: 'paid', paidAt: new Date().toISOString() }))
    const calls = recordServiceOrderCalls(page)

    await page.goto('/pay/resume?next=optimize')
    await expectState(page, 'ok')
    await expect(payScreen(page)).toContainText('付好了，马上开始')
    await expect(payScreen(page)).toContainText('这一次已经付好')
    await expect(payScreen(page)).toContainText(RESUME_TRIP)
    await expect(payScreen(page)).toContainText('要是没生成出来，可以免费再试一次；不试了或再不成，钱自动退回原付款账户，到账时间以支付渠道为准。')
    await expect(primary(page)).toHaveText('马上开始')
    await expectNoForbiddenCopy(page)
    await expect(page).toHaveURL(/\/resume\/optimize$/, { timeout: 10_000 })
    expect(calls.filter((call) => call.path === serviceOrderClosePath(order.id))).toHaveLength(0)
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TRIP_KEY)).toContain(order.id)
  })

  test('没付成：渠道说失败写「钱没有扣」，再出一张码先关旧单再建新单 @kiosk', async ({ page, api }) => {
    chargingMachine(api, { resume_optimize: 200 })
    const first = { ...ORDER_A, createdAt: Date.now() }
    const second = { ...ORDER_B, createdAt: Date.now() + 1_000 }
    api.respondWith('POST', SERVICE_ORDERS_PATH, (n) => ok(serviceOrderView(n === 1 ? first : second)))
    respondOrder(api, first, () => serviceOrderView(first, { paymentFailed: true }))
    respondOrder(api, second)
    const calls = recordServiceOrderCalls(page)

    await page.goto('/pay/resume')
    await expectState(page, 'fail')
    await expect(payScreen(page)).toContainText('这次没付成')
    await expect(payScreen(page)).toContainText('没付成，钱没有扣')
    await expect(page.getByTestId('pay-service-line')).toHaveText('钱没有扣。没付成就不会开始 AI 简历优化。可以再出一张码，或返回。返回之后这一次还没开始。')
    await expect(primary(page)).toHaveText('再出一张码')
    await expectNoForbiddenCopy(page)

    await primary(page).click()
    await expectState(page, 'wait')
    await expect(page.getByTestId('pay-service-amount')).toHaveText('2.00 元')
    const order = calls.map((call) => `${call.method} ${call.path}`)
    const closeAt = order.indexOf(`POST ${serviceOrderClosePath(first.id)}`)
    const secondCreateAt = order.lastIndexOf(`POST ${SERVICE_ORDERS_PATH}`)
    expect(closeAt).toBeGreaterThan(-1)
    expect(secondCreateAt).toBeGreaterThan(closeAt)
    expect(calls.filter((call) => call.method === 'POST' && call.path === SERVICE_ORDERS_PATH)).toHaveLength(2)
  })

  for (const closeReason of ['price_changed', 'personal_charge_changed', 'org_rebound']) {
    test(`管理员关单（${closeReason}）归入没付成 @kiosk`, async ({ page, api }) => {
      chargingMachine(api)
      const order = { ...ORDER_A, createdAt: Date.now() }
      api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
      respondOrder(api, order, (n) => (n <= 1 ? serviceOrderView(order) : serviceOrderView(order, { status: 'closed', closeReason })))

      await page.goto('/pay/resume')
      await expectState(page, 'wait')
      await expectState(page, 'fail')
      await expect(payScreen(page)).toContainText('没付成，钱没有扣')
      await expect(page.getByTestId('pay-service-line')).toContainText('钱没有扣。没付成就不会开始 AI 简历优化。')
      await expectNoForbiddenCopy(page)
    })
  }

  test('超时按本地时钟：服务端还没关单，过了 expiresAt 屏上就是超时 @kiosk', async ({ page, api }) => {
    const start = new Date('2026-11-19T14:20:00+08:00').getTime()
    await page.clock.install({ time: start })
    chargingMachine(api)
    const order = { ...ORDER_A, createdAt: start }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    // 服务端清扫最多晚 30 秒才关单：这里一直回待付，页面不能跟着多等。
    respondOrder(api, order)

    await page.goto('/pay/resume')
    await expectState(page, 'wait')
    // 人还在屏前：第 4 分钟点一次「刷新付款结果」。不点的话 5 分钟没碰屏，隐私硬截止会先把这一位清场。
    await page.clock.runFor(4 * 60_000)
    await primary(page).click()
    await page.clock.runFor(SERVICE_PAY_TTL_MS - 4 * 60_000 + 2_000)
    await expectState(page, 'timeout')
    await expect(payScreen(page)).toContainText('等了 5 分钟，这一次没有付成')
    await expect(payScreen(page)).toContainText('没收到这一次的钱')
    await expect(page.getByTestId('pay-service-line')).toHaveText(`${TIMEOUT_FULL}可以再出一张码，或返回。`)
    await expect(primary(page)).toHaveText('再出一张码')
    await expectNoForbiddenCopy(page)
  })

  test('免费直通：本机这一项 0 元时不建单，直接去合法站内下一步而不是退回 report @kiosk', async ({ page, api }) => {
    chargingMachine(api, { resume_optimize: 0, mock_interview: 200 })
    const calls = recordServiceOrderCalls(page)

    await page.goto('/pay/resume?next=optimize&back=report')
    await expect(page).toHaveURL(/\/resume\/optimize$/, { timeout: 15_000 })
    expect(calls).toHaveLength(0)

    // 公共就业点位即使价目表非 0 也直接去合法站内下一步；非法 next 回落到白名单默认下一步。
    api.mapJson('GET', KIOSK_CONFIG_PATH, (json) => {
      const base = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
      const pricing = base.pricing && typeof base.pricing === 'object' ? (base.pricing as Record<string, unknown>) : {}
      return { ...base, pricing: { ...pricing, isPublicSite: true, effective: { resume_optimize: 100 } } }
    })
    await page.goto('/pay/resume?next=https://evil.test&back=report')
    await expect(page).toHaveURL(/\/resume\/optimize$/, { timeout: 15_000 })
    expect(calls).toHaveLength(0)
  })

  test('免费兜底：建单回 409 这项现在免费，刷新本机价目后直接去下一步 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    api.respond('POST', SERVICE_ORDERS_PATH, apiError(409, 'SERVICE_FREE_ON_THIS_TERMINAL', '这台机器这一项不向个人收费'))
    const configReadsBefore = api.requestCount('GET', KIOSK_CONFIG_PATH)

    await page.goto('/pay/resume?next=optimize')
    await expect(page).toHaveURL(/\/resume\/optimize$/, { timeout: 15_000 })
    expect(api.requestCount('GET', KIOSK_CONFIG_PATH) - configReadsBefore).toBeGreaterThanOrEqual(2)
  })

  test('返回即关单：不付了，返回先关掉待付单，再回到来的那一页 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    const order = { ...ORDER_A, createdAt: Date.now() }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    respondOrder(api, order)
    const calls = recordServiceOrderCalls(page)

    await page.goto('/pay/resume?back=report')
    await expectState(page, 'wait')
    const sessionId = String(calls.find((call) => call.method === 'POST')?.body?.kioskSessionId)
    await page.getByRole('button', { name: '不付了，返回' }).click()
    await expect(page).toHaveURL(/\/resume\/report$/)
    const closes = calls.filter((call) => call.method === 'POST' && call.path === serviceOrderClosePath(order.id))
    expect(closes).toHaveLength(1)
    expect(closes[0]?.sessionHeader).toBe(sessionId)
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TRIP_KEY)).toBeNull()
  })

  test('重载找回同一单：不再建单，用建单时的会话号查同一张 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    const order = { ...ORDER_A, createdAt: Date.now() }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    respondOrder(api, order)
    const calls = recordServiceOrderCalls(page)

    await page.goto('/pay/resume')
    await expectState(page, 'wait')
    const sessionId = String(calls.find((call) => call.method === 'POST')?.body?.kioskSessionId)
    const before = calls.length
    await page.reload()
    await expectState(page, 'wait')
    await expect(page.getByTestId('pay-service-amount')).toHaveText('1.00 元')
    const after = calls.slice(before)
    expect(after.filter((call) => call.method === 'POST' && call.path === SERVICE_ORDERS_PATH)).toHaveLength(0)
    const reads = after.filter((call) => call.method === 'GET' && call.path === serviceOrderPath(order.id))
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every((call) => call.sessionHeader === sessionId)).toBe(true)
  })

  test('清场后旧单号作废：闲置到点清场后再进付款屏，建新单，不再碰旧单 @kiosk', async ({ page, api }) => {
    await page.clock.install({ time: new Date('2026-11-19T14:30:00+08:00').getTime() })
    chargingMachine(api, { resume_optimize: 200 })
    const now = await page.evaluate(() => Date.now())
    const first = { ...ORDER_A, createdAt: now }
    const second = { ...ORDER_B, createdAt: now + 200_000 }
    api.respondWith('POST', SERVICE_ORDERS_PATH, (n) => ok(serviceOrderView(n === 1 ? first : second)))
    let cleared = false
    // 清场前：渠道说没付成（不占忙碌锁，闲置计时照走）。清场后这张旧单若还被查，就回成待付，好让「找回旧单」的错一眼看出来。
    respondOrder(api, first, () => serviceOrderView(first, cleared ? {} : { paymentFailed: true }))
    respondOrder(api, second)
    const calls = recordServiceOrderCalls(page)

    await page.goto('/pay/resume')
    await expectState(page, 'fail')
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TRIP_KEY)).toContain(first.id)

    await page.clock.runFor(185_000)
    // 清场先挂遮罩，再隔一帧（或兜底定时器）重载成干净首页：等它整个走完再往下。
    await page.waitForTimeout(800)
    await page.waitForLoadState('load')
    await expect(page.getByTestId('session-guard-state-clearing')).toHaveCount(0)
    await page.waitForLoadState('load')
    await expect(page).toHaveURL((url) => url.pathname === '/', { timeout: 15_000 })
    await expect(page.getByTestId('qx-home')).toBeVisible({ timeout: 15_000 })
    cleared = true
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TRIP_KEY)).toBeNull()
    const mark = calls.length

    // 清场立了隐私边界：地址栏直接打开的旧历史项会被当成边界之前的条目送回首页，
    // 所以用站内跳转（idx 在边界之后）去付款屏，和下一位在机器上点过去是同一条路。
    await page.evaluate(() => {
      const current = window.history.state as { idx?: number } | null
      const idx = typeof current?.idx === 'number' ? current.idx + 1 : 1
      window.history.pushState({ usr: null, key: 'pay-after-clear', idx }, '', '/pay/resume')
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    })
    await page.waitForURL((url) => url.pathname === '/pay/resume')
    await expectState(page, 'wait')
    await expect(page.getByTestId('pay-service-amount')).toHaveText('2.00 元')
    const after = calls.slice(mark)
    expect(after.filter((call) => call.path.startsWith(serviceOrderPath(first.id)))).toEqual([])
    expect(after.filter((call) => call.method === 'POST' && call.path === SERVICE_ORDERS_PATH)).toHaveLength(1)
  })

  test('轮询限额：一分钟里连点刷新，查单总数也不超过 30 次，核实间隔不少于 10 秒 @kiosk', async ({ page, api }) => {
    await page.clock.install({ time: new Date('2026-11-19T14:40:00+08:00').getTime() })
    chargingMachine(api)
    const now = await page.evaluate(() => Date.now())
    const order = { ...ORDER_A, createdAt: now }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    respondOrder(api, order)
    const calls = recordServiceOrderCalls(page)

    await page.goto('/pay/resume')
    await expectState(page, 'wait')
    // 停住页面时钟：页面时间只随 runFor 走，下面 29 步正好 58 秒，全落在同一分钟里。
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500)
    const mark = calls.length
    for (let step = 0; step < 29; step += 1) {
      for (let tap = 0; tap < 3; tap += 1) {
        await primary(page).click()
        await page.waitForTimeout(25)
      }
      await page.clock.runFor(2_000)
      await page.waitForTimeout(40)
    }
    const reads = calls.slice(mark).filter((call) => call.method === 'GET')
    expect(reads.length).toBeGreaterThan(10)
    expect(reads.length).toBeLessThanOrEqual(30)
    // 核实（refresh=1）间隔不少于 10 秒：58 秒里最多 6 次。
    expect(reads.filter((call) => call.refresh).length).toBeLessThanOrEqual(6)
  })

  test('会话还没落库：稍等再建一次，再不成给标准句，不循环 @kiosk', async ({ page, api }) => {
    chargingMachine(api)
    api.respond('POST', SERVICE_ORDERS_PATH, apiError(400, 'SERVICE_SESSION_REQUIRED', '请先开始这一次使用'))
    const calls = recordServiceOrderCalls(page)

    await page.goto('/pay/resume')
    await expectState(page, 'error')
    await expect(payScreen(page)).toContainText('这一次暂时出不了付款码')
    await expect(payScreen(page)).toContainText('没有出码，钱没有扣')
    await expect(page.getByTestId('pay-service-line')).toHaveText('这一次暂时出不了付款码。需要帮助？拨打服务电话 18369161921（工作日 9:00–18:00）。')
    await page.waitForTimeout(4_000)
    expect(calls.filter((call) => call.method === 'POST' && call.path === SERVICE_ORDERS_PATH)).toHaveLength(2)
    await expectNoForbiddenCopy(page)
  })
})
