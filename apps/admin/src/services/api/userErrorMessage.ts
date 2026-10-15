/**
 * 管理员后台给操作者看的错误文案。
 * 适配器抛出的 ApiHttpError（按 name 识别，避免单测去加载带 import.meta.env 的 client）：
 * 已登记码 → 中文；后端中文或其它非状态串 message → 原样；
 * 英文状态串 / 401 / 5xx / 网络 → 中文；其余 → 调用方兜底句。
 * 页面自己抛出的 TypeError 只有断网那几句才算网络问题。
 * 普通 Error 没有中文时用兜底句，有中文则原样（本项目里手写的 Error 多是中文）。
 */
const CODE_MESSAGES: Readonly<Record<string, string>> = {
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  AUTH_REQUIRED: '登录已过期，请重新登录',
  SOURCE_ARCHIVED: '该数据源已归档，无法执行此操作',
  ORG_DISABLED: '所属机构已停用，无法执行此操作',
  NO_ENDPOINT: '未配置接口地址，请先填写 endpoint',
  ENDPOINT_NOT_PUBLIC: '接口地址不是可访问的公网地址',
  REFUND_REASON_REQUIRED: '请填写退款原因后再提交',
  ORDER_ALREADY_REFUNDED: '该订单已退款，无需重复操作',
  ORDER_NOT_REFUNDABLE: '该订单当前状态不可退款',
  ORDER_TASK_IN_PROGRESS: '打印任务进行中，暂不能退款',
  REFUND_CHANNEL_UNSUPPORTED: '该支付来源不支持从本页退款，请走原渠道',
  REFUND_CHANNEL_FAILED: '渠道退款失败，订单未改状态，请稍后重试',
  REFUND_SOURCE_ATTEMPT_MISSING: '找不到原支付记录，无法原路退回，请人工核账',
  REFUND_SOURCE_AMBIGUOUS: '该单存在多笔成功支付，无法自动退款，请人工核账',
  REFUND_AMOUNT_BASIS_UNSUPPORTED: '退款金额口径不被支持，请人工核账',
  REFUND_STATE_CONFLICT: '退款状态冲突，请刷新后重试',
  PRINT_REFUND_VERIFIED_PRINTED_FORBIDDEN: '该单已核查为已出纸，禁止退款',
  ORDER_NOT_FOUND: '订单不存在',
  ORDER_INVALID_TRANSITION: '当前支付状态不允许此操作',
  VALIDATION_FAILED: '提交内容未通过校验，请检查后重试',
  CONTENT_TRUST_INACTIVE: '来源机构内容信任未生效，无法发布',
  // 3.13 招聘内容托管与紧急下架
  RECRUITMENT_HOSTING_DISABLED: '本平台已关闭招聘内容托管，这项操作不可用',
  EMERGENCY_TAKEDOWN_IRREVERSIBLE: '该内容已被紧急下架，或所属机构 / 来源已熔断，不能再发布',
  TAKEDOWN_REASON_REQUIRED: '请选择事由并填写说明后再提交',
  ADMIN_POLICY_PUBLISH_DISABLED: '管理员不能审核或发布政策，政策由机构自行审核发布',
  CONTENT_NOT_FOUND: '内容不存在或已被删除，请刷新列表',
  CIRCUIT_BREAK_TARGET_REQUIRED: '请指定要熔断的机构或来源',
}

const ENGLISH_STATUS_TEXT = /^(OK|Created|Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable)$/i
const HAS_CHINESE = /[\u4e00-\u9fff]/
const NETWORK_TYPE_ERROR = /Failed to fetch|NetworkError|Load failed|network/i

type HttpErrorLike = Error & { code: string; status: number }

function isHttpError(error: unknown): error is HttpErrorLike {
  if (!(error instanceof Error) || error.name !== 'ApiHttpError') return false
  const record = error as { code?: unknown; status?: unknown }
  return typeof record.code === 'string' && typeof record.status === 'number'
}

function fromHttpFields(
  code: string,
  message: string,
  status: number,
  fallback: string,
  keepNonChinese: boolean,
): string {
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
  const msg = message.trim()
  const technical = !msg
    || /^HTTP[_\s]?\d+/i.test(msg)
    || ENGLISH_STATUS_TEXT.test(msg)
    || msg === String(status)
  if (!technical && (keepNonChinese || HAS_CHINESE.test(msg))) return msg
  if (status === 0 || code === 'NETWORK_ERROR') return CODE_MESSAGES.NETWORK_ERROR
  if (status === 401) return CODE_MESSAGES.AUTH_REQUIRED
  if (status >= 500) return '服务暂时不可用，请稍后重试'
  return fallback
}

export function userMessageOf(error: unknown, fallback: string): string {
  if (isHttpError(error)) return fromHttpFields(error.code, error.message, error.status, fallback, false)
  if (error instanceof TypeError) {
    if (NETWORK_TYPE_ERROR.test(error.message)) return CODE_MESSAGES.NETWORK_ERROR
    return fallback
  }
  if (error instanceof Error) {
    const msg = error.message.trim()
    if (msg && HAS_CHINESE.test(msg)) return msg
    return fallback
  }
  if (error && typeof error === 'object') {
    const record = error as { code?: unknown; message?: unknown; status?: unknown }
    if (typeof record.message === 'string' || typeof record.code === 'string') {
      return fromHttpFields(
        typeof record.code === 'string' ? record.code : '',
        typeof record.message === 'string' ? record.message : '',
        typeof record.status === 'number' ? record.status : 400,
        fallback,
        false,
      )
    }
  }
  return fallback
}
