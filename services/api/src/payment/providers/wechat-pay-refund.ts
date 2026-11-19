/**
 * 微信支付退款报文的归一化（从 wechat-pay.provider.ts 拆出，退款申请、查询、结果通知三处共用）。
 *
 * 归一化 status：SUCCESS→success，PROCESSING→processing，CLOSED / ABNORMAL / 未知→failed。
 * 官方说明：
 * - 查询单笔退款（退款状态取值）https://pay.weixin.qq.com/doc/v3/merchant/4012791884
 * - 退款结果回调通知（refund_status 与 REFUND.ABNORMAL）https://pay.weixin.qq.com/doc/v3/merchant/4012791886
 * - 订单退款开发指引（退款异常时资金停在退款中间账户，需发起异常退款）https://pay.weixin.qq.com/doc/v3/merchant/4013071031
 */
import type { RefundExecuteResult, RefundNotifyVerifyResult, RefundQueryResult } from '../payment-provider.types'

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** wechat 退款状态 → 归一化（受理中绝不假报成功）。 */
export function mapWechatRefundStatus(status: string | null): 'success' | 'failed' | 'processing' {
  if (status === 'SUCCESS') return 'success'
  if (status === 'PROCESSING') return 'processing'
  return 'failed' // ABNORMAL / CLOSED / 未知：按失败处理（由业务层回滚可重试）
}

function refundAmountOf(resource: Record<string, unknown>): number | null {
  const amount = resource['amount'] as { refund?: unknown } | undefined
  return typeof amount?.refund === 'number' && Number.isInteger(amount.refund) && amount.refund >= 0
    ? amount.refund
    : null
}

/** 退款申请应答。 */
export function parseWechatRefundCreate(resp: Record<string, unknown>): RefundExecuteResult {
  const raw = asString(resp['status'])
  return {
    channelRefundNo: asString(resp['refund_id']),
    status: mapWechatRefundStatus(raw),
  }
}

/** 查询抛错：退款单不存在、404 当成渠道查无此单（unknown），其余返回 null 让调用方原样抛出。 */
export function wechatRefundQueryMiss(error: unknown): RefundQueryResult | null {
  const message = (error as Error)?.message ?? ''
  if (!message.includes('RESOURCE_NOT_EXISTS') && !message.includes('HTTP_404')) return null
  return {
    status: 'unknown',
    channelRefundNo: null,
    refundState: message.includes('RESOURCE_NOT_EXISTS') ? 'RESOURCE_NOT_EXISTS' : null,
  }
}

/** 查询应答。未知状态按 unknown（不回滚不完成，等下次查证）；只有 ABNORMAL / CLOSED 归 failed。 */
export function parseWechatRefundQuery(resp: Record<string, unknown>): RefundQueryResult {
  const raw = asString(resp['status'])
  const status = mapWechatRefundStatus(raw)
  const refundAmountCents = refundAmountOf(resp)
  if (status === 'failed' && raw !== 'ABNORMAL' && raw !== 'CLOSED') {
    return { status: 'unknown', channelRefundNo: asString(resp['refund_id']), refundAmountCents }
  }
  return { status, channelRefundNo: asString(resp['refund_id']), refundAmountCents, refundState: raw }
}

/**
 * 退款结果通知解密后的退款对象 → 归一化事件。无 appid 字段，归属只校验 mchid；
 * SUCCESS→success，CLOSED/ABNORMAL→failed，其它 refund_status 一律拒绝。
 */
export function parseWechatRefundNotify(
  refund: Record<string, unknown>,
  ctx: { mchid: string; channel: string; nonce: string; timestampMs: number },
): RefundNotifyVerifyResult {
  if (asString(refund['mchid']) !== ctx.mchid) return { ok: false, code: 'CALLBACK_MERCHANT_MISMATCH' }
  const refundNo = asString(refund['out_refund_no'])
  const outTradeNo = asString(refund['out_trade_no'])
  if (!refundNo || !outTradeNo) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }
  const rawStatus = asString(refund['refund_status'])
  let status: 'success' | 'failed'
  if (rawStatus === 'SUCCESS') status = 'success'
  else if (rawStatus === 'CLOSED' || rawStatus === 'ABNORMAL') status = 'failed'
  else return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' } // 未知状态：拒绝，绝不猜测
  const refundAmountCents = refundAmountOf(refund)
  // SUCCESS 必须齐备退款金额（业务层比对依据），缺失拒绝。
  if (status === 'success' && refundAmountCents === null) return { ok: false, code: 'CALLBACK_PAYLOAD_INVALID' }
  return {
    ok: true,
    event: {
      channel: ctx.channel,
      refundNo,
      outTradeNo,
      channelRefundNo: asString(refund['refund_id']),
      status,
      refundAmountCents,
      nonce: ctx.nonce,
      timestampMs: ctx.timestampMs,
    },
  }
}
