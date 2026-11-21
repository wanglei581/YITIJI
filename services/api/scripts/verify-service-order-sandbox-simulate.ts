/**
 * 服务单沙箱「模拟付成 / 付失败」（POST /api/v1/payment/sandbox/simulate-service-order）。
 * 临时 SQLite，真实 Nest HTTP，与 verify:service-orders 共用夹具。断言按规矩写，不按实现迁就：
 *   · 生产环境 404（连乱写的请求体也是 404，不暴露这条路由在不在）；
 *   · 只认沙箱通道：注册表里没有沙箱、或这张单不是沙箱单，都拒绝，单原样不动；
 *   · 付成后单变 paid，付失败后 paymentFailed 且仍是 pending、钱没记；
 *   · 重复调用幂等：同一张单再模拟付成，不重复记账、不换流水号、审计只记一次；
 *   · 报文按库内数据造、走真回调的验签入账：调用方传不了金额。
 */
/**
 * 密钥必须写在任何 import 之前。swc 会把 import 提前。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-service-orders-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-service-orders-terminal-action-secret-0123456789'
process.env['ADMIN_IP_ALLOWLIST'] = ''
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['NODE_ENV'] = 'test'
process.env['PAYMENT_PROVIDER'] = 'sandbox'
process.env['SANDBOX_PAYMENT_SECRET'] = 'verify-service-orders-sandbox-secret'
process.env['JWT_SECRET'] = 'verify-service-orders-jwt-secret-0123456789'

import assert from 'node:assert/strict'
import { newProviderOrderNo } from '../src/payment/service-order.payment'
import {
  DEMO_PRICES,
  TERM_CHARGE,
  pass,
  withServiceOrderFixture,
  type ServiceOrderFixture,
} from './support/service-order-verify-fixture'

const SIMULATE = '/api/v1/payment/sandbox/simulate-service-order'

async function createOrder(fx: ServiceOrderFixture, serviceKey: 'resume_optimize' | 'mock_interview' | 'scan'): Promise<string> {
  const made = await fx.call('POST', '/api/v1/kiosk/service-orders', { serviceKey, kioskSessionId: fx.chargeSession }, fx.termHeaders(TERM_CHARGE, fx.chargeToken))
  fx.expectStatus(made, 200, `建单 ${serviceKey}`)
  assert.equal(made.json.data?.['provider'], 'sandbox', '夹具只配了沙箱通道')
  return String(made.json.data?.['id'])
}

async function readOrder(fx: ServiceOrderFixture, id: string): Promise<Record<string, unknown>> {
  const got = await fx.call('GET', `/api/v1/kiosk/service-orders/${id}`, undefined, fx.termHeaders(TERM_CHARGE, fx.chargeToken, fx.chargeSession))
  fx.expectStatus(got, 200, `查单 ${id}`)
  return got.json.data ?? {}
}

async function withNodeEnv<T>(value: string, run: () => Promise<T>): Promise<T> {
  const before = process.env['NODE_ENV']
  process.env['NODE_ENV'] = value
  try {
    return await run()
  } finally {
    process.env['NODE_ENV'] = before
  }
}

async function cases(fx: ServiceOrderFixture): Promise<void> {
  // ── 生产环境：这条路由不存在 ──────────────────────────────────────
  const prodOrder = await createOrder(fx, 'resume_optimize')
  const prod = await withNodeEnv('production', () => fx.call('POST', SIMULATE, { serviceOrderId: prodOrder, result: 'success' }))
  fx.expectStatus(prod, 404, '生产环境模拟付成')
  const prodJunk = await withNodeEnv('production', () => fx.call('POST', SIMULATE, { nope: 1 }))
  fx.expectStatus(prodJunk, 404, '生产环境乱写请求体')
  assert.equal((await fx.loadOrder(prodOrder)).status, 'pending', '生产环境的模拟不能改单')
  pass('生产环境 404，单不动')

  // ── 只认沙箱通道 ──────────────────────────────────────────────────
  const wechatRow = await fx.prisma.serviceOrder.create({
    data: {
      terminalId: TERM_CHARGE,
      serviceKey: 'resume_optimize',
      amountCents: DEMO_PRICES.resume_optimize,
      status: 'pending',
      kioskSessionId: fx.chargeSession,
      provider: 'wechat',
      providerOrderNo: newProviderOrderNo(),
      prepayId: 'wx-prepay-verify-0001',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  })
  const wechat = await fx.call('POST', SIMULATE, { serviceOrderId: wechatRow.id, result: 'success' })
  fx.expectStatus(wechat, 400, '微信单不能模拟付成')
  assert.equal(
    wechat.json.error?.code,
    'SANDBOX_ONLY',
    '微信单必须由上游 provider 校验明确返回 SANDBOX_ONLY，不能靠下游回调字段校验掩盖',
  )
  assert.equal((await fx.loadOrder(wechatRow.id)).status, 'pending', '被拒的微信单仍是待付')
  assert.equal((await fx.loadOrder(wechatRow.id)).channelTxnNo, null, '被拒的微信单没有记流水号')

  const realGet = fx.registry.get.bind(fx.registry)
  fx.registry.get = ((channel: string) => (channel === 'sandbox' ? undefined : realGet(channel))) as typeof fx.registry.get
  let noSandbox
  try {
    noSandbox = await fx.call('POST', SIMULATE, { serviceOrderId: prodOrder, result: 'success' })
  } finally {
    fx.registry.get = realGet
  }
  fx.expectStatus(noSandbox, 400, '注册表里没有沙箱通道')
  assert.equal(noSandbox.json.error?.code, 'SANDBOX_ONLY', '注册表没有沙箱时必须返回 SANDBOX_ONLY')
  assert.equal((await fx.loadOrder(prodOrder)).status, 'pending', '没有沙箱通道时不能改单')
  pass('非沙箱通道一律拒绝：微信单 400 SANDBOX_ONLY、注册表没有沙箱 400 SANDBOX_ONLY，单都不动')

  // ── 参数与找不到 ──────────────────────────────────────────────────
  fx.expectStatus(await fx.call('POST', SIMULATE, { serviceOrderId: prodOrder, result: 'maybe' }), 400, 'result 只认 success/failed')
  fx.expectStatus(await fx.call('POST', SIMULATE, { serviceOrderId: prodOrder, result: 'success', amountCents: 1 }), 400, '请求体不收金额')
  const missing = await fx.call('POST', SIMULATE, { serviceOrderId: 'svc-order-not-here', result: 'success' })
  fx.expectStatus(missing, 404, '没有这张单')
  assert.equal(missing.json.error?.code, 'SERVICE_ORDER_NOT_FOUND', '单不存在必须返回 SERVICE_ORDER_NOT_FOUND')
  pass('参数校验：result 白名单、不收金额；单不存在 404 SERVICE_ORDER_NOT_FOUND')

  // ── 付成：单变 paid，按库内金额入账 ───────────────────────────────
  const auditBefore = await fx.prisma.auditLog.count({ where: { action: 'service_order.paid', targetId: prodOrder } })
  const ok = await fx.call('POST', SIMULATE, { serviceOrderId: prodOrder, result: 'success' })
  fx.expectStatus(ok, 200, '模拟付成')
  assert.equal(ok.json.ok, true)
  const paidView = await readOrder(fx, prodOrder)
  assert.equal(paidView['status'], 'paid', '模拟付成后单是 paid')
  assert.ok(paidView['paidAt'], '记了付款时刻')
  assert.equal(paidView['paymentFailed'], false)
  const paidRow = await fx.loadOrder(prodOrder)
  assert.match(String(paidRow.channelTxnNo), /^sbx_txn_[0-9a-f]{16}$/, '沙箱流水号由服务端造')
  assert.equal(paidRow.amountCents, DEMO_PRICES.resume_optimize, '金额按建单时冻结的价')
  assert.equal(await fx.prisma.auditLog.count({ where: { action: 'service_order.paid', targetId: prodOrder } }), auditBefore + 1, '审计记一次已付')
  pass('模拟付成：单变 paid，按库内金额走真回调入账')

  // ── 重复调用幂等 ──────────────────────────────────────────────────
  const again = await fx.call('POST', SIMULATE, { serviceOrderId: prodOrder, result: 'success' })
  fx.expectStatus(again, 200, '再模拟付成一次')
  assert.equal(again.json.idempotent, true, '第二次是幂等返回')
  const againRow = await fx.loadOrder(prodOrder)
  assert.equal(againRow.status, 'paid')
  assert.equal(againRow.channelTxnNo, paidRow.channelTxnNo, '流水号不换')
  assert.equal(await fx.prisma.auditLog.count({ where: { action: 'service_order.paid', targetId: prodOrder } }), auditBefore + 1, '审计不重复记')
  const failAfterPaid = await fx.call('POST', SIMULATE, { serviceOrderId: prodOrder, result: 'failed' })
  fx.expectStatus(failAfterPaid, 200, '已付的单再模拟失败')
  assert.equal(failAfterPaid.json.idempotent, true)
  assert.equal((await fx.loadOrder(prodOrder)).status, 'paid', '已付的单不会被失败回调改回去')
  pass('重复调用幂等：不重复记账、不换流水号；已付的单收到失败也不变')

  // ── 付失败：paymentFailed，仍是待付，钱没记 ───────────────────────
  const failedOrder = await createOrder(fx, 'scan')
  const failed = await fx.call('POST', SIMULATE, { serviceOrderId: failedOrder, result: 'failed' })
  fx.expectStatus(failed, 200, '模拟付失败')
  const failedView = await readOrder(fx, failedOrder)
  assert.equal(failedView['status'], 'pending', '付失败的单仍是待付')
  assert.equal(failedView['paymentFailed'], true, '付失败的单 paymentFailed')
  assert.equal(failedView['paidAt'], null)
  assert.equal((await fx.loadOrder(failedOrder)).channelTxnNo, null, '付失败不记流水号')
  const failedAgain = await fx.call('POST', SIMULATE, { serviceOrderId: failedOrder, result: 'failed' })
  fx.expectStatus(failedAgain, 200, '再模拟付失败一次')
  assert.equal((await readOrder(fx, failedOrder))['paymentFailed'], true)
  pass('模拟付失败：paymentFailed 且仍是待付；再来一次结果不变')
}

async function main(): Promise<void> {
  await withServiceOrderFixture(cases)
  pass('服务单沙箱模拟付成：生产 404、只认沙箱、付成 / 付失败、幂等')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
