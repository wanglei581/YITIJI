// ============================================================
// advisorProvider — P25「这段回答到底是不是 AI 生成的」唯一判定处
//
// 背景（接线矩阵 §1.5 风险 R1 / §四 S0-1）：
// `/assistant/chat` 是全站唯一可能回落到 mock 预置话术的 AI 路径 ——
// `ai.service.ts:761-766` 在 `assistant_chat` 未就绪时走
// `provider.chatAssistant()`，而 `mock.provider.ts:154-178` 有 5 段写死的话术。
// 那些话术**看起来完全像 AI 回答**。若前端照单全收地渲染，P25 就是一个
// 会说话的假 AI，直接踩 CLAUDE.md §9「不伪造能力」。
//
// 服务端（#617）已把判定结果算好并透出：
//   providerLabel = `llm:<vendor>`（真实大模型） 或 provider 名（mock/stub）
//   aiGenerated   = providerLabel.startsWith('llm:')
//
// 本文件是前端侧的唯一判定入口，禁止在页面里另写一份前缀判断。
// ============================================================

import type { AssistantChatResponse } from '@ai-job-print/shared'

/** 服务端约定的真实大模型前缀（`ai-provider.interface.ts:329`）。 */
export const LLM_PROVIDER_PREFIX = 'llm:'

/**
 * 这条回复能不能当作「AI 生成的回答」呈现。
 *
 * 判定刻意是**双重**的：`aiGenerated === true` **且** `providerLabel` 带 `llm:` 前缀。
 * 服务端两者恒定一致，所以双重判定不会误杀真回答；但如果哪天有人手写了一个
 * 只设 `aiGenerated: true` 却拿不出模型标识的响应，这里仍然拦得住。
 *
 * 字段缺失一律判 false（fail-closed）—— 旧版本后端与本地 mock adapter 都不带这两个
 * 字段，把「没说」当成「是真的」正是 R1 要防的那种错。
 */
export function isAiGeneratedReply(
  response: Pick<AssistantChatResponse, 'providerLabel' | 'aiGenerated'>,
): boolean {
  return response.aiGenerated === true && (response.providerLabel?.startsWith(LLM_PROVIDER_PREFIX) ?? false)
}

/** 服务标识的用户可读形式。缺字段时如实说「未标注」，不猜。 */
export function describeProviderLabel(providerLabel?: string): string {
  return providerLabel?.trim() ? providerLabel : '未标注'
}

/**
 * 非 AI 回复时展示给用户的说明。
 *
 * 关键点：这段文案**取代**了模型回复正文的位置 —— 后端返回的那段预置话术
 * 根本不进 UI，也不进 React state。不是「加个免责声明照样展示」，
 * 而是「不展示」。
 */
export function buildNonAiNotice(providerLabel?: string): string {
  return (
    `本机 AI 顾问还没有接上真实模型（当前服务标识：${describeProviderLabel(providerLabel)}）。`
    + '后端返回的是未接模型时的预置话术，页面不会拿它冒充小青的回答，所以正文不予展示。'
  )
}
