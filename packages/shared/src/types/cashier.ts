// ============================================================
// 支付域 C5-3 · Kiosk 收银 / 支付状态轮询 — 前端安全视图类型（SSOT）
//
// 契约源：services/api/src/payment/online-payment.service.ts 的
//   `PayAttemptView`（POST /orders/:id/pay 出码响应）
//   `PayStatusView`（GET  /orders/:id/pay-status 轮询响应）
// 本文件为**前端只读消费**的镜像类型，字段与后端响应逐一对齐。
//
// 合规硬约束（CLAUDE.md §12/§18）：
// - **绝不含任何密钥字段**：appSecret / SANDBOX_PAYMENT_SECRET / prepay 签名等一律不出现在前端类型；
//   Kiosk 只拿屏上动态码内容 `qrCodeContent`（沙箱为自描述测试 scheme，不指向真实收款地址）。
// - 金额一律整数「分」（amountCents），绝不浮点。
// - `pickupCode` 仅在后端 `pickupCodeVisibleFor`（paid + 未退款 + 任务未进终态）判定可见时才有值，
//   前端不得在 unpaid/paying/closed/refunded 下自行编造或展示取件码。
// ============================================================

import type { OrderPayStatus, PaymentAttemptStatus, PaymentSource, PaymentChannel } from './payment'

/**
 * 出码响应视图（`POST /orders/:id/pay`，body 可选 channel 选择已启用通道）。
 * 为付费订单创建（或幂等复用未过期的）支付尝试，返回屏上动态码内容。
 */
export interface PayAttemptView {
  attemptId: string
  orderId: string
  orderNo: string
  /** 支付通道：sandbox（测试通道）/ wechat / alipay（C5-6 真实渠道）。 */
  channel: PaymentChannel | string
  amountCents: number
  /** 支付尝试状态。 */
  status: PaymentAttemptStatus
  /** 屏上动态码内容（沙箱为 `sandboxpay://...` 自描述测试 scheme）；异常时为 null。 */
  qrCodeContent: string | null
  /** 本次动态码有效期（ISO 串）。 */
  expiresAt: string | null
  /** 订单支付状态（出码后进入 `paying`）。 */
  orderPayStatus: OrderPayStatus | string
  /** 订单超时关单时间（ISO 串）。 */
  orderExpiresAt: string | null
}

/**
 * 付款码支付响应（`POST /orders/:id/code-pay`）。
 * 不含付款码、渠道原文错误或任何密钥；`paying` 时由既有 pay-status/reconcile 收敛。
 */
export interface CodePayAttemptView {
  status: 'success' | 'paying' | 'failed'
  attemptId: string
  failReason: string | null
}

/**
 * 支付状态轮询视图（`GET /orders/:id/pay-status`）。
 * 含后端惰性过期/关单结果；`pickupCode` 仅 paid 且可见时返回。
 */
export interface PayStatusView {
  orderId: string
  orderNo: string
  payStatus: OrderPayStatus | string
  /** 支付来源；未支付时 null。付费线上入账为 `sandbox`（测试通道，非真实收款）。 */
  paymentSource: PaymentSource | string | null
  /** 支付通道；未支付时 null。 */
  payChannel: PaymentChannel | string | null
  amountCents: number
  /** 支付完成时间（ISO 串）；未支付 null。 */
  paidAt: string | null
  /** 取件凭证码；仅 paid 且后端 `pickupCodeVisibleFor` 判定可见时有值，否则 null。 */
  pickupCode: string | null
  /** 最近一次支付尝试摘要；无尝试为 null。 */
  attempt: {
    attemptId: string
    /** 本次尝试的支付通道（C5-6：sandbox / wechat / alipay；Kiosk 据此渲染品牌文案）。 */
    channel: PaymentChannel | string
    status: PaymentAttemptStatus
    qrCodeContent: string | null
    expiresAt: string | null
  } | null
}

/** GET /payment/channels 响应：服务端已启用的支付通道（无任何密钥信息）。 */
export interface PaymentChannelsView {
  channels: (PaymentChannel | string)[]
}
