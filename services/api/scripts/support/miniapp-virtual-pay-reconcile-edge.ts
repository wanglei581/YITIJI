import assert from 'node:assert/strict'
import { encryptPhone, hashPhone } from '../../src/common/crypto/phone-identity'
import type { PrismaService } from '../../src/prisma/prisma.service'
import type { RedisService } from '../../src/common/redis/redis.service'
import { AuditService } from '../../src/audit/audit.service'
import { MiniappAccessTokenService } from '../../src/miniapp-access-token/miniapp-access-token.service'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from '../../src/virtual-pay/virtual-pay-order.service'
import {
  VIRTUAL_PAY_QUERY_MAX_AGE_MS,
  VIRTUAL_PAY_QUERY_MIN_AGE_MS,
  VirtualPayReconcileService,
} from '../../src/virtual-pay/virtual-pay-reconcile.service'
import { calcPaySig } from '../../src/virtual-pay/virtual-pay-sign'

const MEMBER = 'vpay-edge-member'
const OPEN_ID = 'openid-edge-member'
const PRICE = 80808
const PROD_KEY = 'app-key-verify'
const SANDBOX_KEY = 'sandbox-key-verify'
const TOKEN = 'token-edge-verify'

export async function assertVirtualPayReconcileEdge(options: {
  prisma: PrismaService
  redis: {
    get(key: string): Promise<string | null>
    setEx(key: string, ttl: number, value: string): Promise<unknown>
    setIfAbsent?(key: string, value: string, ttlSeconds: number): Promise<boolean>
    del?(key: string): Promise<number>
  }
}): Promise<void> {
  const { prisma } = options
  await prisma.endUser.create({
    data: {
      id: MEMBER,
      phoneHash: hashPhone('13800138019'),
      phoneEnc: encryptPhone('13800138019'),
      wxOpenId: OPEN_ID,
    },
  })
  const saved = snapshotEnv()
  try {
    await assertOrderEnvAppKeySelection(prisma, options.redis as RedisService)
    await assertExpiredErrorExitAndDiagLimit(prisma, options.redis as RedisService)
    await assertOfficialPaidStatusOnly(prisma, options.redis as RedisService)
    await assertUnconfiguredNoPendingSilent(prisma, options.redis as RedisService)
  } finally {
    restoreEnv(saved)
  }
}

