/**
 * 已付款但未履约（废弃孤单 / 核查未出纸）的待退款信号。
 *
 * 复用 Order.refundReason，不新建 Prisma 字段，不创建 Refund 行、不调渠道出款。
 * 真正出款仍走 canonical RefundService（管理员在订单页手动发起）。
 *
 * 与 ONLINE_PAID_PENDING_REFUND 的区别：那条是「渠道已收款但订单未转 paid」；
 * 本信号是「订单已是 paid，纸没出」。
 */
export const PAID_UNFULFILLED_PENDING_REFUND_REASON = 'PAID_UNFULFILLED_PENDING_REFUND'

export type PaidUnfulfilledRefundOrder = {
  id: string
  payStatus: string
  amountCents: number
  discountCents: number
  refundReason: string | null
}

export function payableCents(order: { amountCents: number; discountCents: number }): number {
  return Math.max(0, order.amountCents - order.discountCents)
}

export function shouldSignalPaidUnfulfilledRefund(order: {
  payStatus: string
  amountCents: number
  discountCents: number
}): boolean {
  return order.payStatus === 'paid' && payableCents(order) > 0
}

export function isPaidUnfulfilledRefundRequired(order: {
  payStatus: string
  refundReason: string | null
}): boolean {
  return order.payStatus === 'paid' && order.refundReason === PAID_UNFULFILLED_PENDING_REFUND_REASON
}

/** CAS 写入待退款标记。已有同标记则视为已标记；已有其它 refundReason 不覆盖。不创建 Refund。 */
export async function markPaidUnfulfilledRefundRequired(
  db: { order: { updateMany: (args: never) => Promise<{ count: number }> } },
  order: PaidUnfulfilledRefundOrder,
): Promise<boolean> {
  if (!shouldSignalPaidUnfulfilledRefund(order)) return false
  if (order.refundReason === PAID_UNFULFILLED_PENDING_REFUND_REASON) return true
  if (order.refundReason) return false
  const updateMany = db.order.updateMany as (args: {
    where: { id: string; payStatus: string; refundReason: null }
    data: { refundReason: string }
  }) => Promise<{ count: number }>
  const res = await updateMany({
    where: {
      id: order.id,
      payStatus: 'paid',
      refundReason: null,
    },
    data: { refundReason: PAID_UNFULFILLED_PENDING_REFUND_REASON },
  })
  return res.count === 1
}
