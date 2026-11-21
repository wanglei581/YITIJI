import { calcPaySig } from './virtual-pay-sign'

const QUERY_URI = '/xpay/query_order'
const NOTIFY_PROVIDE_GOODS_URL = 'https://api.weixin.qq.com/xpay/notify_provide_goods'
export const VIRTUAL_PAY_HTTP_TIMEOUT_MS = 10_000

export interface WechatQueryOrderResponse {
  errcode?: number
  order?: {
    status?: number
    paid_fee?: number
    env_type?: number
    wx_order_id?: string
    paid_time?: number
  }
}

/**
 * 微信虚拟支付查单（现金单）。核对表 3.3、3.4、3.6、3.7、补充规则 10。
 * pay_sig 只签实际发出的 body 字节，AppKey 由调用方按订单自身的 env 选好。
 */
export async function queryWechatVirtualPayOrder(input: {
  openId: string
  env: number
  orderId: string
  appKey: string
  token: string
  fetchImpl: typeof fetch
  timeoutMs?: number
}): Promise<WechatQueryOrderResponse> {
  const timeoutMs = input.timeoutMs ?? VIRTUAL_PAY_HTTP_TIMEOUT_MS
  const body = JSON.stringify({ openid: input.openId, env: input.env, order_id: input.orderId })
  const paySig = calcPaySig(QUERY_URI, body, input.appKey)
  const url =
    `https://api.weixin.qq.com${QUERY_URI}` +
    `?access_token=${encodeURIComponent(input.token)}` +
    `&pay_sig=${encodeURIComponent(paySig)}`
  const response = await input.fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error('VPAY_QUERY_HTTP')
  return (await response.json()) as WechatQueryOrderResponse
}

/**
 * 微信虚拟支付通知已发货完成（只能通知现金单）。核对表 3.8、3.9。
 * 仅用于推送失败后走查单补记的异常兜底；官方原文 HTTPS 调用不带 pay_sig，注意事项为「无特殊」。
 */
export async function notifyWechatProvideGoods(input: {
  orderId: string
  env: number
  token: string
  fetchImpl: typeof fetch
  timeoutMs?: number
}): Promise<boolean> {
  const timeoutMs = input.timeoutMs ?? VIRTUAL_PAY_HTTP_TIMEOUT_MS
  const body = JSON.stringify({ order_id: input.orderId, env: input.env })
  const url = `${NOTIFY_PROVIDE_GOODS_URL}?access_token=${encodeURIComponent(input.token)}`
  try {
    const response = await input.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return false
    const text = (await response.text()).trim()
    if (!text) return true
    const parsed = JSON.parse(text) as { errcode?: unknown }
    return parsed.errcode === undefined || parsed.errcode === 0
  } catch {
    return false
  }
}
