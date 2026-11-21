// 付款屏（稿 pay-1113.js 的 pay-service）并排：等待、核实、付好了、没付成、超时、免费兜底、手机上买过（简历/面试）。
// 稿上的 1.00 元是演示价；运行页这台机器也设成 1.00 元，金额对得上。渠道用微信（正式通道），
// 运行页照实写「请用微信扫这张码」，与稿里两家渠道并列那句的差别是裁决定的。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import { machinePricing } from '../../fixtures/machine-pricing'
import {
  ORDER_A,
  SERVICE_ORDERS_PATH,
  SERVICE_PAY_TTL_MS,
  ok,
  serviceOrderClosePath,
  serviceOrderPath,
  serviceOrderView,
} from '../../fixtures/service-orders'
import { loginTo, registerTouchShell, see } from './touch-pair-shell'
import type { TouchPair } from './touch-pair-types'

type PayPairState = 'wait' | 'check' | 'ok' | 'fail' | 'timeout' | 'free'

async function openOwnedPay(
  page: Page,
  api: ApiRouter,
  what: 'resume' | 'interview',
): Promise<void> {
  const serviceKind = what === 'resume' ? 'resume_optimize' : 'mock_interview'
  const route = what === 'resume' ? '/pay/resume' : '/pay/interview'
  registerTouchShell(api, undefined, machinePricing(0, 0, { resume_optimize: 100, mock_interview: 100 }))
  api.respond('GET', '/api/v1/member/service-credits', {
    status: 200,
    json: { items: [{ serviceKind, createdAt: '2026-11-21T08:00:00.000Z' }] },
  })
  await loginTo(page, api, route)
  await see(page, '[data-qx-page="pay-service"][data-qxt-state="owned"]')
}

async function openPay(page: Page, api: ApiRouter, state: PayPairState): Promise<void> {
  registerTouchShell(api, undefined, machinePricing(0, 0, { resume_optimize: state === 'free' ? 0 : 100 }))
  await page.clock.install()
  const order = { ...ORDER_A, provider: 'wechat' as const, createdAt: Date.now() }
  const later = state === 'check' ? { checking: true }
    : state === 'ok' ? { status: 'paid', paidAt: new Date().toISOString() }
      : state === 'fail' ? { paymentFailed: true }
        : {}
  api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
  // 第一次查单还是待付，之后才是这一态要的样子：和真机上「先出码、再看到结果」同一个顺序。
  api.respondWith('GET', serviceOrderPath(order.id), (n) => ok(serviceOrderView(order, n <= 1 ? {} : later)))
  api.respondWith('POST', serviceOrderClosePath(order.id), () => ok(serviceOrderView(order, { status: 'closed', closeReason: 'user_cancelled' })))
  await page.goto('/pay/resume?next=optimize&back=report', { waitUntil: 'domcontentloaded' })
  if (state === 'free') {
    await see(page, '[data-qx-page="pay-service"][data-qxt-state="free"]')
    return
  }
  await see(page, '[data-qx-page="pay-service"][data-qxt-state="wait"]')
  if (state === 'timeout') {
    // 人还在屏前（第 4 分钟点过一次刷新），过了 expiresAt 就是超时。
    await page.clock.runFor(4 * 60_000)
    await page.getByTestId('pay-service-primary').click()
    await page.clock.runFor(SERVICE_PAY_TTL_MS - 4 * 60_000 + 2_000)
  } else if (state !== 'wait') {
    await page.clock.runFor(7_000)
  }
  await see(page, `[data-qx-page="pay-service"][data-qxt-state="${state}"]`)
  // 付好了会停 1.6 秒自动去下一步：拍照前把页面时钟停住。
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100)
}

export function payPairs(): TouchPair[] {
  const base = { what: 'resume' }
  const pair = (state: PayPairState, query: Record<string, string>): TouchPair => ({
    item: '付款',
    screen: 'pay-service',
    state,
    route: '/pay/resume',
    seeds: ['machinePricing resume_optimize 100（免费兜底为 0）', 'kiosk/service-orders 微信单 1.00 元'],
    missingReason: null,
    proto: { query: { fee: '1', ...base, ...query } },
    prepare: (page, api) => openPay(page, api, state),
    ready: `[data-qx-page="pay-service"][data-qxt-state="${state}"]`,
  })
  const ownedPair = (what: 'resume' | 'interview'): TouchPair => ({
    item: '付款',
    screen: 'pay-service',
    state: `owned-${what}`,
    route: what === 'resume' ? '/pay/resume' : '/pay/interview',
    seeds: [`已登录会员持有 ${what === 'resume' ? 'resume_optimize' : 'mock_interview'} 可用权益`, '本机收费 1.00 元'],
    missingReason: null,
    proto: { query: { fee: '1', what, py: 'owned' } },
    prepare: (page, api) => openOwnedPay(page, api, what),
    ready: '[data-qx-page="pay-service"][data-qxt-state="owned"]',
  })
  return [
    pair('wait', { py: 'wait' }),
    pair('check', { py: 'wait', pyCheck: '1' }),
    pair('ok', { py: 'ok' }),
    pair('fail', { py: 'fail' }),
    pair('timeout', { py: 'timeout' }),
    pair('free', { pyzero: 'resume' }),
    ownedPair('resume'),
    ownedPair('interview'),
  ]
}