async function assertOrderEnvAppKeySelection(prisma: PrismaService, redis: RedisService): Promise<void> {
  const now = new Date()
  const dueAt = now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 60_000

  // 2a: 当前配置 env=0，库里遗留 env=1 的单必须用沙箱键签 pay_sig
  applyEnv({ WECHAT_MINIAPP_VPAY_ENV: '0' })
  await createOrder(prisma, 'vpqueryenv1sbx', dueAt, 1)
  const seen = new Map<string, { body: string; paySig: string }>()
  const fetchEnvKey: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('stable_token')) return json({ access_token: TOKEN, expires_in: 7200 })
    if (url.includes('/xpay/notify_provide_goods')) return json({ errcode: 0, errmsg: 'ok' })
    const body = String(init?.body ?? '')
    const parsed = JSON.parse(body) as { order_id: string; env: number }
    const paySig = new URL(url).searchParams.get('pay_sig') ?? ''
    seen.set(parsed.order_id, { body, paySig })
    const expectedKey = parsed.env === 1 ? SANDBOX_KEY : PROD_KEY
    assert.equal(paySig, calcPaySig('/xpay/query_order', body, expectedKey), `order ${parsed.order_id} 必须用 order.env=${parsed.env} 对应的 AppKey 签名`)
    return json({
      errcode: 0,
      errmsg: 'ok',
      order: {
        order_id: parsed.order_id,
        status: 2,
        paid_fee: PRICE,
        env_type: parsed.env === 1 ? 2 : 1,
        wx_order_id: `WX_${parsed.order_id}`,
        paid_time: Math.floor(now.getTime() / 1000),
      },
    })
  }) as typeof fetch

  const svc = new VirtualPayReconcileService(prisma, new AuditService(prisma), new MiniappAccessTokenService(redis))
  await svc.reconcileOnce(now, fetchEnvKey)
  const env1Req = seen.get('vpqueryenv1sbx')
  assert.ok(env1Req, 'env=1 的单应当发出查单请求')
  assert.equal(env1Req.paySig, calcPaySig('/xpay/query_order', env1Req.body, SANDBOX_KEY))
  assert.notEqual(env1Req.paySig, calcPaySig('/xpay/query_order', env1Req.body, PROD_KEY))
  assert.equal(await statusOf(prisma, 'vpqueryenv1sbx'), 'paid')
  assert.equal(await creditsOf(prisma, 'vpqueryenv1sbx'), 1)

  // 2b: 当前配置 env=1，库里 env=0 的单必须用现网键签 pay_sig
  applyEnv({ WECHAT_MINIAPP_VPAY_ENV: '1' })
  await createOrder(prisma, 'vpqueryenv0liv', dueAt, 0)
  await svc.reconcileOnce(now, fetchEnvKey)
  const env0Req = seen.get('vpqueryenv0liv')
  assert.ok(env0Req, 'env=0 的单应当发出查单请求')
  assert.equal(env0Req.paySig, calcPaySig('/xpay/query_order', env0Req.body, PROD_KEY))
  assert.equal(await statusOf(prisma, 'vpqueryenv0liv'), 'paid')

  // 2c: 当前配置 env=0 且未配沙箱键，库里 env=1 的单不得拿现网键乱签，只写 app_key_missing 诊断
  applyEnv({ WECHAT_MINIAPP_VPAY_ENV: '0', WECHAT_MINIAPP_VPAY_SANDBOX_APP_KEY: undefined })
  await createOrder(prisma, 'vpqueryenv1nok', dueAt, 1)
  seen.clear()
  await svc.reconcileOnce(now, fetchEnvKey)
  assert.equal(seen.has('vpqueryenv1nok'), false, '缺少订单对应环境的 AppKey 时不得发出查单请求')
  assert.equal(await statusOf(prisma, 'vpqueryenv1nok'), 'pending')
  const diag = await prisma.auditLog.findFirstOrThrow({
    where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION, targetId: 'vpqueryenv1nok' },
    orderBy: { createdAt: 'desc' },
  })
  assert.equal(JSON.parse(diag.payloadJson).reason, 'app_key_missing')
  // 收尾关掉这条残单，不干扰后续用例
  await prisma.virtualPayOrder.update({ where: { outTradeNo: 'vpqueryenv1nok' }, data: { status: 'closed' } })
  console.log('PASS 查单按订单自己的 env 选 AppKey 签名，缺对应环境键不乱签')
}

