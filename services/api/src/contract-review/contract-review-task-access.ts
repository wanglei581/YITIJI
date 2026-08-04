import { Injectable, NotFoundException } from '@nestjs/common'
import { verifyAnonymousAccessToken } from './contract-review-access'
import type { ContractReviewRequester, ContractReviewTaskOwnerRow } from './contract-review.types'

@Injectable()
export class ContractReviewTaskAccess {
  requireOwnedTask<T extends ContractReviewTaskOwnerRow>(
    task: T | null,
    requester: ContractReviewRequester,
  ): T {
    if (!task || requester.sourceFileProof !== null) throw taskNotFound()
    const memberOwned =
      typeof requester.endUserId === 'string' &&
      requester.endUserId.length > 0 &&
      requester.accessToken === null &&
      task.endUserId === requester.endUserId &&
      task.accessTokenHash === null
    const anonymousOwned =
      requester.endUserId === null &&
      task.endUserId === null &&
      verifyAnonymousAccessToken(requester.accessToken, task.accessTokenHash)
    if (!memberOwned && !anonymousOwned) throw taskNotFound()
    return task
  }
}

export function taskNotFound(): NotFoundException {
  return new NotFoundException({
    error: {
      code: 'CONTRACT_REVIEW_TASK_NOT_FOUND',
      message: '合同审查任务不存在',
    },
  })
}
