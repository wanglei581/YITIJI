import { Injectable, Logger, Optional } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { sendVirtualPayOpsAlert } from './virtual-pay-alert'
import { confirmPaid } from './virtual-pay-delivery'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from './virtual-pay-order.service'
import {
  WechatMessageCryptoError,
  decryptWechatMessage,
  isWechatEncodingAesKey,
  wechatSha1Signature,
  wechatSignaturesMatch,
} from './wechat-message-crypto'

export const VIRTUAL_PAY_MESSAGE_AUDIT_ACTION = 'virtual_pay.message'
export const VIRTUAL_PAY_CLOSED_RECOVERY_AUDIT_ACTION = 'virtual_pay.closed_order_paid_recovered'

const DELIVER_EVENT = 'xpay_goods_deliver_notify'

export type MessageHttpResult =
  | { status: 200; text: string }
  | { status: 400 | 401 | 503; code: string; message: string }

/**
 * 微信消息推送。GET 原样回 echostr（核对表补充规则 2）。
 * POST 只做安全模式：msg_signature、AES、核 AppID（核对表 4.13、补充规则 4）。
 * 成功应答回空串，等于 ErrCode=0（核对表 4.4、补充规则 4）。
 */
@Injectable()
export class WechatMiniappMessageService {
  private readonly logger = new Logger(WechatMiniappMessageService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  verifyUrl(query: Record<string, unknown>): MessageHttpResult {
    const token = readToken()
    if (!token) return configMissing()
    const timestamp = readQuery(query, 'timestamp')
    const nonce = readQuery(query, 'nonce')
    const signature = readQuery(query, 'signature')
    const echostr = readQuery(query, 'echostr')
    if (!timestamp || !nonce || !signature || echostr == null) return signatureInvalid()
    const expected = wechatSha1Signature([token, timestamp, nonce])
    if (!wechatSignaturesMatch(signature, expected)) return signatureInvalid()
    return { status: 200, text: echostr }
  }

  async receive(rawBody: Buffer | undefined, contentType: string, query: Record<string, unknown>): Promise<MessageHttpResult> {
    const secrets = readPostSecrets()
    if (!secrets) return configMissing()
    if (!rawBody || rawBody.length === 0) {
      return { status: 400, code: 'VPAY_RAW_BODY_MISSING', message: '缺少原始消息体' }
    }
    const timestamp = readQuery(query, 'timestamp')
    const nonce = readQuery(query, 'nonce')
    const msgSignature = readQuery(query, 'msg_signature')
    const encrypt = extractEncrypt(rawBody.toString('utf8'), contentType)
    if (!timestamp || !nonce || !msgSignature || !encrypt) return signatureInvalid()
    const expected = wechatSha1Signature([secrets.token, timestamp, nonce, encrypt])
    if (!wechatSignaturesMatch(msgSignature, expected)) return signatureInvalid()
    let plain: string
    try {
      plain = decryptWechatMessage(encrypt, secrets.encodingAesKey, secrets.appId)
    } catch (error) {
      if (error instanceof WechatMessageCryptoError) {
        return { status: 401, code: error.code, message: '微信消息校验失败' }
      }
      return { status: 401, code: 'VPAY_DECRYPT_FAILED', message: '微信消息校验失败' }
    }
    await this.handlePlain(plain)
    return { status: 200, text: '' }
  }

  private async handlePlain(plain: string): Promise<void> {
    const payload = parsePayload(plain)
    if (!payload) {
      await this.diagnose('payload_incomplete', null)
      return
    }
    const event = readString(payload['Event']) ?? 'unknown'
    if (event !== DELIVER_EVENT) {
      await this.audit.write({
        actorId: null,
        actorRole: 'system',
        action: VIRTUAL_PAY_MESSAGE_AUDIT_ACTION,
        targetType: 'virtual_pay_message',
        payload: { event },
      })
      return
    }
    const notice = readDeliver(payload)
    if (!notice) {
      await this.diagnose('payload_incomplete', readString(payload['OutTradeNo']))
      return
    }
    const result = await confirmPaid(this.prisma, { ...notice, allowClosedRecovery: true })
    if (!result.ok) {
      await this.diagnose(result.reason, notice.outTradeNo)
      return
    }
    if (result.recoveredFromClosed) {
      await this.audit.write({
        actorId: null,
        actorRole: 'system',
        action: VIRTUAL_PAY_CLOSED_RECOVERY_AUDIT_ACTION,
        targetType: 'virtual_pay_order',
        targetId: notice.outTradeNo,
        payload: {
          reason: 'closed_order_paid_recovered',
          summary: '关单后到账补记',
          wxOrderId: notice.wxOrderId,
        },
      })
      await sendVirtualPayOpsAlert({
        redis: this.redis,
        outTradeNo: notice.outTradeNo,
        episodeToken: 'closed-recovery',
        type: 'virtual_pay_closed_order_recovered',
        severity: 'warning',
        title: `小程序虚拟支付订单 ${notice.outTradeNo} 关单后到账补记`,
        logger: this.logger,
      })
    }
  }

  private diagnose(reason: string, outTradeNo: string | null): Promise<string | null> {
    return this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: VIRTUAL_PAY_DIAGNOSTIC_ACTION,
      targetType: 'virtual_pay_order',
      targetId: outTradeNo,
      payload: { reason },
    })
  }
}

