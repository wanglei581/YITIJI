import { ApiHttpError } from '../../services/api/httpAdapter'
import { aiErrorCodeOf } from '../../ai'
import { inspectionSignalsEncrypted } from '../print/components/printPreviewKind'
import { readAiResumeSession } from './aiResumeSession'

export const PARSE_FAIL_REASONS = [
  '文件格式不支持，请重新上传',
  '文字识别失败，请确保文件清晰',
  '结构提取超时，请稍后重试',
  'AI 诊断服务暂时不可用，请稍后重试',
]

const NO_REPLY_CODES = new Set(['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'UNKNOWN_ERROR'])

export function parseErrorOutcome(err: unknown): 'failed' | 'unknown' {
  const code = aiErrorCodeOf(err)
  if (inspectionSignalsEncrypted([code])) return 'failed'
  if (code === 'RESUME_PARSE_OUTCOME_UNKNOWN' || code === 'AI_TASK_NOT_FOUND') return 'unknown'
  if (NO_REPLY_CODES.has(code)) return 'unknown'
  if (err instanceof ApiHttpError && (err.status >= 500 || err.status === 408)) return 'unknown'
  return 'failed'
}

export function isTaskNotFound(err: unknown): boolean {
  return err instanceof ApiHttpError && err.status === 404 && aiErrorCodeOf(err) === 'AI_TASK_NOT_FOUND'
}

export function anonymousAccessReady(taskId: string, accessToken: string | undefined, anonymous: boolean): boolean {
  const back = readAiResumeSession()
  if (!back || back.taskId !== taskId) return false
  if (!anonymous) return true
  return typeof accessToken === 'string' && accessToken.length > 0 && back.accessToken === accessToken
}
