/**
 * 成功的过期退款不属于当前这笔。
 * 订单仍已付、任务失败、纸没出，并且有过期成功退款时，去向是待人工，订单列表也要筛得到。
 * 当前这笔失败或待人工不能把这单滤掉。不写待退款原因：那个原因会挡住领取。
 * 已经出纸的不在这里。没有过期成功退款的，也不靠这一条进来。
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
    },
  }
}
