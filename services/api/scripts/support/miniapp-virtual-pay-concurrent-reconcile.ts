import assert from 'node:assert/strict'
import { AuditService } from '../../src/audit/audit.service'
import { encryptPhone, hashPhone } from '../../src/common/crypto/phone-identity'
import type { RedisService } from '../../src/common/redis/redis.service'
import { MiniappAccessTokenService } from '../../src/miniapp-access-token/miniapp-access-token.service'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from '../../src/virtual-pay/virtual-pay-order.service'
import {
  VIRTUAL_PAY_QUERY_MAX_AGE_MS,
  VIRTUAL_PAY_QUERY_MIN_AGE_MS,
  VirtualPayReconcileService,
} from '../../src/virtual-pay/virtual-pay-reconcile.service'

const MEMBER_ID = 'vpay-race-reconcile-member'
const OPEN_ID = 'openid-race-reconcile-member'
const PRICE_CENTS = 80808
const ACCESS_TOKEN = 'token-race-reconcile-verify'

export interface ConcurrentReconcileRedisStub {
  get(key: string): Promise<string | null>
  setEx(key: string, ttl: number, value: string): Promise<unknown>
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>
  del(key: string): Promise<number>
}

export async function assertConcurrentReconcileFailureCount(options: {
  prisma: PrismaService
  redis: ConcurrentReconcileRedisStub
}): Promise<void> {
  const { prisma, redis } = options
  const saved = snapshotEnv()
  try {
    applyEnv({ ALERT_WEBHOOK_URL: 'https://alert.local.test/vpay-race' })
    await prisma.virtualPayOrder.updateMany({ where: { status: 'pending' }, data: { status: 'closed' } })
    await prisma.endUser.upsert({
      where: { id: MEMBER_ID },
      create: {
        id: MEMBER_ID,
        phoneHash: hashPhone('13800138035'),
        phoneEnc: encryptPhone('13800138035'),
        wxOpenId: OPEN_ID,
      },
      update: { status: 'active', enabled: true, wxOpenId: OPEN_ID },
    })

    const now = new Date()

    // 3a: 2 个独立实例同时对同一张未超期 pending 单失败查单 → queryFailCount === 2，同因诊断严格 === 1
    const twoFailNo = 'vpracefail2001'
    await prisma.virtualPayOrder.create({
      data: {
        endUserId: MEMBER_ID,
        openId: OPEN_ID,
        serviceKind: 'resume_optimize',
        productId: 'FAKEGOOD1',
        priceCents: PRICE_CENTS,
        env: 0,
        status: 'pending',
        outTradeNo: twoFailNo,
        createdAt: new Date(now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS - 60_000),
      },
    })
    await runConcurrentFailures({ prisma, redis, now, outTradeNo: twoFailNo, concurrency: 2 })
    const row2 = await prisma.virtualPayOrder.findUniqueOrThrow({ where: { outTradeNo: twoFailNo } })
    assert.equal(row2.queryFailCount, 2, '2 并发失败查单必须原子累计 queryFailCount === 2')
    assert.equal(row2.status, 'pending')
    const diags2 = await readDiagnosticReasons(prisma, twoFailNo)
    assert.deepEqual(diags2, ['query_failed'], '2 并发同因失败诊断经 DB CAS 严格只写 1 条')
    await prisma.virtualPayOrder.update({ where: { id: row2.id }, data: { status: 'closed' } })

    // 3b: 3 个独立实例同时对同一张超期 pending 单失败查单 → queryFailCount === 3、manual_review、同因诊断 <= 1 + 1 条 query_manual_review
    const threeFailNo = 'vpracefail3001'
    await prisma.virtualPayOrder.create({
      data: {
        endUserId: MEMBER_ID,
        openId: OPEN_ID,
        serviceKind: 'resume_optimize',
        productId: 'FAKEGOOD1',
        priceCents: PRICE_CENTS,
        env: 0,
        status: 'pending',
        outTradeNo: threeFailNo,
        createdAt: new Date(now.getTime() - VIRTUAL_PAY_QUERY_MAX_AGE_MS - 10 * 60_000),
      },
    })
    const { alertHits } = await runConcurrentFailures({
      prisma,
      redis,
      now,
      outTradeNo: threeFailNo,
      concurrency: 3,
    })
    const row3 = await prisma.virtualPayOrder.findUniqueOrThrow({ where: { outTradeNo: threeFailNo } })
    assert.equal(row3.queryFailCount, 3, '3 并发失败查单必须原子累计 queryFailCount === 3')
    assert.equal(row3.status, 'manual_review', '3 并发失败查单达阈值必须转 manual_review')
    const diags3 = await readDiagnosticReasons(prisma, threeFailNo)
    const queryFailedCount = diags3.filter((r) => r === 'query_failed').length
    const manualReviewCount = diags3.filter((r) => r === 'query_manual_review').length
    assert.ok(queryFailedCount <= 1, `同因 query_failed 诊断必须 <= 1 条，实际=${queryFailedCount}`)
    assert.equal(manualReviewCount, 1, `query_manual_review 诊断必须严格为 1 条，实际=${manualReviewCount}`)
    assert.equal(alertHits, 1, `转人工告警必须严格触发 1 次，实际=${alertHits}`)

    console.log('PASS 并发失败计数原子递增（2/3 实例均精确累加）与诊断去重原子 DB CAS（不写重复诊断）')
  } finally {
    restoreEnv(saved)
  }
}

async function runConcurrentFailures(input: {
  prisma: PrismaService
  redis: ConcurrentReconcileRedisStub
  now: Date
  outTradeNo: string
  concurrency: number
}): Promise<{ alertHits: number }> {
  let arrived = 0
  let releaseBarrier: (() => void) | null = null
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve
  })
  let alertHits = 0
  const barrierFetch: typeof fetch = (async (urlInput: RequestInfo | URL, init?: RequestInit) => {
    const url = String(urlInput)
    if (url.startsWith('https://alert.local.test/')) {
      alertHits += 1
      return json({ errcode: 0 })
    }
    if (url.includes('stable_token')) {
      return json({ access_token: ACCESS_TOKEN, expires_in: 7200 })
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as { order_id?: string }
    if (body.order_id === input.outTradeNo) {
      arrived += 1
      if (arrived >= input.concurrency && releaseBarrier) {
        releaseBarrier()
      }
      await barrier
    }
    return json({ errcode: -1, errmsg: 'concurrent upstream failure' })
  }) as typeof fetch

  const instances = Array.from({ length: input.concurrency }, () => {
    return new VirtualPayReconcileService(
      input.prisma,
      new AuditService(input.prisma),
      new MiniappAccessTokenService(input.redis as unknown as RedisService),
      input.redis as unknown as RedisService,
    )
  })
  await Promise.all(instances.map((svc) => svc.reconcileOnce(input.now, barrierFetch)))
  return { alertHits }
}

async function readDiagnosticReasons(prisma: PrismaService, outTradeNo: string): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION, targetId: outTradeNo },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((row) => (JSON.parse(row.payloadJson) as { reason: string }).reason)
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
    WECHAT_MINIAPP_VPAY_APP_KEY: 'app-key-verify',
    WECHAT_MINIAPP_VPAY_SANDBOX_APP_KEY: 'sandbox-key-verify',
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
