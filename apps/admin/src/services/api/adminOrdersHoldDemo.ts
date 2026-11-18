import { ApiHttpError } from './client'
import type { AdminOrderReadonlyDetail, PrintReturnResolutionResult } from './adminOrdersReadonly'

/**
 * 只有浏览器用例写入这个键时才出现。默认列表不带这张单，也不带运营关注角标。
 * manual：渠道退款已经失败，三步都能做。pending：退款还在处理，改为出纸必须禁用。
 */
const HOLD_DEMO_KEY = 'mock:order-hold'
const HOLD_ID = 'ord_mock_hold'
const LEDGER_NO = 'RFD-HOLD-MANUAL'
const LEDGER_CENTS = 200

type HoldAction = 'confirm-refunded' | 'release-paper' | 'close'
type HoldDemoMode = 'manual' | 'pending'

let loaded = false
let holdOrder: AdminOrderReadonlyDetail | null = null

function holdDemoMode(): HoldDemoMode | null {
  try {
    const value = localStorage.getItem(HOLD_DEMO_KEY)
    if (value === 'manual' || value === 'pending') return value
    return null
  } catch {
    return null
  }
}

function freshHoldOrder(mode: HoldDemoMode): AdminOrderReadonlyDetail {
  const createdAt = new Date().toISOString()
  return {
    id: HOLD_ID,
    orderNo: 'ORD-HOLD-MANUAL',
    type: 'print',
    ownerType: 'anonymous',
    userLabel: '待人工演示',
    terminalCode: 'KSK-HOLD',
    payableCents: LEDGER_CENTS,
    channel: null,
    pickupStatus: 'none',
    pickupCodeExpiresAt: null,
    amountCents: LEDGER_CENTS,
    currency: 'CNY',
    payStatus: 'paid',
    taskStatus: 'failed',
    billablePages: 1,
    printFileName: '待人工退款.pdf',
    copies: 1,
    colorMode: 'black_white',
    paperSize: 'A4',
    errorCode: null,
    printOutcome: 'not_printed',
    aftercareStatus: null,
    refundEligible: false,
    retryForbidden: false,
    refundRequired: true,
    opsAttention: true,
    opsAttentionCode: 'refund_required',
    createdAt,
    updatedAt: createdAt,
    refundedAt: null,
    refundReason: null,
    discountCents: 0,
    refundedAmountCents: 0,
    printTaskId: null,
    print: {
      fileName: '待人工退款.pdf',
      copies: 1,
      colorMode: 'black_white',
      duplex: 'simplex',
      paperSize: 'A4',
      pageRange: null,
      status: 'failed',
      createdAt,
      completedAt: null,
      errorCode: null,
    },
    statusLogs: [{ fromStatus: 'pending', toStatus: 'failed', errorCode: null, createdAt }],
    autoRefund: false,
    refundStatus: mode === 'pending' ? 'pending' : 'failed',
    refundFailureReason: mode === 'pending' ? null : '渠道退款失败',
    printRefundDisposition: 'manual',
    printRefundReason: '渠道未确认',
    refundLedgerNo: LEDGER_NO,
    refundLedgerCents: LEDGER_CENTS,
    refundRemainderCents: null,
  }
}

/** 本页第一次读列表时才看本地开关，避免默认订单页带上待人工单。 */
export function currentHoldDemo(): AdminOrderReadonlyDetail | null {
  if (!loaded) {
    loaded = true
    const mode = holdDemoMode()
    holdOrder = mode ? freshHoldOrder(mode) : null
  }
  return holdOrder
}

/** 不是这张演示单时返回 null，调用方继续走原来的模拟。 */
export function resolveHoldDemo(id: string, action: HoldAction): PrintReturnResolutionResult | null {
  const order = currentHoldDemo()
  if (!order || order.id !== id) return null
  if (order.printRefundDisposition !== 'manual' && order.printRefundDisposition !== 'auto_failed') {
    throw new ApiHttpError('REFUND_HOLD_ALREADY_RESOLVED', '这张单刚刚已经处理过，请刷新后再看。', 409)
  }
  if (!order.refundLedgerNo) {
    throw new ApiHttpError('REFUND_HOLD_NOT_FOUND', '没有待人工处理的退款，不能做这一步。', 400)
  }
  if (action === 'release-paper' && order.refundStatus === 'pending') {
    throw new ApiHttpError(
      'REFUND_CHANNEL_UNCONFIRMED',
      '渠道还没确认这笔退款失败。请先向渠道查证，确认失败后再改为出纸。',
      400,
    )
  }
  const payStatus = action === 'confirm-refunded' ? 'refunded' : action === 'close' ? 'closed' : 'paid'
  const refundStatus = action === 'confirm-refunded' ? 'success' : action === 'close' ? 'closed' : 'withdrawn'
  const taskStatus = action === 'release-paper' ? 'pending' : 'cancelled'
  const at = new Date().toISOString()
  order.payStatus = payStatus
  order.refundStatus = refundStatus
  order.taskStatus = taskStatus
  order.printRefundDisposition = null
  order.opsAttention = false
  order.opsAttentionCode = null
  order.refundRequired = false
  order.refundEligible = false
  order.updatedAt = at
  if (action === 'confirm-refunded') {
    order.refundedAmountCents = order.refundLedgerCents ?? 0
    order.refundedAt = at
  }
  if (order.print) {
    order.print = { ...order.print, status: taskStatus === 'pending' ? 'pending' : 'cancelled' }
  }
  return {
    orderId: order.id,
    payStatus,
    refundStatus,
    taskStatus,
    refundNo: order.refundLedgerNo,
    amountCents: order.refundLedgerCents ?? 0,
  }
}
