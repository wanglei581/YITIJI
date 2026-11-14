import { randomBytes } from 'node:crypto'
import { BadRequestException, Logger } from '@nestjs/common'
import { deliverOpsAlert } from '../admin-ops/admin-alert-push.service'
import { AuditService } from '../audit/audit.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { PaymentCallbackEvent, PaymentProvider } from './payment-provider.types'
import type { PaymentProviderRegistry } from './payment-provider.factory'
import type { RefundNotifyEvent, RefundQueryResult } from './payment-provider.types'
import {
  SERVICE_REFUND_BACKOFF_MS,
  SERVICE_REFUND_LEASE_MS,
  SERVICE_REFUND_REASON_LATE_PAYMENT,
  SERVICE_REFUND_RETRY_CAP,
  SERVICE_REFUND_RETRY_INTERVAL_MS,
} from './service-order.policy'

const logger = new Logger('ServiceOrderPayment')

type ServiceOrderRow = NonNullable<Awaited<ReturnType<PrismaService['serviceOrder']['findUnique']>>>

export interface RefundRedis {
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>
  del(key: string): Promise<number>
}

/** 微信 Native 优先；没有就用沙箱。不走支付宝，避免和沙箱混配规则搅在一起。 */
export function chargingProvider(registry: PaymentProviderRegistry): PaymentProvider {
  const wechat = registry.get('wechat')
  if (wechat) return wechat
  const sandbox = registry.get('sandbox')
  if (sandbox) return sandbox
  throw new BadRequestException({
    error: { code: 'ONLINE_PAYMENT_DISABLED', message: '这台机器暂时不能收款' },
  })
}

export function newProviderOrderNo(): string {
  return `svc${randomBytes(12).toString('hex')}`
}

export function serviceRefundNo(orderId: string): string {
  return `svc-rfd-${orderId}`
}

/**
 * 支付回调找不到打印尝试时来这里。对不上服务单就返回 matched:false，
 * 调用方仍抛 CALLBACK_ATTEMPT_NOT_FOUND。重复的成功通知不重复记账。
 */
export async function settleServiceOrderCallback(
  db: PrismaService,
  registry: PaymentProviderRegistry,
  audit: AuditService,
  event: PaymentCallbackEvent,
  channel: string,
  redis: RefundRedis | null = null,
): Promise<{ matched: boolean; idempotent?: boolean }> {
  const row = await db.serviceOrder.findUnique({ where: { providerOrderNo: event.attemptId } })
  if (!row) return { matched: false }
  if (row.provider !== channel || event.orderId !== row.id) {
    throw new BadRequestException('CALLBACK_FIELD_MISMATCH')
  }
  if (row.prepayId && row.prepayId !== event.prepayId) {
    throw new BadRequestException('CALLBACK_FIELD_MISMATCH')
  }
  if (row.amountCents !== event.amountCents) {
    throw new BadRequestException('CALLBACK_AMOUNT_MISMATCH')
  }

  if (event.result === 'failed') {
    if (row.status === 'pending') {
      await db.serviceOrder.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { paymentFailed: true },
      })
    }
    return { matched: true, idempotent: row.status !== 'pending' }
  }

  if (event.result !== 'success' || !event.channelTxnNo) {
    throw new BadRequestException('CALLBACK_PAYLOAD_INVALID')
  }
  return markServiceOrderPaid(db, registry, audit, row, event.channelTxnNo, event.prepayId, redis)
}

