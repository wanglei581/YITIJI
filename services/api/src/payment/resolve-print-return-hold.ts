/**
 * 待人工的三种解开办法。改状态在一个事务里做完，改完只剩一种状态。
 * 渠道受理过、还没落定的退款，三步都先查渠道（每一笔都查）。渠道说成功就按渠道金额记账：
 * 确认退成给出记账后的结果，改为出纸、关单照实拒绝。
 * 渠道说失败后，改为出纸和关单仍不把钱记成已退。已经出纸不能关单。
 * 确认退成把「还没放行出纸」写进同一条订单更新：任务状态，以及 printOutcome=printed。
 * 和领取、核验出纸抢同一行。抢输了整笔回滚，拒绝审计写在事务外，才留得下。
 */
import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { PAID_UNFULFILLED_PENDING_REFUND_REASON } from './pending-refund-signal'
import { resolveChannelBeforeHold } from './refund-channel-hold-gate'
import { channelRefundedOutcome } from './refund-channel-answer'
import type { ChannelQueryFault, ChannelQuerySuccess } from './refund-channel-query'
import { closeOrderIfPaperUnreleased } from './close-order-if-unreleased'
import { markOrderIfPaperUnreleased, paperAlreadyReleased } from './refund-paper-exclusion'
import { settlementAfterSuccess } from './refund-remainder'

export type PrintReturnResolution = 'confirm_refunded' | 'release_paper' | 'close_order'
export type RefundChannelVerdict = 'success' | 'processing' | 'failed' | 'unknown' | 'unsupported' | 'fault' | 'abnormal'
export type PendingRefundChannelQuery = (input: {
  channel: string
  refundNo: string
  orderId: string
}) => Promise<RefundChannelVerdict | ChannelQueryFault | ChannelQuerySuccess>

const HOLD_STATUSES = ['failed', 'manual_review', 'pending'] as const
const NOT_REFUNDED_NOTE = '这笔钱不会记成已退回'
const PARTIAL_CLOSE_MESSAGE = '这单只退了一部分，不能直接关单。剩下的钱请再退，或留在待人工。'

function deny(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

function exceptionCode(error: unknown): string | null {
  if (!(error instanceof BadRequestException)) return null
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? null
}

async function rejectReleasedPaper(
  db: PrismaService,
  orderId: string,
  action: PrintReturnResolution,
  operatorId: string,
): Promise<void> {
  const order = await db.order.findUnique({ where: { id: orderId } })
  if (!order) return
  const task = order.printTaskId
    ? await db.printTask.findUnique({
      where: { id: order.printTaskId },
      select: { status: true, printOutcome: true },
    })
    : null
  const released = paperAlreadyReleased({
    taskStatus: task?.status ?? null,
    orderTaskStatus: order.taskStatus,
    printOutcome: task?.printOutcome ?? null,
  })
  if (!released) return
  if (action === 'release_paper') {
    await db.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'admin',
        action: 'refund.hold_rejected',
        targetType: 'order',
        targetId: orderId,
        payloadJson: JSON.stringify({
          action,
          operatorId,
          detail: '纸已经出去，不能再改成出纸',
        }),
      },
    })
    throw deny('PAPER_ALREADY_RELEASED', '纸已经放行或已经出去，不能再改成出纸。')
  }
  if (action === 'confirm_refunded') {
    throw deny('PAPER_ALREADY_RELEASED', '纸已经出去。确认退成不能用，请走核对后仍退款。')
  }
  if (action === 'close_order') {
    await db.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'admin',
        action: 'refund.hold_rejected',
        targetType: 'order',
        targetId: orderId,
        payloadJson: JSON.stringify({
          action,
          operatorId,
          code: 'PAPER_ALREADY_OUT_CANNOT_CLOSE',
          detail: '纸已经出去，不能关单',
        }),
      },
    })
    throw deny('PAPER_ALREADY_OUT_CANNOT_CLOSE', '纸已经出去，不能关单。钱还在的话请走核对后仍退款。')
  }
}

