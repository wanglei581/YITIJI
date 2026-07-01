import { clearPrintMaterialSession } from '../pages/print/printMaterialSession'
import { clearAiResumeSession } from '../pages/resume/aiResumeSession'
import { clearJobMaterialDraft } from '../pages/resume/jobMaterialDraft'

export function clearKioskSensitiveSession(): void {
  clearPrintMaterialSession()
  clearAiResumeSession()
  clearJobMaterialDraft()
}
