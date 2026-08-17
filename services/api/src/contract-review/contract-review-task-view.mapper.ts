import {
  contractReviewFailureReason,
  isKnownContractReviewFailureCode,
} from './contract-review-failure-reason'
import { parsePersistedContractReviewResult } from './contract-review-safety-gate.service'
import { contractReviewEtaSeconds } from './contract-review-timing'
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
    // 预计耗时由服务端算并下发，客户端不必再自己维护同一条公式
    // （小程序当前的 `_estimate(pages)` 与此逐字同源，见 contract-review-timing.ts）。
    // 页数取值顺序与小程序一致：analyzedPages → totalPages → 1。
    estimatedSeconds: contractReviewEtaSeconds(task.analyzedPages || task.totalPages || 1),
    ...failureOf(status, task.errorCode),
    result,
  }
}

/**
 * 失败原因。只在终态 `failed` 时给，其余状态一律 null ——
 * 处理中的任务带着上一次的错误码会让客户端误判。
 *
 * `failureCode` 只回白名单内的码；未登记的码不外泄（回 null），
 * 但 `failureReason` 仍给兜底文案，保证客户端永远有话可说。
 * 字段名 `failureReason` / `failureCode` 是小程序 `_poll()` 已经在读的两个键。
 */
function failureOf(
  status: ContractReviewStatus,
  errorCode: string | null | undefined,
): Pick<ContractReviewTaskView, 'failureCode' | 'failureReason'> {
  if (status !== 'failed') return { failureCode: null, failureReason: null }
  return {
    failureCode: isKnownContractReviewFailureCode(errorCode) ? errorCode : null,
    failureReason: contractReviewFailureReason(errorCode),
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
