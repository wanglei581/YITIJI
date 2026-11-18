/**
 * 已付金额大于 0、没出纸的单，最后只落在三种去向之一：
 * 自动退成功、自动退失败、待人工退款。一张单只进一种。
 *
 * 状态落点：
 * - 自动退款成功，或过期付款已按尝试金额原路退成：自动退成功，不进待处理列表。
 * - 自动退款失败，或只有失败审计还没有退款行：自动退失败，告警。订单停在退款中也算。
 * - 退款待人工（金额对不上、已经放行不能再记成功、过期付款没有渠道流水）：待人工，告警。
 * - 自动退或过期付款还在处理中：待人工，不能写成已经退成。
 * - 说不准、部分出纸、缺纸、个人收费总开关关着：待人工，告警。
 */
import { PAID_UNFULFILLED_PENDING_REFUND_REASON, payableCents } from './pending-refund-signal'
import {
  PAID_NO_PAPER_AUTO_REASON,
  STALE_ATTEMPT_REFUND_REASON,
} from './print-no-paper-refund.constants'
import type { PrismaService } from '../prisma/prisma.service'

export const PRINT_NO_PAPER_MANUAL_AUDIT = 'print_order.no_paper_manual'
export const PRINT_NO_PAPER_AUTO_FAILED_AUDIT = 'print_order.auto_return_failed'

const CHANNEL_FAILED_REASON = '退款渠道返回失败（REFUND_CHANNEL_FAILED），没有退成'
const SWITCH_OFF_REASON = '个人收费总开关关着，没有发起自动退款'

export type PrintRefundDisposition = 'auto_success' | 'auto_failed' | 'manual'

export interface PrintRefundView {
  disposition: PrintRefundDisposition | null
  refundStatus: string | null
  reason: string | null
  refundNo: string | null
  amountCents: number | null
}

const EMPTY_VIEW: PrintRefundView = {
  disposition: null,
  refundStatus: null,
  reason: null,
  refundNo: null,
  amountCents: null,
}

export function staleCollectedRefundReason(amountCents: number): string {
  return `过期付款 ${amountCents} 分已原路退回`
}

export const CHANNEL_UNCONFIRMED_REFUND_REASON = '渠道还没确认退款结果，不能当成已经退成'

export function switchOffRefundReason(): string {
  return SWITCH_OFF_REASON
}

export function manualHoldReason(input: {
  errorCode: string | null
  completedItemCount: number
  itemCount: number
}): string {
  if (input.completedItemCount > 0) {
    const total = input.itemCount > 0 ? input.itemCount : input.completedItemCount
    return `材料包 ${total} 份里出了 ${input.completedItemCount} 份，没有全部出纸，不能自动退`
  }
  if (!input.errorCode) return '打印失败但没有错误码，不能确定有没有出纸，不能自动退'
  if (input.errorCode === 'PRINT_JOB_UNCONFIRMED') return '出纸结果未确认，不能自动退'
  if (input.errorCode === 'PRINTING_REPORT_LOST') return '打印过程中报告丢失，不能自动退'
  if (input.errorCode === 'PARTIAL_OUTPUT') return '只出了一部分纸，不能自动退'
  if (input.errorCode === 'PAPER_EMPTY') return '打印机缺纸，没有自动退'
  return `打印失败（${input.errorCode}），还不能确定有没有出纸，不能自动退`
}

function blockedReason(code: string): string {
  if (code === 'REFUND_CHANNEL_FAILED') return CHANNEL_FAILED_REASON
  if (code === 'REFUND_SOURCE_ATTEMPT_MISSING') return '找不到当时的付款记录，没有退成'
  if (code === 'REFUND_SOURCE_AMBIGUOUS') return '付款记录不止一条，没有退成'
  if (code === 'REFUND_AMOUNT_BASIS_UNSUPPORTED') return '实付金额对不上，没有退成'
  return `自动退款被拦住（${code}）`
}

interface AuditFact {
  action: string
  payloadJson: string
}

