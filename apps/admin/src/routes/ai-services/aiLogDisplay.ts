import { AI_LOG_REASON_LABELS, AI_USAGE_VENDOR_LABELS } from '@ai-job-print/shared'

/** 日志仅有错误码，不附带中文 message；未知码显示未归类及码值；已登记码的原值留在悬停。 */


export function aiLogReason(code: string): string {
  return AI_LOG_REASON_LABELS[code] ?? `未归类失败（${code}）`
}

/** 服务端日志格式 llm:厂商:模型；仅重排已知结构，原串由调用方保留在 title。 */
export function aiProviderName(raw: string): string {
  const parts = raw.split(':')
  if (parts[0] === 'llm' && parts.length >= 3) {
    return `${AI_USAGE_VENDOR_LABELS[parts[1]] ?? parts[1]} · ${parts.slice(2).join(':')}`
  }
  return AI_USAGE_VENDOR_LABELS[raw] ?? raw
}
