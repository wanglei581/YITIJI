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

/** Gate 0 已通过（2026-08-04 wanglei 自营签字），HTTP 端点注册至 AppModule。
 * 处理链必须同时具备 REDIS_URL 与 CONTRACT_REVIEW_API_KEY：
 *   - 均已配置：启用真实 DeepSeek/Qwen provider + BullMQ 队列
 *   - 任一缺失：fail-closed，任务不会进入未获准的模型分析
 *
 * @see docs/compliance/contract-review-release-gate.md
 */
@Module({
  imports: [ContractReviewModule, JwtVerifierModule, RedisModule],
  controllers: [ContractReviewController],
})
export class ContractReviewHttpModule {
  /** 隔离 HTTP 契约测试使用；AppModule 只导入上面的静态模块，不使用此覆盖绑定。 */
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
