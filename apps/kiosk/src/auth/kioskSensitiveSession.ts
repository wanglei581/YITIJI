import { clearPrintMaterialSession } from '../pages/print/printMaterialSession'
import { clearAiResumeSession } from '../pages/resume/aiResumeSession'
import { clearJobMaterialDraft } from '../pages/resume/jobMaterialDraft'
import {
  clearContractReviewSession,
  hasContractReviewSession,
} from '../pages/contract-review/contractReviewSession'

/**
 * 清场会真正清掉的 sessionStorage 键。
 *
 * 必须与下面 clearKioskSensitiveSession 清理的集合保持一一对应：
 * 新增一处敏感会话就要同时登记到这里，否则 hasKioskSensitiveSession 会漏判，
 * 把「其实有东西要清」误判成空操作。
 */
const SENSITIVE_SESSION_STORAGE_KEYS = [
  'ai-job-print:current-print-material-check',
  'ai-job-print:current-ai-resume',
  'ai-job-print:job-material-draft:v1',
] as const

export function clearKioskSensitiveSession(): void {
  clearContractReviewSession()
  clearPrintMaterialSession()
  clearAiResumeSession()
  clearJobMaterialDraft()
}

/**
 * 本机是否还留着上一位用户的敏感会话。
 *
 * fail-closed：sessionStorage 不可用或读取抛错时一律返回 true。
 * 判不准就当「有东西要清」，让清场照常发生——宁可多清一次，不可漏清一次。
 */
export function hasKioskSensitiveSession(): boolean {
  if (hasContractReviewSession()) return true
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return true
    return SENSITIVE_SESSION_STORAGE_KEYS.some(
      (key) => window.sessionStorage.getItem(key) !== null,
    )
  } catch {
    return true
  }
}
