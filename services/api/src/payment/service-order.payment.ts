import { randomBytes } from 'node:crypto'
import { BadRequestException, Logger } from '@nestjs/common'
import { deliverOpsAlert } from '../admin-ops/admin-alert-push.service'
import { AuditService } from '../audit/audit.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { PaymentCallbackEvent, PaymentProvider } from './payment-provider.types'
import type { PaymentProviderRegistry } from './payment-provider.factory'
import {
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
  return markServiceOrderPaid(db, registry, audit, row, event.channelTxnNo, event.prepayId)
}

async function markServiceOrderPaid(
  db: PrismaService,
  registry: PaymentProviderRegistry,
  audit: AuditService,
  row: ServiceOrderRow,
  channelTxnNo: string,
  prepayId: string,
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
    await executeServiceOrderRefund(db, registry, audit, null, row.id, SERVICE_REFUND_REASON_LATE_PAYMENT)
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
): Promise<'refunded' | 'refunding' | 'skipped'> {
  const now = new Date()
  const nextRefundAt = new Date(now.getTime() + SERVICE_REFUND_RETRY_INTERVAL_MS)
  const existing = await db.serviceOrder.findUnique({ where: { id: orderId } })
  if (!existing) return 'skipped'
  if (existing.status === 'refunded') return 'refunded'
  const cap = opts?.manual ? SERVICE_REFUND_RETRY_CAP + 1 : SERVICE_REFUND_RETRY_CAP
  if (existing.status === 'refunding' && existing.refundAttempts >= cap) return 'skipped'
  if (existing.status !== 'paid' && existing.status !== 'consumed' && existing.status !== 'refunding') return 'skipped'

  const refundNo = existing.refundNo ?? serviceRefundNo(existing.id)
  const claimed = await claimRefund(db, existing, reason, refundNo, nextRefundAt, now, cap, opts?.manual === true)
  if (claimed !== 1) {
    const fresh = await db.serviceOrder.findUnique({ where: { id: orderId } })
    if (fresh?.status === 'refunded') return 'refunded'
    return 'skipped'
  }

  if (opts?.manual) {
    await audit.write({
      actorId: opts.actorId ?? null,
      actorRole: opts.actorId ? 'admin' : 'system',
      action: 'service_order.refund_retry',
      targetType: 'service_order',
      targetId: existing.id,
      payload: { reason, amountCents: existing.amountCents, refundNo, refundAttempts: existing.refundAttempts },
    })
  }

  const provider = registry.get(existing.provider)
  if (!provider) {
    await markRefundFailed(db, redis, existing.id)
    return 'refunding'
  }
  try {
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
      await db.serviceOrder.updateMany({
        where: { id: existing.id, status: 'refunding' },
        data: {
          status: 'refunded',
          refundedAt: new Date(),
          channelRefundNo: result.channelRefundNo,
          refundReason: reason,
          nextRefundAt: null,
        },
      })
      await audit.write({
        actorId: null,
        actorRole: 'system',
        action: 'service_order.refunded',
        targetType: 'service_order',
        targetId: existing.id,
        payload: { reason, amountCents: existing.amountCents, refundNo, channelRefundNo: result.channelRefundNo },
      })
      return 'refunded'
    }
    if (result.status === 'failed') {
      await markRefundFailed(db, redis, existing.id)
      return 'refunding'
    }
    return 'refunding'
  } catch (error) {
    logger.warn(`service refund call failed id=${existing.id}`)
    void error
    await markRefundFailed(db, redis, existing.id)
    return 'refunding'
  }
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
  if (existing.status === 'paid' || existing.status === 'consumed') {
    const res = await db.serviceOrder.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { status: 'refunding', refundReason: reason, refundNo, nextRefundAt },
    })
    return res.count
  }
  const res = await db.serviceOrder.updateMany({
    where: {
      id: existing.id,
      status: 'refunding',
      refundAttempts: { lt: cap },
      ...(manual ? {} : { OR: [{ nextRefundAt: null }, { nextRefundAt: { lte: now } }] }),
    },
    data: { nextRefundAt, refundReason: reason, refundNo },
  })
  return res.count
}

/** 失败才加次数。受理中不加，避免把还在处理的退款提前打到上限。 */
async function markRefundFailed(db: PrismaService, redis: RefundRedis | null, orderId: string): Promise<void> {
  await db.serviceOrder.updateMany({
    where: { id: orderId, status: 'refunding' },
    data: { refundAttempts: { increment: 1 } },
  })
  if (!redis) return
  const row = await db.serviceOrder.findUnique({
    where: { id: orderId },
    select: { refundAttempts: true, terminalId: true },
  })
  try {
    await deliverOpsAlert({
      redis,
      webhook: process.env['ALERT_WEBHOOK_URL']?.trim() || null,
      fetchImpl: fetch,
      alert: {
        subjectKey: `service-order:${orderId}`,
        episodeToken: `refund-${row?.refundAttempts ?? 0}`,
        type: 'service_order_refund_failed',
        severity: 'error',
        title: '服务单退款失败',
        terminalCode: null,
      },
      state: 'firing',
    })
  } catch {
    // 告警失败不改变退款状态，下一拍还会再试。
  }
}
