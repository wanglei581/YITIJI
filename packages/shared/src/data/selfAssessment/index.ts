import questionsJson from './v1.questions.json' with { type: 'json' }
import type { SelfAssessmentQuestionsV1 } from '../../types/selfAssessment'

/** 题目 seed（v1）。版本化以备未来 v2 切换。 */
export const SELF_ASSESSMENT_QUESTIONS_V1 = questionsJson as SelfAssessmentQuestionsV1