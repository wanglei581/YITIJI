import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes } from 'crypto'
import { AuditService } from '../../src/audit/audit.service'
import { encryptPhone, hashPhone } from '../../src/common/crypto/phone-identity'
import type { RedisService } from '../../src/common/redis/redis.service'
import { MiniappAccessTokenService } from '../../src/miniapp-access-token/miniapp-access-token.service'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from '../../src/virtual-pay/virtual-pay-order.service'
import {
  VIRTUAL_PAY_QUERY_MIN_AGE_MS,
  VirtualPayReconcileService,
} from '../../src/virtual-pay/virtual-pay-reconcile.service'
import { VIRTUAL_PAY_CLOSED_RECOVERY_AUDIT_ACTION } from '../../src/virtual-pay/wechat-miniapp-message.service'

const APP_ID = 'wx-verify-appid'
const TOKEN = 'message-token-verify'
const AES_KEY = Buffer.alloc(32, 7).toString('base64').replace(/=+$/, '')
const PRODUCT_ID = 'FAKEGOOD1'
const PRICE_CENTS = 80808
const ACCESS_TOKEN = 'token-hardening-verify'

export interface HardeningRedisStub {
  get(key: string): Promise<string | null>
  setEx(key: string, ttl: number, value: string): Promise<unknown>
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>
  del(key: string): Promise<number>
}

