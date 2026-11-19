/**
 * 渠道受理过、还没有明确答复的退款。
 * 显式记录：Refund.channelSubmittedAt 非空 = 已经向渠道（sandbox / wechat / alipay）发起过退款。
 * 状态 success / failed / withdrawn / closed 都是明确答复或本地已处置，不再算在途。
 * 本地新建的待人工（窗口关闭、没有渠道流水的过期付款、线下/人工确认/免费/券）永远不写这一列。
 */

const SETTLED_STATUSES = new Set(['success', 'failed', 'withdrawn', 'closed'])

export type ChannelAcceptanceRefund = {
  status: string
  channelSubmittedAt: Date | string | null
}

/** 渠道受理过（写过 channelSubmittedAt），且还没有明确答复。 */
export function refundMayStillBeAtChannel(refund: ChannelAcceptanceRefund): boolean {
  if (!refund.channelSubmittedAt) return false
  return !SETTLED_STATUSES.has(refund.status)
}