export async function resolvePrintReturnHold(
  db: PrismaService,
  orderId: string,
  action: PrintReturnResolution,
  operatorId: string,
  channelQuery?: PendingRefundChannelQuery,
): Promise<{
  orderId: string
  payStatus: string
  refundStatus: string
  taskStatus: string
  refundNo: string
  amountCents: number
}> {
  await rejectReleasedPaper(db, orderId, action, operatorId)
  const step = await resolveChannelBeforeHold(db, orderId, action, operatorId, channelQuery)
  if (step === 'channel_refunded') return channelRefundedOutcome(db, orderId, action, operatorId)
  try {
    return await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } })
    if (!order) throw new BadRequestException('ORDER_NOT_FOUND')
    const refund = await tx.refund.findFirst({
      where: { orderId, status: { in: [...HOLD_STATUSES] } },
      orderBy: { createdAt: 'desc' },
    })
    if (!refund) {
      if (order.payStatus === 'partial_refunded') {
        throw deny('REFUND_REMAINDER_REQUIRED', '这单只退了一部分。请退还剩余金额，不能用这三步把已经成功的退款再记一次。')
      }
      const settled = await tx.refund.findFirst({
        where: {
          orderId,
          status: { in: ['success', 'withdrawn', 'closed'] },
          updatedAt: { gte: new Date(Date.now() - 60_000) },
        },
        select: { id: true },
      })
      if (settled) throw deny('REFUND_HOLD_ALREADY_RESOLVED', '这笔待人工退款刚刚已经被处理，请刷新后再看。')
      throw deny('REFUND_HOLD_NOT_FOUND', '没有待人工处理的退款，不能做这一步。')
    }
    const task = order.printTaskId
      ? await tx.printTask.findUnique({
        where: { id: order.printTaskId },
        select: { id: true, status: true, printOutcome: true },
      })
      : null
    const released = paperAlreadyReleased({
      taskStatus: task?.status ?? null,
      orderTaskStatus: order.taskStatus,
      printOutcome: task?.printOutcome ?? null,
    })

    if (step === 'release_paper') {
      if (released) {
        throw deny('PAPER_ALREADY_RELEASED', '纸已经放行或已经出去，不能再改成出纸。')
      }
      if (order.payStatus !== 'paid' && order.payStatus !== 'refunding') {
        throw deny('ORDER_NOT_REFUNDABLE', '这单不是已付款，不能改成出纸。')
      }
      const withdrawn = await tx.refund.updateMany({
        where: { id: refund.id, status: { in: [...HOLD_STATUSES] } },
        data: { status: 'withdrawn' },
      })
      if (withdrawn.count !== 1) throw deny('REFUND_HOLD_ALREADY_RESOLVED', '这笔待人工退款刚刚已经被处理，请刷新后再看。')
      const reopened = await tx.order.updateMany({
        where: {
          id: orderId,
          payStatus: { in: ['paid', 'refunding'] },
          taskStatus: { notIn: ['claimed', 'printing', 'completed'] },
        },
        data: {
          payStatus: 'paid',
          taskStatus: 'pending',
          // 未履约待退信号会让终端永远领不到。改为出纸就是要让这张单重新出纸。
          ...(order.refundReason === PAID_UNFULFILLED_PENDING_REFUND_REASON ? { refundReason: null } : {}),
        },
      })
      if (reopened.count !== 1) {
        const current = await tx.order.findUnique({
          where: { id: orderId },
          select: { taskStatus: true, printTaskId: true },
        })
        const taskNow = current?.printTaskId
          ? await tx.printTask.findUnique({
            where: { id: current.printTaskId },
            select: { status: true, printOutcome: true },
          })
          : null
        const taken = paperAlreadyReleased({
          taskStatus: taskNow?.status ?? null,
          orderTaskStatus: current?.taskStatus ?? null,
          printOutcome: taskNow?.printOutcome ?? null,
        }) || current?.taskStatus === 'completed'
        if (taken) throw deny('PAPER_ALREADY_RELEASED', '纸已经放行或已经出去，不能再改成出纸。')
        throw deny('REFUND_HOLD_ALREADY_RESOLVED', '这笔待人工退款刚刚已经被处理，请刷新后再看。')
      }
      if (task) {
        const reset = await tx.printTask.updateMany({
          where: {
            id: task.id,
            status: { in: ['failed', 'cancelled', 'pending'] },
            OR: [
              { printOutcome: null },
              { printOutcome: { not: 'printed' } },
            ],
          },
          data: {
            status: 'pending',
            errorCode: null,
            errorMessage: null,
            printOutcome: null,
            completedAt: null,
          },
        })
        if (reset.count !== 1) throw deny('PAPER_ALREADY_RELEASED', '纸已经放行或已经出去，不能再改成出纸。')
      }
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'admin',
          action: 'refund.hold_resolved',
          targetType: 'order',
          targetId: orderId,
          payloadJson: JSON.stringify({
            action: step,
            refundNo: refund.refundNo,
            operatorId,
            detail: `${NOT_REFUNDED_NOTE}，改为出纸`,
          }),
        },
      })
    } else if (step === 'close_order') {
      if (released) {
        throw deny('PAPER_ALREADY_OUT_CANNOT_CLOSE', '纸已经出去，不能关单。钱还在的话请走核对后仍退款。')
      }
      if (order.payStatus === 'partial_refunded') {
        throw deny('PARTIAL_REFUND_CANNOT_CLOSE', PARTIAL_CLOSE_MESSAGE)
      }
      const closedRefund = await tx.refund.updateMany({
        where: { id: refund.id, status: { in: [...HOLD_STATUSES] } },
        data: { status: 'closed' },
      })
      if (closedRefund.count !== 1) throw deny('REFUND_HOLD_ALREADY_RESOLVED', '这笔待人工退款刚刚已经被处理，请刷新后再看。')
      const closedOrder = await closeOrderIfPaperUnreleased(tx, db.dbKind, orderId, order.payStatus)
      if (!closedOrder) {
        const current = await tx.order.findUnique({
          where: { id: orderId },
          select: { payStatus: true, taskStatus: true, printTaskId: true },
        })
        const taskNow = current?.printTaskId
          ? await tx.printTask.findUnique({
            where: { id: current.printTaskId },
            select: { status: true, printOutcome: true },
          })
          : null
        if (current?.payStatus === 'partial_refunded') {
          throw deny('PARTIAL_REFUND_CANNOT_CLOSE', PARTIAL_CLOSE_MESSAGE)
        }
        const taken = paperAlreadyReleased({
          taskStatus: taskNow?.status ?? null,
          orderTaskStatus: current?.taskStatus ?? null,
          printOutcome: taskNow?.printOutcome ?? null,
        })
        if (taken) throw deny('PAPER_ALREADY_OUT_CANNOT_CLOSE', '纸已经出去，不能关单。钱还在的话请走核对后仍退款。')
        throw deny('REFUND_HOLD_ALREADY_RESOLVED', '这笔待人工退款刚刚已经被处理，请刷新后再看。')
      }
      if (task && (task.status === 'pending' || task.status === 'failed')) {
        const cancelled = await tx.printTask.updateMany({
          where: {
            id: task.id,
            status: { in: ['pending', 'failed'] },
            OR: [
              { printOutcome: null },
              { printOutcome: { not: 'printed' } },
            ],
          },
          data: {
            status: 'cancelled',
            errorCode: 'ORDER_CLOSED',
            errorMessage: `${NOT_REFUNDED_NOTE}，纸也不会再出`,
          },
        })
        if (cancelled.count !== 1) {
          throw deny('PAPER_ALREADY_OUT_CANNOT_CLOSE', '纸已经出去，不能关单。钱还在的话请走核对后仍退款。')
        }
        await tx.order.updateMany({
          where: { id: orderId, taskStatus: { in: ['pending', 'failed'] } },
          data: { taskStatus: 'cancelled' },
        })
      }
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'admin',
          action: 'refund.hold_resolved',
          targetType: 'order',
          targetId: orderId,
          payloadJson: JSON.stringify({
            action: step,
            refundNo: refund.refundNo,
            operatorId,
            detail: `${NOT_REFUNDED_NOTE}，纸也不会再出`,
          }),
        },
      })
    } else {
      if (released) throw deny('PAPER_ALREADY_RELEASED', '纸已经出去。确认退成不能用，请走核对后仍退款。')
      // 未付、支付中、已关闭：只把退款行记成成功，不改订单支付状态。
      // 已关闭的单不能再改成已退，否则和关单「钱不记成已退、纸不再出」打架。
      const leaveOrder = order.payStatus === 'unpaid' || order.payStatus === 'paying' || order.payStatus === 'closed'
      const confirmed = await tx.refund.updateMany({
        where: { id: refund.id, status: { in: [...HOLD_STATUSES] } },
        data: { status: 'success' },
      })
      if (confirmed.count !== 1) throw deny('REFUND_HOLD_ALREADY_RESOLVED', '这笔待人工退款刚刚已经被处理，请刷新后再看。')
      const settlement = leaveOrder
        ? null
        : await settlementAfterSuccess(tx, {
          id: refund.id,
          orderId,
          amountCents: refund.amountCents,
          reason: refund.reason,
        }, order)
      if (settlement) {
        const marked = await markOrderIfPaperUnreleased(tx, db.dbKind, orderId, {
          payStatus: settlement.payStatus,
          refundedAmountCents: settlement.refundedAmountCents,
          refundReason: settlement.refundReason,
          refundedAt: settlement.payStatus === 'refunded' ? new Date() : null,
        })
        if (!marked) {
          const current = await tx.order.findUnique({
            where: { id: orderId },
            select: { taskStatus: true, printTaskId: true },
          })
          const taskNow = current?.printTaskId
            ? await tx.printTask.findUnique({
              where: { id: current.printTaskId },
              select: { status: true, printOutcome: true },
            })
            : null
          const taken = current?.taskStatus === 'claimed'
            || current?.taskStatus === 'printing'
            || current?.taskStatus === 'completed'
            || paperAlreadyReleased({
              taskStatus: taskNow?.status ?? null,
              orderTaskStatus: current?.taskStatus ?? null,
              printOutcome: taskNow?.printOutcome ?? null,
            })
          if (taken) throw deny('PAPER_ALREADY_RELEASED', '纸已经出去。确认退成不能用，请走核对后仍退款。')
          throw deny('ORDER_INVALID_TRANSITION', '这单现在的支付状态不能记成已退。')
        }
        if (settlement.payStatus === 'refunded' && task && task.status === 'pending' && task.printOutcome !== 'printed') {
          await tx.printTask.updateMany({
            where: { id: task.id, status: 'pending' },
            data: {
              status: 'cancelled',
              errorCode: 'REFUND_COMPLETED',
              errorMessage: '退款已经成功，不再出纸',
            },
          })
          await tx.order.updateMany({
            where: { id: orderId, taskStatus: 'pending' },
            data: { taskStatus: 'cancelled' },
          })
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'admin',
          action: 'refund.hold_resolved',
          targetType: 'order',
          targetId: orderId,
          payloadJson: JSON.stringify({
            action: step,
            refundNo: refund.refundNo,
            amountCents: refund.amountCents,
            operatorId,
            detail: leaveOrder
              ? (order.payStatus === 'closed'
                ? '确认退款已经退成，订单保持关闭'
                : '确认过期付款已经退回，订单仍按未付，可以付现在的价')
              : settlement?.payStatus === 'partial_refunded'
                ? '确认退了一部分，还没退完'
                : '确认退款已经退成',
          }),
        },
      })
    }

    const freshOrder = await tx.order.findUniqueOrThrow({ where: { id: orderId } })
    const freshRefund = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } })
    const freshTask = freshOrder.printTaskId
      ? await tx.printTask.findUnique({ where: { id: freshOrder.printTaskId }, select: { status: true } })
      : null
    return {
      orderId,
      payStatus: freshOrder.payStatus,
      refundStatus: freshRefund.status,
      taskStatus: freshTask?.status ?? freshOrder.taskStatus,
      refundNo: freshRefund.refundNo,
      amountCents: freshRefund.amountCents,
    }
  })
  } catch (error) {
    const rejectedCode = exceptionCode(error)
    const rejectedDetail = (step === 'confirm_refunded' || step === 'release_paper') && rejectedCode === 'PAPER_ALREADY_RELEASED'
      ? (step === 'confirm_refunded'
        ? '纸已经放行或已经出去，确认退成不能用'
        : '纸已经放行或已经出去，不能再改成出纸')
      : step === 'close_order' && rejectedCode === 'PARTIAL_REFUND_CANNOT_CLOSE'
        ? PARTIAL_CLOSE_MESSAGE
        : null
    if (rejectedDetail && rejectedCode) {
      await db.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'admin',
          action: 'refund.hold_rejected',
          targetType: 'order',
          targetId: orderId,
          payloadJson: JSON.stringify({
            action: step,
            operatorId,
            code: rejectedCode,
            detail: rejectedDetail,
          }),
        },
      })
    }
    throw error
  }
}
