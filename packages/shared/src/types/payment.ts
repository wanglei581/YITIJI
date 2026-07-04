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
 * C5-2 线上态：`paying`（已出码待支付）/ `closed`（超时关单，可由已存在支付尝试的
 * 有效迟到回调转 paid，见 OrderStatusService.markPaidOnline）。
 * C5-4 退款态：`refunding`（退款处理中）/ `refunded`（已全额退款）/ `partial_refunded`
 *   （部分退款，**本波仅类型/状态机预留，不接部分退款动作**）。
 * C5-3 出纸门控口径：**只有 paid 可 claim 出纸**；refunding/partial_refunded/refunded 一律不放行。
 * 线下与免费单仍只走 unpaid → paid → refunded，不进 paying/closed。
 * 注意：`cancelled` 属于 `Order.taskStatus`，不是 payStatus。
 */
export type OrderPayStatus =
  | 'unpaid'
  | 'paying'
  | 'paid'
  | 'refunding'
  | 'partial_refunded'
  | 'refunded'
  | 'failed'
  | 'closed'

/**
 * 支付来源 —— 表示资金性质，绝不伪装线上真实收款：
 * - `offline`：线下收款（现金 / 对公 / 其它线下渠道）
 * - `free`：免费单（报价为 0）
 * - `manual_confirmed`：管理员人工确认已收款
 * - `sandbox`：C5-2 沙箱测试通道入账（**非真实资金**；只能由回调成功入账路径写入，
 *   Admin mark-paid / 任何手工动作禁止写入；生产环境启动门禁禁用 sandbox Provider）
 * - `voucher`：C5-4 券 / 免费次数 / 会员权益**全额核销单**入账（**非资金**；只能由核销路径
 *   `OrderStatusService.markPaidByRedemption` 写入，Admin mark-paid / markPaidOnline 禁写）
 *
 * `wechat` / `alipay` / `benefit` 均为未来扩展（C5-6），**继续按名禁止写入**，
 * 故不纳入本联合类型；待真实渠道适配再扩展。
 */
export type PaymentSource = 'offline' | 'free' | 'manual_confirmed' | 'sandbox' | 'voucher'

/** P0a 允许写入的 paymentSource 白名单（**markPaid 线下路径**专用；sandbox/voucher 各有独立入账路径，禁经 markPaid 写）。 */
export const P0A_ALLOWED_PAYMENT_SOURCES: readonly PaymentSource[] = [
  'offline',
  'free',
  'manual_confirmed',
] as const

/**
 * C5-2 线上支付通道白名单（同时是线上入账 paymentSource 的唯一合法取值）。
 * 本波只有 sandbox；wechat / alipay 到 C5-6 真实渠道适配才允许出现。
 */
export type PaymentChannel = 'sandbox'
export const C52_ONLINE_PAYMENT_CHANNELS: readonly PaymentChannel[] = ['sandbox'] as const

/** 支付尝试状态（对齐 `PaymentAttempt.status`）。 */
export type PaymentAttemptStatus = 'created' | 'pending' | 'success' | 'failed' | 'expired'

/**
 * 计费页数来源（后端识别，**绝不信任前端 `file.pages`**，见计划 §2.4/§4.4）：
 * - `pdf_lightweight_scan`：PDF 经后端轻量页数识别（复用 materials.service 能力）
 * - `image_single_page`：图片按 1 页计
 * 识别失败 / 未知 MIME / 页数为 0 时后端 fail-closed，拒绝创建付费订单（不回退到前端估算或单页假设）。
 */
export type BillingPageSource = 'pdf_lightweight_scan' | 'image_single_page'

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
  /** 计费页数（后端识别，非前端上报）；历史无 Order 或未识别时为 null。 */
  billablePages: number | null
  /** 计费页数来源；历史无 Order 或未识别时为 null。 */
  billingPageSource: BillingPageSource | null
  /** 支付状态。 */
  payStatus: OrderPayStatus
  /**
   * 支付来源；未支付（unpaid/paying/failed/closed）时为 null。
   * payStatus=paid 时必为 {@link P0A_ALLOWED_PAYMENT_SOURCES} 之一，
   * 或 `sandbox`（C5-2 回调成功入账，测试通道，非真实收款）。
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

/**
 * C5-4 退款记录安全视图（Refund 表；Admin/服务端退款结果 + 会员只读消费共用）。
 * 沙箱/线下/免费单口径：绝不含商户密钥、内部堆栈等敏感字段。
 */
export interface RefundView {
  /** 退款单号（幂等键）。 */
  refundNo: string
  /** 本次退款额（分，>= 0）。 */
  amountCents: number
  /** pending | success | failed。本波沙箱/线下均落 success。 */
  status: 'pending' | 'success' | 'failed'
  /** 退款执行渠道：sandbox | offline | manual_confirmed | free | voucher。 */
  channel: string
  /** 渠道退款流水号（沙箱为假标识；线下/免费单为 null）。 */
  channelRefundNo: string | null
  /** 退款原因；无则 null。 */
  reason: string | null
  /** 创建时间（ISO 串）。 */
  createdAt: string
}

/**
 * C5-4 订单核销结果安全视图（RedemptionRecord order-linked 子集）。
 * 券=平台 credit / 权益，非资金；绝不承诺补贴到账。
 */
export interface OrderRedemptionView {
  /** 关联订单 id。 */
  orderId: string
  /** 核销种类：coupon | free_quota | package_entitlement | membership。 */
  kind: string
  /** 抵扣金额（分，>= 0）；全额核销单 = 订单应付。 */
  amountCents: number
  /** 幂等键（hash(benefitGrantId:'order_redeem':orderId)）。 */
  idempotencyKey: string
  /** 核销时间（ISO 串）。 */
  createdAt: string
}
