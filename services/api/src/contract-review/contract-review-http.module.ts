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

/** Gate 0 已通过（2026-08-04 wanglei 自营签字），HTTP 端点已注册至 AppModule。
 * 功能开关由 CONTRACT_REVIEW_API_KEY 环境变量控制：
 *   - 已配置：启用真实 DeepSeek/Qwen provider + BullMQ 队列
 *   - 未配置：fail-closed，所有 AI 分析请求返回 CONTRACT_PROVIDER_NOT_APPROVED
 *
 * @see docs/compliance/contract-review-release-gate.md
 */
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
