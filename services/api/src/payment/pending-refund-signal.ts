/**
 * 待退款信号（复用 Order.refundReason，不新建 Prisma 字段）。
 *
 * - PAID_UNFULFILLED_PENDING_REFUND：订单已是 paid，纸没出（废弃孤单 / 核查未出纸）。
 * - ONLINE_PAID_PENDING_REFUND：渠道已收款但取件窗口已关，订单未转 paid（不铸幽灵码、不履约）。
 *
 * 两条都不创建 Refund 行、不调渠道出款。真正出款仍走 canonical RefundService。
 */
export const PAID_UNFULFILLED_PENDING_REFUND_REASON = 'PAID_UNFULFILLED_PENDING_REFUND'
export const ONLINE_PAID_PENDING_REFUND_REASON = 'ONLINE_PAID_PENDING_REFUND'

/** 迟到回调待退：渠道已收款、订单尚未转 paid。refunding 锁期间用 {@link isOnlineCollectedRefundLock}。 */
export const ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES = ['unpaid', 'paying', 'closed'] as const

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

export function isOnlineCollectedPendingRefund(order: {
  payStatus: string
  refundReason: string | null
}): boolean {
  return (
    order.refundReason === ONLINE_PAID_PENDING_REFUND_REASON &&
    (ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES as readonly string[]).includes(order.payStatus)
  )
}

/** refunding 锁期间仍能识别「从未转 paid 的渠道已收款待退」，用于失败回滚到 closed 而非 paid。 */
export function isOnlineCollectedRefundLock(order: {
  refundReason: string | null
  paymentSource?: string | null
  paidAt?: Date | null
}): boolean {
  return (
    order.refundReason === ONLINE_PAID_PENDING_REFUND_REASON &&
    order.paymentSource == null &&
    order.paidAt == null
  )
}

/** Admin refundRequired：已付款未出纸，或渠道已收款但订单未转 paid。不把后者伪装成 payStatus=paid。 */
export function isAdminRefundRequired(order: {
  payStatus: string
  refundReason: string | null
}): boolean {
  return isPaidUnfulfilledRefundRequired(order) || isOnlineCollectedPendingRefund(order)
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
