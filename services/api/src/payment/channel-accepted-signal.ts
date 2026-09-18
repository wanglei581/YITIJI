/**
 * 渠道已受理、本地确认未落地。
 *
 * 出码/付款码在事务外向渠道下单成功后，回填 prepayId / qrCodeContent / channelTxnNo
 * 可能失败。现有字段没有单独的「受理确认」列，因此用 failReason 与空标识组合：
 * - Provider 返回成功但 finalize 失败：钉 failReason=CHANNEL_ACCEPTED_UNCONFIRMED。
 * - 连 failReason 都写不上：status 仍为 created/pending/expired 且三标识全空。
 *   这与「渠道调用尚未发出 / 进程在 createQr 期间崩溃」在字段上不可分。
 *
 * 区分（用现有 status / failReason / createdAt，不加列）：
 * - Provider 尚在执行：created + 空标识、createdAt 很新。出码互斥立刻拦住第二扣
 *   （不得自动放行），但对账/Admin **等宽限期** 才告警，避免把正常出码窗口当故障。
 * - Provider 明确抛错：failQrCreateAttempt 写成 failed + unpaid，本信号不命中，可重新出码。
 * - finalize 失败：有 CHANNEL_ACCEPTED_UNCONFIRMED 或空标识已过宽限期 → fail-closed，
 *   不自动 unpaid、不假装 paid/refunded、不自动退款。人工按 PaymentAttempt.id 查渠道。
 *
 * 短暂误报：宽限期内的空标识不会进对账/Admin。永久锁死的是「可能已向渠道下单」
 * 的互斥，不是误报；渠道无单时由运营查账后处理，代码不放第二扣。
 */
export const CHANNEL_ACCEPTED_UNCONFIRMED_REASON = 'CHANNEL_ACCEPTED_UNCONFIRMED'

/** 空标识尚未钉 failReason 时，对账/Admin 的可见宽限。互斥不采用此宽限。 */
export const EMPTY_IDENTIFIER_VISIBLE_AFTER_MS = 30_000

/** Admin 全表模糊行（无显式 failReason）的回看窗口。显式 CHANNEL_ACCEPTED_UNCONFIRMED 不受此限。 */
export const EMPTY_IDENTIFIER_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000

export const CHANNEL_ACCEPTED_UNCONFIRMED_NEXT_STEP =
  '按商户订单号（PaymentAttempt.id = 渠道 out_trade_no）查渠道账本。已收款则走 reconcile 入账或待退；渠道无单则保持互斥锁，不要重新出码或付款码。'

export type ChannelAcceptedAttemptSnap = {
  status: string
  prepayId: string | null
  qrCodeContent: string | null
  channelTxnNo: string | null
  failReason: string | null
  createdAt?: Date | null
}

export function identifiersNeverLanded(attempt: ChannelAcceptedAttemptSnap): boolean {
  return attempt.prepayId == null && attempt.qrCodeContent == null && attempt.channelTxnNo == null
}

export function isOpenPaymentAttemptStatus(status: string): boolean {
  return status === 'created' || status === 'pending' || status === 'expired'
}

export function isChannelAcceptedUnconfirmedAttempt(
  attempt: ChannelAcceptedAttemptSnap,
  nowMs: number = Date.now(),
): boolean {
  if (attempt.status === 'success' || attempt.status === 'failed') return false
  if (attempt.failReason === CHANNEL_ACCEPTED_UNCONFIRMED_REASON) return true
  if (!isOpenPaymentAttemptStatus(attempt.status) || !identifiersNeverLanded(attempt)) return false
  if (!attempt.createdAt) return true
  return nowMs - attempt.createdAt.getTime() >= EMPTY_IDENTIFIER_VISIBLE_AFTER_MS
}

export function channelAcceptedUnconfirmedWhere(
  now: Date = new Date(),
  opts?: { fuzzyLookbackMs?: number },
): {
  status: { in: string[] }
  OR: Array<
    | { failReason: string }
    | {
        prepayId: null
        qrCodeContent: null
        channelTxnNo: null
        createdAt: { lte: Date; gte?: Date }
      }
  >
} {
  const visibleBefore = new Date(now.getTime() - EMPTY_IDENTIFIER_VISIBLE_AFTER_MS)
  const emptyCreatedAt: { lte: Date; gte?: Date } = { lte: visibleBefore }
  if (opts?.fuzzyLookbackMs != null) {
    emptyCreatedAt.gte = new Date(now.getTime() - opts.fuzzyLookbackMs)
  }
  return {
    status: { in: ['created', 'pending', 'expired'] },
    OR: [
      { failReason: CHANNEL_ACCEPTED_UNCONFIRMED_REASON },
      { prepayId: null, qrCodeContent: null, channelTxnNo: null, createdAt: emptyCreatedAt },
    ],
  }
}
