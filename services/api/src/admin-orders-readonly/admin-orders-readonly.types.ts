export interface AdminOrderReadonlyPrintSummary {
  fileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  duplex: string | null
  paperSize: string | null
  pageRange: string | null
}

export type AdminOrderAftercareStatus = 'manual_check_required' | null

export interface AdminOrderReadonlyItem {
  id: string
  orderNo: string
  type: string
  typeLabel?: '复印'
  ownerType: 'member' | 'anonymous'
  userLabel: string
  terminalCode: string | null
  amountCents: number
  /** 订单原始计费内容页数，不含份数；多文件为各文件选中页数之和。 */
  billablePages: number | null
  currency: string
  /** 下单渠道：kiosk | miniapp_cloud；null = 存量单无法可靠判定，前端显示「未标注」 */
  channel: string | null
  /** 取件状态：none | pending | claimed | used | expired | cancelled；一体机单恒 none */
  pickupStatus: string
  /** 取件码过期时间（ISO）；仅小程序云单有值 */
  pickupCodeExpiresAt: string | null
  payStatus: string
  /** 复印单返回 CopyJob.state；不使用为注销保留的 Order.taskStatus 映射。 */
  taskStatus: string
  taskStatusLabel?: string
  printFileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  paperSize: string | null
  errorCode: string | null
  /** 管理员现场核查：null = 未核查；printed / not_printed 与 errorCode 正交。 */
  printOutcome: 'printed' | 'not_printed' | null
  aftercareStatus: AdminOrderAftercareStatus
  refundEligible: boolean
  retryForbidden: boolean
  /** 已付款未出纸、已落待退款信号。不会自动出款。 */
  refundRequired: boolean
  /**
   * 运营必须看见：待退款、退款中、渠道已受理但本地确认未落地、部分退款、已出纸且退款失败、待人工。
   * 只读；不自动出款、不改 payStatus。
   */
  opsAttention: boolean
  opsAttentionCode: 'refund_required' | 'refunding' | 'channel_accepted_unconfirmed' | 'copy_result_unconfirmed' | 'partial_refunded' | 'paper_refund_failed' | 'print_return_manual' | null
  createdAt: string
  updatedAt: string
}

export interface AdminOrderStatusLogItem {
  fromStatus: string
  toStatus: string
  errorCode: string | null
  createdAt: string
}

export interface AdminOrderReadonlyDetail extends AdminOrderReadonlyItem {
  /** 服务单才有，打印单不返回。与 toAdminItem 对齐。 */
  recordKind?: 'service'
  serviceKey?: string
  serviceName?: string
  serviceStatus?: string
  paidAt?: string | null
  refundAttempts?: number
  locationLabel?: string | null
  failureReason?: string | null
  closeReason?: string | null
  refundedAt: string | null
  refundReason: string | null
  /** 券/权益抵扣（分）。Order.discountCents，无抵扣为 0。 */
  discountCents: number
  /** 应付额（分）。与退款同一公式，按钮只展示这个数。 */
  payableCents: number
  /** 已退金额累计（分）。Order.refundedAmountCents，未退为 0。 */
  refundedAmountCents: number
  /** PrintTask.id（废弃孤单入口使用；非文件链接，不含敏感内容）。 */
  printTaskId: string | null
  print: (AdminOrderReadonlyPrintSummary & {
    status: string
    createdAt: string
    completedAt: string | null
    errorCode: string | null
  }) | null
  statusLogs: AdminOrderStatusLogItem[]
  /** 这一单有「已付款没出纸」的自动原路退记录。 */
  autoRefund: boolean
  /** 自动退款那一行的状态：pending / success / failed。没有记录时为 null。 */
  refundStatus: string | null
  /** 自动退款失败时给管理员看的原因。成功或还没有记录时为 null。 */
  refundFailureReason: string | null
  /** 已付没出纸的去向。自动退成功、自动退失败、待人工。都不是时为 null。 */
  printRefundDisposition: 'auto_success' | 'auto_failed' | 'manual' | null
  /** 这一去向的原因。普通没出纸自动退成功时为 null；过期付款退成时写明金额。 */
  printRefundReason: string | null
  /** 这一去向对应的退款单号。没有退款行时为 null。 */
  refundLedgerNo: string | null
  /** 这一去向对应的退款金额（分）。没有退款行时为 null。 */
  refundLedgerCents: number | null
  /** 部分退款还没退完的金额（分）。不是部分退款时为 null。 */
  refundRemainderCents: number | null
}

export interface AdminOrderReadonlyPage {
  items: AdminOrderReadonlyItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}
