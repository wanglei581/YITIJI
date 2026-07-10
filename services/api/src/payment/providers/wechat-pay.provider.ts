/**
 * 微信支付 Native（APIv3，动态二维码）Provider —— C5-6 真实渠道。
 *
 * 协议要点（对齐微信支付 APIv3 公钥模式）：
 * - 请求签名：SHA256withRSA(商户私钥) over `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`，
 *   Authorization: WECHATPAY2-SHA256-RSA2048。
 * - 回调验签：SHA256withRSA(微信支付公钥) over `${timestamp}\n${nonce}\n${rawBody}\n`，
 *   Wechatpay-Serial 必须命中配置的公钥 ID；时间窗 ±5 分钟；验签先于一切 payload 解析。
 * - 回调报文 resource 为 AES-256-GCM（APIv3 密钥）密文，解密后才是交易对象。
 * - out_trade_no = attemptId（服务端 cuid），attach 回带 orderId —— 维持业务层全字段匹配。
 *
 * 安全边界（CLAUDE.md §12 口径）：
 * - 商户私钥 / APIv3 密钥 / 平台公钥只经服务端 env（内联 PEM 或文件路径）加载；
 *   本文件绝不打印任何密钥材料；Kiosk / Agent / 前端一律不得持有。
 * - 金额一律整数「分」；回调金额与服务端快照的双重比对在业务层完成。
 * - 退款（W-B）：`/v3/refund/domestic/refunds`，`out_refund_no=refundNo` 渠道级幂等；
 *   SUCCESS→success / PROCESSING→processing（经 queryRefund 收敛）/ 其它→failed，
 *   绝不把受理中假报为已退款。
 */
import { createCipheriv, createDecipheriv, createSign, createVerify, randomBytes } from 'crypto'
import type {
  CallbackAck,
  CallbackVerifyResult,
  CodePaymentCreateInput,
  CodePaymentCreateResult,
  PaymentCallbackContext,
  PaymentCallbackEvent,
  PaymentProvider,
  PaymentQueryResult,
  QrPaymentCreateInput,
  QrPaymentCreateResult,
  RefundExecuteInput,
  RefundExecuteResult,
  RefundNotifyVerifyResult,
  RefundQueryResult,
} from '../payment-provider.types'
import { buildPaymentCallbackPath } from '../payment-provider.types'

export const WECHAT_TIMESTAMP_HEADER = 'wechatpay-timestamp'
export const WECHAT_NONCE_HEADER = 'wechatpay-nonce'
export const WECHAT_SIGNATURE_HEADER = 'wechatpay-signature'
export const WECHAT_SERIAL_HEADER = 'wechatpay-serial'

/** 回调时间窗 ±5 分钟（对齐 sandbox / W3 Webhook / Pantum 口径）。 */
const CALLBACK_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000
const APIV3_KEY_LENGTH = 32
const HTTP_TIMEOUT_MS = 10_000

export interface WechatPayProviderConfig {
  mchid: string
  appid: string
  /** 商户 API 证书序列号（请求 Authorization 用）。 */
  mchSerialNo: string
  /** 商户 API 私钥（PKCS8 PEM）。 */
  privateKeyPem: string
  /** APIv3 密钥（32 字节，回调 resource 解密用）。 */
  apiV3Key: string
  /** 微信支付公钥（PEM，回调验签用；公钥模式）。 */
  platformPublicKeyPem: string
  /** 微信支付公钥 ID（回调 Wechatpay-Serial 必须命中）。 */
  platformPublicKeyId: string
  /** 回调可达的公网 base（https），notify_url = base + /api/v1/payment/callback/wechat。 */
  notifyBaseUrl: string
  /** 渠道网关 base；默认官方，verify 脚本可指向本地假网关。 */
  apiBaseUrl: string
  /** 付款码支付线下门店商户编码；未配置时拒绝该方式，不影响屏上二维码支付。 */
  codePayStoreOutId?: string
}

/** 回调验签 base（与微信支付平台侧构造一致；verify 脚本模拟渠道侧时共用，避免口径漂移）。 */
export function buildWechatCallbackVerifyBase(input: {
  timestamp: string
  nonce: string
  rawBody: Buffer | string
}): string {
  const body = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8')
  return `${input.timestamp}\n${input.nonce}\n${body}\n`
}

/**
 * AES-256-GCM 加密交易对象为回调 resource（**仅 verify 脚本模拟渠道侧使用**；
 * 生产回调只做解密）。与 decryptWechatResource 同一口径。
 */