export async function assertVirtualPayMemberClosureWriteProtection(options: {
  prisma: PrismaService
  base: string
  redis: HardeningRedisStub
}): Promise<void> {
  const { prisma, base, redis } = options
  const saved = snapshotEnv()
  try {
    applyEnv()
    await prisma.virtualPayOrder.updateMany({ where: { status: 'pending' }, data: { status: 'closed' } })

    const closingMemberId = 'vpay-closing-member'
    const closingOpenId = 'openid-closing-member'
    const closedMemberId = 'vpay-closed-member'
    const closedOpenId = 'openid-closed-member'
    const activeMemberId = 'vpay-active-batch-member'
    const activeOpenId = 'openid-active-batch-member'

    await prisma.endUser.create({
      data: {
        id: closingMemberId,
        phoneHash: hashPhone('13800138031'),
        phoneEnc: encryptPhone('13800138031'),
        wxOpenId: closingOpenId,
        status: 'closing',
        enabled: false,
      },
    })
    await prisma.endUser.create({
      data: {
        id: closedMemberId,
        phoneHash: hashPhone('13800138032'),
        phoneEnc: encryptPhone('13800138032'),
        wxOpenId: closedOpenId,
        status: 'closed',
        enabled: false,
      },
    })
    await prisma.endUser.create({
      data: {
        id: activeMemberId,
        phoneHash: hashPhone('13800138033'),
        phoneEnc: encryptPhone('13800138033'),
        wxOpenId: activeOpenId,
        status: 'active',
        enabled: true,
      },
    })

    // 1a: closing 会员的 closed 订单收到有效已付推送，必须拒绝转 paid 与创建权益，推送仍返回 200 空串
    const closingClosedOrder = await prisma.virtualPayOrder.create({
      data: {
        endUserId: closingMemberId,
        openId: closingOpenId,
        serviceKind: 'resume_optimize',
        productId: PRODUCT_ID,
        priceCents: PRICE_CENTS,
        env: 0,
        status: 'closed',
        outTradeNo: 'vpclosingpush01',
      },
    })
    const pushClosing = await postMessage(base, seal(deliverJson(closingClosedOrder.outTradeNo, closingOpenId)))
    assert.equal(pushClosing.status, 200)
    assert.equal(await pushClosing.text(), '')
    assert.equal(await creditCount(prisma, closingClosedOrder.id), 0, 'closing 会员收到推送不得创建权益')
    assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: closingClosedOrder.id } })).status, 'closed')
    assert.equal(
      await prisma.auditLog.count({
        where: { action: VIRTUAL_PAY_CLOSED_RECOVERY_AUDIT_ACTION, targetId: closingClosedOrder.outTradeNo },
      }),
      0,
    )
    const closingPushDiag = await prisma.auditLog.findFirstOrThrow({
      where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION, targetId: closingClosedOrder.outTradeNo },
      orderBy: { createdAt: 'desc' },
    })
    assert.equal(JSON.parse(closingPushDiag.payloadJson).reason, 'member_not_active')
    assert.equal(closingPushDiag.payloadJson.includes(closingOpenId), false, '诊断不得记录 openid')

    // 1b: closed 会员的 pending 订单收到有效已付推送，同样拒绝
    const closedPendingOrder = await prisma.virtualPayOrder.create({
      data: {
        endUserId: closedMemberId,
        openId: closedOpenId,
        serviceKind: 'resume_optimize',
        productId: PRODUCT_ID,
        priceCents: PRICE_CENTS,
        env: 0,
        status: 'pending',
        outTradeNo: 'vpclosedmem0001',
      },
    })
    const pushClosed = await postMessage(base, seal(deliverJson(closedPendingOrder.outTradeNo, closedOpenId)))
    assert.equal(pushClosed.status, 200)
    assert.equal(await pushClosed.text(), '')
    assert.equal(await creditCount(prisma, closedPendingOrder.id), 0, 'closed 会员收到推送不得创建权益')
    assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: closedPendingOrder.id } })).status, 'pending')
    const closedPushDiag = await prisma.auditLog.findFirstOrThrow({
      where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION, targetId: closedPendingOrder.outTradeNo },
      orderBy: { createdAt: 'desc' },
    })
    assert.equal(JSON.parse(closedPushDiag.payloadJson).reason, 'member_not_active')
    assert.equal(closedPushDiag.payloadJson.includes(closedOpenId), false)

    // 1c: 查单批次同时命中 closing 会员与正常 active 会员：closing 会员拒记且不调 notify，正常单不受影响
    await prisma.virtualPayOrder.update({ where: { id: closedPendingOrder.id }, data: { status: 'closed' } })
    const now = new Date()
    const dueAt = now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 60_000
    const closingQueryOrder = await prisma.virtualPayOrder.create({
      data: {
        endUserId: closingMemberId,
        openId: closingOpenId,
        serviceKind: 'resume_optimize',
        productId: PRODUCT_ID,
        priceCents: PRICE_CENTS,
        env: 0,
        status: 'pending',
        outTradeNo: 'vpclosingqry001',
        createdAt: new Date(dueAt),
      },
    })
    const activeQueryOrder = await prisma.virtualPayOrder.create({
      data: {
        endUserId: activeMemberId,
        openId: activeOpenId,
        serviceKind: 'resume_optimize',
        productId: PRODUCT_ID,
        priceCents: PRICE_CENTS,
        env: 0,
        status: 'pending',
        outTradeNo: 'vpactiveqry0001',
        createdAt: new Date(dueAt + 1000),
      },
    })
    const notified: string[] = []
    const fetchReconcile: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('stable_token')) return json({ access_token: ACCESS_TOKEN, expires_in: 7200 })
      if (url.includes('/xpay/notify_provide_goods')) {
        const parsed = JSON.parse(String(init?.body ?? '{}')) as { order_id: string }
        notified.push(parsed.order_id)
        return json({ errcode: 0, errmsg: 'ok' })
      }
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { order_id: string }
      return json({
        errcode: 0,
        errmsg: 'ok',
        order: {
          order_id: parsed.order_id,
          status: 2,
          paid_fee: PRICE_CENTS,
          env_type: 1,
          wx_order_id: `WX_${parsed.order_id}`,
          paid_time: Math.floor(now.getTime() / 1000),
        },
      })
    }) as typeof fetch

    const reconcile = new VirtualPayReconcileService(
      prisma,
      new AuditService(prisma),
      new MiniappAccessTokenService(redis as unknown as RedisService),
      redis as unknown as RedisService,
    )
    await reconcile.reconcileOnce(now, fetchReconcile)

    assert.equal(await creditCount(prisma, closingQueryOrder.id), 0, '查单对 closing 会员不得记权益')
    assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: closingQueryOrder.id } })).status, 'pending')
    const closingQryDiag = await prisma.auditLog.findFirstOrThrow({
      where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION, targetId: closingQueryOrder.outTradeNo },
      orderBy: { createdAt: 'desc' },
    })
    assert.equal(JSON.parse(closingQryDiag.payloadJson).reason, 'member_not_active')
    assert.equal(closingQryDiag.payloadJson.includes(closingOpenId), false)

    assert.equal(await creditCount(prisma, activeQueryOrder.id), 1, '同批正常 active 会员单不得受 closing 拒绝影响')
    assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: activeQueryOrder.id } })).status, 'paid')
    assert.deepEqual(notified, [activeQueryOrder.outTradeNo], '仅正常单调 notify_provide_goods')

    await prisma.virtualPayOrder.update({ where: { id: closingQueryOrder.id }, data: { status: 'closed' } })
    console.log('PASS 闭户写保护：closing/closed 会员在推送与查单路径均拒转 paid 与建权益，不泄 PII，不拖垮同批正常单')
  } finally {
    restoreEnv(saved)
  }
}

