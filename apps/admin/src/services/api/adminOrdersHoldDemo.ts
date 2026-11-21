import { ApiHttpError } from './client'
import type { AdminOrderReadonlyDetail, PrintReturnResolutionResult } from './adminOrdersReadonly'
import type { ChannelResultRegistrationInput, ChannelResultRegistrationOutcome, QueryPrintReturnChannelOutcome } from './adminOrdersRegistration'

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
type HoldDemoMode = 'manual' | 'pending' | 'channel-manual' | 'window-local' | 'channel-stuck' | 'paper-channel-manual' | 'channel-abnormal'
const HOLD_DEMO_MODES: readonly HoldDemoMode[] = ['manual', 'pending', 'channel-manual', 'window-local', 'channel-stuck', 'paper-channel-manual', 'channel-abnormal']

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
    taskStatus: mode === 'paper-channel-manual' ? 'completed' : 'failed',
    billablePages: 1,
    printFileName: '待人工退款.pdf',
    copies: 1,
    colorMode: 'black_white',
    paperSize: 'A4',
    errorCode: null,
    printOutcome: mode === 'paper-channel-manual' ? 'printed' : 'not_printed',
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
      status: mode === 'paper-channel-manual' ? 'completed' : 'failed',
      createdAt,
      completedAt: mode === 'paper-channel-manual' ? createdAt : null,
      errorCode: null,
    },
    statusLogs: [{ fromStatus: 'pending', toStatus: mode === 'paper-channel-manual' ? 'completed' : 'failed', errorCode: null, createdAt }],
    autoRefund: false,
    refundStatus: mode === 'pending' || mode === 'channel-stuck' || mode === 'channel-abnormal' ? 'pending' : mode === 'manual' ? 'failed' : 'manual_review',
    refundFailureReason: mode === 'manual' ? '渠道退款失败' : null,
    printRefundDisposition: 'manual',
    printRefundReason: mode === 'window-local'
      ? '取件窗口已经关了，纸没出，待人工原路退回'
      : mode === 'channel-abnormal'
        ? '渠道说退款异常：资金在渠道中间账户，需按渠道异常退款流程处理。'
        : mode === 'channel-manual' || mode === 'paper-channel-manual' ? '渠道通知退款金额对不上，待人工核对' : '渠道未确认',
    refundLedgerNo: LEDGER_NO,
    refundLedgerCents: LEDGER_CENTS,
    refundRemainderCents: null,
    channelInFlight: mode === 'pending' || mode === 'channel-manual' || mode === 'channel-stuck' || mode === 'paper-channel-manual' || mode === 'channel-abnormal',
    channelResultRegistration: mode === 'channel-stuck' || mode === 'channel-abnormal'
      ? { refundNo: LEDGER_NO, amountCents: LEDGER_CENTS, submittedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(), abnormal: mode === 'channel-abnormal' }
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
  if (input.result === 'refunded') {
    const maxCents = order.channelResultRegistration.amountCents
    const actualCents = input.actualAmountCents ?? maxCents
    if (!Number.isInteger(actualCents) || actualCents <= 0 || actualCents > maxCents) {
      throw new ApiHttpError('REGISTRATION_AMOUNT_INVALID', `实退金额必须是大于 0 且不超过本笔申请额（${maxCents} 分）的整数分。`, 400)
    }
    order.channelInFlight = false
    order.channelResultRegistration = null
    order.updatedAt = at
    order.refundStatus = 'success'
    order.refundLedgerCents = actualCents
    order.refundedAmountCents = actualCents
    if (actualCents < order.payableCents) {
      order.payStatus = 'partial_refunded'
      order.refundRemainderCents = order.payableCents - actualCents
      order.refundEligible = true
      order.printRefundDisposition = 'manual'
      order.printRefundReason = '只退了一部分，纸没有出，待人工核对'
      order.opsAttention = true
      order.opsAttentionCode = 'partial_refunded'
      order.refundRequired = false
    } else {
      order.payStatus = 'refunded'
      order.taskStatus = 'cancelled'
      order.printRefundDisposition = null
      order.refundRemainderCents = null
      order.refundedAt = at
      order.opsAttention = false
      order.opsAttentionCode = null
      order.refundRequired = false
    }
    return {
      orderId: order.id,
      payStatus: order.payStatus,
      refundStatus: 'success',
      refundNo: input.refundNo,
      amountCents: actualCents,
      recordedBy: 'registration',
    }
  }
  order.channelInFlight = false
  order.channelResultRegistration = null
  order.updatedAt = at
  order.payStatus = 'paid'
  order.refundStatus = 'failed'
  order.refundFailureReason = '按商户平台核实：没退出去'
  return {
    orderId: order.id,
    payStatus: order.payStatus,
    refundStatus: order.refundStatus ?? 'failed',
    refundNo: input.refundNo,
    amountCents: order.refundLedgerCents ?? 0,
    recordedBy: 'registration',
  }
}

/** 24 小时内在途退款「只查不处置」演示。返回字段与服务端 QueryPrintReturnChannelOutcome 逐一对齐。 */
export function queryHoldDemo(id: string): QueryPrintReturnChannelOutcome | null {
  const order = currentHoldDemo()
  if (!order || order.id !== id) return null
  if (!order.channelInFlight) {
    return {
      orderId: order.id,
      outcome: 'no_in_flight',
      payStatus: order.payStatus,
      refundStatus: order.refundStatus,
      channelInFlight: false,
      checkedCount: 0,
      message: '这单目前没有渠道在途退款，无需查询。请刷新后查看最新状态。',
    }
  }
  const mode = holdDemoMode()
  if (mode === 'pending') {
    return {
      orderId: order.id,
      outcome: 'processing',
      payStatus: order.payStatus,
      refundStatus: order.refundStatus,
      channelInFlight: true,
      checkedCount: 1,
      message: '渠道还在处理这笔退款，结果出来前不能处置，请稍后再查。',
    }
  }
  const at = new Date().toISOString()
  order.channelInFlight = false
  order.channelResultRegistration = null
  order.updatedAt = at
  if (mode === 'paper-channel-manual') {
    order.refundStatus = 'success'
    order.printRefundReason = '渠道退款已成功并已记账，但纸已经放行或已出纸，已转待人工核对，请勿重复退款。'
    return {
      orderId: order.id,
      outcome: 'conflict',
      payStatus: order.payStatus,
      refundStatus: 'success',
      channelInFlight: false,
      checkedCount: 1,
      message: '渠道退款已成功并已记账，但纸已经放行或已出纸，已转待人工核对，请勿重复退款。',
    }
  }
  order.payStatus = 'refunded'
  order.refundStatus = 'success'
  order.taskStatus = 'cancelled'
  order.printRefundDisposition = 'auto_success'
  order.printRefundReason = null
  order.refundedAmountCents = order.refundLedgerCents ?? 0
  order.refundedAt = at
  order.opsAttention = false
  order.opsAttentionCode = null
  order.refundRequired = false
  if (order.print) order.print = { ...order.print, status: 'cancelled' }
  return {
    orderId: order.id,
    outcome: 'refunded',
    payStatus: 'refunded',
    refundStatus: 'success',
    channelInFlight: false,
    checkedCount: 1,
    message: '渠道已确认退款成功，已按渠道金额记账。',
  }
}
