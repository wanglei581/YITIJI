/**
 * 退款渠道错误的分类（从 refund.service.ts 拆出，口径不变）。
 */

/**
 * 渠道异常分类（W-B 审查 H1 修复）：只有「渠道明确给出业务判定」才算明确拒绝；
 * 超时/网络异常/5xx/响应不可解析或验签失败 → 结果不可知（资金可能已动），保持 pending 收敛。
 */
export function isDefinitiveChannelRejection(e: unknown): boolean {
  const msg = (e as Error)?.message ?? ''
  // 发起前的本地输入校验失败：未发出任何请求，必然明确失败。
  if (msg.includes('REFUND_INPUT_MISSING')) return true
  // 渠道返回了可解析的业务错误码（providers 统一以 *_CHANNEL_ERROR: <code> 抛出）。
  if (msg.includes('CHANNEL_ERROR:')) {
    if (/HTTP_5\d\d/.test(msg)) return false // 5xx：渠道内部错误，结果不可知
    // 瞬态 4xx（第二轮审查 High 修复）：408 超时 / 409 冲突 / 425 too-early / 429 限流 ——
    // 请求可能已被渠道受理或稍后可重试，均按结果不可知处理，绝不回滚为明确失败。
    if (/HTTP_(408|409|425|429)\b/.test(msg)) return false
    // 渠道自述「结果未知/请同参数重试/频控」的业务码：wechat SYSTEM_ERROR、FREQUENCY_LIMITED /
    // alipay code=20000。
    if (msg.includes('SYSTEM_ERROR') || msg.includes('FREQUENCY_LIMITED') || /CHANNEL_ERROR:\s*20000\b/.test(msg)) {
      return false
    }
    if (msg.includes('RESPONSE_NOT_JSON') || msg.includes('RESPONSE_NODE_MISSING') || msg.includes('RESPONSE_SIGN_INVALID')) {
      return false // 响应损坏/不可验签：请求可能已被处理，结果不可知
    }
    return true // 其余 4xx / 明确业务 sub_code：渠道明确拒绝，未出款
  }
  return false // fetch/超时/连接异常等传输层错误：结果不可知
}

/** 退款通知验签/时间窗/解密类失败 → 401；其余业务校验失败 → 400（与支付回调同分类口径）。 */
export const UNAUTHORIZED_NOTIFY_CODES = new Set([
  'CALLBACK_HEADER_MISSING',
  'CALLBACK_TIMESTAMP_INVALID',
  'CALLBACK_TIMESTAMP_EXPIRED',
  'CALLBACK_NONCE_INVALID',
  'CALLBACK_SIGNATURE_INVALID',
  'CALLBACK_SERIAL_MISMATCH',
  'CALLBACK_RESOURCE_DECRYPT_FAILED',
  'CALLBACK_MERCHANT_MISMATCH',
])
