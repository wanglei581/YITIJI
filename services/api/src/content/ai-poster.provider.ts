// ============================================================
// AI 文生图海报 Provider 抽象(二期能力,一期默认 disabled)。
//
// 设计口径(用户锁定范围):
//   - 一期预留接口/Provider 抽象,但不接真实外部 AI 费用接口
//   - 默认 AI_IMAGE_PROVIDER=disabled
//   - disabled 时所有调用返回明确错误,不假装成功
//   - 二期接入真实供应商(通义万相 / 智谱 CogView 等)时实现新的 Provider,
//     生成结果先进草稿/待确认,管理员确认后才写入 AdAsset 素材库
// ============================================================

export interface AiPosterGenerateInput {
  prompt: string
  /** 目标尺寸,例 '1080x1920'(竖屏一体机) */
  size?: string
}

export interface AiPosterGenerationResult {
  generationId: string
  status: 'pending' | 'succeeded' | 'failed'
  /** 生成成功后的临时预览 URL(草稿态,未入素材库) */
  imageUrl?: string
  failReason?: string
}

export interface AiPosterProvider {
  readonly name: string
  readonly enabled: boolean
  generate(input: AiPosterGenerateInput): Promise<AiPosterGenerationResult>
  get(generationId: string): Promise<AiPosterGenerationResult | null>
}

/**
 * 一期默认 Provider:全部 disabled。
 * 所有方法抛错;真正的"未启用"判定在 AiPosterService 统一处理(返回 400)。
 */
export class DisabledAiPosterProvider implements AiPosterProvider {
  readonly name = 'disabled'
  readonly enabled = false

  async generate(): Promise<AiPosterGenerationResult> {
    throw new Error('AI poster generation is not enabled')
  }

  async get(): Promise<AiPosterGenerationResult | null> {
    throw new Error('AI poster generation is not enabled')
  }
}
