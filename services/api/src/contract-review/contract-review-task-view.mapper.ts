import { parsePersistedContractReviewResult } from './contract-review-safety-gate.service'
import type {
  ContractReviewResult,
  ContractReviewStatus,
  ContractReviewTaskRow,
  ContractReviewTaskView,
  ContractType,
} from './contract-review.types'

const STATUSES = new Set<ContractReviewStatus>([
  'uploaded', 'queued', 'extracting', 'awaiting_confirmation', 'rule_checking',
  'ai_analyzing', 'safety_reviewing', 'completed', 'failed', 'cancelled', 'expired',
])
const CONTRACT_TYPES = new Set<ContractType>([
  'labor_contract', 'internship_agreement', 'non_compete', 'offer',
])
const OCR_CONFIDENCE = new Set(['high', 'medium', 'low'])

export function mapContractReviewTaskView(task: ContractReviewTaskRow): ContractReviewTaskView {
  const status = statusOf(task.status)
  const result = status === 'completed' ? parseResultJson(task.resultJson) : null
  if (!CONTRACT_TYPES.has(task.contractType as ContractType)) invalidResult()
  if (!Number.isSafeInteger(task.analyzedPages) || task.analyzedPages < 0) invalidResult()
  if (
    task.totalPages !== null &&
    (!Number.isSafeInteger(task.totalPages) || task.totalPages < 1 || task.totalPages > 50)
  ) {
    invalidResult()
  }
  if (task.totalPages !== null && task.analyzedPages > task.totalPages) invalidResult()
  if (typeof task.truncated !== 'boolean') invalidResult()
  if (!(task.expiresAt instanceof Date) || !Number.isFinite(task.expiresAt.getTime())) invalidResult()
  const ocrConfidence = task.ocrConfidence === null
    ? null
    : OCR_CONFIDENCE.has(task.ocrConfidence)
      ? task.ocrConfidence as 'high' | 'medium' | 'low'
      : invalidResult()
  return {
    id: task.id,
    status,
    contractType: task.contractType as ContractType,
    analyzedPages: task.analyzedPages,
    totalPages: task.totalPages,
    truncated: task.truncated,
    ocrConfidence,
    expiresAt: task.expiresAt.toISOString(),
    progress: {
      stage: status,
      completedPages: task.analyzedPages,
      totalPages: task.totalPages,
    },
    result,
  }
}

function statusOf(value: string): ContractReviewStatus {
  if (!STATUSES.has(value as ContractReviewStatus)) invalidResult()
  return value as ContractReviewStatus
}

function parseResultJson(value: string | null): ContractReviewResult {
  if (typeof value !== 'string') invalidResult()
  try {
    return parsePersistedContractReviewResult(JSON.parse(value))
  } catch {
    return invalidResult()
  }
}

function invalidResult(): never {
  throw new Error('CONTRACT_REVIEW_RESULT_INVALID')
}
