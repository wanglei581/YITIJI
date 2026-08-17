// Runtime-local mirror of packages/shared/src/types/contractReview.ts. The API package is compiled
// as an isolated CommonJS root and intentionally does not import the frontend/shared ESM package.
export type ContractReviewStatus =
  | 'uploaded'
  | 'queued'
  | 'extracting'
  | 'awaiting_confirmation'
  | 'rule_checking'
  | 'ai_analyzing'
  | 'safety_reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'

export type ContractType = 'labor_contract' | 'internship_agreement' | 'non_compete' | 'offer'

export type ContractReviewPriority = 'priority_check' | 'attention' | 'insufficient_info'

export type ContractReviewCategory =
  | 'parties'
  | 'term'
  | 'probation'
  | 'compensation'
  | 'position_location'
  | 'working_time'
  | 'social_insurance'
  | 'training_service'
  | 'penalty'
  | 'non_compete'
  | 'deposit_documents'
  | 'termination'
  | 'imbalance'
  | 'offer_conditions'

export interface ContractReviewFinding {
  id: string
  category: ContractReviewCategory
  priority: ContractReviewPriority
  title: string
  evidence: {
    pageNumber: number | null
    excerpt: string
    charStart: number | null
    charEnd: number | null
  }
  explanation: string
  basisRef: string | null
  verificationQuestion: string
  uncertainty: string
  source: 'rule' | 'ai' | 'rule_and_ai'
}

export interface ContractReviewResult {
  priorityCheckCount: number
  attentionCount: number
  insufficientInfoCount: number
  coverage: 'complete' | 'truncated'
  ocrConfidence: 'high' | 'medium' | 'low'
  disclaimerVersion: string
  rulePackVersion: string
  generatedByAi: true
  findings: ContractReviewFinding[]
}

export interface ContractReviewRequester {
  endUserId: string | null
  accessToken: string | null
  /** Short-lived signed content URL presented only when creating an anonymous task. */
  sourceFileProof: string | null
}

export interface ContractReviewCreateInput {
  sourceFileId: string
  contractType: ContractType
  consentVersion: string
  consentedAt: string
  consentScopeHash: string
  disclaimerVersion: string
}

export interface ContractReviewOwnerShape {
  endUserId: string | null
  accessTokenHash: string | null
}

export interface ContractReviewSourceFile {
  id: string
  purpose: string
  status: string
  expiresAt: Date | null
  deletedAt: Date | null
  endUserId: string | null
  ownerType: string | null
  ownerId: string | null
}

export interface ContractReviewCreatedTask {
  id: string
  status: 'uploaded'
  expiresAt: string
  accessToken?: string
}

export const CONTRACT_REVIEW_CLOCK = Symbol('CONTRACT_REVIEW_CLOCK')

export interface ContractReviewClock {
  now(): number
}

export interface ContractReviewConfirmInput {
  contractType: ContractType
  totalPages: number
  analyzedPages: number
  truncated: boolean
  ocrCoverageConfirmed: true
  personalUseConfirmed: true
}

export interface ContractReviewTaskOwnerRow {
  endUserId: string | null
  accessTokenHash: string | null
}

export interface ContractReviewTaskRow extends ContractReviewTaskOwnerRow {
  id: string
  sourceFileId: string
  resultFileId: string | null
  contractType: string
  status: string
  analyzedPages: number
  totalPages: number | null
  truncated: boolean
  ocrConfidence: string | null
  expiresAt: Date
  resultJson: string | null
  extractionFingerprint: string | null
  confirmedAt: Date | null
  /** 失败时服务端写入的机器码；对外经白名单转成可读文案（见 failureReason）。 */
  errorCode?: string | null
}

export interface ContractReviewReportView {
  fileId: string
  filename: string
  mimeType: 'application/pdf'
  sizeBytes: number
  pages: number
  expiresAt: string
  printFileUrl: string
  abandonToken: string
  abandonTokenExpiresAt: string
}

export interface ContractReviewTaskView {
  id: string
  status: ContractReviewStatus
  contractType: ContractType
  analyzedPages: number
  totalPages: number | null
  truncated: boolean
  ocrConfidence: 'high' | 'medium' | 'low' | null
  expiresAt: string
  progress: {
    stage: ContractReviewStatus
    completedPages: number
    totalPages: number | null
  }
  /**
   * 服务端按页数算出的预计耗时（秒），与服务端自己的超时预算同源。
   * 客户端据此展示等待预期，不必再复刻公式。
   */
  estimatedSeconds: number
  /** 仅 status='failed' 时非空：白名单内的失败机器码，否则 null。 */
  failureCode: string | null
  /** 仅 status='failed' 时非空：可直接展示给用户的失败原因。 */
  failureReason: string | null
  result: ContractReviewResult | null
}