function readToken(): string {
  return process.env['WECHAT_MINIAPP_MESSAGE_TOKEN']?.trim() ?? ''
}

function readPostSecrets(): { token: string; encodingAesKey: string; appId: string } | null {
  const token = readToken()
  const encodingAesKey = process.env['WECHAT_MINIAPP_MESSAGE_ENCODING_AES_KEY']?.trim() ?? ''
  const appId = process.env['WECHAT_MINIAPP_APPID']?.trim() ?? ''
  if (!token || !appId || !isWechatEncodingAesKey(encodingAesKey)) return null
  return { token, encodingAesKey, appId }
}

function configMissing(): MessageHttpResult {
  return { status: 503, code: 'VPAY_MESSAGE_CONFIG_MISSING', message: '微信消息推送暂不可用' }
}

function signatureInvalid(): MessageHttpResult {
  return { status: 401, code: 'VPAY_SIGNATURE_INVALID', message: '微信消息签名无效' }
}

function readQuery(query: Record<string, unknown>, key: string): string | null {
  const value = query[key]
  return typeof value === 'string' ? value : null
}

function extractEncrypt(raw: string, contentType: string): string | null {
  const trimmed = raw.trim()
  if (contentType.includes('xml') || trimmed.startsWith('<')) {
    const match = trimmed.match(/<Encrypt>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/Encrypt>/)
    const value = match?.[1] ?? match?.[2]
    return value ? value.trim() : null
  }
  try {
    const parsed = JSON.parse(trimmed) as { Encrypt?: unknown }
    return typeof parsed.Encrypt === 'string' && parsed.Encrypt.length > 0 ? parsed.Encrypt : null
  } catch {
    return null
  }
}

function parsePayload(plain: string): Record<string, unknown> | null {
  const trimmed = plain.trim()
  try {
    if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>
    if (trimmed.startsWith('<')) return parseWechatXml(trimmed)
  } catch {
    return null
  }
  return null
}

/** 只解析微信推送这种没有属性、没有命名空间的 XML。不引入新依赖。 */
export function parseWechatXml(xml: string): Record<string, unknown> {
  const parsed = parseXmlChildren(xml.trim())
  if (typeof parsed === 'string' || parsed['xml'] == null || typeof parsed['xml'] === 'string') {
    throw new Error('VPAY_XML_INVALID')
  }
  return parsed['xml'] as Record<string, unknown>
}

function parseXmlChildren(input: string): Record<string, unknown> | string {
  const text = input.trim()
  if (!text.startsWith('<')) return text
  const out: Record<string, unknown> = {}
  const pattern = /<([A-Za-z_][A-Za-z0-9_]*)>(<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/\1>/g
  let saw = false
  for (const match of text.matchAll(pattern)) {
    saw = true
    const inner = match[3] !== undefined ? match[3] : (match[4] ?? '')
    out[match[1]] = inner.includes('<') ? parseXmlChildren(inner) : inner
  }
  return saw ? out : text
}

function readDeliver(payload: Record<string, unknown>): {
  outTradeNo: string
  openId: string
  env: number
  productId: string
  quantity: number
  priceCents: number
  wxOrderId: string | null
  paidAt: Date | null
} | null {
  const goods = asRecord(payload['GoodsInfo'])
  const pay = asRecord(payload['WeChatPayInfo'])
  const outTradeNo = readString(payload['OutTradeNo'])
  const openId = readString(payload['OpenId'])
  const env = readNumber(payload['Env'])
  const productId = goods ? readString(goods['ProductId']) : null
  const quantity = goods ? readNumber(goods['Quantity']) : null
  const priceCents = goods ? readNumber(goods['ActualPrice']) : null
  if (!outTradeNo || !openId || env == null || !productId || quantity == null || priceCents == null) return null
  const mchOrderNo = pay ? readString(pay['MchOrderNo']) : null
  const transactionId = pay ? readString(pay['TransactionId']) : null
  const paidTime = pay ? readNumber(pay['PaidTime']) : null
  return {
    outTradeNo,
    openId,
    env,
    productId,
    quantity,
    priceCents,
    wxOrderId: mchOrderNo ?? transactionId,
    paidAt: paidTime != null && paidTime > 0 ? new Date(paidTime * 1000) : null,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value)
  return null
}
