import { clearPrintMaterialSession } from '../pages/print/printMaterialSession'
import { clearAiResumeSession } from '../pages/resume/aiResumeSession'
import { clearJobMaterialDraft } from '../pages/resume/jobMaterialDraft'
import {
  clearSession as clearSelfAssessmentSession,
  SESSION_STORAGE_KEY as SELF_ASSESSMENT_SESSION_KEY,
} from '../pages/resume/selfAssessmentSession'
import {
  clearAllLocalFavorites,
  hasLocalFavorites,
} from '../favorites/localFavorites'
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
  SELF_ASSESSMENT_SESSION_KEY,
] as const

export function clearKioskSensitiveSession(): void {
  clearContractReviewSession()
  clearPrintMaterialSession()
  clearAiResumeSession()
  clearJobMaterialDraft()
  clearSelfAssessmentSession()
}

/**
 * 公共设备残留：匿名本机收藏写在 localStorage，跨用户、跨刷新都还在。
 *
 * 只在 logout / 隐私清场里调用。login() 不得调用——登录后要把游客收藏
 * 留给「合并到账号」，清掉就没得合。
 */
export function clearKioskSharedDeviceResidue(): void {
  clearAllLocalFavorites()
}

/**
 * 本机是否还留着上一位用户的敏感会话。
 *
 * fail-closed：sessionStorage 不可用或读取抛错时一律返回 true。
 * 判不准就当「有东西要清」，让清场照常发生——宁可多清一次，不可漏清一次。
 * 匿名本机收藏单独探测：读失败视为没有残留（写不进去也就漏不出去）。
 */
export function hasKioskSensitiveSession(): boolean {
  if (hasContractReviewSession()) return true
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return true
    if (
      SENSITIVE_SESSION_STORAGE_KEYS.some(
        (key) => window.sessionStorage.getItem(key) !== null,
      )
    ) {
      return true
    }
  } catch {
    return true
  }
  return hasLocalFavorites()
}
