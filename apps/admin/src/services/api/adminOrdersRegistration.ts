/**
 * 按商户平台核实结果登记（长期查不到渠道结果时）。请求体与结果，和服务端
 * POST /admin/orders/:id/print-return/register-channel-result 对齐。
 */
export interface ChannelResultRegistrationInput {
  refundNo: string
  result: 'refunded' | 'not_refunded'
  /** 登记「渠道已退成」时必填。 */
  channelRefundNo?: string
  /** 登记「渠道已退成」时的实退金额（整数分），必须满足 0 < actualAmountCents <= 申请额。 */
  actualAmountCents?: number
  /** 登记「渠道确认没退出去」时必填，4 到 200 字。 */
  note?: string
  /** 重输的订单号，必须和这张单一致。 */
  confirmOrderNo: string
}

export interface ChannelResultRegistrationOutcome {
  orderId: string
  payStatus: string
  refundStatus: string
  refundNo: string
  amountCents: number
  /** channel：登记前问渠道已经有了明确答复，按渠道答复记账，没有用这次登记。 */
  recordedBy: 'registration' | 'channel'
}

export type ChannelQuerySummaryOutcome =
  | 'no_in_flight'
  | 'refunded'
  | 'failed'
  | 'processing'
  | 'abnormal'
  | 'unknown'
  | 'unsupported'
  | 'conflict'

/** 只查不处置结果，与服务端 POST /admin/orders/:id/print-return/query-channel 对齐。 */
export interface QueryPrintReturnChannelOutcome {
  orderId: string
  outcome: ChannelQuerySummaryOutcome
  payStatus: string
  refundStatus: string | null
  channelInFlight: boolean
  checkedCount: number
  message: string
}