async function markServiceOrderPaid(
  db: PrismaService,
  registry: PaymentProviderRegistry,
  audit: AuditService,
  row: ServiceOrderRow,
  channelTxnNo: string,
  prepayId: string,
  redis: RefundRedis | null,
): Promise<{ matched: true; idempotent?: boolean }> {
  if (row.channelTxnNo && row.channelTxnNo !== channelTxnNo) {
    throw new BadRequestException('CALLBACK_TXN_CONFLICT')
  }
  if (row.status === 'paid' || row.status === 'consumed' || row.status === 'refunding' || row.status === 'refunded') {
    return { matched: true, idempotent: true }
  }

  if (row.status === 'closed') {
    // 先记成已付，退款才能认领。留在 closed 上的话，退款会直接跳过，钱就留在已关闭的单上。
    const marked = await db.serviceOrder.updateMany({
      where: { id: row.id, status: 'closed', channelTxnNo: null },
      data: {
        status: 'paid',
        channelTxnNo,
        paidAt: new Date(),
        paymentFailed: false,
        prepayId: row.prepayId ?? prepayId,
      },
    })
    if (marked.count === 0) {
      const fresh = await db.serviceOrder.findUnique({ where: { id: row.id } })
      if (fresh?.channelTxnNo === channelTxnNo) return { matched: true, idempotent: true }
      throw new BadRequestException('CALLBACK_TXN_CONFLICT')
    }
    await audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'service_order.paid',
      targetType: 'service_order',
      targetId: row.id,
      payload: { amountCents: row.amountCents, serviceKey: row.serviceKey, provider: row.provider, late: true },
    })
    await executeServiceOrderRefund(db, registry, audit, redis, row.id, SERVICE_REFUND_REASON_LATE_PAYMENT)
    return { matched: true }
  }

  const marked = await db.serviceOrder.updateMany({
    where: { id: row.id, status: 'pending' },
    data: {
      status: 'paid',
      paidAt: new Date(),
      channelTxnNo,
      prepayId: row.prepayId ?? prepayId,
      paymentFailed: false,
    },
  })
  if (marked.count === 0) {
    const fresh = await db.serviceOrder.findUnique({ where: { id: row.id } })
    if (fresh?.channelTxnNo === channelTxnNo) return { matched: true, idempotent: true }
    if (fresh?.channelTxnNo && fresh.channelTxnNo !== channelTxnNo) {
      throw new BadRequestException('CALLBACK_TXN_CONFLICT')
    }
    // 读到 pending 之后单被取消或清场关掉。不能当幂等成功，否则渠道不再重发，钱留在已关闭的单上。
    if (fresh?.status === 'closed' && !fresh.channelTxnNo) {
      return markServiceOrderPaid(db, registry, audit, fresh, channelTxnNo, prepayId, redis)
    }
    return { matched: true, idempotent: true }
  }
  await audit.write({
    actorId: null,
    actorRole: 'kiosk',
    action: 'service_order.paid',
    targetType: 'service_order',
    targetId: row.id,
    payload: { amountCents: row.amountCents, serviceKey: row.serviceKey, provider: row.provider },
  })
  return { matched: true }
}

export interface ServiceRefundOptions {
  manual?: boolean
  actorId?: string | null
}

/**
 * 按原路退。渠道没明确成功就留在 refunding，绝不标成已退。
 * 同一张单的 refundNo 固定，渠道按这个号幂等，重试不会退第二次。
 */
export async function executeServiceOrderRefund(
  db: PrismaService,
  registry: PaymentProviderRegistry,
  audit: AuditService,
  redis: RefundRedis | null,
  orderId: string,
  reason: string,
  opts?: ServiceRefundOptions,
): Promise<'refunded' | 'refunding' | 'refund_failed' | 'skipped'> {
  const now = new Date()
  const existing = await db.serviceOrder.findUnique({ where: { id: orderId } })
  if (!existing) return 'skipped'
  if (existing.status === 'refunded') return 'refunded'
  const manual = opts?.manual === true
  const cap = manual ? SERVICE_REFUND_RETRY_CAP + 1 : SERVICE_REFUND_RETRY_CAP
  const retryable = existing.status === 'refunding' || existing.status === 'refund_failed'
  if (retryable && existing.refundAttempts >= cap) return 'skipped'
  if (existing.status !== 'paid' && existing.status !== 'consumed' && !retryable) return 'skipped'

  const refundNo = existing.refundNo ?? serviceRefundNo(existing.id)
  const nextRefundAt = new Date(now.getTime() + SERVICE_REFUND_RETRY_INTERVAL_MS)
  const claimed = await claimRefund(db, existing, reason, refundNo, nextRefundAt, now, cap, manual)
  if (claimed !== 1) {
    const fresh = await db.serviceOrder.findUnique({ where: { id: orderId } })
    if (fresh?.status === 'refunded') return 'refunded'
    return 'skipped'
  }

  if (manual) {
    await audit.write({
      actorId: opts?.actorId ?? null,
      actorRole: opts?.actorId ? 'admin' : 'system',
      action: 'service_order.refund_retry',
      targetType: 'service_order',
      targetId: existing.id,
      payload: { reason, amountCents: existing.amountCents, refundNo, refundAttempts: existing.refundAttempts },
    })
  }

  const provider = registry.get(existing.provider)
  const processing = existing.refundChannelState === 'processing' && Boolean(existing.refundNo)
  try {
    if (processing) {
      if (!provider?.queryRefund) {
        await noteStillProcessing(db, redis, existing)
        return 'refunding'
      }
      const queried = await provider.queryRefund({ refundNo, outTradeNo: existing.providerOrderNo })
      return applyRefundQuery(db, audit, redis, existing, reason, refundNo, queried, manual)
    }
    if (!provider) return markRefundFailed(db, redis, existing.id, manual)
    const result = await provider.refund({
      orderId: existing.id,
      orderNo: existing.providerOrderNo,
      refundNo,
      amountCents: existing.amountCents,
      orderAmountCents: existing.amountCents,
      outTradeNo: existing.providerOrderNo,
      channelTxnNo: existing.channelTxnNo,
    })
    if (result.status === 'success') {
      if (amountMismatch(result.refundAmountCents, existing.amountCents)) {
        return markRefundFailed(db, redis, existing.id, manual)
      }
      return markRefunded(db, audit, existing, reason, refundNo, result.channelRefundNo)
    }
    if (result.status === 'failed') return markRefundFailed(db, redis, existing.id, manual)
    await noteStillProcessing(db, redis, existing)
    return 'refunding'
  } catch (error) {
    logger.warn(`service refund call failed id=${existing.id}`)
    void error
    return markRefundFailed(db, redis, existing.id, manual)
  }
}

