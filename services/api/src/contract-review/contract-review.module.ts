import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { AiModule } from '../ai/ai.module'
import { FilesModule } from '../files/files.module'
import { MemberPrivacyModule } from '../member-privacy/member-privacy.module'
import { PrismaModule } from '../prisma/prisma.module'
import { ContractReviewBullMqAdapter } from './contract-review-bullmq-adapter'
import { ContractReviewConsentService } from './contract-review-consent.service'
import { ContractReviewExtractionService } from './contract-review-extraction.service'
import { ContractReviewFactMerger } from './contract-review-fact-merger'
import { ContractReviewFindingMapper } from './contract-review-finding-mapper'
import { ContractReviewLifecycleService } from './contract-review-lifecycle.service'
import {
  CONTRACT_REVIEW_PROVIDER_RUNTIME,
  ContractReviewOrchestratorService,
  type ContractReviewProviderRuntime,
} from './contract-review-orchestrator.service'
import {
  ContractReviewProviderService,
  type ContractProviderApprovalGate,
  type ContractProviderIdentity,
} from './contract-review-provider.service'
import {
  CONTRACT_REVIEW_ORCHESTRATOR,
  ContractReviewProcessor,
} from './contract-review.processor'
import {
  CONTRACT_REVIEW_QUEUE,
  CONTRACT_REVIEW_QUEUE_ADAPTER,
  ContractReviewQueueService,
} from './contract-review.queue'
import { ContractReviewRuleEngine } from './contract-review-rule-engine'
import { ContractReviewSafetyGate } from './contract-review-safety-gate.service'
import { ContractReviewService } from './contract-review.service'
import { ContractReviewTaskAccess } from './contract-review-task-access'
import { ContractReviewCleanupTask } from './contract-review.cleanup.task'

export const CONTRACT_REVIEW_BLOCKED_PROVIDER_RUNTIME: ContractReviewProviderRuntime = Object.freeze({
  async reviewWithIdentity(): Promise<never> {
    throw new Error('CONTRACT_PROVIDER_NOT_APPROVED')
  },
})

// ── 条件开关 ──────────────────────────────────────────────────────────────────
// 两个条件都满足时才启用真实 AI + BullMQ 处理链：
//   1. REDIS_URL 已配置（BullMQ 依赖 Redis）
//   2. CONTRACT_REVIEW_API_KEY 已配置（真实 AI 调用凭证）
const redisUrl = process.env['REDIS_URL']
const contractApiKey = process.env['CONTRACT_REVIEW_API_KEY']
const realProviderEnabled = Boolean(redisUrl && contractApiKey && contractApiKey.length >= 16)

// 允许的境内 provider 白名单（Gate 0 provider_allowlist 检查项对应实现）
const APPROVED_PROVIDERS = Object.freeze(new Set(['deepseek', 'qwen']))

const SELF_OPERATOR_APPROVAL_GATE: ContractProviderApprovalGate = Object.freeze({
  assertApproved(identity: ContractProviderIdentity) {
    if (!APPROVED_PROVIDERS.has(identity.provider)) {
      throw new Error('CONTRACT_PROVIDER_NOT_APPROVED')
    }
  },
})

function makeProviderRuntime(): ContractReviewProviderRuntime {
  if (!realProviderEnabled) return CONTRACT_REVIEW_BLOCKED_PROVIDER_RUNTIME
  try {
    return new ContractReviewProviderService({
      env: () => process.env as Record<string, string>,
      approvalGate: SELF_OPERATOR_APPROVAL_GATE,
    })
  } catch (err) {
    // fail-closed：回退到 blocked runtime，但必须记录错误以便运营排查
    // （区分"未配置 key"和"key 格式错误/provider 初始化失败"两种情形）。
    console.error('[ContractReviewModule] Provider init failed, falling back to blocked runtime:', err)
    return CONTRACT_REVIEW_BLOCKED_PROVIDER_RUNTIME
  }
}

@Module({
  imports: [
    PrismaModule,
    FilesModule,
    AiModule,
    MemberPrivacyModule,
    // BullMQ 队列只在 Redis + API Key 均就绪时注册，否则 QueueService 保持
    // @Optional() 空适配器（调用时抛 CONTRACT_REVIEW_QUEUE_UNAVAILABLE）。
    ...(realProviderEnabled ? [BullModule.registerQueue({ name: CONTRACT_REVIEW_QUEUE })] : []),
  ],
  providers: [
    ContractReviewService,
    ContractReviewConsentService,
    ContractReviewTaskAccess,
    ContractReviewLifecycleService,
    ContractReviewExtractionService,
    ContractReviewFactMerger,
    ContractReviewRuleEngine,
    ContractReviewFindingMapper,
    ContractReviewSafetyGate,
    ContractReviewQueueService,
    ContractReviewCleanupTask,
    ContractReviewOrchestratorService,
    { provide: CONTRACT_REVIEW_PROVIDER_RUNTIME, useFactory: makeProviderRuntime },
    { provide: CONTRACT_REVIEW_ORCHESTRATOR, useExisting: ContractReviewOrchestratorService },
    // BullMQ 适配器和 Processor 同样条件展开
    ...(realProviderEnabled
      ? [
          ContractReviewBullMqAdapter,
          { provide: CONTRACT_REVIEW_QUEUE_ADAPTER, useExisting: ContractReviewBullMqAdapter },
          ContractReviewProcessor,
        ]
      : []),
  ],
  exports: [ContractReviewLifecycleService, ContractReviewConsentService, ContractReviewQueueService],
})
export class ContractReviewModule {}
