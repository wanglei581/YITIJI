// ============================================================
// C5-3 收银页状态映射（纯函数，无副作用，便于单测/复用）
//
// 把后端 `PayStatusView`（payStatus + 最近支付尝试）映射为收银页 UI 展示模型：
// 显示什么文案、是否展示动态码、是否允许「重新出码」、是否已支付可进入履约。
//
// 合规硬约束（CLAUDE.md §9「不伪造能力」+ 决策 3）：
// - `canProceed`（可进入出纸/取件）**仅** payStatus==='paid' 才为 true；
//   unpaid/paying/closed/refunded/failed 一律不得进入可 claim 路径。
// - pickupCode 的可见性由后端 `pickupCodeVisibleFor` 决定（前端只透传 status.pickupCode），
//   本模块不自行编造取件码。
// ============================================================

import type { PayStatusView } from '@ai-job-print/shared'

export type CashierPhase =
  | 'awaiting_scan' // paying + 动态码有效 → 展示 QR 等待扫码
  | 'expired' // 动态码过期/缺失 → 允许重新出码
  | 'paid' // 已支付 → 进入履约
  | 'failed' // 支付失败 → 允许重新出码 / 返回
  | 'closed' // 订单超时关闭 → 终态，返回重新发起
  | 'refunded' // 订单已退款 → 终态

export type CashierTone = 'info' | 'success' | 'warning' | 'error'

export interface CashierView {
  phase: CashierPhase
  title: string
  hint: string
  tone: CashierTone
  /** 是否展示屏上动态码。 */
  showQr: boolean
  /** 是否允许「重新出码」。 */
  canReissue: boolean
  /** 是否已支付、可进入出纸/取件（仅 paid 为 true）。 */
  canProceed: boolean
}

/** 金额（分）→ 人民币展示串。整数分，绝不浮点误差累积。 */
export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0
  return `¥${(safe / 100).toFixed(2)}`
}

function attemptHasLiveCode(attempt: PayStatusView['attempt'], nowMs: number): boolean {
  if (!attempt || attempt.status !== 'pending' || !attempt.qrCodeContent) return false
  if (!attempt.expiresAt) return false
  return new Date(attempt.expiresAt).getTime() > nowMs
}

/**
 * 由支付状态推导收银页展示模型。
 * @param status  pay-status 轮询结果（或出码后即时构造的等价对象）
 * @param nowMs   当前时间（毫秒），显式传入便于测试
 */
export function deriveCashierView(
  status: Pick<PayStatusView, 'payStatus' | 'attempt'>,
  nowMs: number,
): CashierView {
  const { payStatus, attempt } = status

  if (payStatus === 'paid') {
    return { phase: 'paid', title: '支付成功', hint: '正在进入打印，请稍候…', tone: 'success', showQr: false, canReissue: false, canProceed: true }
  }
  if (payStatus === 'refunded') {
    return { phase: 'refunded', title: '订单已退款', hint: '该订单已退款；如需打印请返回重新发起。', tone: 'error', showQr: false, canReissue: false, canProceed: false }
  }
  if (payStatus === 'closed') {
    return { phase: 'closed', title: '订单已超时关闭', hint: '支付超时，订单已关闭，请返回重新发起打印。', tone: 'warning', showQr: false, canReissue: false, canProceed: false }
  }
  if (payStatus === 'failed') {
    return { phase: 'failed', title: '支付未完成', hint: '本次支付未完成，请返回重新发起打印。', tone: 'error', showQr: false, canReissue: false, canProceed: false }
  }

  // ── unpaid / paying ──
  if (attempt?.status === 'failed') {
    return { phase: 'failed', title: '支付未完成', hint: '支付未成功，可点击「重新出码」再试。', tone: 'error', showQr: false, canReissue: true, canProceed: false }
  }
  if (attemptHasLiveCode(attempt, nowMs)) {
    return {
      phase: 'awaiting_scan',
      title: '请扫码支付',
      hint: '请使用手机扫描下方动态码完成支付（测试支付通道，非真实收款）。',
      tone: 'info',
      showQr: true,
      canReissue: false,
      canProceed: false,
    }
  }
  // paying/unpaid 但动态码已过期或缺失 → 允许重新出码
  return { phase: 'expired', title: '动态码已过期', hint: '支付码已过期，请点击「重新出码」生成新的支付码。', tone: 'warning', showQr: false, canReissue: true, canProceed: false }
}
