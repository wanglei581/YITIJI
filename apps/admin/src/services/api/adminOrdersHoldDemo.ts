import { ApiHttpError } from './client'
import type { AdminOrderReadonlyDetail, PrintReturnResolutionResult } from './adminOrdersReadonly'
import type { ChannelResultRegistrationInput, ChannelResultRegistrationOutcome } from './adminOrdersRegistration'

/**
 * 只有浏览器用例写入这个键时才出现。默认列表不带这张单，也不带运营关注角标。
 * manual：渠道退款已经失败，三步都能做。pending：退款还在渠道处理中，三步都不能做。
 * channel-manual：渠道受理过、记成待人工（例如金额对不上搁置），三步都不能做。
 * window-local：取件窗口关闭后本地停放的待人工，渠道没受理过，三步都能做。
 * channel-stuck：渠道受理过、满 24 小时还查不到结果，三步不能做，可以按商户平台核实结果登记。
 * 能不能做只看 channelInFlight，和服务端同一个判断。
 */
const HOLD_DEMO_KEY = 'mock:order-hold'
const HOLD_ID = 'ord_mock_hold'
const LEDGER_NO = 'RFD-HOLD-MANUAL'
const LEDGER_CENTS = 200

type HoldAction = 'confirm-refunded' | 'release-paper' | 'close'
type HoldDemoMode = 'manual' | 'pending' | 'channel-manual' | 'window-local' | 'channel-stuck'
const HOLD_DEMO_MODES: readonly HoldDemoMode[] = ['manual', 'pending', 'channel-manual', 'window-local', 'channel-stuck']

let loaded = false
let holdOrder: AdminOrderReadonlyDetail | null = null

function holdDemoMode(): HoldDemoMode | null {
  try {
    const value = localStorage.getItem(HOLD_DEMO_KEY)
    return HOLD_DEMO_MODES.find((mode) => mode === value) ?? null
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
    refundStatus: mode === 'pending' || mode === 'channel-stuck' ? 'pending' : mode === 'manual' ? 'failed' : 'manual_review',
    refundFailureReason: mode === 'manual' ? '渠道退款失败' : null,
    printRefundDisposition: 'manual',
    printRefundReason: mode === 'window-local'
      ? '取件窗口已经关了，纸没出，待人工原路退回'
      : mode === 'channel-manual' ? '渠道通知退款金额对不上，待人工核对' : '渠道未确认',
    refundLedgerNo: LEDGER_NO,
    refundLedgerCents: LEDGER_CENTS,
    refundRemainderCents: null,
    channelInFlight: mode === 'pending' || mode === 'channel-manual' || mode === 'channel-stuck',
    channelResultRegistration: mode === 'channel-stuck'
      ? { refundNo: LEDGER_NO, amountCents: LEDGER_CENTS, submittedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() }
      : null,
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
  if (order.channelInFlight) {
    throw new ApiHttpError(
      'REFUND_CHANNEL_UNCONFIRMED',
      '退款还在渠道处理中，结果出来前不能处置。',
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
  order.channelInFlight = false
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

/** 按商户平台核实结果登记的演示。不是这张演示单时返回 null。 */
export function registerHoldDemo(id: string, input: ChannelResultRegistrationInput): ChannelResultRegistrationOutcome | null {
  const order = currentHoldDemo()
  if (!order || order.id !== id) return null
  if (!order.channelResultRegistration || order.channelResultRegistration.refundNo !== input.refundNo) {
    throw new ApiHttpError('REGISTRATION_NOT_IN_FLIGHT', '这笔退款不在渠道处理中，不用登记。请刷新后再看。', 400)
  }
  if (input.confirmOrderNo.trim() !== order.orderNo) {
    throw new ApiHttpError('REGISTRATION_ORDER_NO_MISMATCH', '重输的订单号和这张单对不上，没有登记。', 400)
  }
  const at = new Date().toISOString()
  order.channelInFlight = false
  order.channelResultRegistration = null
  order.updatedAt = at
  if (input.result === 'refunded') {
    order.payStatus = 'refunded'
    order.refundStatus = 'success'
    order.taskStatus = 'cancelled'
    order.printRefundDisposition = null
    order.refundedAmountCents = order.refundLedgerCents ?? 0
    order.refundedAt = at
    order.opsAttention = false
    order.opsAttentionCode = null
    order.refundRequired = false
  } else {
    order.payStatus = 'paid'
    order.refundStatus = 'failed'
    order.refundFailureReason = '按商户平台核实：没退出去'
  }
  return {
    orderId: order.id,
    payStatus: order.payStatus,
    refundStatus: order.refundStatus ?? 'failed',
    refundNo: input.refundNo,
    amountCents: order.refundLedgerCents ?? 0,
    recordedBy: 'registration',
  }
}
