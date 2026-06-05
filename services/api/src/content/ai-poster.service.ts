import { BadRequestException, Injectable, Logger } from '@nestjs/common'
// Logger 仅在 resolveProvider 静态方法里按需实例化(降级告警),无需实例字段。
import {
  DisabledAiPosterProvider,
  type AiPosterGenerateInput,
  type AiPosterGenerationResult,
  type AiPosterProvider,
} from './ai-poster.provider'
import type { AiPosterStatusView } from './content.types'

/**
 * AI 文生图海报服务(二期能力,一期 stub)。
 *
 * provider 由 env AI_IMAGE_PROVIDER 决定:
 *   - 'disabled'(默认)或未知值 → DisabledAiPosterProvider,所有生成调用返回 400
 *   - 二期接真实供应商时在此注册并返回对应 Provider
 *
 * "未启用"是唯一的服务端真相:任何生成/查询/确认调用都先过 ensureEnabled()。
 */
@Injectable()
export class AiPosterService {
  private readonly provider: AiPosterProvider

  constructor() {
    this.provider = AiPosterService.resolveProvider()
  }

  private static resolveProvider(): AiPosterProvider {
    const name = (process.env['AI_IMAGE_PROVIDER'] ?? 'disabled').trim().toLowerCase()
    switch (name) {
      case 'disabled':
      case '':
        return new DisabledAiPosterProvider()
      default:
        // 二期才会有真实 provider;现在任何非 disabled 取值都没有实现,
        // 安全降级为 disabled 并告警,绝不静默"假装可用"。
        new Logger(AiPosterService.name).warn(
          `AI_IMAGE_PROVIDER="${name}" 暂无实现(二期能力),已降级为 disabled。`,
        )
        return new DisabledAiPosterProvider()
    }
  }

  status(): AiPosterStatusView {
    const raw = process.env['AI_IMAGE_DAILY_LIMIT']
    const dailyLimit = raw && Number.isFinite(Number(raw)) ? Number(raw) : null
    return {
      enabled: this.provider.enabled,
      provider: this.provider.name,
      dailyLimit,
    }
  }

  async generate(input: AiPosterGenerateInput): Promise<AiPosterGenerationResult> {
    this.ensureEnabled()
    return this.provider.generate(input)
  }

  async get(generationId: string): Promise<AiPosterGenerationResult | null> {
    this.ensureEnabled()
    return this.provider.get(generationId)
  }

  /** 把草稿生成确认为正式素材(二期实现:写入 AdAsset,source='ai_generated')。 */
  async accept(_generationId: string): Promise<never> {
    this.ensureEnabled()
    // provider.enabled=true 的二期实现里才会走到这里;一期不可达。
    throw new BadRequestException({
      error: { code: 'AI_POSTER_NOT_ENABLED', message: 'AI poster generation is not enabled' },
    })
  }

  private ensureEnabled(): void {
    if (!this.provider.enabled) {
      throw new BadRequestException({
        error: { code: 'AI_POSTER_NOT_ENABLED', message: 'AI poster generation is not enabled' },
      })
    }
  }
}
