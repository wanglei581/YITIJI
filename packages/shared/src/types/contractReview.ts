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
  /**
   * 失败原因码，仅在 status==='failed' 时非 null。
   * 服务端 ContractReviewTask.errorCode 一直有写入，此前未随任务返回，
   * 客户端只能显示「服务端未说明原因」。
   * 只回传形如 CONTRACT_XXX 的稳定错误码（服务端按形状白名单过滤），
   * 不回传 errorMessage —— 后者可能含上游报文片段或合同内容（§11）。
   */
  errorCode?: string | null
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
