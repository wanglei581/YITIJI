/**
 * 渠道退款成功通知的收敛。
 *
 * 同一单不许既出纸又默默记成正常已退。任务已领取、打印中、已完成，或订单已标成领取中、打印中，
 * 或已经核对为出纸，都算已经放行。此时渠道退成仍是事实：先把退款行落成 success（绝不掩盖/回滚），
 * 不把订单静默改成已退，记下冲突审计并返回 blocked 触发人工核对告警。
 * 任务还是待打印、纸也没出去：迟到的成功通知记成退款成功。打印任务状态不在这里改。
 */
import { NotFoundException } from '@nestjs/common'
import type { PrismaTransactionClient } from '../prisma/prisma.service'
import { REFUND_STATUS_MANUAL_REVIEW } from './refund-amount-hold'
import { paperAlreadyReleased } from './refund-paper-exclusion'
import {
  ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES,
  ONLINE_PAID_PENDING_REFUND_REASON,
  payableCents,
} from './pending-refund-signal'
import { STALE_ATTEMPT_REFUND_REASON } from './print-no-paper-refund.constants'
import { CHANNEL_SUCCESS_CONFLICT_AUDIT } from './refund-channel-answer'
import { nonStaleSuccessCents } from './refund-remainder'

const PAPER_ALREADY_RELEASED_AUDIT = 'refund.notify_paper_already_released'
const AMOUNT_EXCEEDS_CONFLICT_DETAIL = '渠道退款已成功并已记账，但成功退款合计超过订单实付，已转待人工核对，请勿重复退款。'
const ORDER_STATE_CONFLICT_DETAIL = '渠道退款已成功并已记账，但订单当前状态无法自动收口为已退，已转待人工核对，请勿重复退款。'

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
    select: { payStatus: true, printTaskId: true, taskStatus: true },
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
  const canBlock = input.priorStatus === 'failed'
    || input.priorStatus === 'pending'
    || input.priorStatus === 'withdrawn'
    || input.priorStatus === 'manual_review'
  if (canBlock && released) {
    const recorded = await tx.refund.updateMany({
      where: { id: input.refundId, status: { in: ['pending', 'failed', 'withdrawn', 'manual_review'] } },
      data: {
        status: 'success',
        amountCents: input.amountCents,
        ...(input.channelRefundNo ? { channelRefundNo: input.channelRefundNo } : {}),
      },
    })
    if (recorded.count === 0) return 'idempotent'
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
          detail: '已经放行出纸，但渠道已退成并已记账，存在冲突，待人工核对，请勿重复退款',
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
  if (order.payStatus === 'closed' && input.priorStatus === REFUND_STATUS_MANUAL_REVIEW) {
    return 'idempotent'
  }

  const casRefund = await tx.refund.updateMany({
    where: { id: input.refundId, status: { in: ['pending', 'failed', 'withdrawn', REFUND_STATUS_MANUAL_REVIEW] } },
    data: {
      status: 'success',
      amountCents: input.amountCents,
      ...(input.channelRefundNo ? { channelRefundNo: input.channelRefundNo } : {}),
    },
  })
  if (casRefund.count === 0) return 'idempotent'

  const freshOrder = await tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      amountCents: true,
      discountCents: true,
      payStatus: true,
      printTaskId: true,
      refundReason: true,
      paymentSource: true,
      paidAt: true,
    },
  })
  if (!freshOrder) throw new NotFoundException('ORDER_NOT_FOUND')
  // 过期付款补收退款不计入本笔实付合计，也不翻动正常订单支付状态（与 recordChannelAnswers 同口径）。
  if (input.reason === STALE_ATTEMPT_REFUND_REASON) return 'completed'

  const payable = payableCents(freshOrder)
  const total = await nonStaleSuccessCents(tx, input.orderId)
  if (payable > 0 && total > payable) {
    // 渠道退成事实绝不回滚：保留 Refund.status = 'success'，不静默把订单改成已退，记冲突审计并告警。
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'system',
        action: CHANNEL_SUCCESS_CONFLICT_AUDIT,
        targetType: 'order',
        targetId: input.orderId,
        payloadJson: JSON.stringify({
          code: 'REFUND_CHANNEL_AMOUNT_EXCEEDS',
          refundNo: input.refundId,
          totalSuccessCents: total,
          payableCents: payable,
          source: 'notify',
          detail: AMOUNT_EXCEEDS_CONFLICT_DETAIL,
        }),
      },
    })
    return 'blocked'
  }

  const fully = payable <= 0 || total >= payable
  const updated = await tx.order.updateMany({
    where: {
      id: input.orderId,
      OR: [
        { payStatus: { in: ['refunding', 'paid', 'partial_refunded'] } },
        {
          payStatus: { in: [...ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES] },
          refundReason: ONLINE_PAID_PENDING_REFUND_REASON,
          paymentSource: null,
          paidAt: null,
        },
      ],
    },
    data: {
      payStatus: fully ? 'refunded' : 'partial_refunded',
      refundedAt: fully ? new Date() : null,
      refundReason: input.reason,
      refundedAmountCents: total,
    },
  })
  if (updated.count === 0) {
    // 严禁抛 ORDER_INVALID_TRANSITION 回滚渠道退成事实：保留 Refund.status = 'success'，写冲突审计并告警。
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'system',
        action: CHANNEL_SUCCESS_CONFLICT_AUDIT,
        targetType: 'order',
        targetId: input.orderId,
        payloadJson: JSON.stringify({
          code: 'REFUND_NOTIFY_ORDER_STATE_CONFLICT',
          payStatus: freshOrder.payStatus,
          refundNo: input.refundId,
          totalSuccessCents: total,
          payableCents: payable,
          source: 'notify',
          detail: ORDER_STATE_CONFLICT_DETAIL,
        }),
      },
    })
    return 'blocked'
  }
  return 'completed'
}
