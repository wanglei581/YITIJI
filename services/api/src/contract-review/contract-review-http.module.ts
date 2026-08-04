import { Module, type DynamicModule } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { RedisModule } from '../common/redis/redis.module'
import { ContractReviewConsentService } from './contract-review-consent.service'
import { ContractReviewController } from './contract-review.controller'
import { ContractReviewLifecycleService } from './contract-review-lifecycle.service'
import { ContractReviewModule } from './contract-review.module'
import { ContractReviewQueueService } from './contract-review.queue'

export interface ContractReviewHttpVerificationOverrides {
  lifecycle: ContractReviewLifecycleService
  consent: ContractReviewConsentService
  queue: ContractReviewQueueService
}

/** Explicit Task 12 HTTP surface. It remains outside AppModule until all release gates pass. */
@Module({
  imports: [ContractReviewModule, JwtVerifierModule, RedisModule],
  controllers: [ContractReviewController],
})
export class ContractReviewHttpModule {
  /** Isolated harness binding; never imported by AppModule or selected by environment. */
  static forVerification(
    overrides: ContractReviewHttpVerificationOverrides,
  ): DynamicModule {
    return {
      module: ContractReviewHttpModule,
      providers: [
        { provide: ContractReviewLifecycleService, useValue: overrides.lifecycle },
        { provide: ContractReviewConsentService, useValue: overrides.consent },
        { provide: ContractReviewQueueService, useValue: overrides.queue },
      ],
    }
  }
}
