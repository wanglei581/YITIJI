import { Module } from '@nestjs/common'
import { AiModule } from '../ai/ai.module'
import { FilesModule } from '../files/files.module'
import { MemberPrivacyModule } from '../member-privacy/member-privacy.module'
import { PrismaModule } from '../prisma/prisma.module'
import { ContractReviewExtractionService } from './contract-review-extraction.service'
import { ContractReviewFactMerger } from './contract-review-fact-merger'
import { ContractReviewFindingMapper } from './contract-review-finding-mapper'
import {
  CONTRACT_REVIEW_PROVIDER_RUNTIME,
  ContractReviewOrchestratorService,
  type ContractReviewProviderRuntime,
} from './contract-review-orchestrator.service'
import { CONTRACT_REVIEW_ORCHESTRATOR } from './contract-review.processor'
import { ContractReviewQueueService } from './contract-review.queue'
import { ContractReviewRuleEngine } from './contract-review-rule-engine'
import { ContractReviewSafetyGate } from './contract-review-safety-gate.service'
import { ContractReviewService } from './contract-review.service'
import { ContractReviewCleanupTask } from './contract-review.cleanup.task'

export const CONTRACT_REVIEW_BLOCKED_PROVIDER_RUNTIME: ContractReviewProviderRuntime = Object.freeze({
  async reviewWithIdentity(): Promise<never> {
    throw new Error('CONTRACT_PROVIDER_NOT_APPROVED')
  },
})

/**
 * Task 11 default-closed module.
 *
 * It deliberately has no controller, BullMQ registration, processor, queue adapter, or real
 * provider. Task 14 may replace those bindings only after Gate 0 and execution isolation pass.
 */
@Module({
  imports: [PrismaModule, FilesModule, AiModule, MemberPrivacyModule],
  providers: [
    ContractReviewService,
    ContractReviewExtractionService,
    ContractReviewFactMerger,
    ContractReviewRuleEngine,
    ContractReviewFindingMapper,
    ContractReviewSafetyGate,
    ContractReviewQueueService,
    ContractReviewCleanupTask,
    ContractReviewOrchestratorService,
    { provide: CONTRACT_REVIEW_PROVIDER_RUNTIME, useValue: CONTRACT_REVIEW_BLOCKED_PROVIDER_RUNTIME },
    { provide: CONTRACT_REVIEW_ORCHESTRATOR, useExisting: ContractReviewOrchestratorService },
  ],
  exports: [ContractReviewService, ContractReviewQueueService],
})
export class ContractReviewModule {}
