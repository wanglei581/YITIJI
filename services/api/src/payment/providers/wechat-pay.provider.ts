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
 * - 退款属 C5-6 明确排除范围：refund() 抛明确错误码 fail-closed，绝不假装退款成功。
 */
import { createCipheriv, createDecipheriv, createSign, createVerify, randomBytes } from 'crypto'
import type {
  CallbackAck,
  CallbackVerifyResult,
  PaymentCallbackContext,
  PaymentCallbackEvent,
  PaymentProvider,
  PaymentQueryResult,
  QrPaymentCreateInput,
  QrPaymentCreateResult,
  RefundExecuteInput,
  RefundExecuteResult,
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
    if ((cfg.apiV3Key ?? '').length !== APIV3_KEY_LENGTH) missing.push(`apiV3Key(须 ${APIV3_KEY_LENGTH} 字节)`)
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
      const code = asString(parsed['code']) ?? `HTTP_${res.status}`
      throw new Error(`WECHAT_PAY_CHANNEL_ERROR: ${code}`)
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

  async verifyAndParseCallback(ctx: PaymentCallbackContext): Promise<CallbackVerifyResult> {
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

    let txn: Record<string, unknown>
    try {
      txn = JSON.parse(decrypted) as Record<string, unknown>
    } catch {
      return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }
    }

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

  /** C5-6 明确不碰退款：真实渠道退款留待后续退款批次，绝不假装成功。 */
  async refund(_input: RefundExecuteInput): Promise<RefundExecuteResult> {
    throw new Error('REFUND_CHANNEL_NOT_IMPLEMENTED: wechat 真实渠道退款不在 C5-6 范围（不碰退款/C5-4），留待后续批次')
  }

  callbackAck(): CallbackAck {
    return { contentType: 'application/json', body: JSON.stringify({ code: 'SUCCESS', message: '成功' }) }
  }
}