async function assertExpiredErrorExitAndDiagLimit(prisma: PrismaService, redis: RedisService): Promise<void> {
  // 清掉前序用例残留 pending 单，保证这组用例独立计数
  await prisma.virtualPayOrder.updateMany({ where: { status: 'pending' }, data: { status: 'closed' } })
  const now = new Date()
  applyEnv({ WECHAT_MINIAPP_VPAY_ENV: '0', ALERT_WEBHOOK_URL: 'https://alert.local.test/vpay-hook' })

  // 3a: 51 张超期单（前 50 张一直 errcode=-1，第 51 张其实已付）
  const deadNos: string[] = []
  for (let i = 0; i < 50; i += 1) {
    const no = `vpdeaderr${String(i).padStart(4, '0')}`
    deadNos.push(no)
    await createOrder(prisma, no, now.getTime() - VIRTUAL_PAY_QUERY_MAX_AGE_MS - (120 - i) * 60_000, 0)
  }
  const latePaidNo = 'vplatepaid0001'
  await createOrder(prisma, latePaidNo, now.getTime() - VIRTUAL_PAY_QUERY_MAX_AGE_MS - 5 * 60_000, 0)

  let alertHits = 0
  const queriedNos = new Set<string>()
  const fakeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://alert.local.test/')) {
      alertHits += 1
      return json({ errcode: 0 })
    }
    if (url.includes('stable_token')) return json({ access_token: TOKEN, expires_in: 7200 })
    if (url.includes('/xpay/notify_provide_goods')) return json({ errcode: 0, errmsg: 'ok' })
    const body = JSON.parse(String(init?.body ?? '{}')) as { order_id: string }
    queriedNos.add(body.order_id)
    if (body.order_id.startsWith('vpdeaderr')) {
      return json({ errcode: -1, errmsg: 'system error' })
    }
    return json({
      errcode: 0,
      errmsg: 'ok',
      order: {
        order_id: body.order_id,
        status: 2,
        paid_fee: PRICE,
        env_type: 1,
        wx_order_id: `WX_${body.order_id}`,
        paid_time: Math.floor(now.getTime() / 1000),
      },
    })
  }) as typeof fetch

  // 刻意每轮 new 服务实例，证明连续失败次数与诊断限频落库而非只放实例内存
  for (let round = 0; round < 5; round += 1) {
    const svc = new VirtualPayReconcileService(prisma, new AuditService(prisma), new MiniappAccessTokenService(redis), redis)
    await svc.reconcileOnce(now, fakeFetch)
  }

  const deadManualCount = await prisma.virtualPayOrder.count({
    where: { outTradeNo: { in: deadNos }, status: 'manual_review' },
  })
  assert.equal(deadManualCount, 50, '50 张持续报错超期单必须全部转待人工 manual_review')
  assert.equal(await statusOf(prisma, latePaidNo), 'paid', '第 51 张已付超期单必须在报错单出队后被补记')
  assert.equal(await creditsOf(prisma, latePaidNo), 1)
  assert.ok(alertHits >= 50, '转待人工必须触发运维告警')

  const deadDiagsBeforeExtra = await prisma.auditLog.count({
    where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION, targetId: { in: deadNos } },
  })
  // 每单最多首次 query_failed + 转待人工 query_manual_review = 2 条，50 单 <= 100 条
  assert.ok(deadDiagsBeforeExtra > 0 && deadDiagsBeforeExtra <= 100, `诊断条数必须有上限(<=100)，实际=${deadDiagsBeforeExtra}`)

  // 再跑 2 轮：50 张待人工单不得再进自动批次，诊断条数零增长
  queriedNos.clear()
  for (let round = 0; round < 2; round += 1) {
    const svc = new VirtualPayReconcileService(prisma, new AuditService(prisma), new MiniappAccessTokenService(redis), redis)
    await svc.reconcileOnce(now, fakeFetch)
  }
  assert.equal(deadNos.some((no) => queriedNos.has(no)), false, '已转待人工的单不得再进自动批次')
  const deadDiagsAfterExtra = await prisma.auditLog.count({
    where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION, targetId: { in: deadNos } },
  })
  assert.equal(deadDiagsAfterExtra, deadDiagsBeforeExtra, '待人工单后续轮次不得新增诊断')

  // 3b: 超过最大时长（25 小时前）的单首次查单报错即直接转待人工
  const agedNo = 'vpagedfail0001'
  await createOrder(prisma, agedNo, now.getTime() - 25 * 60 * 60 * 1000, 0)
  const agedFetch: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('https://alert.local.test/')) return json({ errcode: 0 })
    if (url.includes('stable_token')) return json({ access_token: TOKEN, expires_in: 7200 })
    return json({ errcode: -1, errmsg: 'still failing' })
  }) as typeof fetch
  await new VirtualPayReconcileService(prisma, new AuditService(prisma), new MiniappAccessTokenService(redis), redis)
    .reconcileOnce(now, agedFetch)
  assert.equal(await statusOf(prisma, agedNo), 'manual_review', '超过最大时长的报错单应直接转待人工')

  // 3c: 未超期单连续 3 轮同一种诊断（amount_mismatch）按单限频只写 1 条
  const misNo = 'vpmislimit0001'
  await createOrder(prisma, misNo, now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 60_000, 0)
  const misFetch: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('stable_token')) return json({ access_token: TOKEN, expires_in: 7200 })
    return json({
      errcode: 0,
      errmsg: 'ok',
      order: { order_id: misNo, status: 2, paid_fee: 1, env_type: 1, wx_order_id: 'WX_MIS', paid_time: Math.floor(now.getTime() / 1000) },
    })
  }) as typeof fetch
  for (let round = 0; round < 3; round += 1) {
    await new VirtualPayReconcileService(prisma, new AuditService(prisma), new MiniappAccessTokenService(redis), redis)
      .reconcileOnce(now, misFetch)
  }
  const misDiagCount = await prisma.auditLog.count({
    where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION, targetId: misNo },
  })
  assert.equal(misDiagCount, 1, '同一单状态未变化时诊断只写 1 条')
  await prisma.virtualPayOrder.update({ where: { outTradeNo: misNo }, data: { status: 'closed' } })
  console.log('PASS 51 张超期单报错出口转待人工且补记第 51 张；诊断按单限频有上限')
}

