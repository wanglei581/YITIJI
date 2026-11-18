/**
 * 渠道退款成功通知的收敛。
 *
 * 同一单不许既出纸又退款。退款曾经失败、订单回到已付款之后，取件可以建出打印任务；
 * 渠道随后又通知 SUCCESS 时，不能把这单改成已退款。退款行改成待人工，订单停在已付款。
 * 打印任务已经失败（纸没有出去）时仍允许收敛为退款成功，否则没出纸的退款在渠道先失败、后补成功时退不掉。
 * 退款还是 pending、任务也还是 pending 的旧路径保持原样：那不是「失败之后又放行」。
 */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { PrismaTransactionClient } from '../prisma/prisma.service'
import { REFUND_STATUS_MANUAL_REVIEW } from './refund-amount-hold'
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
    select: { printTaskId: true },
  })
  if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
  const task = order.printTaskId
    ? await tx.printTask.findUnique({
      where: { id: order.printTaskId },
      select: { status: true, printOutcome: true },
    })
    : null
  // 任务还没失败、也没取消，就还能出纸。printOutcome 为空的 pending 也算已经放行。
  // 任务已经失败才视为没出纸，迟到的成功通知仍可记成退款成功。
  const printable = task != null && task.status !== 'failed' && task.status !== 'cancelled'
  const alreadyPrinted = task?.printOutcome === 'printed'
  if (input.priorStatus === 'failed' && (printable || alreadyPrinted)) {
    const held = await tx.refund.updateMany({
      where: { id: input.refundId, status: { in: ['pending', 'failed'] } },
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

  const casRefund = await tx.refund.updateMany({
    where: { id: input.refundId, status: { in: ['pending', 'failed'] } },
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
