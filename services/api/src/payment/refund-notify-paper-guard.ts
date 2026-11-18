/**
 * 渠道退款成功通知的收敛。
 *
 * 同一单不许既出纸又退款。任务已领取、打印中、已完成，或订单已标成领取中、打印中，
 * 或已经核对为出纸，都算已经放行。这时无论退款原先是待确认还是失败，都不能记成退款成功。
 * 任务还是待打印、纸也没出去：迟到的成功通知记成退款成功。打印任务状态不在这里改。
 */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { PrismaTransactionClient } from '../prisma/prisma.service'
import { REFUND_STATUS_MANUAL_REVIEW } from './refund-amount-hold'
import { paperAlreadyReleased } from './refund-paper-exclusion'
import {
  ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES,
  ONLINE_PAID_PENDING_REFUND_REASON,
} from './pending-refund-signal'

const PAPER_ALREADY_RELEASED_AUDIT = 'refund.notify_paper_already_released'

export async function convergeNotifiedRefundSuccess(
  tx: PrismaTransactionClient,
  input: {
    refundId: string
    orderId: string
    priorStatus: string
    channelRefundNo: string | null
    amountCents: number
    reason: string | null
  },
): Promise<'completed' | 'blocked' | 'idempotent'> {
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: { printTaskId: true, taskStatus: true },
  })
  if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
  const task = order.printTaskId
    ? await tx.printTask.findUnique({
      where: { id: order.printTaskId },
      select: { status: true, printOutcome: true },
    })
    : null
  const released = paperAlreadyReleased({
    taskStatus: task?.status ?? null,
    orderTaskStatus: order.taskStatus,
    printOutcome: task?.printOutcome ?? null,
  })
  const canBlock = input.priorStatus === 'failed' || input.priorStatus === 'pending' || input.priorStatus === 'withdrawn'
  if (canBlock && released) {
    const held = await tx.refund.updateMany({
      where: { id: input.refundId, status: { in: ['pending', 'failed', 'withdrawn'] } },
      data: {
        status: REFUND_STATUS_MANUAL_REVIEW,
        ...(input.channelRefundNo ? { channelRefundNo: input.channelRefundNo } : {}),
      },
    })
    if (held.count === 0) return 'idempotent'
    await tx.order.updateMany({
      where: { id: input.orderId, payStatus: 'refunding' },
      data: { payStatus: 'paid' },
    })
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'system',
        action: PAPER_ALREADY_RELEASED_AUDIT,
        targetType: 'order',
        targetId: input.orderId,
        payloadJson: JSON.stringify({
          refundNo: input.refundId,
          amountCents: input.amountCents,
          reason: input.reason,
          detail: '已经放行出纸，这笔退款不能再记成成功',
        }),
      },
    })
    return 'blocked'
  }

  // 管理员已经关单。渠道事后又通知退成时不能抛错（渠道会重试），也不能自动改成已退。
  // 退款行回到待人工，订单保持关闭。
  if (input.priorStatus === 'closed') {
    const reopened = await tx.refund.updateMany({
      where: { id: input.refundId, status: 'closed' },
      data: {
        status: REFUND_STATUS_MANUAL_REVIEW,
        ...(input.channelRefundNo ? { channelRefundNo: input.channelRefundNo } : {}),
      },
    })
    if (reopened.count === 0) return 'idempotent'
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'system',
        action: PAPER_ALREADY_RELEASED_AUDIT,
        targetType: 'order',
        targetId: input.orderId,
        payloadJson: JSON.stringify({
          refundNo: input.refundId,
          amountCents: input.amountCents,
          reason: input.reason,
          detail: '订单已经关闭，渠道又通知退成，改回待人工。订单保持关闭',
        }),
      },
    })
    return 'blocked'
  }

  const casRefund = await tx.refund.updateMany({
    where: { id: input.refundId, status: { in: ['pending', 'failed', 'withdrawn'] } },
    data: {
      status: 'success',
      ...(input.channelRefundNo ? { channelRefundNo: input.channelRefundNo } : {}),
    },
  })
  if (casRefund.count === 0) return 'idempotent'
  await tx.order.updateMany({
    where: {
      id: input.orderId,
      OR: [
        { payStatus: { in: ['refunding', 'paid'] } },
        {
          payStatus: { in: [...ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES] },
          refundReason: ONLINE_PAID_PENDING_REFUND_REASON,
          paymentSource: null,
          paidAt: null,
        },
      ],
    },
    data: {
      payStatus: 'refunded',
      refundedAt: new Date(),
      refundReason: input.reason,
      refundedAmountCents: input.amountCents,
    },
  })
  const fresh = await tx.order.findUnique({ where: { id: input.orderId }, select: { payStatus: true } })
  if (!fresh) throw new NotFoundException('ORDER_NOT_FOUND')
  if (fresh.payStatus !== 'refunded') throw new BadRequestException('ORDER_INVALID_TRANSITION')
  return 'completed'
}
