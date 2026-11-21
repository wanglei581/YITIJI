import assert from 'node:assert/strict'
import { encryptPhone, hashPhone } from '../../src/common/crypto/phone-identity'
import type { PrismaService } from '../../src/prisma/prisma.service'
import type { RedisService } from '../../src/common/redis/redis.service'
import { AuditService } from '../../src/audit/audit.service'
import { MiniappAccessTokenService } from '../../src/miniapp-access-token/miniapp-access-token.service'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from '../../src/virtual-pay/virtual-pay-order.service'
import {
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
