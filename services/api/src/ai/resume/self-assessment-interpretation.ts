// ============================================================
// 自我探索 · 「AI 解读」这一半的可用性判定（打分与解读拆开）
//
// 维度打分是纯函数（固定权重记分，不经过模型）；只有 note / summary 是模型写的。
// AI 暂停 / 额度用完 / 未开通 / 声明缺失 / 登录档位拦下时，打分照常出，解读如实缺席，
// 并用 aiUnavailableReason 说清为什么（AI 是加速器不是前置条件）。
//
// 为什么单独成文件：self-assessment.service.ts 已到 500 行，判定口径（什么算「含 AI 解读」、
// 原因码怎么取）被提交、读回、打印、附加到简历、PDF 版式五处共用，只能有一份。
// ============================================================

import { HttpException } from '@nestjs/common'
import type { SelfAssessmentDimensionResult } from './self-assessment.types'

/** 解读缺席时的 providerName。一体机与小程序现网就按它显示「AI 解读缺失」，不能换名。 */
export const LLM_UNAVAILABLE_PROVIDER = 'llm_unavailable'

/** 解读缺席、但说不出具体原因时的兜底码（旧记录、解读全被合规过滤掉等）。 */
export const INTERPRETATION_UNAVAILABLE_CODE = 'AI_INTERPRETATION_UNAVAILABLE'

/** 模型回包解析不出解读时的码。 */
export const INTERPRETATION_UNPARSEABLE_CODE = 'AI_INTERPRETATION_UNPARSEABLE'

/** 问 AI 闸门时闸门自己出错（不是 HTTP 拒绝）：失败关闭，不调模型，打分照常。 */
export const AI_ACCESS_CHECK_FAILED_CODE = 'AI_ACCESS_CHECK_FAILED'

export interface SelfAssessmentInterpretationState {
  /** 本条结果里有没有模型写的解读（任一维 note 或整体 summary 非空）。 */
  interpretationAvailable: boolean
  /** interpretationAvailable=false 时必有值（错误码）；为 true 时恒为 null。 */
  aiUnavailableReason: string | null
}

/**
 * 控制器交给服务的两道 AI 闸门（同一个 AiAccessService.enforce，只是用法不同）：
 *   - interpretation：调模型前问一次；放行回 null，拦下回错误码（**不抛**，打分照常）；
 *   - aiContentExport：只在文件里要放 AI 解读时调；拦下**直接抛**，与改动前同一错误。
 * 没传 = 不拦（仅供单元测试直接调服务；HTTP 入口一律由控制器传入）。
 */
export interface SelfAssessmentAiGates {
  interpretation?: () => Promise<string | null>
  aiContentExport?: () => Promise<void>
}

export function hasAiInterpretation(
  dimensions: ReadonlyArray<Pick<SelfAssessmentDimensionResult, 'note'>>,
  summary: string | null | undefined,
): boolean {
  return Boolean(summary) || dimensions.some((d) => Boolean(d.note))
}

/** 内容说了算：有模型写的文字就是「有解读」，与当时记下的原因码无关。 */
export function interpretationStateOf(
  dimensions: ReadonlyArray<Pick<SelfAssessmentDimensionResult, 'note'>>,
  summary: string | null | undefined,
  reason?: string | null,
): SelfAssessmentInterpretationState {
  if (hasAiInterpretation(dimensions, summary)) return { interpretationAvailable: true, aiUnavailableReason: null }
  return { interpretationAvailable: false, aiUnavailableReason: reason || INTERPRETATION_UNAVAILABLE_CODE }
}

/** 取 Nest 异常体里的 error.code；取不到回 fallback。只取码，不取 message（不进库、不进审计）。 */
export function errorCodeOf(error: unknown, fallback: string): string {
  if (error instanceof HttpException) {
    const body = error.getResponse() as { error?: { code?: unknown } } | string
    const code = typeof body === 'object' ? body?.error?.code : undefined
    if (typeof code === 'string' && code.trim()) return code.trim()
  }
  return fallback
}

/** 跑一次闸门检查：放行回 null，拦下（或闸门自身出错）回错误码。 */
export async function aiGateRefusal(check: () => Promise<void>): Promise<string | null> {
  try {
    await check()
    return null
  } catch (error) {
    return errorCodeOf(error, AI_ACCESS_CHECK_FAILED_CODE)
  }
}