function amountMismatch(reported: number | null | undefined, amountCents: number): boolean {
  return typeof reported === 'number' && reported !== amountCents
}

async function applyRefundQuery(
  db: PrismaService,
  audit: AuditService,
  redis: RefundRedis | null,
  existing: ServiceOrderRow,
  reason: string,
  refundNo: string,
  queried: RefundQueryResult,
  manual: boolean,
): Promise<'refunded' | 'refunding' | 'refund_failed' | 'skipped'> {
  if (queried.status === 'success') {
    if (amountMismatch(queried.refundAmountCents, existing.amountCents)) {
      return markRefundFailed(db, redis, existing.id, manual)
    }
    return markRefunded(db, audit, existing, reason, refundNo, queried.channelRefundNo)
  }
  if (queried.status === 'processing') {
    await noteStillProcessing(db, redis, existing)
    return 'refunding'
  }
  return markRefundFailed(db, redis, existing.id, manual)
}

/** 微信退款通知里 svc-rfd- 开头的单号属于服务单，不进打印退款表。 */
export async function settleServiceRefundNotify(
  db: PrismaService,
  audit: AuditService,
  redis: RefundRedis | null,
  event: Pick<RefundNotifyEvent, 'refundNo' | 'status' | 'refundAmountCents' | 'channelRefundNo'>,
): Promise<{ handled: true; idempotent?: boolean }> {
  const prefix = 'svc-rfd-'
  if (!event.refundNo.startsWith(prefix)) throw new BadRequestException('REFUND_NOTIFY_UNKNOWN_REFUND')
  const row = await db.serviceOrder.findUnique({ where: { id: event.refundNo.slice(prefix.length) } })
  if (!row || row.refundNo !== event.refundNo) throw new BadRequestException('REFUND_NOTIFY_UNKNOWN_REFUND')
  if (row.status === 'refunded') return { handled: true, idempotent: true }
  if (event.status === 'success') {
    if (event.refundAmountCents !== null && event.refundAmountCents !== row.amountCents) {
      throw new BadRequestException('REFUND_NOTIFY_AMOUNT_MISMATCH')
    }
    const updated = await markRefunded(db, audit, row, row.refundReason ?? SERVICE_REFUND_REASON_LATE_PAYMENT, event.refundNo, event.channelRefundNo)
    return { handled: true, idempotent: updated !== 'refunded' }
  }
  if (row.status === 'refunding' || row.status === 'refund_failed') {
    await markRefundFailed(db, redis, row.id, false)
  }
  return { handled: true }
}

async function claimRefund(
  db: PrismaService,
  existing: ServiceOrderRow,
  reason: string,
  refundNo: string,
  nextRefundAt: Date,
  now: Date,
  cap: number,
  manual: boolean,
): Promise<number> {
  const refundLeaseUntil = new Date(now.getTime() + SERVICE_REFUND_LEASE_MS)
  if (existing.status === 'paid' || existing.status === 'consumed') {
    const res = await db.serviceOrder.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { status: 'refunding', refundReason: reason, refundNo, nextRefundAt, refundLeaseUntil },
    })
    return res.count
  }
  const res = await db.serviceOrder.updateMany({
    where: {
      id: existing.id,
      status: { in: ['refunding', 'refund_failed'] },
      refundAttempts: { lt: cap },
      AND: [
        { OR: [{ refundLeaseUntil: null }, { refundLeaseUntil: { lt: now } }] },
        ...(manual ? [] : [{ OR: [{ nextRefundAt: null }, { nextRefundAt: { lte: now } }] }]),
      ],
    },
    data: { status: 'refunding', nextRefundAt, refundReason: reason, refundNo, refundLeaseUntil },
  })
  return res.count
}