export function encryptWechatCallbackResource(
  plaintext: string,
  apiV3Key: string,
  associatedData = 'transaction',
): { ciphertext: string; nonce: string; associated_data: string } {
  // nonce 用 ASCII 串（与真实回调一致），解密侧按 utf8 还原为同一 iv 字节序列。
  const nonceStr = randomBytes(8).toString('hex') // 16 ASCII chars
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonceStr, 'utf8'))
  cipher.setAAD(Buffer.from(associatedData, 'utf8'))
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString('base64'),
    nonce: nonceStr,
    associated_data: associatedData,
  }
}

function decryptWechatResource(
  resource: { ciphertext: string; nonce: string; associated_data?: string },
  apiV3Key: string,
): string | null {
  try {
    const buf = Buffer.from(resource.ciphertext, 'base64')
    if (buf.length < 16) return null
    const data = buf.subarray(0, buf.length - 16)
    const tag = buf.subarray(buf.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'))
    if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null // 解密失败（密钥不符/报文被改）→ 上层返回明确错误码，绝不半解析
  }
}

function headerValue(headers: PaymentCallbackContext['headers'], name: string): string | null {
  const raw = headers[name]
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' && v.length > 0 ? v : null
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function asPositiveInteger(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

/** 微信 trade_state → 归一化结果。中间态（NOTPAY/USERPAYING/ACCEPT）绝不误判为失败。 */
function mapTradeState(state: string | null): 'success' | 'failed' | 'ignored' {
  if (state === 'SUCCESS') return 'success'
  if (state === 'NOTPAY' || state === 'USERPAYING' || state === 'ACCEPT') return 'ignored'
  return 'failed' // CLOSED / REVOKED / PAYERROR / REFUND 等：本尝试不会再成功
}

export class WechatPayProvider implements PaymentProvider {
  readonly channel = 'wechat' as const
  private readonly cfg: WechatPayProviderConfig

  constructor(cfg: WechatPayProviderConfig) {
    // fail-closed：任何关键材料缺失/明显非法 → 启动即拒绝，绝不带残缺配置跑真实资金通道。
    const missing: string[] = []
    if (!cfg.mchid?.trim()) missing.push('mchid')
    if (!cfg.appid?.trim()) missing.push('appid')
    if (!cfg.mchSerialNo?.trim()) missing.push('mchSerialNo')
    if (!cfg.privateKeyPem?.includes('PRIVATE KEY')) missing.push('privateKeyPem')
    if (!cfg.platformPublicKeyPem?.includes('PUBLIC KEY')) missing.push('platformPublicKeyPem')
    if (!cfg.platformPublicKeyId?.trim()) missing.push('platformPublicKeyId')
    if (!cfg.notifyBaseUrl?.trim()) missing.push('notifyBaseUrl')
    if (!cfg.apiBaseUrl?.trim()) missing.push('apiBaseUrl')
    // 按字节长校验（AES-256 要求 32 字节密钥；JS 字符长度对非 ASCII 会失真）
    if (Buffer.byteLength(cfg.apiV3Key ?? '', 'utf8') !== APIV3_KEY_LENGTH) {
      missing.push(`apiV3Key(须 ${APIV3_KEY_LENGTH} 字节)`)
    }
    if (missing.length > 0) {
      throw new Error(`WECHAT_PAY_CONFIG_INVALID: 缺失/非法配置项 ${missing.join(', ')}（密钥只存服务端 env，见 .env.example）`)
    }
    this.cfg = cfg
  }

  /** APIv3 请求签名（Authorization header）。 */
  private buildAuthorization(method: string, pathWithQuery: string, body: string): string {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = randomBytes(16).toString('hex')
    const signBase = `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`
    const signature = createSign('RSA-SHA256').update(signBase).sign(this.cfg.privateKeyPem, 'base64')
    return (
      `WECHATPAY2-SHA256-RSA2048 mchid="${this.cfg.mchid}",` +
      `nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${this.cfg.mchSerialNo}"`
    )
  }

  private async request(method: 'GET' | 'POST', pathWithQuery: string, bodyObj?: unknown): Promise<Record<string, unknown>> {
    const body = bodyObj ? JSON.stringify(bodyObj) : ''
    const res = await fetch(`${this.cfg.apiBaseUrl}${pathWithQuery}`, {
      method,
      headers: {
        Authorization: this.buildAuthorization(method, pathWithQuery, body),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'ai-job-print-terminal/payment',
      },
      ...(bodyObj ? { body } : {}),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    const text = await res.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      /* 非 JSON 响应按空对象处理，由状态码分支报错 */
    }
    if (!res.ok) {
      // 渠道错误码可记录（无敏感材料）；绝不把商户配置回显进错误信息。
      // 始终携带 HTTP 状态：退款域按「明确拒绝 vs 结果不可知」分类依赖 5xx 标记
      //（如 500+SYSTEM_ERROR = 渠道要求同参数重试，绝不能按明确失败回滚）。
      const code = asString(parsed['code'])
      throw new Error(`WECHAT_PAY_CHANNEL_ERROR: HTTP_${res.status}${code ? ` ${code}` : ''}`)
    }
    return parsed
  }

  async createQrPayment(input: QrPaymentCreateInput): Promise<QrPaymentCreateResult> {
    const notifyUrl = `${this.cfg.notifyBaseUrl.replace(/\/$/, '')}${buildPaymentCallbackPath(this.channel)}`
    const resp = await this.request('POST', '/v3/pay/transactions/native', {
      appid: this.cfg.appid,
      mchid: this.cfg.mchid,
      description: `打印服务订单 ${input.orderNo}`,
      out_trade_no: input.attemptId, // 服务端 cuid，回调经 out_trade_no 找回 attempt
      notify_url: notifyUrl,
      // attach 回调原样回带 —— 业务层全字段匹配 orderId 的通道侧来源
      attach: JSON.stringify({ orderId: input.orderId }),
      amount: { total: input.amountCents, currency: 'CNY' },
    })
    const codeUrl = asString(resp['code_url'])
    if (!codeUrl) throw new Error('WECHAT_PAY_CHANNEL_ERROR: CODE_URL_MISSING')
    // Native 无独立 prepay_id：prepayId 统一取 out_trade_no（= attemptId），回调回带同值。
    return { prepayId: input.attemptId, qrCodeContent: codeUrl }
  }

  async createCodePayment(input: CodePaymentCreateInput): Promise<CodePaymentCreateResult> {
    if (!/^\d{18}$/.test(input.authCode)) {
      return { status: 'failed', channelTxnNo: null, prepayId: null, amountCents: null, failReason: '付款码格式无效' }
    }
    const storeOutId = this.cfg.codePayStoreOutId?.trim()
    if (!storeOutId || !/^[A-Za-z0-9]{1,64}$/.test(storeOutId)) {
      return { status: 'failed', channelTxnNo: null, prepayId: null, amountCents: null, failReason: '付款码支付未配置，请联系工作人员' }
    }

    let resp: Record<string, unknown>
    try {
      resp = await this.request('POST', '/v3/pay/transactions/codepay', {
        appid: this.cfg.appid,
        mchid: this.cfg.mchid,
        description: `打印服务订单 ${input.orderNo}`,
        out_trade_no: input.attemptId,
        attach: JSON.stringify({ orderId: input.orderId }),
        payer: { auth_code: input.authCode },
        amount: { total: input.amountCents, currency: 'CNY' },
        scene_info: {
          ...(input.terminalId ? { device_id: input.terminalId.slice(0, 32) } : {}),
          store_info: { out_id: storeOutId },
        },
      })
    } catch (e) {
      const msg = (e as Error).message ?? ''
      if (msg.includes('USERPAYING')) {
        // 用户可能已经看到密码确认页；这是未决状态，不是拒绝，不能让订单回 unpaid 后再次扣款。
        return { status: 'paying', channelTxnNo: null, prepayId: input.attemptId, amountCents: null, failReason: '请在手机上完成支付验证' }
      }
      if (msg.includes('AUTHCODE') || msg.includes('AUTH_CODE')) {
        return { status: 'failed', channelTxnNo: null, prepayId: null, amountCents: null, failReason: '付款码无效或已过期' }
      }
      if (msg.includes('NOTENOUGH') || msg.includes('BALANCE')) {
        return { status: 'failed', channelTxnNo: null, prepayId: null, amountCents: null, failReason: '余额不足，请换卡或重试' }
      }
      // 5xx、超时或网络中断的结果不可知：渠道可能已经受理，必须保留 pending 交给查单收敛，不能回退 unpaid 允许再次扣款。
      const status = Number(msg.match(/HTTP_(\d{3})/)?.[1] ?? 0)
      if (status === 0 || status >= 500) {
        return { status: 'paying', channelTxnNo: null, prepayId: input.attemptId, amountCents: null, failReason: '支付结果待核实，请稍候' }
      }
      return { status: 'failed', channelTxnNo: null, prepayId: null, amountCents: null, failReason: '支付未完成，请重试' }
    }

    const state = asString(resp['trade_state'])
    const txnNo = asString(resp['transaction_id'])
    const amountCents = asPositiveInteger((resp['amount'] as Record<string, unknown> | undefined)?.['total'])
    if (state === 'SUCCESS') {
      if (!txnNo || amountCents === null) {
        // 渠道已表明 SUCCESS，但关键字段缺失时绝不回退为失败/未支付；保留 pending 交给查单收敛。
        return { status: 'paying', channelTxnNo: null, prepayId: input.attemptId, amountCents: null, failReason: '支付结果待核实，请联系工作人员' }
      }
      return { status: 'success', channelTxnNo: txnNo, prepayId: input.attemptId, amountCents, failReason: null }
    }
    if (state === 'USERPAYING' || state === 'NOTPAY' || state === 'ACCEPT') {
      return { status: 'paying', channelTxnNo: null, prepayId: input.attemptId, amountCents: null, failReason: null }
    }
    return { status: 'failed', channelTxnNo: null, prepayId: input.attemptId, amountCents: null, failReason: '支付未完成，请重试' }
  }

  /**
   * APIv3 通知公共段：header 校验 → 时间窗 → serial 命中 → 验签（先于一切解析）→
   * 外层 JSON → resource AES-256-GCM 解密。支付回调与退款结果通知共用（口径一致，防漂移）。
   */
  private verifyAndDecryptNotify(
    ctx: PaymentCallbackContext,
  ): { ok: true; payload: Record<string, unknown>; nonce: string; timestampMs: number } | { ok: false; code: string } {
    const timestamp = headerValue(ctx.headers, WECHAT_TIMESTAMP_HEADER)
    const nonce = headerValue(ctx.headers, WECHAT_NONCE_HEADER)
    const signature = headerValue(ctx.headers, WECHAT_SIGNATURE_HEADER)
    const serial = headerValue(ctx.headers, WECHAT_SERIAL_HEADER)
    if (!timestamp || !nonce || !signature || !serial) return { ok: false, code: 'CALLBACK_HEADER_MISSING' }

    if (!/^\d{10}$/.test(timestamp)) return { ok: false, code: 'CALLBACK_TIMESTAMP_INVALID' }
    const timestampMs = Number(timestamp) * 1000
    if (Math.abs(Date.now() - timestampMs) > CALLBACK_TIMESTAMP_WINDOW_MS) {
      return { ok: false, code: 'CALLBACK_TIMESTAMP_EXPIRED' }
    }
    if (nonce.length < 8 || nonce.length > 128) return { ok: false, code: 'CALLBACK_NONCE_INVALID' }
    // 公钥模式：回调声明的验签材料必须命中配置的微信支付公钥 ID（平台证书轮换模式暂不支持，配置期明确）。
    if (serial !== this.cfg.platformPublicKeyId) return { ok: false, code: 'CALLBACK_SERIAL_MISMATCH' }

    // 验签先于一切 payload 解析。
    const verifyBase = buildWechatCallbackVerifyBase({ timestamp, nonce, rawBody: ctx.rawBody })
    let verified = false
    try {
      verified = createVerify('RSA-SHA256').update(verifyBase).verify(this.cfg.platformPublicKeyPem, signature, 'base64')
    } catch {
      verified = false
    }
    if (!verified) return { ok: false, code: 'CALLBACK_SIGNATURE_INVALID' }

    let outer: Record<string, unknown>
    try {
      outer = JSON.parse(ctx.rawBody.toString('utf8')) as Record<string, unknown>
    } catch {
      return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }
    }
    const resource = outer['resource'] as { ciphertext?: string; nonce?: string; associated_data?: string } | undefined
    if (!resource?.ciphertext || !resource.nonce) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }

    const decrypted = decryptWechatResource(
      { ciphertext: resource.ciphertext, nonce: resource.nonce, associated_data: resource.associated_data },
      this.cfg.apiV3Key,
    )
    if (!decrypted) return { ok: false, code: 'CALLBACK_RESOURCE_DECRYPT_FAILED' }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(decrypted) as Record<string, unknown>
    } catch {
      return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }
    }
    return { ok: true, payload, nonce, timestampMs }
  }

  async verifyAndParseCallback(ctx: PaymentCallbackContext): Promise<CallbackVerifyResult> {
    const base = this.verifyAndDecryptNotify(ctx)
    if (!base.ok) return base
    const { payload: txn, nonce, timestampMs } = base

    // 交易归属校验：解密报文中的商户/应用必须是本商户（防跨商户报文错投）。
    if (asString(txn['mchid']) !== this.cfg.mchid || asString(txn['appid']) !== this.cfg.appid) {
      return { ok: false, code: 'CALLBACK_MERCHANT_MISMATCH' }
    }

    const outTradeNo = asString(txn['out_trade_no'])
    if (!outTradeNo) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }

    const amount = txn['amount'] as { total?: unknown } | undefined
    const total = amount?.total
    if (typeof total !== 'number' || !Number.isInteger(total) || total <= 0) {
      return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }
    }

    // attach 回带 orderId（出码时写入）；缺失/损坏 → 拒绝，绝不放宽全字段匹配。
    let orderId: string | null = null
    try {
      const attach = JSON.parse(asString(txn['attach']) ?? '') as { orderId?: unknown }
      orderId = asString(attach.orderId)
    } catch {
      orderId = null
    }
    if (!orderId) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }

    const result = mapTradeState(asString(txn['trade_state']))
    const channelTxnNo = asString(txn['transaction_id'])
    if (result === 'success' && !channelTxnNo) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }

    const event: PaymentCallbackEvent = {
      channel: this.channel,
      attemptId: outTradeNo,
      prepayId: outTradeNo, // 与出码时 prepayId=out_trade_no 对应
      orderId,
      amountCents: total,
      result,
      channelTxnNo,
      failReasonRaw: result === 'failed' ? (asString(txn['trade_state_desc']) ?? asString(txn['trade_state'])) : null,
      nonce,
      timestampMs,
    }
    return { ok: true, event }
  }

  /** 主动查单兜底（回调丢失时）：GET /v3/pay/transactions/out-trade-no/{out_trade_no}。 */
  async queryPayment(input: { attemptId: string; orderId: string }): Promise<PaymentQueryResult> {
    let resp: Record<string, unknown>
    try {
      resp = await this.request(
        'GET',
        `/v3/pay/transactions/out-trade-no/${encodeURIComponent(input.attemptId)}?mchid=${encodeURIComponent(this.cfg.mchid)}`,
      )
    } catch (e) {
      if ((e as Error).message?.includes('ORDER_NOT_EXIST') || (e as Error).message?.includes('HTTP_404')) {
        return { status: 'unknown', channelTxnNo: null, amountCents: null }
      }
      throw e
    }
    const state = asString(resp['trade_state'])
    const amount = resp['amount'] as { total?: unknown } | undefined
    const total = typeof amount?.total === 'number' && Number.isInteger(amount.total) ? amount.total : null
    const txnNo = asString(resp['transaction_id'])
    if (state === 'SUCCESS') {
      // paid 必须齐备流水号 + 金额，否则按不可判处理（reconcile 拒绝入账，绝不凑合）。
      if (!txnNo || total === null) return { status: 'unknown', channelTxnNo: null, amountCents: null }
      return { status: 'paid', channelTxnNo: txnNo, amountCents: total }
    }
    if (state === 'NOTPAY' || state === 'USERPAYING' || state === 'ACCEPT') {
      return { status: 'pending', channelTxnNo: null, amountCents: null }
    }
    if (state === 'CLOSED' || state === 'REVOKED') return { status: 'closed', channelTxnNo: null, amountCents: null }
    if (state === 'PAYERROR') return { status: 'failed', channelTxnNo: null, amountCents: null }
    return { status: 'unknown', channelTxnNo: null, amountCents: null }
  }

  /** wechat 退款状态 → 归一化（受理中绝不假报成功）。 */
  private static mapRefundStatus(status: string | null): 'success' | 'failed' | 'processing' {
    if (status === 'SUCCESS') return 'success'
    if (status === 'PROCESSING') return 'processing'
    return 'failed' // ABNORMAL / CLOSED / 未知：按失败处理（由业务层回滚可重试）
  }

  /**
   * 真实退款（W-B）：POST /v3/refund/domestic/refunds。
   * `out_refund_no = refundNo`（渠道级幂等：同号重复请求不会重复出款）；
   * amount.refund = 本次退款额、amount.total = 订单原始应付（均整数分，来自服务端落库数据）。
   */
  async refund(input: RefundExecuteInput): Promise<RefundExecuteResult> {
    if (!input.outTradeNo || input.orderAmountCents === undefined) {
      // fail-closed：缺原单定位/原始金额绝不盲发退款请求（业务层应传成功尝试的 attemptId）。
      throw new Error('WECHAT_REFUND_INPUT_MISSING: 缺少 outTradeNo / orderAmountCents，拒绝发起渠道退款')
    }
    const resp = await this.request('POST', '/v3/refund/domestic/refunds', {
      out_trade_no: input.outTradeNo,
      out_refund_no: input.refundNo,
      amount: { refund: input.amountCents, total: input.orderAmountCents, currency: 'CNY' },
    })
    return {
      channelRefundNo: asString(resp['refund_id']),
      status: WechatPayProvider.mapRefundStatus(asString(resp['status'])),
    }
  }

  /** 退款查证（W-B）：GET /v3/refund/domestic/refunds/{out_refund_no}，processing 收敛依据。 */
  async queryRefund(input: { refundNo: string; outTradeNo?: string | null }): Promise<RefundQueryResult> {
    let resp: Record<string, unknown>
    try {
      resp = await this.request('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(input.refundNo)}`)
    } catch (e) {
      if ((e as Error).message?.includes('RESOURCE_NOT_EXISTS') || (e as Error).message?.includes('HTTP_404')) {
        return { status: 'unknown', channelRefundNo: null }
      }
      throw e
    }
    const status = WechatPayProvider.mapRefundStatus(asString(resp['status']))
    // 查证接口的未知状态按 unknown 处理（不回滚不完成，等下次查证），仅明确 ABNORMAL/CLOSED 判失败。
    const raw = asString(resp['status'])
    if (status === 'failed' && raw !== 'ABNORMAL' && raw !== 'CLOSED') {
      return { status: 'unknown', channelRefundNo: asString(resp['refund_id']) }
    }
    return { status, channelRefundNo: asString(resp['refund_id']) }
  }

  /**
   * 退款结果异步通知（商户平台「退款结果回调通知 URL」）验签+解密+归一化。
   * 与支付回调共用 verifyAndDecryptNotify（同一验签/时间窗/serial/解密口径）；
   * 报文差异：解密后为退款对象（out_refund_no/refund_id/refund_status/amount.refund），
   * **无 appid 字段**，归属只校验 mchid；SUCCESS→success，CLOSED/ABNORMAL→failed，
   * 其它/未知 refund_status 一律拒绝（绝不猜测入账）。
   */
  async verifyRefundNotify(ctx: PaymentCallbackContext): Promise<RefundNotifyVerifyResult> {
    const base = this.verifyAndDecryptNotify(ctx)
    if (!base.ok) return base
    const { payload: refund, nonce, timestampMs } = base

    if (asString(refund['mchid']) !== this.cfg.mchid) return { ok: false, code: 'CALLBACK_MERCHANT_MISMATCH' }

    const refundNo = asString(refund['out_refund_no'])
    const outTradeNo = asString(refund['out_trade_no'])
    if (!refundNo || !outTradeNo) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }

    const rawStatus = asString(refund['refund_status'])
    let status: 'success' | 'failed'
    if (rawStatus === 'SUCCESS') status = 'success'
    else if (rawStatus === 'CLOSED' || rawStatus === 'ABNORMAL') status = 'failed'
    else return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' } // 未知状态：拒绝，绝不猜测

    const amount = refund['amount'] as { refund?: unknown } | undefined
    const refundAmountCents =
      typeof amount?.refund === 'number' && Number.isInteger(amount.refund) && amount.refund >= 0 ? amount.refund : null
    // SUCCESS 必须齐备退款金额（业务层比对依据），缺失拒绝。
    if (status === 'success' && refundAmountCents === null) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }

    return {
      ok: true,
      event: {
        channel: this.channel,
        refundNo,
        outTradeNo,
        channelRefundNo: asString(refund['refund_id']),
        status,
        refundAmountCents,
        nonce,
        timestampMs,
      },
    }
  }

  callbackAck(): CallbackAck {
    return { contentType: 'application/json', body: JSON.stringify({ code: 'SUCCESS', message: '成功' }) }
  }
}
