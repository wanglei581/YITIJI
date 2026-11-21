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

const MEMBER = 'vpay-notify-member'
const OPEN_ID = 'openid-notify-member'
const PRICE = 80808
const TOKEN = 'token-notify-verify'

export async function assertVirtualPayNotifyProvideGoods(options: {
  prisma: PrismaService
  redis: {
    get(key: string): Promise<string | null>
    setEx(key: string, ttl: number, value: string): Promise<unknown>
    setIfAbsent?(key: string, value: string, ttlSeconds: number): Promise<boolean>
    del?(key: string): Promise<number>
  }
}): Promise<void> {
  const { prisma } = options
  const saved = snapshotEnv()
  try {
    await prisma.virtualPayOrder.updateMany({ where: { status: 'pending' }, data: { status: 'closed' } })
    applyEnv()
    await prisma.endUser.create({
      data: {
        id: MEMBER,
        phoneHash: hashPhone('13800138021'),
        phoneEnc: encryptPhone('13800138021'),
        wxOpenId: OPEN_ID,
      },
    })
    const now = new Date()
    const dueAt = now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 60_000

    // 7a/7b/7c/7d 订单准备
    await createOrder(prisma, 'vpntfstatus2a', dueAt, 0, 'pending')
    await createOrder(prisma, 'vpntfstatus3b', dueAt + 1000, 1, 'pending')
    await createOrder(prisma, 'vpntfstatus4c', dueAt + 2000, 0, 'pending')
    await createOrder(prisma, 'vpntffail001d', dueAt + 3000, 0, 'pending')
    await createOrder(prisma, 'vpntfafter02e', dueAt + 4000, 0, 'pending')
    await createOrder(prisma, 'vpntfpushpaid', dueAt + 5000, 0, 'paid')

    const notifyCalls: Array<{
      pathname: string
      accessToken: string | null
      hasPaySig: boolean
      body: string
      orderId: string
      env: number
    }> = []
    const fakeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('stable_token')) return json({ access_token: TOKEN, expires_in: 7200 })
      if (url.includes('/xpay/notify_provide_goods')) {
        const parsedUrl = new URL(url)
        const rawBody = String(init?.body ?? '')
        const parsedBody = JSON.parse(rawBody) as { order_id: string; env: number }
        notifyCalls.push({
          pathname: parsedUrl.pathname,
          accessToken: parsedUrl.searchParams.get('access_token'),
          hasPaySig: parsedUrl.searchParams.has('pay_sig'),
          body: rawBody,
          orderId: parsedBody.order_id,
          env: parsedBody.env,
        })
        if (parsedBody.order_id === 'vpntffail001d') {
          return json({ errcode: -1, errmsg: 'temporary error' })
        }
        return new Response('', { status: 200 })
      }
      if (!url.includes('/xpay/query_order')) throw new Error(`unexpected url ${url.split('?')[0]}`)
      const body = JSON.parse(String(init?.body ?? '{}')) as { order_id: string; env: number }
      const statusMap: Record<string, number> = {
        vpntfstatus2a: 2,
        vpntfstatus3b: 3,
        vpntfstatus4c: 4,
        vpntffail001d: 2,
        vpntfafter02e: 2,
      }
      return json({
        errcode: 0,
        errmsg: 'ok',
        order: {
          order_id: body.order_id,
          status: statusMap[body.order_id] ?? 1,
          paid_fee: PRICE,
          env_type: body.env === 1 ? 2 : 1,
          wx_order_id: `WX_${body.order_id}`,
          paid_time: Math.floor(now.getTime() / 1000),
        },
      })
    }) as typeof fetch

    const localStore = new Map<string, string>()
    const localRedis = {
      async get(key: string) { return localStore.get(key) ?? null },
      async setEx(key: string, _ttl: number, value: string) { localStore.set(key, value) },
      async setIfAbsent(key: string, value: string) {
        if (localStore.has(key)) return false
        localStore.set(key, value)
        return true
      },
      async del(key: string) { return localStore.delete(key) ? 1 : 0 },
    }
    const svc = new VirtualPayReconcileService(
      prisma,
      new AuditService(prisma),
      new MiniappAccessTokenService(localRedis as unknown as RedisService),
      localRedis as unknown as RedisService,
    )
    await svc.reconcileOnce(now, fakeFetch)
    // 再跑一轮验证幂等：不重复通知发货
    await svc.reconcileOnce(now, fakeFetch)

    for (const no of ['vpntfstatus2a', 'vpntfstatus3b', 'vpntfstatus4c', 'vpntffail001d', 'vpntfafter02e']) {
      assert.equal(await statusOf(prisma, no), 'paid', `${no} 查单补记后应为 paid`)
      assert.equal(await creditsOf(prisma, no), 1, `${no} 必须恰好 1 条权益`)
    }
    const calledIds = notifyCalls.map((c) => c.orderId).sort()
    assert.deepEqual(
      calledIds,
      ['vpntfafter02e', 'vpntffail001d', 'vpntfstatus2a', 'vpntfstatus3b'],
      '查单补记且状态为 2/3 时必须幂等调用一次 notify_provide_goods；状态 4 和已推送 paid 单不调用',
    )
    for (const call of notifyCalls) {
      assert.equal(call.pathname, '/xpay/notify_provide_goods')
      assert.equal(call.accessToken, TOKEN)
      assert.equal(call.hasPaySig, false, '官方 notify_provide_goods URL 不带 pay_sig（核对表 3.8）')
    }
    const call2 = notifyCalls.find((c) => c.orderId === 'vpntfstatus2a')!
    assert.equal(call2.body, '{"order_id":"vpntfstatus2a","env":0}')
    const call3 = notifyCalls.find((c) => c.orderId === 'vpntfstatus3b')!
    assert.equal(call3.body, '{"order_id":"vpntfstatus3b","env":1}')

    // 7c: notify_provide_goods 失败不回滚权益，但写诊断
    const failDiag = await prisma.auditLog.findFirstOrThrow({
      where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION, targetId: 'vpntffail001d' },
      orderBy: { createdAt: 'desc' },
    })
    assert.equal(JSON.parse(failDiag.payloadJson).reason, 'notify_provide_goods_failed')
    console.log('PASS 查单补记(2/3)后按官方规范幂等调用 notify_provide_goods；状态 4 不重复调；通知失败不回滚权益')
  } finally {
    restoreEnv(saved)
  }
}

