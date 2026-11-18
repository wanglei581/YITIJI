/**
 * 成功的过期退款不属于当前这笔。
 * 订单仍已付、任务失败、纸没出、退款行只剩过期成功时，去向是待人工，订单列表也要筛得到。
 * 不写待退款原因：那个原因会挡住领取。
 */
import { STALE_ATTEMPT_REFUND_REASON } from './print-no-paper-refund.constants'

export function staleSuccessUnprintedAttentionWhere() {
  return {
    payStatus: 'paid' as const,
    taskStatus: 'failed' as const,
    amountCents: { gt: 0 },
    NOT: { printTask: { is: { printOutcome: 'printed' as const } } },
    refunds: {
      some: { status: 'success' as const, reason: STALE_ATTEMPT_REFUND_REASON },
      none: {
        OR: [
          { status: { not: 'success' as const } },
          { reason: null },
          { reason: { not: STALE_ATTEMPT_REFUND_REASON } },
        ],
      },
    },
  }
}
