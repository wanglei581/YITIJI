/**
 * 已经退成一部分之后，剩下的钱按同一退款入口再退。
 * 过期付款的成功退款不属于这一笔实付，不计入已退。
 */
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import { payableCents } from './pending-refund-signal'
import { STALE_ATTEMPT_REFUND_REASON } from './print-no-paper-refund.constants'

type RefundDb = PrismaService | PrismaTransactionClient

const NOT_STALE = {
  OR: [
    { reason: null },
    { reason: { not: STALE_ATTEMPT_REFUND_REASON } },
  ],
}

export async function nonStaleSuccessCents(
  db: RefundDb,
  orderId: string,
  exceptRefundId?: string,
): Promise<number> {
  const sum = await db.refund.aggregate({
    where: {
      orderId,
      status: 'success',
      ...(exceptRefundId ? { id: { not: exceptRefundId } } : {}),
      ...NOT_STALE,
    },
    _sum: { amountCents: true },
  })
  return sum._sum?.amountCents ?? 0
}

/** 只有部分退款的单才有剩余。返回 null 表示这不是部分退款。 */
export async function remainderAmountCents(
  db: RefundDb,
  order: { id: string; payStatus: string; amountCents: number; discountCents: number },
): Promise<number | null> {
  if (order.payStatus !== 'partial_refunded') return null
  return payableCents(order) - await nonStaleSuccessCents(db, order.id)
}

export async function settlementAfterSuccess(
  db: RefundDb,
  refund: { id: string; orderId: string; amountCents: number; reason: string | null },
  order: { amountCents: number; discountCents: number },
): Promise<{ payStatus: 'refunded' | 'partial_refunded'; refundedAmountCents: number; refundReason: string | null }> {
  const prior = await nonStaleSuccessCents(db, refund.orderId, refund.id)
  const added = refund.reason === STALE_ATTEMPT_REFUND_REASON ? 0 : refund.amountCents
  const total = prior + added
  const payable = payableCents(order)
  // 第一次退款 prior 也是 0。不能因为没有更早的成功记录，就把 50 分记成整单已退。
  const fully = payable <= 0 || total >= payable
  return {
    payStatus: fully ? 'refunded' : 'partial_refunded',
    refundedAmountCents: total,
    refundReason: refund.reason,
  }
}

/** 这一笔没退成：没有更早的成功退款就回到已付；有的话回到部分退款并保留已退金额。 */
export async function payStatusAfterRefundFailure(
  db: RefundDb,
  orderId: string,
): Promise<{ payStatus: 'paid' | 'partial_refunded'; refundedAmountCents?: number }> {
  const prior = await nonStaleSuccessCents(db, orderId)
  if (prior <= 0) return { payStatus: 'paid' }
  return { payStatus: 'partial_refunded', refundedAmountCents: prior }
}
