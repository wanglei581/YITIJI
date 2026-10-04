// ============================================================
// AI 服务日志（旧表）的 operation 常量 —— 从 ai-services/index.tsx 拆出
//
// 使用方：index.tsx（AI 服务日志表）与 AiOperationCostTable.tsx（分能力成本表）。
// 与「AI 用量与额度」面板（aiUsageDisplay.ts）是两张表、两本账：
// 这边是 AiServiceLog 的 operation 维度，那边是 #1088 计量账的功能位维度。
// ============================================================

import type { AiOperation } from '../../services/api'

/** AI 服务日志 operation → 中文名（从 index.tsx 原样拆出，语义未动）。 */
export { AI_OPERATION_LABELS as OPERATION_LABELS } from '@ai-job-print/shared'

/**
 * 不按 token 计费的操作：ASR 按音频时长、TTS 按字符数。
 *
 * 后端对这些行不写 estimatedCostCny（保持 null），因为我们没有厂家确认的单价，
 * 编一个数字就是伪造成本。页面必须如实标注「按量计费 · 未估算」，
 * 绝不能因为聚合出来是 0 就显示成 ¥0.0000（那等于谎称免费）。
 * 后端真相源：services/api/src/ai/ai-log.service.ts NON_TOKEN_BILLED_OPERATIONS
 */
export const NON_TOKEN_BILLED_OPS: readonly AiOperation[] = ['voiceTranscribe', 'voiceSynthesize']

export const NON_TOKEN_BILLED_NOTE: Record<string, string> = {
  voiceTranscribe: '按音频时长计费',
  voiceSynthesize: '按字符数计费',
  // 注：selfAssessment 曾被误列在此。它是**按 token 计费**的付费 LLM 调用，
  // 本表只在 !row.tokenBilled 时才会被读到，所以那条目永远读不到，
  // 却会误导后来人以为它按量计费。已移除。
}
