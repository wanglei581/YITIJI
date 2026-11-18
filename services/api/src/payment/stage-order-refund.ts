/**
 * 开一笔新退款的同一事务：先判定不能和出纸或另一笔退款同时成立，再把订单改成退款中。
 */
import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES, ONLINE_PAID_PENDING_REFUND_REASON } from './pending-refund-signal'
import { assertCanOpenRefund } from './refund-paper-exclusion'

const ACTIVE_PRINT_TASK_STATES = ['claimed', 'printing'] as const
const ALREADY_REFUND_STATES = new Set(['refunding', 'refunded', 'partial_refunded'])

function isRefundNoConflict(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } }
  if (err?.code !== 'P2002') return false
  const target = err.meta?.target
  if (typeof target === 'string') return target.includes('refundNo')
  if (Array.isArray(target)) return target.some((item) => String(item).includes('refundNo'))
  return true
}

type RefundRow = NonNullable<Awaited<ReturnType<PrismaService['refund']['findUnique']>>>

export async function stageNewRefund(
  db: PrismaService,
  input: {
    orderId: string
    refundNo: string
    reason: string
    channel: string
    amountCents: number
    operatorId: string | null
    collected: boolean
    unreleasedOnly: boolean
    verifiedAfterPaper: boolean
  },
): Promise<{ record: RefundRow; idempotent: boolean }> {
  try {
    return await db.$transaction(async (tx) => {
      await assertCanOpenRefund(tx, input.orderId, {
        refundNo: input.refundNo,
        verifiedAfterPaper: input.verifiedAfterPaper,
      })
      const taskGate = input.verifiedAfterPaper ? {} : { taskStatus: { notIn: [...ACTIVE_PRINT_TASK_STATES] } }
      const cas = input.collected
        ? await tx.order.updateMany({
          where: {
            id: input.orderId,
            payStatus: { in: [...ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES] },
            refundReason: ONLINE_PAID_PENDING_REFUND_REASON,
            paymentSource: null,
            paidAt: null,
            pickupCode: null,
            ...taskGate,
          },
          data: { payStatus: 'refunding' },
        })
        : await tx.order.updateMany({
          where: {
            id: input.orderId,
            payStatus: 'paid',
            ...taskGate,
            ...(input.unreleasedOnly ? { printTaskId: null, pickupStatus: { in: ['pending', 'expired'] } } : {}),
          },
          data: { payStatus: 'refunding' },
        })
      if (cas.count === 0) {
        const raced = await tx.refund.findUnique({ where: { refundNo: input.refundNo } })
        if (raced) return { record: raced, idempotent: true }
        const fresh = await tx.order.findUnique({ where: { id: input.orderId } })
        if (fresh && !input.verifiedAfterPaper && ACTIVE_PRINT_TASK_STATES.includes(fresh.taskStatus as 'claimed' | 'printing')) {
          throw new BadRequestException('ORDER_TASK_IN_PROGRESS')
        }
        if (fresh && ALREADY_REFUND_STATES.has(fresh.payStatus)) throw new BadRequestException('ORDER_ALREADY_REFUNDED')
        throw new BadRequestException('ORDER_INVALID_TRANSITION')
      }
      const record = await tx.refund.create({
        data: {
          orderId: input.orderId,
          refundNo: input.refundNo,
          amountCents: input.amountCents,
          status: 'pending',
          reason: input.reason,
          channel: input.channel,
          operatorId: input.operatorId,
        },
      })
      return { record, idempotent: false }
    })
  } catch (error) {
    if (!isRefundNoConflict(error)) throw error
    const existing = await db.refund.findUnique({ where: { refundNo: input.refundNo } })
    if (!existing) throw error
    return { record: existing, idempotent: true }
  }
}