async function createOrder(
  prisma: PrismaService,
  outTradeNo: string,
  createdAtMs: number,
  env: number,
  status: string,
): Promise<void> {
  await prisma.virtualPayOrder.create({
    data: {
      endUserId: MEMBER,
      openId: OPEN_ID,
      serviceKind: 'resume_optimize',
      productId: 'FAKEGOOD1',
      priceCents: PRICE,
      env,
      status,
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

function applyEnv(): void {
  process.env['NODE_ENV'] = 'test'
  process.env['WECHAT_MINIAPP_APPID'] = 'wx-verify-appid'
  process.env['WECHAT_MINIAPP_APPSECRET'] = 'verify-app-secret'
  process.env['WECHAT_MINIAPP_VPAY_OFFER_ID'] = 'offer-verify'
  process.env['WECHAT_MINIAPP_VPAY_APP_KEY'] = 'app-key-verify'
  process.env['WECHAT_MINIAPP_VPAY_SANDBOX_APP_KEY'] = 'sandbox-key-verify'
  process.env['WECHAT_MINIAPP_VPAY_ENV'] = '0'
  process.env['WECHAT_MINIAPP_MESSAGE_TOKEN'] = 'message-token-verify'
  process.env['WECHAT_MINIAPP_MESSAGE_ENCODING_AES_KEY'] = Buffer.alloc(32, 7).toString('base64').replace(/=+$/, '')
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
  ]
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]))
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
