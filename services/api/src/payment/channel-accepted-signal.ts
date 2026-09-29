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
 * - createQrPayment 只抛普通 Error，没有「操作 + 可信响应 + 明确拒绝」的结构化契约。
 *   因此任何出码 throw，哪怕文案像 40004 / ACQ.INVALID_PARAMETER，都钉上本信号
 *   （或留下 created + 空标识），订单保持 paying，不能从这次 throw 再出第二码。
 * - 渠道已返回二维码但本地回填失败：同样钉本信号。用户文案可以说已受理；
 *   出码 throw 的结果尚未确认，不能说已受理。
 * - 收敛只走现有 queryPayment 的结构化结果：paid 且金额流水匹配则入账或待退；
 *   closed/failed 且订单仍可支付则释放并允许新出码；pending/unknown 保持互斥。
 *   支付宝 TRADE_NOT_EXIST、微信 404/ORDER_NOT_EXIST 在 queryPayment 里仍是 unknown，
 *   不会在这里被当成关单。查不到时要人工按 PaymentAttempt.id 核对。
 *   生产运维恢复尚未验收。这不是一条已经闭环的自动解锁。
 * - 有本信号或空标识已过宽限期 → 对账/Admin 可见，不自动 unpaid、不假装 paid/refunded、
 *   不自动退款。
 *
 * 短暂误报：宽限期内的空标识不会进对账/Admin。互斥一直保持到结构化查单或验签回调
 * 给出终态；unknown 不会自行放行。
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
