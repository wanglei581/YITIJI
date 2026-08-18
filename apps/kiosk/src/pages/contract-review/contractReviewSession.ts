import type {
  ContractReviewResult,
  ContractReviewTaskView,
  ContractType,
} from '@ai-job-print/shared'

export interface ContractReviewSession {
  taskId: string
  accessToken: string | null
  contractType: ContractType
  expiresAt: string
  result: ContractReviewResult | null
  ownerMemberId: string | null
}

let activeSession: ContractReviewSession | null = null

function freezeSession(session: ContractReviewSession): ContractReviewSession {
  return Object.freeze({ ...session })
}

function isValidExpiry(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function startContractReviewSession(input: {
  taskId: string
  accessToken?: string | null
  contractType: ContractType
  expiresAt: string
  ownerMemberId: string | null
}): ContractReviewSession {
  if (!input.taskId.trim() || !isValidExpiry(input.expiresAt)) {
    throw new Error('CONTRACT_REVIEW_SESSION_INVALID')
  }
  activeSession = freezeSession({
    taskId: input.taskId,
    accessToken: input.accessToken?.trim() || null,
    contractType: input.contractType,
    expiresAt: input.expiresAt,
    result: null,
    ownerMemberId: input.ownerMemberId,
  })
  return activeSession
}

export function readContractReviewSession(
  currentMemberId: string | null,
): ContractReviewSession | null {
  if (!activeSession) return null
  if (activeSession.ownerMemberId !== currentMemberId) {
    activeSession = null
    return null
  }
  return activeSession
}

export function updateContractReviewSession(
  task: ContractReviewTaskView,
): ContractReviewSession | null {
  if (!activeSession || activeSession.taskId !== task.id || !isValidExpiry(task.expiresAt)) {
    return null
  }
  activeSession = freezeSession({
    ...activeSession,
    contractType: task.contractType,
    expiresAt: task.expiresAt,
    result: task.result ?? activeSession.result,
  })
  return activeSession
}

export function clearContractReviewSession(): void {
  activeSession = null
}

/** 是否存在进行中的合同审查会话（内存态，供「清场是否为空操作」判定使用）。 */
export function hasContractReviewSession(): boolean {
  return activeSession !== null
}
