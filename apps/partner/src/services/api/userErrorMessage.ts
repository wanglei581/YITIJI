/**
 * 机构后台给操作者看的错误文案。规则与管理员后台同一套，但不能跨应用引用那边的文件。
 * 码表只收录机构端会遇到的码。ApiHttpError 按 name 识别。
 * 页面 TypeError 只有断网那几句才算网络问题；普通 Error 没有中文时用兜底句。
 */
const CODE_MESSAGES: Readonly<Record<string, string>> = {
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  AUTH_REQUIRED: '登录已过期，请重新登录',
  VALIDATION_FAILED: '提交内容未通过校验，请检查后重试',
  SOURCE_ARCHIVED: '该数据源已归档，无法执行此操作',
  DATA_SOURCE_ARCHIVED: '数据源已归档，无法继续操作。请先取消归档',
  ORG_DISABLED: '所属机构已停用，无法执行此操作',
  NO_ENDPOINT: '未配置接口地址，请先填写接口地址',
  ENDPOINT_NOT_PUBLIC: '接口地址不是可访问的公网地址',
  ORG_REQUIRED: '当前账号未绑定机构，无法查看本机构数据',
  AUTH_ROLE_FORBIDDEN: '当前账号没有这项操作的权限',
  AUTH_FORBIDDEN: '未识别身份，请重新登录后再试',
  RECRUITMENT_HOSTING_DISABLED: '本平台已关闭招聘内容托管，这项操作不可用',
  EMERGENCY_TAKEDOWN_IRREVERSIBLE: '该内容已被紧急下架，或所属机构已熔断，不能再发布',
  CONTENT_TRUST_INACTIVE: '来源机构内容信任未生效，无法发布',
  CONTENT_NOT_FOUND: '内容不存在或已被删除，请刷新列表',
  WEBHOOK_SECRET_LOW_ENTROPY: '自定义密钥强度不足，请改用更长的随机密钥或留空由系统生成',
  WEBHOOK_SECRET_TOO_SHORT: '自定义密钥太短，请改用更长的随机密钥或留空由系统生成',
  CREDENTIAL_REQUIRED: 'API 数据源必须提供新的凭证',
  DATA_SOURCE_HAS_NO_CREDENTIAL: '该接入方式不使用凭证，无需轮换',
  CREDENTIAL_ROTATION_COOLDOWN: '该数据源刚刚完成轮换，请稍后再试',
  CREDENTIAL_ROTATION_RATE_LIMITED: '轮换次数过多。紧急停止接收请归档该数据源',
  CREDENTIAL_ROTATION_CONFIRMATION_REQUIRED: '轮换未确认，已取消',
  CREDENTIAL_ROTATION_CONFLICT: '该数据源刚刚已被轮换，请刷新后再试',
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
  if (isHttpError(error)) return fromHttpFields(error.code, error.message, error.status, fallback, true)
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
