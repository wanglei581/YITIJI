/**
 * 已付金额大于 0、打印失败的单，最后只落在三种去向之一：
 * 自动退成功、自动退失败、待人工退款。原因按当次决定写进审计，后台照着读。
 */
import { PAID_UNFULFILLED_PENDING_REFUND_REASON, payableCents } from './pending-refund-signal'
import { PAID_NO_PAPER_AUTO_REASON } from './print-no-paper-refund.constants'
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
}

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
] as const

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
  const refund = await db.refund.findFirst({
    where: { orderId, reason: PAID_NO_PAPER_AUTO_REASON },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  })
  if (!order) return { disposition: null, refundStatus: refund?.status ?? null, reason: null }
  if (refund?.status === 'success' || (order.payStatus === 'refunded' && order.refundReason === PAID_NO_PAPER_AUTO_REASON)) {
    return { disposition: 'auto_success', refundStatus: refund?.status ?? 'success', reason: null }
  }
  const audits = await db.auditLog.findMany({
    where: { targetId: orderId, action: { in: [...REASON_ACTIONS] } },
    orderBy: { createdAt: 'desc' },
    select: { action: true, payloadJson: true },
  })
  if (refund?.status === 'failed') {
    return { disposition: 'auto_failed', refundStatus: 'failed', reason: autoRefundFailureReason(audits) }
  }
  if (refund?.status === 'pending') {
    return { disposition: null, refundStatus: 'pending', reason: null }
  }
  const printed = order.printTask?.printOutcome === 'printed'
  const manual = order.payStatus === 'paid'
    && order.taskStatus === 'failed'
    && !printed
    && order.refundReason === PAID_UNFULFILLED_PENDING_REFUND_REASON
    && payableCents(order) > 0
  if (!manual) return { disposition: null, refundStatus: null, reason: null }
  const itemCount = await db.orderItem.count({ where: { orderId } })
  const completedItemCount = await db.orderItem.count({ where: { orderId, status: 'completed' } })
  return {
    disposition: 'manual',
    refundStatus: null,
    reason: manualReasonFromAudit(audits) ?? manualHoldReason({
      errorCode: order.printTask?.errorCode ?? null,
      completedItemCount,
      itemCount,
    }),
  }
}

export interface PrintReturnHold {
  orderId: string
  terminalId: string | null
  updatedAt: Date
  disposition: 'auto_failed' | 'manual'
  reason: string
}

export async function listPrintReturnHolds(db: PrismaService): Promise<PrintReturnHold[]> {
  const failedRefunds = await db.refund.findMany({
    where: { reason: PAID_NO_PAPER_AUTO_REASON, status: 'failed', order: { payStatus: 'paid' } },
    select: { orderId: true, updatedAt: true, order: { select: { terminalId: true } } },
    orderBy: { updatedAt: 'asc' },
  })
  const manuals = await db.order.findMany({
    where: {
      payStatus: 'paid',
      taskStatus: 'failed',
      refundReason: PAID_UNFULFILLED_PENDING_REFUND_REASON,
      refunds: { none: { reason: PAID_NO_PAPER_AUTO_REASON } },
    },
    select: {
      id: true,
      terminalId: true,
      updatedAt: true,
      amountCents: true,
      discountCents: true,
      printTask: { select: { printOutcome: true, errorCode: true } },
    },
    orderBy: { updatedAt: 'asc' },
  })
  const manualOrders = manuals.filter((order) => payableCents(order) > 0 && order.printTask?.printOutcome !== 'printed')
  const orderIds = [...failedRefunds.map((row) => row.orderId), ...manualOrders.map((order) => order.id)]
  const audits = orderIds.length === 0
    ? []
    : await db.auditLog.findMany({
      where: { targetId: { in: orderIds }, action: { in: [...REASON_ACTIONS] } },
      orderBy: { createdAt: 'desc' },
      select: { targetId: true, action: true, payloadJson: true },
    })
  const byOrder = new Map<string, AuditFact[]>()
  for (const audit of audits) {
    if (!audit.targetId) continue
    const list = byOrder.get(audit.targetId) ?? []
    list.push(audit)
    byOrder.set(audit.targetId, list)
  }
  const holds: PrintReturnHold[] = failedRefunds.map((row) => ({
    orderId: row.orderId,
    terminalId: row.order.terminalId,
    updatedAt: row.updatedAt,
    disposition: 'auto_failed' as const,
    reason: autoRefundFailureReason(byOrder.get(row.orderId) ?? []),
  }))
  const itemCounts = new Map<string, { total: number; completed: number }>()
  if (manualOrders.length > 0) {
    const grouped = await db.orderItem.groupBy({
      by: ['orderId', 'status'],
      where: { orderId: { in: manualOrders.map((order) => order.id) } },
      _count: { _all: true },
    })
    for (const row of grouped) {
      const current = itemCounts.get(row.orderId) ?? { total: 0, completed: 0 }
      current.total += row._count._all
      if (row.status === 'completed') current.completed += row._count._all
      itemCounts.set(row.orderId, current)
    }
  }
  for (const order of manualOrders) {
    const facts = byOrder.get(order.id) ?? []
    const counts = itemCounts.get(order.id) ?? { total: 0, completed: 0 }
    holds.push({
      orderId: order.id,
      terminalId: order.terminalId,
      updatedAt: order.updatedAt,
      disposition: 'manual',
      reason: manualReasonFromAudit(facts) ?? manualHoldReason({
        errorCode: order.printTask?.errorCode ?? null,
        completedItemCount: counts.completed,
        itemCount: counts.total,
      }),
    })
  }
  return holds
}
