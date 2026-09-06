/**
 * 管理员后台给操作者看的错误文案。
 * 适配器抛 ApiHttpError 时优先用已登记码表，其次用后端中文 message，
 * 英文技术串（statusText / HTTP_400）一律落到调用方兜底句。
 */
import { ApiHttpError } from './client'

const CODE_MESSAGES: Readonly<Record<string, string>> = {
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  AUTH_REQUIRED: '登录已过期，请重新登录',
  SOURCE_ARCHIVED: '该数据源已归档，无法执行此操作',
  ORG_DISABLED: '所属机构已停用，无法执行此操作',
  NO_ENDPOINT: '未配置接口地址，请先填写 endpoint',
  ENDPOINT_NOT_PUBLIC: '接口地址不是可访问的公网地址',
  REFUND_REASON_REQUIRED: '请填写退款原因后再提交',
  ORDER_ALREADY_REFUNDED: '该订单已退款，无需重复操作',
  REFUND_CHANNEL_UNSUPPORTED: '该支付来源不支持从本页退款，请走原渠道',
  REFUND_CHANNEL_FAILED: '渠道退款失败，订单未改状态，请稍后重试',
  PRINT_REFUND_VERIFIED_PRINTED_FORBIDDEN: '该单已核查为已出纸，禁止退款',
  ORDER_NOT_FOUND: '订单不存在',
  ORDER_INVALID_TRANSITION: '当前支付状态不允许此操作',
  VALIDATION_FAILED: '提交内容未通过校验，请检查后重试',
  CONTENT_TRUST_INACTIVE: '来源机构内容信任未生效，无法发布',
}

const ENGLISH_STATUS_TEXT = /^(OK|Created|Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable)$/i

export function userMessageOf(error: unknown, fallback: string): string {
  if (error instanceof ApiHttpError) {
    if (error.code && CODE_MESSAGES[error.code]) return CODE_MESSAGES[error.code]
    const msg = error.message.trim()
    if (
      msg
      && !/^HTTP[_\s]?\d+/i.test(msg)
      && !ENGLISH_STATUS_TEXT.test(msg)
      && msg !== String(error.status)
    ) {
      return msg
    }
    if (error.status === 0 || error.code === 'NETWORK_ERROR') return CODE_MESSAGES.NETWORK_ERROR
    if (error.status === 401) return CODE_MESSAGES.AUTH_REQUIRED
    if (error.status >= 500) return '服务暂时不可用，请稍后重试'
  }
  if (error instanceof TypeError) return CODE_MESSAGES.NETWORK_ERROR
  return fallback
}
