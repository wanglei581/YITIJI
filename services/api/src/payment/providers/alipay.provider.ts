/**
 * 支付宝当面付（precreate 动态二维码）Provider —— C5-6 真实渠道。
 *
 * 协议要点（对齐支付宝开放平台 RSA2 口径）：
 * - 请求签名：SHA256withRSA(应用私钥) over「除 sign 外全部参数按 ASCII 升序 k=v& 拼接」；
 *   网关传输用 form-urlencoded，签名基于**未编码**原值。
 * - 同步响应验签：SHA256withRSA(支付宝公钥) over 响应 JSON 中业务节点的**原始子串**，
 *   验签失败按渠道错误 fail-closed，绝不采信未验签响应。
 * - 异步 notify 验签：form 参数去掉 sign / sign_type 后按 ASCII 升序 k=v& 拼接，
 *   RSA2 验签；notify_id 作防重放 nonce；notify_time（GMT+8）作时间窗依据（±5 分钟）。
 * - out_trade_no = attemptId；passback_params 回带 orderId —— 维持业务层全字段匹配。
 * - trade_status：TRADE_SUCCESS / TRADE_FINISHED → success；TRADE_CLOSED → failed；
 *   WAIT_BUYER_PAY → ignored（中间态只 ack 不改状态，绝不误判为失败）。
 *
 * 安全边界（CLAUDE.md §12 口径）：
 * - 应用私钥 / 支付宝公钥只经服务端 env（内联 PEM 或文件路径）加载，绝不打印；前端不得持有。
 * - 金额一律整数「分」：total_amount 元串 ↔ 分整数换算用字符串拆解，绝不浮点。
 * - 退款属 C5-6 明确排除范围：refund() 抛明确错误码 fail-closed，绝不假装退款成功。
 */
import { createSign, createVerify } from 'crypto'
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
  RefundQueryResult,
} from '../payment-provider.types'
import { buildPaymentCallbackPath } from '../payment-provider.types'

/** 回调时间窗 ±5 分钟（对齐 sandbox / wechat 口径）。 */
const CALLBACK_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000
const HTTP_TIMEOUT_MS = 10_000

export interface AlipayProviderConfig {
  appId: string
  /** 应用私钥（PKCS8 PEM，RSA2 请求签名）。 */
  appPrivateKeyPem: string
  /** 支付宝公钥（PEM，响应/notify 验签）。 */
  alipayPublicKeyPem: string
  /** 回调可达的公网 base（https），notify_url = base + /api/v1/payment/callback/alipay。 */
  notifyBaseUrl: string
  /** 网关地址；默认官方 https://openapi.alipay.com/gateway.do，verify 脚本可指向本地假网关。 */
  gatewayUrl: string
}

