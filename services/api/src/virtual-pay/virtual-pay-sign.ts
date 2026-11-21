import { createHmac, randomBytes } from 'crypto'

/** 用户态 signature：HMAC 密钥是 session_key 字符串本身的 UTF-8 字节，不做 base64 解码。 */
export function calcUserSignature(body: string, sessionKey: string): string {
  return createHmac('sha256', sessionKey).update(body, 'utf8').digest('hex')
}

/** pay_sig：HMAC 密钥是 AppKey，消息是 uri + '&' + 实际发出的 body 字节。uri 不带前导斜杠以外的查询串。 */
export function calcPaySig(uri: string, body: string, appKey: string): string {
  return createHmac('sha256', appKey).update(`${uri}&${body}`, 'utf8').digest('hex')
}

export const VIRTUAL_PAY_MODE = 'short_series_goods'
/** wx.requestVirtualPayment 的 uri 没有前导斜杠。 */
export const VIRTUAL_PAY_REQUEST_URI = 'requestVirtualPayment'

export interface VirtualPaySignFields {
  offerId: string
  env: 0 | 1
  productId: string
  goodsPrice: number
  outTradeNo: string
  attach: string
}

/** 只序列化这一次。签名和返回值必须是同一串。 */
export function buildSignData(fields: VirtualPaySignFields): string {
  return JSON.stringify({
    offerId: fields.offerId,
    buyQuantity: 1,
    env: fields.env,
    currencyType: 'CNY',
    productId: fields.productId,
    goodsPrice: fields.goodsPrice,
    outTradeNo: fields.outTradeNo,
    attach: fields.attach,
  })
}

/** 8–32 位，字符集 [0-9A-Za-z_\\-|*@]，且不以 _ 开头。vp + 24 位十六进制 = 26。 */
export function newOutTradeNo(): string {
  return `vp${randomBytes(12).toString('hex')}`
}
