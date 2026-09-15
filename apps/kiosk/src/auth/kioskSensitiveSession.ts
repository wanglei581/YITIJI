import { clearPrintMaterialSession } from '../pages/print/printMaterialSession'
import { clearAiResumeSession } from '../pages/resume/aiResumeSession'
import { clearJobMaterialDraft } from '../pages/resume/jobMaterialDraft'
import {
  clearSession as clearSelfAssessmentSession,
  SESSION_STORAGE_KEY as SELF_ASSESSMENT_SESSION_KEY,
} from '../pages/resume/selfAssessmentSession'
import {
  clearInterviewWorkbenchSession,
  INTERVIEW_WORKBENCH_SESSION_KEY,
} from '../pages/interview/interviewWorkbenchSession'
import {
  clearScanWorkbenchSession,
  SCAN_WORKBENCH_SESSION_KEY,
} from '../pages/scan/scanWorkbenchSession'
import { beginScanSessionCleanup } from '../pages/scan/scanCleanupGate'
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
  INTERVIEW_WORKBENCH_SESSION_KEY,
  SCAN_WORKBENCH_SESSION_KEY,
] as const

/**
 * 清掉本机这一位用户留下的敏感会话。
 *
 * @param outgoingMemberToken 正在失效的会员令牌（换人 / 退出 / 401 时是**旧**那一个，
 *   游客为 null）。只用于在抹掉本地扫描会话之前撤销服务端那个还活着的扫描任务：
 *   服务端按 endUserId 校验取消权限，用新用户的令牌发只会 403，旧任务照样等着
 *   把下一次面板扫描的文件投给上一位用户。它**只在内存里**流向那一次撤销请求，
 *   不落存储、不进 URL、不进 history。
 *
 * ## 本函数只负责「立刻清干净本机」，收尾归 scanCleanupGate
 *
 * 这里同步做完的每一件事都不等网络：屏幕上那一位的 PII 一个字节都不多留。
 * 服务端那条扫描任务撤没撤干净是另一件事 —— 它要等回执，而这里**不能等**
 * （logout / 清场链路都是同步调用）。所以这一步只把凭证交给
 * {@link beginScanSessionCleanup}，由它重试到服务端确认为止；
 * 清场链路那一端（KioskPrivacyGuard）在拿到确认之前不许整页重载 / 进屏保 ——
 * 重载会把补偿逻辑连同执行环境一起杀掉，那正是 2026-09-15 那条 P1 的成因。
 */
export function clearKioskSensitiveSession(outgoingMemberToken?: string | null): void {
  clearContractReviewSession()
  clearPrintMaterialSession()
  clearAiResumeSession()
  clearJobMaterialDraft()
  clearSelfAssessmentSession()
  clearInterviewWorkbenchSession()
  // 顺序不可调换：收尾要读本地登记的 scanTaskId / controlToken，
  // clearScanWorkbenchSession() 一旦先跑，就再也找不到要撤谁。
  beginScanSessionCleanup(outgoingMemberToken ?? null)
  clearScanWorkbenchSession()
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
