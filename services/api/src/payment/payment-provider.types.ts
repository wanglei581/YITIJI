/**
 * 支付渠道 Provider 抽象（C5-2 定义，C5-6 扩真实渠道）。
 *
 * 实现：sandbox（测试通道，非真实资金）/ wechat（微信 Native APIv3 动态码）/
 * alipay（支付宝当面付 precreate）。业务层（OnlinePaymentService）不感知具体渠道。
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
  /** 服务端持久化的二维码失效时刻；真实渠道必须同步为其可支付截止时间。 */
  expiresAt: Date
}

export interface QrPaymentCreateResult {
  /**
   * 渠道预支付标识。沙箱为服务端生成的假标识；真实渠道（wechat Native / alipay 当面付）
   * 无独立 prepay_id 概念，统一取 out_trade_no（= attemptId），回调事件回带同值以维持全字段匹配。
   */
  prepayId: string
  /**
   * 屏上动态码内容：sandbox 为 sandboxpay:// 假 scheme（UI 必须明示测试通道）；
   * wechat 为渠道返回的 code_url（weixin://wxpay/...）；alipay 为 precreate 返回的 qr_code。
   */
  qrCodeContent: string
}

/** 付款码支付输入：authCode 只允许请求内短暂使用，禁止落库/审计/日志。 */
export interface CodePaymentCreateInput {
  orderId: string
  orderNo: string
  attemptId: string
  /** 线下设备标识，仅用于渠道场景信息。 */
  terminalId: string | null
  /** 整数「分」，快照自 Order.amountCents。 */
  amountCents: number
  /** 用户微信/支付宝付款码；业务层和 Provider 都必须做格式校验。 */
  authCode: string
}

export interface CodePaymentCreateResult {
  /** success=已扣款；paying=用户输密码/处理中；failed=明确失败。 */
  status: 'success' | 'paying' | 'failed'
  /** 渠道支付流水号；success 时必填。 */
  channelTxnNo: string | null
  /** 与二维码路径兼容：付款码支付统一使用 out_trade_no=attemptId。 */
  prepayId: string | null
  /** 同步成功回包中的渠道金额；success 时必须与订单金额一致。 */
  amountCents: number | null
  /** 安全文案；不得包含 authCode、密钥、签名串或渠道完整原文。 */
  failReason: string | null
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
  /**
   * success / failed 正常入账/失败落库；
   * `ignored` = 验签合法但无需变更状态的中间态通知（如 alipay WAIT_BUYER_PAY），
   * 业务层只 ack 不动订单/尝试 —— 绝不把中间态误判为失败。
   */
  result: 'success' | 'failed' | 'ignored'
  /** 渠道支付流水号；success 时必填（幂等入账键组成）。 */
  channelTxnNo: string | null
  /** 渠道原始失败信息；只进审计 payload，绝不透传给用户。 */
  failReasonRaw: string | null
  /** 防重放 nonce（业务层登记 ReplayGuard；wechat 取签名 nonce、alipay 取 notify_id）。 */
  nonce: string
  timestampMs: number
}

export type CallbackVerifyResult =
  | { ok: true; event: PaymentCallbackEvent }
  | { ok: false; code: string }

/** 退款执行输入（C5-4 定义，W-B 扩真实渠道字段）：全部来自服务端落库数据，绝不信任前端金额。 */
export interface RefundExecuteInput {
  orderId: string
  orderNo: string
  /** 幂等键（服务端生成的退款单号，即渠道 out_refund_no / out_request_no）；同一 refundNo 只出款一次。 */
  refundNo: string
  /** 本次退款额（分，>=0），快照自服务端 Refund 记录。 */
  amountCents: number
  /** 订单原始应付（分）——wechat 退款 API 要求 amount.total（W-B additive；sandbox 忽略）。 */
  orderAmountCents?: number
  /** 原支付尝试的 out_trade_no（= attemptId）；真实渠道按原单定位退款（W-B additive）。 */
  outTradeNo?: string | null
  /** 原渠道支付流水号（W-B additive；备用定位键）。 */
  channelTxnNo?: string | null
}

export interface RefundExecuteResult {
  /** 渠道退款流水号（沙箱为服务端生成的假标识；真实渠道为 refund_id / trade_no，可能暂缺）。 */
  channelRefundNo: string | null
  /**
   * success=渠道确认退款完成；failed=渠道明确拒绝；
   * processing=渠道受理中（wechat 异步退款常态）——业务层保持 Refund pending +
   * 订单 refunding，经 queryRefund 收敛，**绝不把受理中假报为已退款**。
   */
  status: 'success' | 'failed' | 'processing'
}

/** 退款查证归一化结果（processing 收敛用）。 */
export interface RefundQueryResult {
  status: 'success' | 'failed' | 'processing' | 'unknown'
  channelRefundNo: string | null
}

