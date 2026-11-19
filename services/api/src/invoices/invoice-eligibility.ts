/**
 * 能不能开票。一体机扫码会话、会员接口和后台标已开前的复核共用这一份判断。
 *
 * 只看订单自己的事实：归属、付款状态、实付金额、退款记录。不看终端「现在」绑的机构——
 * 终端改绑后，原先在商业点位付过钱的单照样能开。公共就业点位永不收费，那里的单实付是 0，由「没有实付」挡住。
 * 实付：打印单用应付减去抵扣（与待退款信号同一口径）；服务单用建单时冻住的金额。
 * 部分退款、已退款、退款还没完成、没付成、实付为 0、已有未退回申请，都不能再开。
 */
import { payableCents } from '../payment/pending-refund-signal'

export const INVOICE_BLOCK_MESSAGES = {
  not_owner: '这不是你的订单。',
  not_paid: '没付成的单，开不了发票。',
  refunded: '已退款的单，开不了发票。',
  refund_in_progress: '退款还没完成的单，开不了发票。',
  partial_refund: '部分退款的单，开不了发票。',
  zero_amount: '这一单没有实付金额，开不了发票。',
  already_requested: '这一单已经提交过开票申请。',
} as const

export type InvoiceBlockCode = keyof typeof INVOICE_BLOCK_MESSAGES
export type InvoiceOpenStatus = 'submitted' | 'issued' | null

interface InvoiceFactsBase {
  id: string
  endUserId: string | null
  openInvoiceStatus: InvoiceOpenStatus
}

export interface PrintInvoiceFacts extends InvoiceFactsBase {
  kind: 'print'
  payStatus: string
  amountCents: number
  discountCents: number
  refundedAmountCents: number
  refundStatuses: readonly string[]
}

export interface ServiceInvoiceFacts extends InvoiceFactsBase {
  kind: 'service'
  status: string
  amountCents: number
  paymentFailed: boolean
}

export type InvoiceFacts = PrintInvoiceFacts | ServiceInvoiceFacts

export interface InvoiceDecision {
  ok: boolean
  code: InvoiceBlockCode | null
  message: string
  amountCents: number
}

type Settlement = 'paid' | Exclude<InvoiceBlockCode, 'not_owner' | 'already_requested'>

function block(code: InvoiceBlockCode, amountCents: number): InvoiceDecision {
  return { ok: false, code, message: INVOICE_BLOCK_MESSAGES[code], amountCents }
}

function printSettlement(facts: PrintInvoiceFacts, payable: number): Settlement {
  if (facts.payStatus === 'refunding' || facts.refundStatuses.includes('pending')) return 'refund_in_progress'
  const partialByAmount = facts.refundedAmountCents > 0 && payable > 0 && facts.refundedAmountCents < payable
  if (facts.payStatus === 'partial_refunded' || partialByAmount) return 'partial_refund'
  if (facts.payStatus === 'refunded' || (payable > 0 && facts.refundedAmountCents >= payable)) return 'refunded'
  if (facts.payStatus !== 'paid') return 'not_paid'
  if (payable <= 0) return 'zero_amount'
  return 'paid'
}

function serviceSettlement(facts: ServiceInvoiceFacts, payable: number): Settlement {
  if (facts.paymentFailed) return 'not_paid'
  if (facts.status === 'refunding' || facts.status === 'refund_failed') return 'refund_in_progress'
  if (facts.status === 'refunded') return 'refunded'
  if (facts.status !== 'paid' && facts.status !== 'consumed') return 'not_paid'
  if (payable <= 0) return 'zero_amount'
  return 'paid'
}

export function assessInvoiceEligibility(facts: InvoiceFacts, requesterEndUserId: string): InvoiceDecision {
  const amountCents = facts.kind === 'print' ? payableCents(facts) : Math.max(0, facts.amountCents)
  if (!facts.endUserId || facts.endUserId !== requesterEndUserId) return block('not_owner', amountCents)
  const settlement = facts.kind === 'print' ? printSettlement(facts, amountCents) : serviceSettlement(facts, amountCents)
  if (settlement !== 'paid') return block(settlement, amountCents)
  if (facts.openInvoiceStatus === 'submitted' || facts.openInvoiceStatus === 'issued') {
    return block('already_requested', amountCents)
  }
  return { ok: true, code: null, message: '', amountCents }
}
