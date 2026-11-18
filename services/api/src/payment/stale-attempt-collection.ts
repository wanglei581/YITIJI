/**
 * 到机改价之后，旧的付款尝试如果已经过期，渠道仍可能把旧金额扣成功。
 * 这笔钱和现在的订单金额对不上：不能按旧金额把订单改成已付（少收就出纸），
 * 也不能只拒掉回调让渠道把钱留下。记待人工退款，订单保持未按这笔钱放行。
 * 尝试还没过期时金额对不上，仍当校验失败，不在这里收账。
 */
import type { PrismaService } from '../prisma/prisma.service'
import { ONLINE_PAID_PENDING_REFUND_REASON } from './pending-refund-signal'

const STALE_ATTEMPT_AUDIT = 'order.stale_attempt_collection'
const PARKABLE_PAY_STATUSES = ['unpaid', 'paying', 'closed'] as const

export async function parkRepricedAttemptCollection(
  db: PrismaService,
  input: {
    orderId: string
    payStatus: string
    refundReason: string | null
    attemptId: string
    attemptStatus: string
    attemptAmountCents: number
    orderAmountCents: number
    channel: string
    channelTxnNo: string | null
  },
): Promise<boolean> {
  if (input.attemptStatus !== 'expired') return false
  if (input.attemptAmountCents === input.orderAmountCents) return false
  if ((PARKABLE_PAY_STATUSES as readonly string[]).includes(input.payStatus) && !input.refundReason) {
    await db.order.updateMany({
      where: {
        id: input.orderId,
        payStatus: { in: [...PARKABLE_PAY_STATUSES] },
        refundReason: null,
      },
      data: { refundReason: ONLINE_PAID_PENDING_REFUND_REASON },
    })
  }
  await db.paymentAttempt.updateMany({
    where: { id: input.attemptId, status: 'expired' },
    data: { failReason: '到机改价之后付来的钱，没有按这个金额入账，待人工退回' },
  })
  const existing = await db.auditLog.findFirst({
    where: { targetId: input.orderId, action: STALE_ATTEMPT_AUDIT },
    select: { id: true },
  })
  if (!existing) {
    await db.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'system',
        action: STALE_ATTEMPT_AUDIT,
        targetType: 'order',
        targetId: input.orderId,
        payloadJson: JSON.stringify({
          attemptId: input.attemptId,
          attemptAmountCents: input.attemptAmountCents,
          orderAmountCents: input.orderAmountCents,
          channel: input.channel,
          channelTxnNo: input.channelTxnNo,
          reason: 'repriced_attempt_collected',
        }),
      },
    })
  }
  return true
}
