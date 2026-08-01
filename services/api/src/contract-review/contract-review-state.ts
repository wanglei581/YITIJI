import type { ContractReviewOwnerShape, ContractReviewStatus } from './contract-review.types'

export const ALLOWED_TRANSITIONS: Readonly<
  Record<ContractReviewStatus, readonly ContractReviewStatus[]>
> = {
  uploaded: ['queued', 'cancelled', 'expired'],
  queued: ['extracting', 'cancelled', 'failed', 'expired'],
  extracting: ['awaiting_confirmation', 'failed', 'cancelled', 'expired'],
  awaiting_confirmation: ['rule_checking', 'cancelled', 'expired'],
  rule_checking: ['ai_analyzing', 'failed', 'cancelled', 'expired'],
  ai_analyzing: ['safety_reviewing', 'failed', 'cancelled', 'expired'],
  safety_reviewing: ['completed', 'failed', 'cancelled', 'expired'],
  completed: ['expired'],
  failed: ['expired'],
  cancelled: ['expired'],
  expired: [],
}

export function assertTransition(from: ContractReviewStatus, to: ContractReviewStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from]
  if (!Array.isArray(allowed) || !allowed.includes(to)) {
    throw new Error(`CONTRACT_REVIEW_INVALID_TRANSITION:${from}:${to}`)
  }
}

export function assertOwnerShape(owner: ContractReviewOwnerShape): void {
  const validMember =
    typeof owner.endUserId === 'string' &&
    owner.endUserId.length > 0 &&
    owner.accessTokenHash === null
  const validAnonymous =
    owner.endUserId === null &&
    typeof owner.accessTokenHash === 'string' &&
    /^[a-f0-9]{64}$/.test(owner.accessTokenHash)
  if (validMember === validAnonymous) {
    throw new Error('CONTRACT_REVIEW_OWNER_INVALID')
  }
}
