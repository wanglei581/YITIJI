/**
 * 全站共享 AI 前端原语（接线矩阵 §四 S1-1 / S1-2）。
 * 后续 17 个待接线页面一律从这里取，不再各页自写四态与免责文案。
 */
export {
  deriveAiTaskState,
  useAiTask,
  type AiAvailability,
  type AiTaskBlockReason,
  type AiTaskSource,
  type AiTaskState,
  type AiTaskStatus,
} from './useAiTask'

export {
  AiTaskRegion,
  type AiTaskFallback,
  type AiTaskFallbackBlocked,
  type AiTaskFallbackManual,
  type AiTaskFallbackResultUnavailable,
  type AiTaskRegionProps,
} from './AiTaskRegion'

export {
  AI_OUTAGE_CODES,
  aiErrorCodeOf,
  aiErrorMessageOf,
  deriveAiAvailability,
  isAiOutage,
} from './aiOutage'

export {
  AI_JUDGEMENT_DISCLAIMER,
  AI_JUDGEMENT_TEXT,
  AIGC_MARK_TEXT,
  AiCapabilityChip,
  AiConclusion,
  AiDisclaimerLine,
  AigcMark,
  EVIDENCE_LABEL,
  EvidenceBadge,
  EvidenceLegend,
  FORBIDDEN_E3_CLAIM_PATTERNS,
  hasForbiddenE3Claim,
  type AiCapabilityTone,
  type EvidenceLevel,
} from './AiEvidence'