function readPayload(raw: string): { code?: unknown; errorCode?: unknown; detail?: unknown } {
  try {
    const parsed = JSON.parse(raw) as { code?: unknown; errorCode?: unknown; detail?: unknown }
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function autoRefundFailureReason(audits: AuditFact[]): string {
  for (const audit of audits) {
    if (audit.action !== 'refund.channel_error') continue
    const errorCode = readPayload(audit.payloadJson).errorCode
    if (typeof errorCode === 'string' && errorCode.trim()) return `退款渠道拒绝：${errorCode.trim()}`
  }
  for (const audit of audits) {
    if (audit.action !== 'refund.blocked' && audit.action !== PRINT_NO_PAPER_AUTO_FAILED_AUDIT) continue
    const code = readPayload(audit.payloadJson).code
    if (typeof code === 'string' && code.trim()) return blockedReason(code.trim())
  }
  return CHANNEL_FAILED_REASON
}

export function manualReasonFromAudit(audits: AuditFact[]): string | null {
  for (const audit of audits) {
    if (audit.action !== PRINT_NO_PAPER_MANUAL_AUDIT) continue
    const detail = readPayload(audit.payloadJson).detail
    if (typeof detail === 'string' && detail.trim()) return detail.trim()
  }
  return null
}

const REASON_ACTIONS = [
  'refund.channel_error',
  'refund.blocked',
  PRINT_NO_PAPER_AUTO_FAILED_AUDIT,
  PRINT_NO_PAPER_MANUAL_AUDIT,
  'refund.notify_amount_mismatch',
  'refund.notify_paper_already_released',
] as const

const AUTO_REASONS = new Set<string>([PAID_NO_PAPER_AUTO_REASON, STALE_ATTEMPT_REFUND_REASON])

interface RefundFact {
  refundNo: string
  amountCents: number
  status: string
  reason: string | null
}

function viewOf(
  disposition: PrintRefundDisposition,
  refund: RefundFact | undefined,
  reason: string | null,
  refundStatus?: string,
): PrintRefundView {
  return {
    disposition,
    refundStatus: refundStatus ?? refund?.status ?? null,
    reason,
    refundNo: refund?.refundNo ?? null,
    amountCents: refund?.amountCents ?? null,
  }
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function mismatchReason(audits: AuditFact[]): string | null {
  for (const audit of audits) {
    if (audit.action !== 'refund.notify_amount_mismatch') continue
    const payload = readPayload(audit.payloadJson) as { notifyAmountCents?: unknown; wholeOrderCents?: unknown }
    const notify = readNumber(payload.notifyAmountCents)
    const whole = readNumber(payload.wholeOrderCents)
    if (notify != null && whole != null) return `渠道通知退了 ${notify} 分，这笔应退 ${whole} 分，待人工核对`
  }
  return null
}

function paperReleasedReason(audits: AuditFact[]): string | null {
  for (const audit of audits) {
    if (audit.action !== 'refund.notify_paper_already_released') continue
    const detail = readPayload(audit.payloadJson).detail
    if (typeof detail === 'string' && detail.trim()) return detail.trim()
  }
  return null
}

function manualReviewReason(refund: RefundFact, audits: AuditFact[]): string {
  return mismatchReason(audits)
    ?? paperReleasedReason(audits)
    ?? manualReasonFromAudit(audits)
    ?? (refund.reason === STALE_ATTEMPT_REFUND_REASON
      ? `过期付款 ${refund.amountCents} 分没有渠道流水，待人工原路退回`
      : '退款结果对不上，待人工核对')
}

export async function explainPrintRefund(db: PrismaService, orderId: string): Promise<PrintRefundView> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      payStatus: true,
      refundReason: true,
      amountCents: true,
      discountCents: true,
      taskStatus: true,
      printTask: { select: { printOutcome: true, errorCode: true } },
    },
  })
  const refunds = await db.refund.findMany({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
    select: { refundNo: true, amountCents: true, status: true, reason: true },
  })
  const latest = refunds[0]
  if (!order) {
    return latest
      ? { ...EMPTY_VIEW, refundStatus: latest.status, refundNo: latest.refundNo, amountCents: latest.amountCents }
      : EMPTY_VIEW
  }
  const audits = await db.auditLog.findMany({
    where: { targetId: orderId, action: { in: [...REASON_ACTIONS] } },
    orderBy: { createdAt: 'desc' },
    select: { action: true, payloadJson: true },
  })
  const success = refunds.find((refund) => refund.status === 'success' && refund.reason != null && AUTO_REASONS.has(refund.reason))
  if (success || (order.payStatus === 'refunded' && order.refundReason === PAID_NO_PAPER_AUTO_REASON)) {
    const stale = success?.reason === STALE_ATTEMPT_REFUND_REASON
    return viewOf(
      'auto_success',
      success,
      stale && success ? staleCollectedRefundReason(success.amountCents) : null,
      success?.status ?? 'success',
    )
  }
  const manualReview = refunds.find((refund) => refund.status === 'manual_review')
  if (manualReview) return viewOf('manual', manualReview, manualReviewReason(manualReview, audits))
  const failedAuto = refunds.find((refund) => refund.status === 'failed' && refund.reason != null && AUTO_REASONS.has(refund.reason))
  const failedAudit = audits.some((audit) => audit.action === PRINT_NO_PAPER_AUTO_FAILED_AUDIT)
  if (failedAuto || failedAudit) {
    return viewOf('auto_failed', failedAuto, autoRefundFailureReason(audits), failedAuto?.status ?? 'failed')
  }
  const pending = refunds.find((refund) => refund.status === 'pending' && refund.reason != null && AUTO_REASONS.has(refund.reason))
  if (pending) return viewOf('manual', pending, CHANNEL_UNCONFIRMED_REFUND_REASON)
  const printed = order.printTask?.printOutcome === 'printed'
  const manualDetail = manualReasonFromAudit(audits)
  // 开关关着仍用待退款信号。缺纸和说不准不写那条信号，只靠待人工审计认。
  const manual = order.payStatus === 'paid'
    && order.taskStatus === 'failed'
    && !printed
    && payableCents(order) > 0
    && (
      order.refundReason === PAID_UNFULFILLED_PENDING_REFUND_REASON
      || (order.refundReason == null && manualDetail != null)
    )
  if (!manual) return EMPTY_VIEW
  const itemCount = await db.orderItem.count({ where: { orderId } })
  const completedItemCount = await db.orderItem.count({ where: { orderId, status: 'completed' } })
  return viewOf('manual', undefined, manualDetail ?? manualHoldReason({
    errorCode: order.printTask?.errorCode ?? null,
    completedItemCount,
    itemCount,
  }))
}