async function markRefunded(
  db: PrismaService,
  audit: AuditService,
  existing: Pick<ServiceOrderRow, 'id' | 'amountCents'>,
  reason: string,
  refundNo: string,
  channelRefundNo: string | null,
): Promise<'refunded' | 'skipped'> {
  const updated = await db.serviceOrder.updateMany({
    where: { id: existing.id, status: { in: ['refunding', 'refund_failed', 'paid', 'consumed'] } },
    data: {
      status: 'refunded',
      refundedAt: new Date(),
      channelRefundNo,
      refundReason: reason,
      nextRefundAt: null,
      refundLeaseUntil: null,
      refundChannelState: 'success',
    },
  })
  if (updated.count !== 1) return 'skipped'
  await audit.write({
    actorId: null,
    actorRole: 'system',
    action: 'service_order.refunded',
    targetType: 'service_order',
    targetId: existing.id,
    payload: { reason, amountCents: existing.amountCents, refundNo, channelRefundNo },
  })
  return 'refunded'
}

/** 受理中不加失败次数。退避 2、5、15、30 分钟；超过窗口告警一次，并停在最后一档。 */
async function noteStillProcessing(db: PrismaService, redis: RefundRedis | null, existing: ServiceOrderRow): Promise<void> {
  const tries = existing.refundProcessingTries
  const index = Math.min(tries, SERVICE_REFUND_BACKOFF_MS.length - 1)
  const wait = SERVICE_REFUND_BACKOFF_MS[index] ?? SERVICE_REFUND_RETRY_INTERVAL_MS
  await db.serviceOrder.updateMany({
    where: { id: existing.id, status: 'refunding' },
    data: {
      refundChannelState: 'processing',
      refundProcessingTries: { increment: 1 },
      nextRefundAt: new Date(Date.now() + wait),
      refundLeaseUntil: null,
    },
  })
  if (tries >= SERVICE_REFUND_BACKOFF_MS.length) {
    await alertRefund(redis, existing.id, `processing-window-${existing.refundAttempts}`)
  }
}

/** 失败才加次数。到自动或手动上限就停在退款失败，不再留在退款中。 */
async function markRefundFailed(
  db: PrismaService,
  redis: RefundRedis | null,
  orderId: string,
  manual: boolean,
): Promise<'refunding' | 'refund_failed'> {
  await db.serviceOrder.updateMany({
    where: { id: orderId, status: 'refunding' },
    data: { refundAttempts: { increment: 1 }, refundLeaseUntil: null, refundChannelState: 'failed' },
  })
  const row = await db.serviceOrder.findUnique({
    where: { id: orderId },
    select: { refundAttempts: true },
  })
  const attempts = row?.refundAttempts ?? 0
  const exhausted = manual ? attempts >= SERVICE_REFUND_RETRY_CAP + 1 : attempts >= SERVICE_REFUND_RETRY_CAP
  if (exhausted) {
    await db.serviceOrder.updateMany({
      where: { id: orderId, status: 'refunding' },
      data: { status: 'refund_failed', nextRefundAt: null, refundLeaseUntil: null },
    })
    await alertRefund(redis, orderId, `refund-failed-${attempts}`)
    return 'refund_failed'
  }
  await alertRefund(redis, orderId, `refund-${attempts}`)
  return 'refunding'
}

async function alertRefund(redis: RefundRedis | null, orderId: string, episodeToken: string): Promise<void> {
  if (!redis) return
  try {
    await deliverOpsAlert({
      redis,
      webhook: process.env['ALERT_WEBHOOK_URL']?.trim() || null,
      fetchImpl: fetch,
      alert: {
        subjectKey: `service-order:${orderId}`,
        episodeToken,
        type: 'service_order_refund_failed',
        severity: 'error',
        title: '服务单退款失败',
        terminalCode: null,
      },
      state: 'firing',
    })
  } catch {
    // 告警失败不改变退款状态。
  }
}
