/**
 * 渠道受理过、还没有明确失败答复的退款。
 * 不论记成处理中还是待人工，钱都可能正在退，三步和核验不能当成本地单处理。
 * 窗口清扫、以及没有渠道流水的过期待人工，是本地新建的，不在这一类。
 */
import { PICKUP_WINDOW_CLOSED_UNPRINTED_REASON } from './closed-window-unprinted'
import { STALE_ATTEMPT_REFUND_REASON } from './print-no-paper-refund.constants'

const PROVIDER_REFUND_CHANNELS = new Set(['sandbox', 'wechat', 'alipay'])

export type ChannelAcceptanceRefund = {
  status: string
  channel: string
  refundNo: string
  reason: string | null
  channelRefundNo: string | null
}

export function isProviderRefundChannel(channel: string): boolean {
  return PROVIDER_REFUND_CHANNELS.has(channel)
}

/** 渠道没受理过。单号、原因和空的渠道退款号能对上本地新建。 */
export function isLocalManualReview(refund: ChannelAcceptanceRefund): boolean {
  if (refund.status !== 'manual_review' || refund.channelRefundNo) return false
  if (refund.refundNo.startsWith('RFD-WINDOW-')) return true
  if (refund.reason === PICKUP_WINDOW_CLOSED_UNPRINTED_REASON) return true
  if (refund.reason === STALE_ATTEMPT_REFUND_REASON) return true
  return false
}

/** 向渠道发起过，渠道还没明确说失败。 */
export function refundMayStillBeAtChannel(refund: ChannelAcceptanceRefund): boolean {
  if (!isProviderRefundChannel(refund.channel)) return false
  if (refund.status === 'pending') return true
  if (refund.status !== 'manual_review') return false
  return !isLocalManualReview(refund)
}