export interface PrintReturnHold {
  orderId: string
  terminalId: string | null
  updatedAt: Date
  disposition: 'auto_failed' | 'manual'
  reason: string
}

const HOLD_AUDIT_ACTIONS = [
  PRINT_NO_PAPER_MANUAL_AUDIT,
  PRINT_NO_PAPER_AUTO_FAILED_AUDIT,
  'refund.notify_amount_mismatch',
  'refund.notify_paper_already_released',
] as const

export async function listPrintReturnHolds(db: PrismaService): Promise<PrintReturnHold[]> {
  const [openRefunds, audits, signaled] = await Promise.all([
    db.refund.findMany({
      where: { status: { in: ['failed', 'pending', 'manual_review'] } },
      select: { orderId: true },
    }),
    db.auditLog.findMany({
      where: { action: { in: [...HOLD_AUDIT_ACTIONS] } },
      select: { targetId: true },
    }),
    db.order.findMany({
      where: { refundReason: PAID_UNFULFILLED_PENDING_REFUND_REASON },
      select: { id: true },
    }),
  ])
  const orderIds = [...new Set([
    ...openRefunds.map((row) => row.orderId),
    ...audits.map((row) => row.targetId).filter((id): id is string => Boolean(id)),
    ...signaled.map((row) => row.id),
  ])]
  const holds: PrintReturnHold[] = []
  for (const orderId of orderIds) {
    const explained = await explainPrintRefund(db, orderId)
    if (explained.disposition !== 'auto_failed' && explained.disposition !== 'manual') continue
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { terminalId: true, updatedAt: true },
    })
    if (!order || !explained.reason) continue
    holds.push({
      orderId,
      terminalId: order.terminalId,
      updatedAt: order.updatedAt,
      disposition: explained.disposition,
      reason: explained.reason,
    })
  }
  return holds
}
