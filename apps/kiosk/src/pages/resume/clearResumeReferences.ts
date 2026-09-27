import { clearAiResumeSession, readAiResumeSession } from './aiResumeSession'
import { clearSession, loadSession } from './selfAssessmentSession'

/** 删除成功后仅清掉指向该条记录的本机引用，不影响其他简历或未完成作答。 */
export function clearResumeReferences(taskId: string): void {
  if (readAiResumeSession()?.taskId === taskId) clearAiResumeSession()
  const assessment = loadSession()
  if (assessment.taskId === taskId || assessment.result?.taskId === taskId) clearSession()
}
