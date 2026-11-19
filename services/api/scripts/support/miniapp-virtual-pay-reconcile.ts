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

const MEMBER = 'vpay-query-member'
const OPEN_ID = 'openid-query-member'
const PRICE = 80808
const APP_KEY = 'app-key-verify'
const TOKEN = 'token-verify'

export async function assertVirtualPayReconcile(options: {
  prisma: PrismaService
  redis: { get(key: string): Promise<string | null>; setEx(key: string, ttl: number, value: string): Promise<unknown> }
}): Promise<void> {
  const { prisma } = options
  applyReadyEnv()
  await prisma.endUser.create({
    data: {
      id: MEMBER,
      phoneHash: hashPhone('13800138004'),
      phoneEnc: encryptPhone('13800138004'),
      wxOpenId: OPEN_ID,
    },
  })
  const now = new Date()
  await createOrder(prisma, 'vpqueryfresh1', now.getTime() - 30_000)
  await createOrder(prisma, 'vpquerypaid01', now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 60_000)
  await createOrder(prisma, 'vpquerywait01', now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 2 * 60_000)
  await createOrder(prisma, 'vpquerymismatch', now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 3 * 60_000)
  await createOrder(prisma, 'vpqueryenv01', now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 4 * 60_000)
  await createOrder(prisma, 'vpqueryfail01', now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 8 * 60_000)
  await createOrder(prisma, 'vpqueryafter1', now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 7 * 60_000)
  await createOrder(prisma, 'vpqueryold001', now.getTime() - VIRTUAL_PAY_QUERY_MAX_AGE_MS - 60_000)
  await createOrder(prisma, 'vpqueryoldpay', now.getTime() - VIRTUAL_PAY_QUERY_MAX_AGE_MS - 2 * 60_000)

  const seen = new Map<string, string>()
  let tokenCalls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.includes('api.weixin.qq.com')) return originalFetch(input, init)
    if (url.includes('cgi-bin/token')) throw new Error('third token endpoint')
    if (url.includes('/sns/jscode2session')) throw new Error('reconcile must not login')
    if (url.includes('stable_token')) {
      tokenCalls += 1
      const posted = String(init?.body ?? '')
      assert.equal(posted.includes(' '), false)
      return json({ access_token: TOKEN, expires_in: 7200 })
    }
    if (!url.includes('/xpay/query_order')) throw new Error(`unexpected wechat url ${url.split('?')[0]}`)
    const body = String(init?.body ?? '')
    const paySig = new URL(url).searchParams.get('pay_sig')
    assert.equal(paySig, calcPaySig('/xpay/query_order', body, APP_KEY))
    assert.notEqual(calcPaySig('/xpay/query_order', `${body} `, APP_KEY), paySig)
    assert.equal(body.includes(' '), false)
    const parsed = JSON.parse(body) as { openid: string; env: number; order_id: string }
    assert.equal(parsed.openid, OPEN_ID)
    assert.equal(parsed.env, 0)
    seen.set(parsed.order_id, body)
    return queryResponse(parsed.order_id)
  }) as typeof fetch

  const reconcile = new VirtualPayReconcileService(
    prisma,
    new AuditService(prisma),
    new MiniappAccessTokenService(options.redis as RedisService),
  )
  try {
    await reconcile.reconcileOnce(now, globalThis.fetch)
    assert.equal(seen.has('vpqueryfresh1'), false)
    assert.equal(await statusOf(prisma, 'vpquerypaid01'), 'paid')
    assert.equal(await credits(prisma, 'vpquerypaid01'), 1)
    assert.equal(await statusOf(prisma, 'vpquerywait01'), 'pending')
    assert.equal(await credits(prisma, 'vpquerymismatch'), 0)
    assert.equal(await statusOf(prisma, 'vpquerymismatch'), 'pending')
    assert.equal(await credits(prisma, 'vpqueryenv01'), 0)
    assert.equal(await statusOf(prisma, 'vpqueryenv01'), 'pending')
    assert.equal(await statusOf(prisma, 'vpqueryfail01'), 'pending')
    assert.equal(await statusOf(prisma, 'vpqueryafter1'), 'paid')
    assert.equal(await credits(prisma, 'vpqueryafter1'), 1)
    assert.equal(await statusOf(prisma, 'vpqueryold001'), 'closed')
    assert.equal(await credits(prisma, 'vpqueryold001'), 0)
    assert.equal(await statusOf(prisma, 'vpqueryoldpay'), 'paid')
    assert.equal(await credits(prisma, 'vpqueryoldpay'), 1)
    assert.equal(tokenCalls, 1)
    const paidBody = seen.get('vpquerypaid01')
    assert.equal(paidBody, `{"openid":"${OPEN_ID}","env":0,"order_id":"vpquerypaid01"}`)

    await reconcile.reconcileOnce(now, globalThis.fetch)
    assert.equal(await credits(prisma, 'vpquerypaid01'), 1)
    assert.equal(tokenCalls, 1)

    const reasons = (await prisma.auditLog.findMany({ where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION } }))
      .map((row) => JSON.parse(row.payloadJson).reason as string)
    assert.equal(reasons.includes('amount_mismatch'), true)
    assert.equal(reasons.includes('env_mismatch'), true)
    assert.equal(reasons.includes('query_failed'), true)
    const payloads = (await prisma.auditLog.findMany()).map((row) => row.payloadJson).join('\n')
    assert.equal(payloads.includes(TOKEN), false)
    console.log('PASS 查单补记权益；签名对得上实际 body；失败不拖垮整批；超时未付关单')
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function createOrder(prisma: PrismaService, outTradeNo: string, createdAtMs: number): Promise<void> {
  await prisma.virtualPayOrder.create({
    data: {
      endUserId: MEMBER,
      openId: OPEN_ID,
      serviceKind: 'resume_optimize',
      productId: 'FAKEGOOD1',
      priceCents: PRICE,
      env: 0,
      status: 'pending',
      outTradeNo,
      createdAt: new Date(createdAtMs),
    },
  })
}