async function assertOfficialPaidStatusOnly(prisma: PrismaService, redis: RedisService): Promise<void> {
  await prisma.virtualPayOrder.updateMany({ where: { status: 'pending' }, data: { status: 'closed' } })
  const now = new Date()
  const dueAt = now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 60_000
  applyEnv({ WECHAT_MINIAPP_VPAY_ENV: '0', ALERT_WEBHOOK_URL: undefined })

  const statusByOrder = new Map<string, number>([
    ['vpst2paid00001', 2],
    ['vpst3paid00001', 3],
    ['vpst4paid00001', 4],
    ['vpst7fail00001', 7],
    ['vpst9adfn00001', 9],
    ['vpst10rev00001', 10],
  ])
  for (const no of statusByOrder.keys()) {
    await createOrder(prisma, no, dueAt, 0)
  }
  const fetchStatuses: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('stable_token')) return json({ access_token: TOKEN, expires_in: 7200 })
    if (url.includes('/xpay/notify_provide_goods')) return json({ errcode: 0, errmsg: 'ok' })
    const body = JSON.parse(String(init?.body ?? '{}')) as { order_id: string }
    const wxStatus = statusByOrder.get(body.order_id) ?? 1
    return json({
      errcode: 0,
      errmsg: 'ok',
      order: {
        order_id: body.order_id,
        status: wxStatus,
        paid_fee: PRICE,
        env_type: 1,
        wx_order_id: `WX_${body.order_id}`,
        paid_time: Math.floor(now.getTime() / 1000),
      },
    })
  }) as typeof fetch

  const svc = new VirtualPayReconcileService(prisma, new AuditService(prisma), new MiniappAccessTokenService(redis), redis)
  await svc.reconcileOnce(now, fetchStatuses)

  for (const no of ['vpst2paid00001', 'vpst3paid00001', 'vpst4paid00001']) {
    assert.equal(await statusOf(prisma, no), 'paid', `${no} 是官方已支付状态(2/3/4)，必须记权益`)
    assert.equal(await creditsOf(prisma, no), 1)
  }
  for (const [no, wxStatus] of [['vpst7fail00001', 7], ['vpst9adfn00001', 9], ['vpst10rev00001', 10]] as const) {
    assert.equal(await creditsOf(prisma, no), 0, `官方状态 ${wxStatus} 不得记权益`)
    assert.equal(await statusOf(prisma, no), 'manual_review', `官方状态 ${wxStatus} 应转待人工而非 paid`)
    const diag = await prisma.auditLog.findFirstOrThrow({
      where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION, targetId: no },
      orderBy: { createdAt: 'desc' },
    })
    const payload = JSON.parse(diag.payloadJson) as { reason?: string; wxStatus?: number }
    assert.equal(payload.reason, 'non_grantable_order_status')
    assert.equal(payload.wxStatus, wxStatus)
  }
  console.log('PASS 查单只认官方 2/3/4 为已支付；7/9/10 只写诊断转待人工、不记权益')
}