export async function assertVirtualPayManualReviewLocked(options: {
  prisma: PrismaService
  base: string
  redis: HardeningRedisStub
}): Promise<void> {
  const { prisma, base, redis } = options
  const saved = snapshotEnv()
  try {
    applyEnv({ ALERT_WEBHOOK_URL: undefined })
    await prisma.virtualPayOrder.updateMany({ where: { status: 'pending' }, data: { status: 'closed' } })

    const memberId = 'vpay-manual-lock-member'
    const openId = 'openid-manual-lock-member'
    await prisma.endUser.create({
      data: {
        id: memberId,
        phoneHash: hashPhone('13800138034'),
        phoneEnc: encryptPhone('13800138034'),
        wxOpenId: openId,
      },
    })
    const now = new Date()
    const dueAt = now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 60_000
    const statusByOrder = new Map<string, number>([
      ['vpmanlock70001', 7],
      ['vpmanlock90001', 9],
      ['vpmanlock10001', 10],
    ])
    for (const outTradeNo of statusByOrder.keys()) {
      await prisma.virtualPayOrder.create({
        data: {
          endUserId: memberId,
          openId,
          serviceKind: 'resume_optimize',
          productId: PRODUCT_ID,
          priceCents: PRICE_CENTS,
          env: 0,
          status: 'pending',
          outTradeNo,
          createdAt: new Date(dueAt),
        },
      })
    }
    const fetchStatuses: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('stable_token')) return json({ access_token: ACCESS_TOKEN, expires_in: 7200 })
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { order_id: string }
      return json({
        errcode: 0,
        errmsg: 'ok',
        order: {
          order_id: parsed.order_id,
          status: statusByOrder.get(parsed.order_id) ?? 1,
          paid_fee: PRICE_CENTS,
          env_type: 1,
          wx_order_id: `WX_${parsed.order_id}`,
          paid_time: Math.floor(now.getTime() / 1000),
        },
      })
    }) as typeof fetch

    const reconcile = new VirtualPayReconcileService(
      prisma,
      new AuditService(prisma),
      new MiniappAccessTokenService(redis as unknown as RedisService),
      redis as unknown as RedisService,
    )
    await reconcile.reconcileOnce(now, fetchStatuses)

    // 额外覆盖：连续失败转 manual_review 的单同样锁定
    const failManualOrder = await prisma.virtualPayOrder.create({
      data: {
        endUserId: memberId,
        openId,
        serviceKind: 'resume_optimize',
        productId: PRODUCT_ID,
        priceCents: PRICE_CENTS,
        env: 0,
        status: 'manual_review',
        queryFailCount: 3,
        outTradeNo: 'vpmanlockfail1',
      },
    })

    for (const outTradeNo of [...statusByOrder.keys(), failManualOrder.outTradeNo]) {
      const rowBefore = await prisma.virtualPayOrder.findUniqueOrThrow({ where: { outTradeNo } })
      assert.equal(rowBefore.status, 'manual_review', `${outTradeNo} 应先进入 manual_review`)

      const latePush = await postMessage(base, seal(deliverJson(outTradeNo, openId)))
      assert.equal(latePush.status, 200)
      assert.equal(await latePush.text(), '')

      const rowAfter = await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: rowBefore.id } })
      assert.equal(rowAfter.status, 'manual_review', `${outTradeNo} 收到迟到有效推送仍必须停在 manual_review`)
      assert.equal(await creditCount(prisma, rowBefore.id), 0, `${outTradeNo} 绝不得由迟到推送解锁补发权益`)
      assert.equal(
        await prisma.auditLog.count({
          where: { action: VIRTUAL_PAY_CLOSED_RECOVERY_AUDIT_ACTION, targetId: outTradeNo },
        }),
        0,
      )
      const diag = await prisma.auditLog.findFirstOrThrow({
        where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION, targetId: outTradeNo },
        orderBy: { createdAt: 'desc' },
      })
      assert.equal(JSON.parse(diag.payloadJson).reason, 'order_manual_review')
      assert.equal(diag.payloadJson.includes(openId), false)
    }
    console.log('PASS 待人工锁定：状态 7/9/10 及连续失败转 manual_review 后收到迟到有效推送仍拒转 paid、权益严格为 0')
  } finally {
    restoreEnv(saved)
  }
}

