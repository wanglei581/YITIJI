import type { ContractReviewOwnerShape, ContractReviewStatus } from './contract-review.types'

function frozenTransitions(
  ...statuses: ContractReviewStatus[]
): readonly ContractReviewStatus[] {
  return Object.freeze(statuses)
}

export const ALLOWED_TRANSITIONS: Readonly<
  Record<ContractReviewStatus, readonly ContractReviewStatus[]>
> = Object.freeze({
  uploaded: frozenTransitions('queued', 'cancelled', 'expired'),
  queued: frozenTransitions('extracting', 'cancelled', 'failed', 'expired'),
  extracting: frozenTransitions('awaiting_confirmation', 'failed', 'cancelled', 'expired'),
  awaiting_confirmation: frozenTransitions('rule_checking', 'cancelled', 'expired'),
  rule_checking: frozenTransitions('ai_analyzing', 'failed', 'cancelled', 'expired'),
  ai_analyzing: frozenTransitions('safety_reviewing', 'failed', 'cancelled', 'expired'),
  safety_reviewing: frozenTransitions('completed', 'failed', 'cancelled', 'expired'),
  completed: frozenTransitions('expired'),
  failed: frozenTransitions('expired'),
  cancelled: frozenTransitions('expired'),
  expired: frozenTransitions(),
})

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
