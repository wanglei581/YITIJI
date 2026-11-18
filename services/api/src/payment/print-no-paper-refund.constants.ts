/** 已付款、明确没出纸时自动原路退的退款原因。同一单用这个原因只退一次。 */
export const PAID_NO_PAPER_AUTO_REASON = 'paid_no_paper_auto'

/** 过期付款尝试迟到扣到的钱。按尝试金额原路退，不把订单改成已付或已退。 */
export const STALE_ATTEMPT_REFUND_REASON = 'stale_attempt_collected_refund'

export function staleAttemptRefundNo(attemptId: string): string {
  return `RFD-STALE-${attemptId}`
}

/** 自动退款失败或待人工退款的派生告警类型。已登记在 ALERT_TYPES。 */
export const PRINT_RETURN_MANUAL_TYPE = 'print_return_manual' as const