async function assertUnconfiguredNoPendingSilent(prisma: PrismaService, redis: RedisService): Promise<void> {
  await prisma.virtualPayOrder.updateMany({ where: { status: 'pending' }, data: { status: 'closed' } })
  applyEnv({
    WECHAT_MINIAPP_VPAY_OFFER_ID: undefined,
    WECHAT_MINIAPP_VPAY_APP_KEY: undefined,
    WECHAT_MINIAPP_VPAY_SANDBOX_APP_KEY: undefined,
    WECHAT_MINIAPP_VPAY_ENV: undefined,
    WECHAT_MINIAPP_MESSAGE_TOKEN: undefined,
    WECHAT_MINIAPP_MESSAGE_ENCODING_AES_KEY: undefined,
    ALERT_WEBHOOK_URL: undefined,
  })
  const now = new Date()
  const beforeNoPending = await prisma.auditLog.count({ where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION } })
  const svc = new VirtualPayReconcileService(prisma, new AuditService(prisma), new MiniappAccessTokenService(redis), redis)
  for (let i = 0; i < 3; i += 1) {
    await svc.reconcileOnce(now)
  }
  const afterNoPending = await prisma.auditLog.count({ where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION } })
  assert.equal(afterNoPending, beforeNoPending, '未配置且没有在途订单时定时查单不得写诊断')

  // 有在途订单且未配置时：写诊断，但按状态变化限频不重复刷
  await createOrder(prisma, 'vpwaitunconf01', now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 60_000, 0)
  await svc.reconcileOnce(now)
  await svc.reconcileOnce(now)
  const afterWithPending = await prisma.auditLog.count({ where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION } })
  assert.equal(afterWithPending, beforeNoPending + 1, '有在途单且未配置时同一阻断原因只写 1 条诊断')
  await prisma.virtualPayOrder.update({ where: { outTradeNo: 'vpwaitunconf01' }, data: { status: 'closed' } })
  console.log('PASS 未配置且无在途单时定时查单静默跳过，有在途单按状态变化限频写诊断')
}

async function createOrder(prisma: PrismaService, outTradeNo: string, createdAtMs: number, env = 0): Promise<void> {
  await prisma.virtualPayOrder.create({
    data: {
      endUserId: MEMBER,
      openId: OPEN_ID,
      serviceKind: 'resume_optimize',
      productId: 'FAKEGOOD1',
      priceCents: PRICE,
      env,
      status: 'pending',
      outTradeNo,
      createdAt: new Date(createdAtMs),
    },
  })
}

async function statusOf(prisma: PrismaService, outTradeNo: string): Promise<string> {
  return (await prisma.virtualPayOrder.findUniqueOrThrow({ where: { outTradeNo } })).status
}

async function creditsOf(prisma: PrismaService, outTradeNo: string): Promise<number> {
  const row = await prisma.virtualPayOrder.findUniqueOrThrow({ where: { outTradeNo } })
  return prisma.memberServiceCredit.count({ where: { sourceOrderId: row.id } })
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function applyEnv(extra: Record<string, string | undefined> = {}): void {
  const base: Record<string, string | undefined> = {
    NODE_ENV: 'test',
    WECHAT_MINIAPP_APPID: 'wx-verify-appid',
    WECHAT_MINIAPP_APPSECRET: 'verify-app-secret',
    WECHAT_MINIAPP_VPAY_OFFER_ID: 'offer-verify',
    WECHAT_MINIAPP_VPAY_APP_KEY: PROD_KEY,
    WECHAT_MINIAPP_VPAY_SANDBOX_APP_KEY: SANDBOX_KEY,
    WECHAT_MINIAPP_VPAY_ENV: '0',
    WECHAT_MINIAPP_MESSAGE_TOKEN: 'message-token-verify',
    WECHAT_MINIAPP_MESSAGE_ENCODING_AES_KEY: Buffer.alloc(32, 7).toString('base64').replace(/=+$/, ''),
    ...extra,
  }
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function snapshotEnv(): Record<string, string | undefined> {
  const keys = [
    'NODE_ENV',
    'WECHAT_MINIAPP_APPID',
    'WECHAT_MINIAPP_APPSECRET',
    'WECHAT_MINIAPP_VPAY_OFFER_ID',
    'WECHAT_MINIAPP_VPAY_APP_KEY',
    'WECHAT_MINIAPP_VPAY_SANDBOX_APP_KEY',
    'WECHAT_MINIAPP_VPAY_ENV',
    'WECHAT_MINIAPP_MESSAGE_TOKEN',
    'WECHAT_MINIAPP_MESSAGE_ENCODING_AES_KEY',
    'ALERT_WEBHOOK_URL',
  ]
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]))
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
