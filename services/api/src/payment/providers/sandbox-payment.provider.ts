/**
 * 沙箱支付 Provider（C5-2）。
 *
 * 诚实边界：这是**测试通道**——假 scheme 动态码、无外部资金流、无商户凭证；
 * 生产环境由 production-runtime-gates + 工厂双重禁用。UI 侧（C5-3）必须明示「测试支付通道」。
 *
 * 回调签名（对齐 CLAUDE.md §12 的验签/时间窗/防重放要求，签名 base 绑定 method+path+channel）：
 *   signBase  = `${method}\n${path}\n${timestamp}\n${nonce}\n${rawBody}`
 *   signature = HMAC-SHA256(signBase, SANDBOX_PAYMENT_SECRET) 的 hex 小写
 * path 为 buildPaymentCallbackPath(channel) 规范路径 —— 同一签名不能跨回调路径/渠道复用。
 * 密钥只存服务端 env；前端 / Kiosk / Agent 一律不得持有。
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type {
  CallbackVerifyResult,
  PaymentCallbackContext,
  PaymentCallbackEvent,
  PaymentProvider,
  QrPaymentCreateInput,
  QrPaymentCreateResult,
  RefundExecuteInput,
  RefundExecuteResult,
} from '../payment-provider.types'

export const SANDBOX_TIMESTAMP_HEADER = 'x-pay-timestamp'
export const SANDBOX_NONCE_HEADER = 'x-pay-nonce'
export const SANDBOX_SIGNATURE_HEADER = 'x-pay-signature'

/** 回调时间窗 ±5 分钟（对齐 W3 Webhook / Pantum 口径）。 */
const CALLBACK_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000
const MIN_SECRET_LENGTH = 16

/** 签名 base：绑定 method + 规范回调路径 + 时间戳 + nonce + 原始报文。 */
export function buildSandboxCallbackSignBase(input: {
  method: string
  path: string
  timestamp: string
  nonce: string
  rawBody: Buffer | string
}): string {
  const body = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8')
  return [input.method.toUpperCase(), input.path, input.timestamp, input.nonce, body].join('\n')
}

export function signSandboxCallback(
  input: { method: string; path: string; timestamp: string; nonce: string; rawBody: Buffer | string },
  secret: string,
): string {
  return createHmac('sha256', secret).update(buildSandboxCallbackSignBase(input)).digest('hex')
}