function seal(message: string, appId = APP_ID): string {
  const key = Buffer.from(`${AES_KEY}=`, 'base64')
  const msg = Buffer.from(message, 'utf8')
  const packed = Buffer.concat([
    randomBytes(16),
    Buffer.from([(msg.length >>> 24) & 255, (msg.length >>> 16) & 255, (msg.length >>> 8) & 255, msg.length & 255]),
    msg,
    Buffer.from(appId, 'utf8'),
  ])
  const pad = 32 - (packed.length % 32)
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(Buffer.concat([packed, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64')
}

function sha1(parts: string[]): string {
  return createHash('sha1').update([...parts].sort().join(''), 'utf8').digest('hex')
}

function deliverJson(outTradeNo: string, openId: string): string {
  const paidTime = Math.floor(Date.now() / 1000)
  return JSON.stringify({
    Event: 'xpay_goods_deliver_notify',
    OpenId: openId,
    OutTradeNo: outTradeNo,
    Env: 0,
    WeChatPayInfo: { MchOrderNo: 'WXHARDEN1', TransactionId: 'TXHARDEN1', PaidTime: paidTime },
    GoodsInfo: {
      ProductId: PRODUCT_ID,
      Quantity: 1,
      OrigPrice: PRICE_CENTS,
      ActualPrice: PRICE_CENTS,
      Attach: 'resume_optimize',
    },
  })
}

async function postMessage(base: string, encrypt: string, contentType = 'application/json'): Promise<Response> {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = 'nonce-hardening'
  const msgSignature = sha1([TOKEN, timestamp, nonce, encrypt])
  const envelope = contentType.includes('xml')
    ? `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`
    : JSON.stringify({ ToUserName: 'gh_verify', Encrypt: encrypt })
  const query = new URLSearchParams({ msg_signature: msgSignature, timestamp, nonce })
  return fetch(`${base}/api/v1/wechat/miniapp/message?${query}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: envelope,
  })
}

function creditCount(prisma: PrismaService, orderId: string): Promise<number> {
  return prisma.memberServiceCredit.count({ where: { sourceOrderId: orderId } })
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function applyEnv(extra: Record<string, string | undefined> = {}): void {
  const base: Record<string, string | undefined> = {
    NODE_ENV: 'test',
    WECHAT_MINIAPP_APPID: APP_ID,
    WECHAT_MINIAPP_APPSECRET: 'verify-app-secret',
    WECHAT_MINIAPP_VPAY_OFFER_ID: 'offer-verify',
    WECHAT_MINIAPP_VPAY_APP_KEY: 'app-key-verify',
    WECHAT_MINIAPP_VPAY_SANDBOX_APP_KEY: 'sandbox-key-verify',
    WECHAT_MINIAPP_VPAY_ENV: '0',
    WECHAT_MINIAPP_MESSAGE_TOKEN: TOKEN,
    WECHAT_MINIAPP_MESSAGE_ENCODING_AES_KEY: AES_KEY,
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