/** 支付宝签名 base：除 sign(/sign_type，notify 场景) 外按 ASCII 升序 k=v& 拼接（原值，不做 URL 编码）。 */
export function buildAlipaySignBase(params: Record<string, string>, exclude: readonly string[]): string {
  return Object.keys(params)
    .filter((k) => !exclude.includes(k) && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
}

export function signAlipayParams(params: Record<string, string>, appPrivateKeyPem: string): string {
  return createSign('RSA-SHA256').update(buildAlipaySignBase(params, ['sign']), 'utf8').sign(appPrivateKeyPem, 'base64')
}

/** notify 验签（verify 脚本模拟渠道侧时共用同一 base 构造，避免口径漂移）。 */
export function verifyAlipayNotifySign(params: Record<string, string>, alipayPublicKeyPem: string): boolean {
  const sign = params['sign']
  if (!sign) return false
  const base = buildAlipaySignBase(params, ['sign', 'sign_type'])
  try {
    return createVerify('RSA-SHA256').update(base, 'utf8').verify(alipayPublicKeyPem, sign, 'base64')
  } catch {
    return false
  }
}

/** GMT+8 'yyyy-MM-dd HH:mm:ss'（支付宝公共参数 timestamp 要求北京时间）。 */
export function alipayTimestamp(date = new Date()): string {
  const cn = new Date(date.getTime() + 8 * 3600 * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${cn.getUTCFullYear()}-${p(cn.getUTCMonth() + 1)}-${p(cn.getUTCDate())} ${p(cn.getUTCHours())}:${p(cn.getUTCMinutes())}:${p(cn.getUTCSeconds())}`
}

/** 解析 GMT+8 'yyyy-MM-dd HH:mm:ss' → 毫秒时间戳；非法返回 null。 */
function parseAlipayTime(v: string | null): number | null {
  if (!v || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) return null
  const ms = Date.parse(`${v.replace(' ', 'T')}+08:00`)
  return Number.isFinite(ms) ? ms : null
}

/** 元串 → 分整数（字符串拆解，绝不浮点）；非法/超 2 位小数返回 null。 */
export function yuanToCents(v: string | null): number | null {
  if (!v || !/^\d+(\.\d{1,2})?$/.test(v)) return null
  const [whole, frac = ''] = v.split('.')
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0') || '0')
  return Number.isSafeInteger(cents) ? cents : null
}

/** 分整数 → 元串（当面付 total_amount 要求元，最多 2 位小数）。 */
export function centsToYuan(cents: number): string {
  const whole = Math.floor(cents / 100)
  const frac = cents % 100
  return `${whole}.${String(frac).padStart(2, '0')}`
}

/**
 * 从响应原文提取业务节点的**原始子串**（响应验签必须基于原文，重新 stringify 会破坏签名）。
 * 依据支付宝响应格式：`"<key>":{...}` 平衡花括号截取。
 */
export function extractAlipayResponseNodeRaw(text: string, key: string): string | null {
  const marker = `"${key}":`
  const start = text.indexOf(marker)
  if (start < 0) return null
  let i = start + marker.length
  while (i < text.length && text[i] !== '{') i += 1
  if (i >= text.length) return null
  let depth = 0
  let inString = false
  for (let j = i; j < text.length; j += 1) {
    const ch = text[j]
    if (inString) {
      if (ch === '\\') j += 1
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(i, j + 1)
    }
  }
  return null
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function mapTradeStatus(status: string | null): 'success' | 'failed' | 'ignored' {
  if (status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED') return 'success'
  if (status === 'WAIT_BUYER_PAY') return 'ignored'
  return 'failed' // TRADE_CLOSED 等：本尝试不会再支付成功
}

export class AlipayProvider implements PaymentProvider {
  readonly channel = 'alipay' as const
  private readonly cfg: AlipayProviderConfig

  constructor(cfg: AlipayProviderConfig) {
    // fail-closed：关键材料缺失 → 启动即拒绝，绝不带残缺配置跑真实资金通道。
    const missing: string[] = []
    if (!cfg.appId?.trim()) missing.push('appId')
    if (!cfg.appPrivateKeyPem?.includes('PRIVATE KEY')) missing.push('appPrivateKeyPem')
    if (!cfg.alipayPublicKeyPem?.includes('PUBLIC KEY')) missing.push('alipayPublicKeyPem')
    if (!cfg.notifyBaseUrl?.trim()) missing.push('notifyBaseUrl')
    if (!cfg.gatewayUrl?.trim()) missing.push('gatewayUrl')
    if (missing.length > 0) {
      throw new Error(`ALIPAY_CONFIG_INVALID: 缺失/非法配置项 ${missing.join(', ')}（密钥只存服务端 env，见 .env.example）`)
    }
    this.cfg = cfg
  }

  /** 调网关：公共参数 + biz_content 签名后 form-urlencoded POST；响应业务节点验签通过才返回。 */
  private async call(method: string, bizContent: Record<string, unknown>, opts?: { notifyUrl?: string }): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {
      app_id: this.cfg.appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: alipayTimestamp(),
      version: '1.0',
      biz_content: JSON.stringify(bizContent),
      ...(opts?.notifyUrl ? { notify_url: opts.notifyUrl } : {}),
    }
    params['sign'] = signAlipayParams(params, this.cfg.appPrivateKeyPem)

    const body = new URLSearchParams(params).toString()
    const res = await fetch(this.cfg.gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`ALIPAY_CHANNEL_ERROR: HTTP_${res.status}`)

    const responseKey = `${method.replace(/\./g, '_')}_response`
    let outer: Record<string, unknown>
    try {
      outer = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error('ALIPAY_CHANNEL_ERROR: RESPONSE_NOT_JSON')
    }

    // 响应验签（基于原文子串）；未带签名或验签失败一律 fail-closed。
    const sign = asString(outer['sign'])
    const rawNode = extractAlipayResponseNodeRaw(text, responseKey)
    let verified = false
    if (sign && rawNode) {
      try {
        verified = createVerify('RSA-SHA256').update(rawNode, 'utf8').verify(this.cfg.alipayPublicKeyPem, sign, 'base64')
      } catch {
        verified = false
      }
    }
    if (!verified) throw new Error('ALIPAY_CHANNEL_ERROR: RESPONSE_SIGN_INVALID')

    // 业务节点必须从「验签通过的原文子串」解析 —— 与验签视图字节级同源；
    // 绝不使用 outer[responseKey]（响应含重复 key 时 JSON.parse 取后者，会造成
    // 验签视图与解析视图分离，C5-6 双模型审查 High 修复）。
    let node: Record<string, unknown>
    try {
      node = JSON.parse(rawNode as string) as Record<string, unknown>
    } catch {
      throw new Error('ALIPAY_CHANNEL_ERROR: RESPONSE_NODE_MISSING')
    }

    const code = asString(node['code'])
    if (code !== '10000') {
      // sub_code 可记录（无敏感材料）；错误信息绝不含密钥/配置。
      throw new Error(`ALIPAY_CHANNEL_ERROR: ${asString(node['sub_code']) ?? code ?? 'UNKNOWN'}`)
    }
    return node
  }

  async createQrPayment(input: QrPaymentCreateInput): Promise<QrPaymentCreateResult> {
    const notifyUrl = `${this.cfg.notifyBaseUrl.replace(/\/$/, '')}${buildPaymentCallbackPath(this.channel)}`
    const node = await this.call(
      'alipay.trade.precreate',
      {
        out_trade_no: input.attemptId, // 服务端 cuid，notify 经 out_trade_no 找回 attempt
        total_amount: centsToYuan(input.amountCents),
        subject: `打印服务订单 ${input.orderNo}`,
        // passback_params 原样回带 —— 业务层全字段匹配 orderId 的通道侧来源（协议要求 URL 编码）
        passback_params: encodeURIComponent(JSON.stringify({ orderId: input.orderId })),
      },
      { notifyUrl },
    )
    const qrCode = asString(node['qr_code'])
    if (!qrCode) throw new Error('ALIPAY_CHANNEL_ERROR: QR_CODE_MISSING')
    // 当面付无独立 prepay_id：prepayId 统一取 out_trade_no（= attemptId），notify 回带同值。
    return { prepayId: input.attemptId, qrCodeContent: qrCode }
  }

  async verifyAndParseCallback(ctx: PaymentCallbackContext): Promise<CallbackVerifyResult> {
    // notify 为 form-urlencoded：从 rawBody 解出参数（URLSearchParams 解一次传输层编码）。
    let params: Record<string, string>
    try {
      params = Object.fromEntries(new URLSearchParams(ctx.rawBody.toString('utf8')))
    } catch {
      return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }
    }

    const notifyId = asString(params['notify_id'])
    const signType = asString(params['sign_type'])
    if (!asString(params['sign']) || !notifyId) return { ok: false, code: 'CALLBACK_HEADER_MISSING' }
    if (signType !== 'RSA2') return { ok: false, code: 'CALLBACK_SIGNATURE_INVALID' }

    const timestampMs = parseAlipayTime(asString(params['notify_time']))
    if (timestampMs === null) return { ok: false, code: 'CALLBACK_TIMESTAMP_INVALID' }
    if (Math.abs(Date.now() - timestampMs) > CALLBACK_TIMESTAMP_WINDOW_MS) {
      return { ok: false, code: 'CALLBACK_TIMESTAMP_EXPIRED' }
    }

    // 验签先于一切业务解析。
    if (!verifyAlipayNotifySign(params, this.cfg.alipayPublicKeyPem)) {
      return { ok: false, code: 'CALLBACK_SIGNATURE_INVALID' }
    }

    // 交易归属校验：app_id 必须是本应用（防跨应用报文错投）。
    if (asString(params['app_id']) !== this.cfg.appId) return { ok: false, code: 'CALLBACK_MERCHANT_MISMATCH' }

    const outTradeNo = asString(params['out_trade_no'])
    if (!outTradeNo) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }

    const amountCents = yuanToCents(asString(params['total_amount']))
    if (amountCents === null || amountCents <= 0) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }

    // passback_params 回带 orderId（出码时写入，协议 URL 编码一层）；缺失/损坏 → 拒绝。
    let orderId: string | null = null
    const passback = asString(params['passback_params'])
    if (passback) {
      for (const candidate of [passback, ((): string | null => {
        try {
          return decodeURIComponent(passback)
        } catch {
          return null
        }
      })()]) {
        if (!candidate) continue
        try {
          const parsed = JSON.parse(candidate) as { orderId?: unknown }
          orderId = asString(parsed.orderId)
          if (orderId) break
        } catch {
          /* 尝试下一种解码 */
        }
      }
    }
    if (!orderId) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }

    const result = mapTradeStatus(asString(params['trade_status']))
    const channelTxnNo = asString(params['trade_no'])
    if (result === 'success' && !channelTxnNo) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }

    const event: PaymentCallbackEvent = {
      channel: this.channel,
      attemptId: outTradeNo,
      prepayId: outTradeNo, // 与出码时 prepayId=out_trade_no 对应
      orderId,
      amountCents,
      result,
      channelTxnNo,
      failReasonRaw: result === 'failed' ? asString(params['trade_status']) : null,
      nonce: notifyId, // notify_id 唯一，作防重放键
      timestampMs,
    }
    return { ok: true, event }
  }

  /** 主动查单兜底（回调丢失时）：alipay.trade.query。 */
  async queryPayment(input: { attemptId: string; orderId: string }): Promise<PaymentQueryResult> {
    let node: Record<string, unknown>
    try {
      node = await this.call('alipay.trade.query', { out_trade_no: input.attemptId })
    } catch (e) {
      if ((e as Error).message?.includes('ACQ.TRADE_NOT_EXIST')) {
        return { status: 'unknown', channelTxnNo: null, amountCents: null }
      }
      throw e
    }
    const status = asString(node['trade_status'])
    if (status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED') {
      const txnNo = asString(node['trade_no'])
      const amountCents = yuanToCents(asString(node['total_amount']))
      // paid 必须齐备流水号 + 金额，否则按不可判处理（reconcile 拒绝入账，绝不凑合）。
      if (!txnNo || amountCents === null) return { status: 'unknown', channelTxnNo: null, amountCents: null }
      return { status: 'paid', channelTxnNo: txnNo, amountCents }
    }
    if (status === 'WAIT_BUYER_PAY') return { status: 'pending', channelTxnNo: null, amountCents: null }
    if (status === 'TRADE_CLOSED') return { status: 'closed', channelTxnNo: null, amountCents: null }
    return { status: 'unknown', channelTxnNo: null, amountCents: null }
  }

  /**
   * 真实退款（W-B）：alipay.trade.refund（**同步**接口）。
   * `out_request_no = refundNo`（渠道级幂等：同号重复请求不重复出款）；
   * fund_change='Y' → 本次真实出款成功；'N' → 该退款请求此前已成功（幂等命中），同样视为 success。
   * 渠道错误（非 10000）由 call() 抛 ALIPAY_CHANNEL_ERROR，业务层按失败回滚。
   */
  async refund(input: RefundExecuteInput): Promise<RefundExecuteResult> {
    if (!input.outTradeNo) {
      // fail-closed：缺原单定位绝不盲发退款请求（业务层应传成功尝试的 attemptId）。
      throw new Error('ALIPAY_REFUND_INPUT_MISSING: 缺少 outTradeNo，拒绝发起渠道退款')
    }
    const node = await this.call('alipay.trade.refund', {
      out_trade_no: input.outTradeNo,
      refund_amount: centsToYuan(input.amountCents),
      out_request_no: input.refundNo,
    })
    return { channelRefundNo: asString(node['trade_no']), status: 'success' }
  }

  /** 退款查证（W-B）：alipay.trade.fastpay.refund.query（processing 收敛/对账兜底用）。 */
  async queryRefund(input: { refundNo: string; outTradeNo?: string | null }): Promise<RefundQueryResult> {
    if (!input.outTradeNo) return { status: 'unknown', channelRefundNo: null }
    let node: Record<string, unknown>
    try {
      node = await this.call('alipay.trade.fastpay.refund.query', {
        out_trade_no: input.outTradeNo,
        out_request_no: input.refundNo,
      })
    } catch (e) {
      if ((e as Error).message?.includes('ACQ.TRADE_NOT_EXIST')) return { status: 'unknown', channelRefundNo: null }
      throw e
    }
    // refund_status=REFUND_SUCCESS → 成功；查得记录但无该字段 → 受理中/不可判（绝不假报成功）。
    const refundStatus = asString(node['refund_status'])
    if (refundStatus === 'REFUND_SUCCESS') return { status: 'success', channelRefundNo: asString(node['trade_no']) }
    const hasRecord = asString(node['out_request_no']) === input.refundNo
    return { status: hasRecord ? 'processing' : 'unknown', channelRefundNo: asString(node['trade_no']) }
  }

  /** 支付宝要求异步通知成功应答为纯文本 `success`，否则按失败重试。 */
  callbackAck(): CallbackAck {
    return { contentType: 'text/plain', body: 'success' }
  }
}
