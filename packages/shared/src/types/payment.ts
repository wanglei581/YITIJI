// ============================================================
// 支付域 C-5 · 订单支付/退款状态、来源与报价（SSOT）
//
// 归属计划：docs/superpowers/plans/2026-07-03-profile-commercial-closure-batch1.md（P0a）
//
// 诚实/合规硬约束（P0a 后端底座，无 live 网关）：
// - P0a 只做后端底座：无微信/支付宝 live 网关、无商户密钥、无真实资金交易。
// - 金额一律整数「分」（amountCents），绝不使用浮点。
// - payStatus=paid 必须同时带 paymentSource；本批 paymentSource 只允许
//   offline / free / manual_confirmed，绝不表示线上已真实收款。
// - wechat / alipay / benefit 均为「未来扩展」占位，P0a 禁止写入
//   （类型不纳入 PaymentSource，运行时由 verify:order 断言拦截）。
// ============================================================

/**
 * 订单支付状态（对齐 `Order.payStatus`，schema.prisma 注释）：
 * unpaid → paid → refunded；failed 为异常终态。
 * 注意：`cancelled` 属于 `Order.taskStatus`，不是 payStatus。
 */
export type OrderPayStatus = 'unpaid' | 'paid' | 'refunded' | 'failed'

/**
 * 支付来源（P0a 唯一合法取值）——只表示诚实的线下/免费/人工确认，绝不表示线上已收款：
 * - `offline`：线下收款（现金 / 对公 / 其它线下渠道）
 * - `free`：免费单（报价为 0）
 * - `manual_confirmed`：管理员人工确认已收款
 *
 * `wechat` / `alipay` / `benefit` 均为未来扩展，**P0a 禁止写入**，故不纳入本联合类型；
 * 待 live 网关（商户进件后）或权益核销（P1）另行评估再扩展。
 */
export type PaymentSource = 'offline' | 'free' | 'manual_confirmed'

/** P0a 允许写入的 paymentSource 白名单（后端状态机与 verify:order 共用，避免各处硬编码）。 */
export const P0A_ALLOWED_PAYMENT_SOURCES: readonly PaymentSource[] = [
  'offline',
  'free',
  'manual_confirmed',
] as const

/** 单条计费明细（单位：分）。 */
export interface PrintPriceLine {
  /** 价目项键，如 print_bw_page / print_color_page / print_duplex_surcharge。 */
  serviceKey: string
  /** 单价（分），>= 0。 */
  unitCents: number
  /** 数量（页 / 份 / 件），>= 0。 */
  quantity: number
  /** 小计（分）= unitCents × quantity，>= 0。 */
  subtotalCents: number
  /** 可选人类可读说明。 */
  description?: string
}

/**
 * 报价明细（单位：分）。由 PricingService 依打印参数计算（Task 4 落地）。
 * `amountCents` = 各 line.subtotalCents 之和，>= 0；为 0 时表示免费单。
 */
export interface PrintPriceBreakdown {
  lines: PrintPriceLine[]
  amountCents: number
}

/**
 * 订单支付/退款侧安全视图：`Order` 的支付相关字段（Admin 动作与后续 /me 只读消费共用）。
 * 只含安全元数据，绝不含文件原文 / 签名 URL / 内部堆栈等敏感字段。
 */
export interface OrderPaymentView {
  /** 订单号（Order.orderNo）。 */
  orderNo: string
  /** 关联打印任务 id；非打印类订单为 null。 */
  printTaskId: string | null
  /** 金额（分），>= 0。 */
  amountCents: number
  /** 支付状态。 */
  payStatus: OrderPayStatus
  /**
   * 支付来源；未支付（unpaid/failed）时为 null。
   * payStatus=paid 时必为 {@link P0A_ALLOWED_PAYMENT_SOURCES} 之一。
   */
  paymentSource: PaymentSource | null
  /** 支付完成时间（ISO 串）；未支付为 null。 */
  paidAt: string | null
  /** 取件凭证码；paid 时生成，否则 null。 */
  pickupCode: string | null
  /** 退款原因；未退款为 null。 */
  refundReason: string | null
  /** 退款时间（ISO 串）；未退款为 null。 */
  refundedAt: string | null
}
