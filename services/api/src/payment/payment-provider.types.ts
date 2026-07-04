/**
 * 支付渠道 Provider 抽象（C5-2，仿 AiProvider 可切换模式）。
 *
 * 本波只有 sandbox 实现（无 live 网关、无商户密钥、无真实资金交易）；
 * wechat / alipay 到 C5-6 真实渠道适配时新增实现，业务层（OnlinePaymentService）不感知具体渠道。
 *
 * 职责边界：
 * - Provider 负责「渠道协议」：出码内容生成、回调验签（含签名 base 的 method/path/channel 绑定）、
 *   时间窗校验、回调报文解析归一化。
 * - 业务层负责「资金与状态」：nonce 防重放登记、attempt/order 全字段匹配、金额一致性、
 *   幂等入账、状态机转移、审计。Provider 绝不触碰数据库。
 */
import type { PaymentChannel } from './payment.types'

/** 出码输入：全部来自服务端落库数据，绝不信任前端金额。 */
export interface QrPaymentCreateInput {
  orderId: string
  orderNo: string
  attemptId: string
  /** 整数「分」，快照自 Order.amountCents。 */
  amountCents: number
}

export interface QrPaymentCreateResult {
  /** 渠道预支付标识（沙箱为服务端生成的假标识）。 */
  prepayId: string
  /** 屏上动态码内容（沙箱为 sandboxpay:// 假 scheme，UI 必须明示测试通道）。 */
  qrCodeContent: string
}

/** 回调验签上下文：path 参与签名 base（绑定回调路径，防同一签名跨路径复用）。 */
export interface PaymentCallbackContext {
  /** 路由 path param 中的渠道名。 */
  channel: string
  /** 规范回调路径（buildPaymentCallbackPath 构造），参与签名 base。 */
  path: string
  /** 原始请求字节（express verify 钩子捕获；对 parsed object 重新 stringify 会破坏签名）。 */
  rawBody: Buffer
  headers: Record<string, string | string[] | undefined>
}

/** 归一化回调事件（各渠道报文解析后的统一形状）。 */
export interface PaymentCallbackEvent {
  channel: string
  attemptId: string
  prepayId: string
  orderId: string
  /** 整数「分」；业务层必须与 attempt 快照、Order 应付双重比对。 */
  amountCents: number
  result: 'success' | 'failed'
  /** 渠道支付流水号；success 时必填（幂等入账键组成）。 */
  channelTxnNo: string | null
  /** 渠道原始失败信息；只进审计 payload，绝不透传给用户。 */
  failReasonRaw: string | null
  /** 防重放 nonce（业务层登记 ReplayGuard）。 */
  nonce: string
  timestampMs: number
}

export type CallbackVerifyResult =
  | { ok: true; event: PaymentCallbackEvent }
  | { ok: false; code: string }

/** 退款执行输入（C5-4）：全部来自服务端落库数据（Order + Refund 记录），绝不信任前端金额。 */
export interface RefundExecuteInput {
  orderId: string
  orderNo: string
  /** 幂等键（服务端生成的退款单号）；同一 refundNo 只出款一次由业务层保证。 */
  refundNo: string
  /** 本次退款额（分，>=0），快照自服务端 Refund 记录。 */
  amountCents: number
}

export interface RefundExecuteResult {
  /** 渠道退款流水号（沙箱为服务端生成的假标识；无真实资金）。 */
  channelRefundNo: string
  status: 'success' | 'failed'
}

export interface PaymentProvider {
  readonly channel: PaymentChannel
  createQrPayment(input: QrPaymentCreateInput): Promise<QrPaymentCreateResult>
  /** 验签（含时间窗 + path/channel 绑定）+ 报文解析归一化。失败返回明确错误码，绝不静默放行。 */
  verifyAndParseCallback(ctx: PaymentCallbackContext): Promise<CallbackVerifyResult>
  /**
   * 执行退款（C5-4）。**只对本通道已入账（sandbox paid）的订单调用**；
   * 线下（offline/manual_confirmed）/免费/权益单不经此路径（由业务层判定）。
   * 沙箱为假通道：不动外部资金，返回服务端生成的假 channelRefundNo + success。
   * C5-6 真实渠道接入时实现真实退款 API（验签/幂等/对账另批）。
   */
  refund(input: RefundExecuteInput): Promise<RefundExecuteResult>
  /**
   * 主动查单兜底（回调丢失时对渠道账本查询）。C5-6 真实渠道接入时实现；
   * sandbox 无外部账本（DB 即真相源），不实现 —— 不伪造能力。
   */
  queryPayment?(attemptId: string): Promise<{ status: string }>
}

/** 规范回调路径（签名 base 绑定与路由注册共用同一构造，避免两处口径漂移）。 */
export function buildPaymentCallbackPath(channel: string): string {
  return `/api/v1/payment/callback/${channel}`
}
