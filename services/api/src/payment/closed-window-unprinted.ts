/**
 * 已付、取件窗口已经关上、纸还没出去：按实付原路退。
 * 退成则订单已退。退不成就留下待人工，不能停在已付且没有任何退款去向。
 */
import type { PrismaService } from '../prisma/prisma.service'
import { isPickupWindowClosed } from './order-status.service'
import { payableCents } from './pending-refund-signal'
import { notifyPrintReturnHold } from './print-return-alert'
import { explainPrintRefund } from './print-return-disposition'
import { paperAlreadyReleased } from './refund-paper-exclusion'
import type { RefundService } from './refund.service'

export const PICKUP_WINDOW_CLOSED_UNPRINTED_REASON = 'pickup_window_closed_unprinted'

export async function settleClosedWindowUnprinted(
  db: PrismaService,
  refunds: RefundService,
  orderId: string,
): Promise<'refunded' | 'manual' | 'skipped'> {
  const order = await db.order.findUnique({ where: { id: orderId } })
  if (!order || order.payStatus !== 'paid') return 'skipped'
  if (payableCents(order) <= 0) return 'skipped'
  if (!isPickupWindowClosed(order)) return 'skipped'
  const task = order.printTaskId
    ? await db.printTask.findUnique({
      where: { id: order.printTaskId },
      select: { status: true, printOutcome: true },
    })
    : null
  if (paperAlreadyReleased({
    taskStatus: task?.status ?? null,
    orderTaskStatus: order.taskStatus,
    printOutcome: task?.printOutcome ?? null,
  })) return 'skipped'
  if (order.pickupStatus === 'pending') {
    await db.order.updateMany({
      where: { id: orderId, payStatus: 'paid', pickupStatus: 'pending', printTaskId: order.printTaskId },
      data: { pickupStatus: 'expired', taskStatus: order.taskStatus === 'awaiting_payment' ? 'expired' : order.taskStatus },
    })
  }
  try {
    const result = await refunds.refund(orderId, {
      reason: PICKUP_WINDOW_CLOSED_UNPRINTED_REASON,
      operatorId: 'system:pickup-window',
      unreleasedOnly: order.printTaskId == null,
    })
    if (result.order.payStatus === 'refunded' || result.refund.status === 'success') return 'refunded'
    return 'manual'
  } catch {
    const view = await explainPrintRefund(db, orderId)
    if (view.disposition === 'manual' || view.disposition === 'auto_failed') return 'manual'
    const fresh = await db.order.findUnique({ where: { id: orderId } })
    if (!fresh || fresh.payStatus !== 'paid') return 'manual'
    const refundNo = `RFD-WINDOW-${fresh.orderNo}`
    const existing = await db.refund.findUnique({ where: { refundNo } })
    if (!existing) {
      await db.refund.create({
        data: {
          orderId,
          refundNo,
          amountCents: payableCents(fresh),
          status: 'manual_review',
          reason: PICKUP_WINDOW_CLOSED_UNPRINTED_REASON,
          channel: fresh.paymentSource ?? 'offline',
        },
      })
    }
    await notifyPrintReturnHold(db, orderId)
    return 'manual'
  }
}
