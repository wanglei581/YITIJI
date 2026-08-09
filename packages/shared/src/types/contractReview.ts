export const CONTRACT_REVIEW_STATUSES = [
  'uploaded',
  'queued',
  'extracting',
  'awaiting_confirmation',
  'rule_checking',
  'ai_analyzing',
  'safety_reviewing',
  'completed',
  'failed',
  'cancelled',
  'expired',
] as const

export type ContractReviewStatus = (typeof CONTRACT_REVIEW_STATUSES)[number]

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
  result: ContractReviewResult | null
}

/** 服务端生成的短期风险提示报告；只供既有打印闭环消费。 */
export interface ContractReviewReportView {
  fileId: string
  filename: string
  mimeType: 'application/pdf'
  sizeBytes: number
  pages: number
  expiresAt: string
  printFileUrl: string
  /** 仅允许放弃尚未建单的报告；不得作为合同任务访问凭证。 */
  abandonToken: string
  abandonTokenExpiresAt: string
}
