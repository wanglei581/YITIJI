/**
 * 到机改价或免费放行之后，过期的付款尝试仍可能把旧金额扣成功。
 * 只处理成功回调：失败回调不写成已收款。
 * 钱按尝试上的金额原路退，订单保持现在的支付状态，不按旧金额放行，也不把免费单退成 0 分。
 * 渠道退成则退款单成功；退不成或没有渠道时退款单失败或待人工，并告警。
 * 尝试还没过期时金额对不上，仍当校验失败，不在这里收账。
 */
import type { PrismaService } from '../prisma/prisma.service'
import type { PaymentProviderRegistry } from './payment-provider.factory'
import { ONLINE_PAID_PENDING_REFUND_REASON } from './pending-refund-signal'
import { notifyPrintReturnHold } from './print-return-alert'
import { isChannelAbnormal, parkAbnormalChannelRefund } from './refund-abnormal'
import { REFUND_STATUS_MANUAL_REVIEW } from './refund-amount-hold'
import { STALE_ATTEMPT_REFUND_REASON, staleAttemptRefundNo } from './print-no-paper-refund.constants'

const STALE_ATTEMPT_AUDIT = 'order.stale_attempt_collection'

export interface StaleAttemptCallback {
  orderId: string
  orderNo: string
  payStatus: string
  attemptId: string
  attemptStatus: string
  attemptAmountCents: number
  orderAmountCents: number
  channel: string
  channelTxnNo: string | null
  result: 'success' | 'failed' | 'ignored'
}

async function rememberAudit(db: PrismaService, input: StaleAttemptCallback, refundNo: string): Promise<void> {
  const existing = await db.auditLog.findFirst({
    where: { targetId: input.orderId, action: STALE_ATTEMPT_AUDIT },
    select: { id: true },
  })
  if (existing) return
  await db.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'system',
      action: STALE_ATTEMPT_AUDIT,
      targetType: 'order',
      targetId: input.orderId,
      payloadJson: JSON.stringify({
        attemptId: input.attemptId,
        attemptAmountCents: input.attemptAmountCents,
        orderAmountCents: input.orderAmountCents,
        channel: input.channel,
        channelTxnNo: input.channelTxnNo,
        refundNo,
        reason: 'repriced_attempt_collected',
      }),
    },
  })
}

async function clearCollectedSignal(db: PrismaService, orderId: string): Promise<void> {
  await db.order.updateMany({
    where: { id: orderId, refundReason: ONLINE_PAID_PENDING_REFUND_REASON },
    data: { refundReason: null },
  })
}

/** 过期且金额不符的回调已处理（含失败回调的空确认）时返回 true。调用方据此 ACK。 */
export async function settleStaleRepricedCollection(
  db: PrismaService,
  registry: PaymentProviderRegistry,
  input: StaleAttemptCallback,
): Promise<boolean> {
  if (input.attemptAmountCents === input.orderAmountCents) return false
  if (input.result !== 'success') return input.attemptStatus === 'expired'
  if (input.attemptStatus !== 'expired' && input.attemptStatus !== 'success') return false
  await refundExpiredAttemptCollection(db, registry, input)
  return true
}

/** 按尝试金额退一笔已经不能入账的过期收款。不改订单的支付状态。 */
export async function refundExpiredAttemptCollection(
  db: PrismaService,
  registry: PaymentProviderRegistry,
  input: StaleAttemptCallback,
): Promise<void> {
  const refundNo = staleAttemptRefundNo(input.attemptId)
  const existing = await db.refund.findUnique({ where: { refundNo } })
  if (existing?.status === 'success') return

  if (!input.channelTxnNo) {
    await rememberAudit(db, input, refundNo)
    if (!existing) {
      await db.refund.create({
        data: {
          orderId: input.orderId,
          refundNo,
          amountCents: input.attemptAmountCents,
          status: REFUND_STATUS_MANUAL_REVIEW,
          reason: STALE_ATTEMPT_REFUND_REASON,
          channel: input.channel,
        },
      })
    }
    await notifyPrintReturnHold(db, input.orderId)
    return
  }

  try {
    const marked = await db.paymentAttempt.updateMany({
      where: { id: input.attemptId, status: 'expired' },
      data: { status: 'success', channelTxnNo: input.channelTxnNo, failReason: null },
    })
    if (marked.count === 0) {
      const fresh = await db.paymentAttempt.findUnique({ where: { id: input.attemptId } })
      if (fresh?.status !== 'success' || fresh.channelTxnNo !== input.channelTxnNo) return
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return
    throw error
  }

  await rememberAudit(db, input, refundNo)
  const refund = existing ?? await db.refund.create({
    data: {
      orderId: input.orderId,
      refundNo,
      amountCents: input.attemptAmountCents,
      status: 'pending',
      reason: STALE_ATTEMPT_REFUND_REASON,
      channel: input.channel,
    },
  })
  const provider = registry.get(input.channel)
  if (!provider) {
    await db.refund.update({
      where: { id: refund.id },
      data: { status: 'failed' },
    })
    await notifyPrintReturnHold(db, input.orderId)
    return
  }
  try {
    // 先落「已提交渠道」再调渠道：过期付款已发到渠道的退款，之后要按显式记录挡住核验与三步。
    await db.refund.update({
      where: { id: refund.id },
      data: { channelSubmittedAt: new Date() },
    })
    const executed = await provider.refund({
      orderId: input.orderId,
      orderNo: input.orderNo,
      refundNo,
      amountCents: input.attemptAmountCents,
      orderAmountCents: input.attemptAmountCents,
      outTradeNo: input.attemptId,
      channelTxnNo: input.channelTxnNo,
    })
    if (executed.status === 'success') {
      await db.refund.update({
        where: { id: refund.id },
        data: { status: 'success', channelRefundNo: executed.channelRefundNo },
      })
      await clearCollectedSignal(db, input.orderId)
      return
    }
    if (isChannelAbnormal(executed)) {
      // 退款异常：钱停在渠道中间账户，保持处理中，记诊断并告警。
      await parkAbnormalChannelRefund(db, { refundId: refund.id, refundNo, orderId: input.orderId, channelRefundNo: executed.channelRefundNo, source: 'refund' })
      return
    }
    if (executed.status === 'failed') {
      await db.refund.update({
        where: { id: refund.id },
        data: { status: 'failed', channelRefundNo: executed.channelRefundNo },
      })
      await notifyPrintReturnHold(db, input.orderId)
      return
    }
    await db.refund.update({
      where: { id: refund.id },
      data: { channelRefundNo: executed.channelRefundNo },
    })
    await notifyPrintReturnHold(db, input.orderId)
    return
  } catch {
    await db.refund.update({
      where: { id: refund.id },
      data: { status: 'failed' },
    })
    await notifyPrintReturnHold(db, input.orderId)
  }
}
