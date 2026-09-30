import { AI_USAGE_VENDOR_LABELS } from './aiUsageDisplay'

/** 日志仅有错误码，不附带中文 message；未知码不猜测原因，原值留在悬停。 */
const REASONS: Readonly<Record<string, string>> = {
  ServiceUnavailableException: 'AI 服务暂时不可用',
  AI_PROVIDER_ERROR: '模型厂商服务异常',
  AI_NOT_CONFIGURED: 'AI 服务尚未配置',
  AI_PROVIDER_NOT_CONFIGURED: 'AI 服务尚未配置',
  AI_PAUSED: 'AI 服务已暂停',
  MAINTENANCE_MODE: '设备维护中',
  AI_BUDGET_EXHAUSTED: '当日 AI 额度已用完',
  AI_BUDGET_UNAVAILABLE: 'AI 额度暂时无法读取',
  AI_LOGIN_REQUIRED: '需要先登录',
  AI_DECLARATION_REQUIRED: '需要确认 AI 使用声明',
  AI_CONTENT_BLOCKED: '内容未通过安全检查',
  AI_BUSY: 'AI 服务繁忙',
  AI_TIMEOUT: 'AI 响应超时',
}

export function aiLogReason(code: string): string {
  return REASONS[code] ?? '调用失败，请联系运维查看原因'
}

/** 服务端日志格式 llm:厂商:模型；仅重排已知结构，原串由调用方保留在 title。 */
export function aiProviderName(raw: string): string {
  const parts = raw.split(':')
  if (parts[0] === 'llm' && parts.length >= 3) {
    return `${AI_USAGE_VENDOR_LABELS[parts[1]] ?? parts[1]} · ${parts.slice(2).join(':')}`
  }
  return AI_USAGE_VENDOR_LABELS[raw] ?? raw
}
