import { clearPrintMaterialSession } from '../pages/print/printMaterialSession'
import { clearAiResumeSession } from '../pages/resume/aiResumeSession'
import { clearJobMaterialDraft } from '../pages/resume/jobMaterialDraft'
import { clearContractReviewSession } from '../pages/contract-review/contractReviewSession'

export function clearKioskSensitiveSession(): void {
  clearContractReviewSession()
  clearPrintMaterialSession()
  clearAiResumeSession()
  clearJobMaterialDraft()
}