function headerValue(headers: PaymentCallbackContext['headers'], name: string): string | null {
  const raw = headers[name]
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' && v.length > 0 ? v : null
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export class SandboxPaymentProvider implements PaymentProvider {
  readonly channel = 'sandbox' as const
  private readonly secret: string

  constructor(secret: string) {
    // fail-closed：PAYMENT_PROVIDER=sandbox 时密钥缺失/过短 → 启动即拒绝，绝不带空密钥跑验签。
    if (!secret || secret.trim().length < MIN_SECRET_LENGTH) {
      throw new Error(
        `SANDBOX_PAYMENT_SECRET_INVALID: PAYMENT_PROVIDER=sandbox 时 SANDBOX_PAYMENT_SECRET 必须存在且长度 >= ${MIN_SECRET_LENGTH} 字符（只存服务端 env）`,
      )
    }
    this.secret = secret
  }

  async createQrPayment(input: QrPaymentCreateInput): Promise<QrPaymentCreateResult> {
    const prepayId = `sbx_${randomBytes(12).toString('hex')}`
    // 假 scheme：自描述、明示测试通道、不指向任何真实收款地址。
    const qrCodeContent =
      `sandboxpay://qr?attempt=${encodeURIComponent(input.attemptId)}` +
      `&prepay=${encodeURIComponent(prepayId)}` +
      `&order=${encodeURIComponent(input.orderNo)}` +
      `&amount=${input.amountCents}`
    return { prepayId, qrCodeContent }
  }

  /**
   * 沙箱退款（C5-4）：假通道，不动外部资金，返回服务端生成的假 channelRefundNo + success。
   * 幂等由业务层（RefundService）按 refundNo 保证；本方法无副作用、可安全重试。
   * 生产运行时门禁 + 工厂已禁用 sandbox，故本方法不可能在生产触达真实资金。
   */
  async refund(input: RefundExecuteInput): Promise<RefundExecuteResult> {
    // 假流水号自描述、明示沙箱，不指向任何真实退款账本；绑定 refundNo 便于对照。
    const channelRefundNo = `sbx_refund_${input.refundNo}_${randomBytes(6).toString('hex')}`
    return { channelRefundNo, status: 'success' }
  }

  async verifyAndParseCallback(ctx: PaymentCallbackContext): Promise<CallbackVerifyResult> {
    const timestamp = headerValue(ctx.headers, SANDBOX_TIMESTAMP_HEADER)
    const nonce = headerValue(ctx.headers, SANDBOX_NONCE_HEADER)
    const signature = headerValue(ctx.headers, SANDBOX_SIGNATURE_HEADER)
    if (!timestamp || !nonce || !signature) return { ok: false, code: 'CALLBACK_HEADER_MISSING' }

    if (!/^\d{10,17}$/.test(timestamp)) return { ok: false, code: 'CALLBACK_TIMESTAMP_INVALID' }
    const timestampMs = Number(timestamp)
    if (Math.abs(Date.now() - timestampMs) > CALLBACK_TIMESTAMP_WINDOW_MS) {
      return { ok: false, code: 'CALLBACK_TIMESTAMP_EXPIRED' }
    }
    if (nonce.length < 8 || nonce.length > 128) return { ok: false, code: 'CALLBACK_NONCE_INVALID' }

    // 验签先于一切 payload 解析；签名 base 绑定 POST + 规范回调路径，跨路径/跨渠道复用同一签名必失败。
    const expected = signSandboxCallback(
      { method: 'POST', path: ctx.path, timestamp, nonce, rawBody: ctx.rawBody },
      this.secret,
    )
    if (!timingSafeHexEqual(expected, signature)) return { ok: false, code: 'CALLBACK_SIGNATURE_INVALID' }

    let parsed: unknown
    try {
      parsed = JSON.parse(ctx.rawBody.toString('utf8'))
    } catch {
      return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }
    }
    const p = parsed as Record<string, unknown>
    const str = (k: string): string | null => (typeof p[k] === 'string' && (p[k] as string).length > 0 ? (p[k] as string) : null)

    const channel = str('channel')
    const attemptId = str('attemptId')
    const prepayId = str('prepayId')
    const orderId = str('orderId')
    const result = str('result')
    const amountCents = p['amountCents']
    if (!channel || !attemptId || !prepayId || !orderId) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }
    if (channel !== this.channel || channel !== ctx.channel) return { ok: false, code: 'CALLBACK_CHANNEL_MISMATCH' }
    if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
      return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }
    }
    if (result !== 'success' && result !== 'failed') return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }
    const channelTxnNo = str('channelTxnNo')
    if (result === 'success' && !channelTxnNo) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }

    const event: PaymentCallbackEvent = {
      channel,
      attemptId,
      prepayId,
      orderId,
      amountCents,
      result,
      channelTxnNo,
      failReasonRaw: str('failReason'),
      nonce,
      timestampMs,
    }
    return { ok: true, event }
  }

  /**
   * 构造一条签名合法的模拟回调（仅供沙箱模拟端点与 verify 脚本使用）。
   * 走与真实回调完全相同的验签/解析/入账路径 —— 不给模拟支付开任何旁门。
   */
  buildSimulatedCallback(input: {
    path: string
    attemptId: string
    prepayId: string
    orderId: string
    amountCents: number
    result: 'success' | 'failed'
    channelTxnNo?: string
    failReason?: string
  }): { rawBody: Buffer; headers: Record<string, string> } {
    const payload: Record<string, unknown> = {
      channel: this.channel,
      attemptId: input.attemptId,
      prepayId: input.prepayId,
      orderId: input.orderId,
      amountCents: input.amountCents,
      result: input.result,
    }
    if (input.result === 'success') {
      payload['channelTxnNo'] = input.channelTxnNo ?? `sbx_txn_${randomBytes(8).toString('hex')}`
    }
    if (input.failReason) payload['failReason'] = input.failReason
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8')
    const timestamp = String(Date.now())
    const nonce = randomBytes(16).toString('hex')
    const signature = signSandboxCallback({ method: 'POST', path: input.path, timestamp, nonce, rawBody }, this.secret)
    return {
      rawBody,
      headers: {
        [SANDBOX_TIMESTAMP_HEADER]: timestamp,
        [SANDBOX_NONCE_HEADER]: nonce,
        [SANDBOX_SIGNATURE_HEADER]: signature,
        'content-type': 'application/json',
      },
    }
  }
}
