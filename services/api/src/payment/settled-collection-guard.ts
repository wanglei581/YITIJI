/**
 * 渠道已经收过款、订单却还没按这笔钱放行时，禁止再出一笔码。
 * 过期尝试上已经原路退成的迟到扣款不算未结清：那笔钱有退款单盖住，可以按现在的价重新付。
 */
import { BadRequestException } from '@nestjs/common'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import { ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES, ONLINE_PAID_PENDING_REFUND_REASON } from './pending-refund-signal'
import { staleAttemptRefundNo } from './print-no-paper-refund.constants'

type GuardDb = PrismaService | PrismaTransactionClient

export async function rejectSettledChannelCollection(
  db: GuardDb,
  order: { id: string; payStatus: string; refundReason: string | null },
): Promise<void> {
  if (!(ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES as readonly string[]).includes(order.payStatus)) return
  if (order.refundReason === ONLINE_PAID_PENDING_REFUND_REASON) {
    throw new BadRequestException('PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED')
  }
  const successes = await db.paymentAttempt.findMany({
    where: { orderId: order.id, status: 'success' },
    select: { id: true, amountCents: true },
  })
  for (const attempt of successes) {
    const covered = await db.refund.findFirst({
      where: {
        orderId: order.id,
        refundNo: staleAttemptRefundNo(attempt.id),
        amountCents: attempt.amountCents,
        status: 'success',
      },
      select: { id: true },
    })
    if (!covered) throw new BadRequestException('PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED')
  }
}
