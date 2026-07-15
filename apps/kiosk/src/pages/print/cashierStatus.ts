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
  | 'awaiting_code_confirmation' // 付款码已提交，等待用户输密码/渠道确认
  | 'expired' // 屏上动态二维码过期 → 可重新出码或改用付款码
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
  /** 是否允许对本次终态尝试重试（二维码重新出码 / 付款码重新扫描）。 */
  canReissue: boolean
  /** 是否已支付、可进入出纸/取件（仅 paid 为 true）。 */
  canProceed: boolean
}

/** 通道展示名（C5-6：真实渠道品牌文案；sandbox 必须明示测试通道）。 */
export const PAY_CHANNEL_LABEL: Record<string, string> = {
  sandbox: '测试支付通道',
  wechat: '微信支付',
  alipay: '支付宝',
}

/** 待扫码提示（按通道给出真实指引；sandbox 必须明示非真实收款，不伪装线上收款）。 */
function awaitingScanHint(channel: string | null): string {
  if (channel === 'wechat') return '请打开微信「扫一扫」，扫描下方二维码完成支付。'
  if (channel === 'alipay') return '请打开支付宝「扫一扫」，扫描下方二维码完成支付。'
  return '请使用手机扫描下方动态码完成支付（测试支付通道，非真实收款）。'
}

/** 金额（分）→ 人民币展示串。整数分，绝不浮点误差累积。 */
export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0
  return `¥${(safe / 100).toFixed(2)}`
}

export type AttemptPaymentMethod = 'qr' | 'code'

/** 以服务端尝试真相判断方式，不能以用户当前点亮的按钮猜测。 */
export function paymentMethodForAttempt(attempt: PayStatusView['attempt']): AttemptPaymentMethod | null {
  if (!attempt) return null
  return attempt.qrCodeContent === null ? 'code' : 'qr'
}

function attemptHasLiveCode(attempt: PayStatusView['attempt'], nowMs: number): boolean {
  if (!attempt || attempt.status !== 'pending' || !attempt.qrCodeContent) return false
  if (!attempt.expiresAt) return false
  return new Date(attempt.expiresAt).getTime() > nowMs
}

/** 仅服务端在渠道查单/关单后写入 expired，才代表旧码确认不可再支付。 */
function isScreenQrClosureConfirmed(attempt: PayStatusView['attempt']): boolean {
  if (paymentMethodForAttempt(attempt) !== 'qr') return false
  return attempt?.status === 'expired'
}

/** 本机显示倒计时到点不等于渠道已关单；只可作为发起安全收敛的提示。 */
function isScreenQrDisplayExpired(attempt: PayStatusView['attempt'], nowMs: number): boolean {
  if (paymentMethodForAttempt(attempt) !== 'qr') return false
  if (isScreenQrClosureConfirmed(attempt)) return true
  if (!attempt?.expiresAt) return false
  return new Date(attempt.expiresAt).getTime() <= nowMs
}

/**
 * 未过期屏上二维码和所有未知结果的付款码都必须锁住选择，避免两笔可扣款尝试并行。
 * 屏上码显示期到点后可在 UI 选择新方式，触发服务端先查单并确认关单；未知结果仍由服务端拒绝新建。
 */
export function isPaymentAttemptSelectionLocked(attempt: PayStatusView['attempt'], nowMs: number): boolean {
  if (!attempt || (attempt.status !== 'created' && attempt.status !== 'pending')) return false
  if (paymentMethodForAttempt(attempt) === 'code') return true
  return !isScreenQrDisplayExpired(attempt, nowMs)
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
  if (payStatus === 'refunded' || payStatus === 'refunding' || payStatus === 'partial_refunded') {
    // C5-4：退款中 / 已退款 / 部分退款一律终态展示，绝不放行进入出纸/取件（canProceed=false）。
    const title = payStatus === 'refunding' ? '订单退款处理中' : '订单已退款'
    return { phase: 'refunded', title, hint: '该订单已进入退款流程；如需打印请返回重新发起。', tone: 'error', showQr: false, canReissue: false, canProceed: false }
  }
  if (payStatus === 'closed') {
    return { phase: 'closed', title: '订单已超时关闭', hint: '支付超时，订单已关闭，请返回重新发起打印。', tone: 'warning', showQr: false, canReissue: false, canProceed: false }
  }
  if (payStatus === 'failed') {
    return { phase: 'failed', title: '支付未完成', hint: '本次支付未完成，请返回重新发起打印。', tone: 'error', showQr: false, canReissue: false, canProceed: false }
  }

  // ── unpaid / paying ──
  if (attempt?.status === 'failed') {
    const codePayment = paymentMethodForAttempt(attempt) === 'code'
    return {
      phase: 'failed',
      title: codePayment ? '付款码支付未完成' : '支付未完成',
      hint: codePayment ? '本次扫码未完成，请重新扫描用户付款码。' : '本次支付未完成，可重新出码再试。',
      tone: 'error',
      showQr: false,
      canReissue: true,
      canProceed: false,
    }
  }
  if (paymentMethodForAttempt(attempt) === 'code' && attempt?.status === 'expired') {
    return {
      phase: 'awaiting_code_confirmation',
      title: '支付状态待核实',
      hint: '付款码支付可能仍在渠道处理中，请先核实支付结果，勿重复扫码。',
      tone: 'warning',
      showQr: false,
      canReissue: false,
      canProceed: false,
    }
  }
  if (attemptHasLiveCode(attempt, nowMs)) {
    return {
      phase: 'awaiting_scan',
      title: '请扫码支付',
      hint: awaitingScanHint(attempt?.channel ?? null),
      tone: 'info',
      showQr: true,
      canReissue: false,
      canProceed: false,
    }
  }
  if (attempt?.status === 'pending' && !attempt.qrCodeContent) {
    return {
      phase: 'awaiting_code_confirmation',
      title: '支付处理中',
      hint: '请按手机提示完成验证，支付结果会自动确认。',
      tone: 'info',
      showQr: false,
      canReissue: false,
      canProceed: false,
    }
  }
  if (isScreenQrClosureConfirmed(attempt)) {
    return {
      phase: 'expired',
      title: '屏上收款码已过期',
      hint: '该二维码已失效，可重新出码，或改用扫码枪扫描用户付款码。',
      tone: 'warning',
      showQr: false,
      canReissue: true,
      canProceed: false,
    }
  }
  if (isScreenQrDisplayExpired(attempt, nowMs)) {
    return {
      phase: 'expired',
      title: '收款码到期核验中',
      hint: '该二维码已达到显示有效期。重新出码或切换付款码时会先向支付渠道确认关闭；未确认前请勿重复支付。',
      tone: 'warning',
      showQr: false,
      canReissue: true,
      canProceed: false,
    }
  }
  return {
    phase: 'expired',
    title: '尚未发起支付',
    hint: '请选择屏上收款码或扫付款码开始支付。',
    tone: 'info',
    showQr: false,
    canReissue: false,
    canProceed: false,
  }
}
