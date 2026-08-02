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
