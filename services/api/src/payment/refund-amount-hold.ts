/**
 * 渠道退款额必须等于整单实付。少退、多退或退款行本身不是整单时，
 * 不把订单打成已退款，也不退回 paid（避免对已出的部分再自动打一笔全额）。
 * Refund.status 写成 manual_review，订单保持 refunding，并记一条审计。
 * 重复通知命中同一标记后不再写审计，调用方应对渠道回成功，避免重试风暴。
 */
import type { PrismaService } from '../prisma/prisma.service'

export const REFUND_AMOUNT_MISMATCH_MANUAL_REASON = 'REFUND_AMOUNT_MISMATCH_MANUAL'
export const REFUND_STATUS_MANUAL_REVIEW = 'manual_review'

type AmountOrder = { id: string; amountCents: number; discountCents: number }

export function wholeOrderPayableCents(order: { amountCents: number; discountCents: number }): number {
  return Math.max(0, order.amountCents - order.discountCents)
}

/** 渠道金额与本地退款行都必须等于整单实付。任一不等即不是整单退。 */
export function isWholeOrderRefundAmount(
  order: { amountCents: number; discountCents: number },
  channelAmountCents: number,
  recordedRefundAmountCents: number,
): boolean {
  const whole = wholeOrderPayableCents(order)
  return channelAmountCents === whole && recordedRefundAmountCents === whole
}

export async function holdMismatchedChannelRefund(
  db: PrismaService,
  input: {
    refundId: string
    refundNo: string
    order: AmountOrder
    recordedAmountCents: number
    notifyAmountCents: number | null
    channelRefundNo: string | null
  },
): Promise<'held' | 'idempotent'> {
  const [refund, order] = await Promise.all([
    db.refund.findUnique({ where: { id: input.refundId }, select: { status: true } }),
    db.order.findUnique({ where: { id: input.order.id }, select: { payStatus: true, refundReason: true } }),
  ])
  if (
    refund?.status === REFUND_STATUS_MANUAL_REVIEW &&
    order?.refundReason === REFUND_AMOUNT_MISMATCH_MANUAL_REASON &&
    order.payStatus === 'refunding'
  ) {
    return 'idempotent'
  }
  let held = false
  await db.$transaction(async (tx) => {
    const cas = await tx.refund.updateMany({
      where: { id: input.refundId, status: 'pending' },
      data: {
        status: REFUND_STATUS_MANUAL_REVIEW,
        ...(input.channelRefundNo ? { channelRefundNo: input.channelRefundNo } : {}),
      },
    })
    if (cas.count !== 1) return
    await tx.order.updateMany({
      where: { id: input.order.id, payStatus: 'refunding' },
      data: { refundReason: REFUND_AMOUNT_MISMATCH_MANUAL_REASON },
    })
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'system',
        action: 'refund.notify_amount_mismatch',
        targetType: 'order',
        targetId: input.order.id,
        payloadJson: JSON.stringify({
          refundNo: input.refundNo,
          notifyAmountCents: input.notifyAmountCents,
          localAmountCents: input.recordedAmountCents,
          wholeOrderCents: wholeOrderPayableCents(input.order),
          manualReview: true,
          autoRefund: false,
        }),
      },
    })
    held = true
  })
  return held ? 'held' : 'idempotent'
}
