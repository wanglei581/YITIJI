import { maskEmail, maskPhone } from '../../utils/maskPii'

/** 只用于展示；请求与保存始终使用原值。 */
export function advisorDisplayText(text: string): string {
  return text.replace(/(?<!\d)1\d{10}(?!\d)/g, maskPhone)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, maskEmail)
}

/** 用户话保持原意；只有空值、工程信息、原始错误码退回本步提示。 */
export function advisorUserReason(reason: unknown, fallback: string): string {
  if (typeof reason !== 'string' || !reason.trim() || !/[\u4e00-\u9fff]/.test(reason)) return fallback
  if (/服务端|服务器|后端|前台|后台|会话|字段|接口|落库|链路|回执|引擎|能力探测|真机|未验收|终端编号|内部文件号|元数据|网桥|ASR|TRTC|TTS|providerLabel|aiGenerated|llm:/.test(reason)) return fallback
  if (/\b(?:pending|uploaded|HTTP|TypeError|ReferenceError|SyntaxError|Error|ECONNREFUSED|ETIMEDOUT|ENOENT|taskId|fileId)\b|\b[A-Z][A-Z\d]*_[A-Z\d_]+\b|<[^>]+>/i.test(reason)) return fallback
  return advisorDisplayText(reason)
}

export function advisorErrorMessage(error: unknown, fallback: string): string {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : undefined
  return advisorUserReason(message, fallback)
}
