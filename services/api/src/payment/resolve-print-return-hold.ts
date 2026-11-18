/**
 * 待人工的三种解开办法。都在一个事务里改完，改完只剩一种状态。
 * 确认退成才把钱记成已退。改为出纸和关单都不把钱记成已退。
 */
import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { paperAlreadyReleased } from './refund-paper-exclusion'

export type PrintReturnResolution = 'confirm_refunded' | 'release_paper' | 'close_order'

const HOLD_STATUSES = ['failed', 'manual_review', 'pending'] as const
const NOT_REFUNDED_NOTE = '这笔钱不会记成已退回'

function deny(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
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
}

export async function resolvePrintReturnHold(
  db: PrismaService,
  orderId: string,
  action: PrintReturnResolution,
  operatorId: string,
): Promise<{
  orderId: string
  payStatus: string
  refundStatus: string
  taskStatus: string
  refundNo: string
  amountCents: number
}> {
  await rejectReleasedPaper(db, orderId, action, operatorId)
  return db.$transaction(async (tx) => {
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

    if (action === 'release_paper') {
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
        where: { id: orderId, payStatus: { in: ['paid', 'refunding'] } },
        data: { payStatus: 'paid', taskStatus: 'pending' },
      })
      if (reopened.count !== 1) throw deny('REFUND_HOLD_ALREADY_RESOLVED', '这笔待人工退款刚刚已经被处理，请刷新后再看。')
      if (task && task.printOutcome !== 'printed' && (task.status === 'failed' || task.status === 'cancelled' || task.status === 'pending')) {
        await tx.printTask.updateMany({
          where: { id: task.id, status: { in: ['failed', 'cancelled', 'pending'] } },
          data: {
            status: 'pending',
            errorCode: null,
            errorMessage: null,
            printOutcome: null,
            completedAt: null,
          },
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
            action,
            refundNo: refund.refundNo,
            operatorId,
            detail: `${NOT_REFUNDED_NOTE}，改为出纸`,
          }),
        },
      })
    } else if (action === 'close_order') {
      const closedRefund = await tx.refund.updateMany({
        where: { id: refund.id, status: { in: [...HOLD_STATUSES] } },
        data: { status: 'closed' },
      })
      if (closedRefund.count !== 1) throw deny('REFUND_HOLD_ALREADY_RESOLVED', '这笔待人工退款刚刚已经被处理，请刷新后再看。')
      const closedOrder = await tx.order.updateMany({
        where: { id: orderId, payStatus: order.payStatus },
        data: { payStatus: 'closed', taskStatus: task && task.status === 'pending' ? 'cancelled' : order.taskStatus },
      })
      if (closedOrder.count !== 1) throw deny('REFUND_HOLD_ALREADY_RESOLVED', '这笔待人工退款刚刚已经被处理，请刷新后再看。')
      if (task && task.printOutcome !== 'printed' && (task.status === 'pending' || task.status === 'failed')) {
        await tx.printTask.updateMany({
          where: { id: task.id, status: { in: ['pending', 'failed'] } },
          data: {
            status: 'cancelled',
            errorCode: 'ORDER_CLOSED',
            errorMessage: `${NOT_REFUNDED_NOTE}，纸也不会再出`,
          },
        })
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
            action,
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
      if (!leaveOrder) {
        const marked = await tx.order.updateMany({
          where: { id: orderId, payStatus: { in: ['paid', 'refunding'] } },
          data: {
            payStatus: 'refunded',
            refundedAt: new Date(),
            refundedAmountCents: refund.amountCents,
            refundReason: refund.reason,
          },
        })
        if (marked.count === 0) throw deny('ORDER_INVALID_TRANSITION', '这单现在的支付状态不能记成已退。')
        if (task && task.status === 'pending' && task.printOutcome !== 'printed') {
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
            action,
            refundNo: refund.refundNo,
            amountCents: refund.amountCents,
            operatorId,
            detail: leaveOrder
              ? (order.payStatus === 'closed'
                ? '确认退款已经退成，订单保持关闭'
                : '确认过期付款已经退回，订单仍按未付，可以付现在的价')
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
}
