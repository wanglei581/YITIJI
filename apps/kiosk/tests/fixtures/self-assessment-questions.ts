// GET /api/v1/resume/self-assessment/questions 的夹具：直接取 shared 真源（服务端下发的就是这一组），
// 夹具与服务端不会各写一份再漂移。同意页的条款、勾选框文字、链接、版本号只认这次响应。
import {
  SELF_ASSESSMENT_CONSENT_CHECKBOX_LABEL,
  SELF_ASSESSMENT_CONSENT_ITEMS,
  SELF_ASSESSMENT_CONSENT_LINKS,
  SELF_ASSESSMENT_CONSENT_VERSION,
} from '../../../../packages/shared/src/types/selfAssessment'
import { SELF_ASSESSMENT_QUESTIONS_V1 } from '../../../../packages/shared/src/data/selfAssessment/v1.questions'

export const SELF_ASSESSMENT_QUESTIONS_PATH = '/api/v1/resume/self-assessment/questions'
export const CURRENT_SELF_ASSESSMENT_CONSENT_VERSION = SELF_ASSESSMENT_CONSENT_VERSION

export function selfAssessmentQuestionsResponse() {
  return {
    version: SELF_ASSESSMENT_QUESTIONS_V1.version,
    dimensions: SELF_ASSESSMENT_QUESTIONS_V1.dimensions,
    consentVersion: SELF_ASSESSMENT_CONSENT_VERSION,
    consentItems: [...SELF_ASSESSMENT_CONSENT_ITEMS],
    consentLinks: SELF_ASSESSMENT_CONSENT_LINKS.map((link) => ({ ...link })),
    consentCheckboxLabel: SELF_ASSESSMENT_CONSENT_CHECKBOX_LABEL,
  }
}