function queryResponse(orderId: string): Response {
  if (orderId === 'vpqueryfail01') return new Response('upstream', { status: 500 })
  const status = orderId === 'vpquerywait01' || orderId === 'vpqueryold001' ? 1 : 2
  const paidFee = orderId === 'vpquerymismatch' ? 1 : PRICE
  const envType = orderId === 'vpqueryenv01' ? 2 : 1
  return json({
    errcode: 0,
    errmsg: 'ok',
    order: {
      order_id: orderId,
      status,
      paid_fee: paidFee,
      env_type: envType,
      wx_order_id: 'WXQUERY1',
      paid_time: Math.floor(Date.now() / 1000),
    },
  })
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function statusOf(prisma: PrismaService, outTradeNo: string): Promise<string> {
  const row = await prisma.virtualPayOrder.findUniqueOrThrow({ where: { outTradeNo } })
  return row.status
}

async function credits(prisma: PrismaService, outTradeNo: string): Promise<number> {
  const row = await prisma.virtualPayOrder.findUniqueOrThrow({ where: { outTradeNo } })
  return prisma.memberServiceCredit.count({ where: { sourceOrderId: row.id } })
}

function applyReadyEnv(): void {
  process.env['WECHAT_MINIAPP_APPID'] = 'wx-verify-appid'
  process.env['WECHAT_MINIAPP_APPSECRET'] = 'verify-app-secret'
  process.env['WECHAT_MINIAPP_VPAY_OFFER_ID'] = 'offer-verify'
  process.env['WECHAT_MINIAPP_VPAY_APP_KEY'] = APP_KEY
  process.env['WECHAT_MINIAPP_VPAY_SANDBOX_APP_KEY'] = 'sandbox-key-verify'
  process.env['WECHAT_MINIAPP_VPAY_ENV'] = '0'
  process.env['WECHAT_MINIAPP_MESSAGE_TOKEN'] = 'message-token-verify'
  process.env['WECHAT_MINIAPP_MESSAGE_ENCODING_AES_KEY'] = Buffer.alloc(32, 7).toString('base64').replace(/=+$/, '')
}