/** 退款结果异步通知归一化事件（wechat REFUND.SUCCESS/CLOSED/ABNORMAL 通知解析后）。 */
export interface RefundNotifyEvent {
  channel: string
  /** 渠道 out_refund_no = 本系统 Refund.refundNo（RFD-<orderNo>）。 */
  refundNo: string
  /** 原支付单 out_trade_no（= attemptId），交叉核对用。 */
  outTradeNo: string
  /** 渠道退款流水号 refund_id。 */
  channelRefundNo: string | null
  /** SUCCESS→success；CLOSED/ABNORMAL→failed（渠道明确不会再退）。 */
  status: 'success' | 'failed'
  /** 本次退款额（分）；业务层必须与 Refund.amountCents 比对，不符拒绝。 */
  refundAmountCents: number | null
  /** 防重放 nonce（签名头 nonce）。 */
  nonce: string
  timestampMs: number
}

export type RefundNotifyVerifyResult = { ok: true; event: RefundNotifyEvent } | { ok: false; code: string }

/** 主动查单归一化结果（reconcile 兜底入账用；amountCents/channelTxnNo 缺失时不得入账）。 */
export interface PaymentQueryResult {
  /** paid=渠道账本确认已收款；pending=等待支付；failed/closed=不会再成功；unknown=渠道无此单/暂不可判。 */
  status: 'paid' | 'pending' | 'failed' | 'closed' | 'unknown'
  /** 渠道支付流水号；status=paid 时必填，否则 reconcile 拒绝入账。 */
  channelTxnNo: string | null
  /** 渠道账本金额（分）；status=paid 时必填并与服务端快照双重比对。 */
  amountCents: number | null
}

/** 回调 ack 报文（渠道要求的成功应答格式；不实现时控制器回默认 JSON）。 */
export interface CallbackAck {
  contentType: string
  body: string
}

export interface PaymentProvider {
  readonly channel: PaymentChannel
  createQrPayment(input: QrPaymentCreateInput): Promise<QrPaymentCreateResult>
  /**
   * 付款码支付（商户扫用户付款码，主扫模式）。同步返回渠道受理结果；
   * `paying` 状态由现有 queryPayment/reconcile 路径收敛。Provider 禁止持久化 authCode。
   */
  createCodePayment?(input: CodePaymentCreateInput): Promise<CodePaymentCreateResult>
  /** 验签（含时间窗 + path/channel 绑定）+ 报文解析归一化。失败返回明确错误码，绝不静默放行。 */
  verifyAndParseCallback(ctx: PaymentCallbackContext): Promise<CallbackVerifyResult>
  /**
   * 执行退款（C5-4 定义，W-B 接真实渠道）。**只对本通道已入账的订单调用**；
   * 线下（offline/manual_confirmed）/免费/权益单不经此路径（由业务层判定）。
   * - sandbox：假通道，不动外部资金，返回假 channelRefundNo + success。
   * - wechat：`/v3/refund/domestic/refunds`，`out_refund_no=refundNo` 渠道级幂等；
   *   受理中返回 processing（异步退款常态），由 queryRefund 收敛。
   * - alipay：`alipay.trade.refund`（同步），`out_request_no=refundNo` 幂等。
   * 渠道明确拒绝返回 failed；**绝不把受理中/失败假报为已退款**。
   */
  refund(input: RefundExecuteInput): Promise<RefundExecuteResult>
  /**
   * 退款查证（W-B）：processing 退款单的收敛依据（wechat 按 out_refund_no 查退款单 /
   * alipay `alipay.trade.fastpay.refund.query`）。sandbox 同步完成，不实现。
   */
  queryRefund?(input: { refundNo: string; outTradeNo?: string | null }): Promise<RefundQueryResult>
  /**
   * 退款结果异步通知验签+解密+归一化（wechat 商户平台「退款结果回调通知 URL」）。
   * 与支付回调同一验签/解密口径（验签先于解析、时间窗、serial 命中、AES-256-GCM）；
   * 注意退款通知报文无 appid，归属只校验 mchid。仅 wechat 实现。
   */
  verifyRefundNotify?(ctx: PaymentCallbackContext): Promise<RefundNotifyVerifyResult>
  /**
   * 主动查单兜底（回调丢失/延迟时对渠道账本查询，reconcile 复用与回调完全相同的幂等入账路径）。
   * wechat / alipay 实现；sandbox 无外部账本（DB 即真相源），不实现 —— 不伪造能力。
   */
  queryPayment?(input: { attemptId: string; orderId: string }): Promise<PaymentQueryResult>
  /**
   * 屏上二维码到达本服务 expiresAt 后的安全收敛：先查渠道账本，仍待付才请求关单；
   * 仅返回 closed / failed 才允许业务层释放本地互斥锁，unknown / pending 必须继续锁住。
   * sandbox 返回无资金的 closed；真实渠道实现各自的关单协议。
   */
  closeExpiredQrPayment?(input: { attemptId: string; orderId: string }): Promise<PaymentQueryResult>
  /** 渠道要求的回调成功应答（alipay 要求纯文本 `success`）；未实现时控制器回默认 JSON。 */
  callbackAck?(): CallbackAck
}

/** 规范回调路径（签名 base 绑定与路由注册共用同一构造，避免两处口径漂移）。 */
export function buildPaymentCallbackPath(channel: string): string {
  return `/api/v1/payment/callback/${channel}`
}
