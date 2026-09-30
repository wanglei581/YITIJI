// ============================================================
// 自我探索结果页：AI 解读缺了没有、为什么缺 —— 纯逻辑（无 JSX、不碰网络）。
//
// 打分（维度强度 + 依据题号）是固定权重算的，任何情况下都照常显示；
// 这里只判「解读」这一半。优先读服务端的 interpretationAvailable / aiUnavailableReason
// （后端 #1112 起有），旧服务端没有这两个字段时才退回 providerName 与正文是否为空。
// 能力级停用码表由调用方传入（`ai/aiOutage.ts` 的 AI_OUTAGE_CODES），本文件不 import 运行时模块。
// ============================================================

import type { SelfAssessmentSubmitResponse } from '@ai-job-print/shared'

/**
 * none         有解读；
 * declaration  没做年满 14 周岁确认 —— 确认后重新作答可以有；
 * login        按规定要登录 —— 登录后重新作答可以有；
 * stopped      AI 停用 / 额度用完 / 未开通等 —— 重新作答也不会有，不提示重试；
 * rejected     模型整体合规拒答；
 * unavailable  这次没调通，重新作答可能就有。
 */
export type InterpretationGap = 'none' | 'declaration' | 'login' | 'stopped' | 'rejected' | 'unavailable'

type ResultLike = Pick<SelfAssessmentSubmitResponse, 'status' | 'summary' | 'providerName' | 'interpretationAvailable' | 'aiUnavailableReason'> & {
  dimensions?: ReadonlyArray<{ note: string | null }> | null
}

export function interpretationGap(result: ResultLike | null | undefined, outageCodes: ReadonlySet<string>): InterpretationGap {
  if (!result) return 'none'
  const hasText = Boolean(result.summary) || (Array.isArray(result.dimensions) && result.dimensions.some((d) => Boolean(d.note)))
  const missing = typeof result.interpretationAvailable === 'boolean' ? !result.interpretationAvailable : !hasText
  if (!missing && result.status !== 'rejected') return 'none'
  const reason = typeof result.aiUnavailableReason === 'string' ? result.aiUnavailableReason : null
  if (reason === 'AI_DECLARATION_REQUIRED') return 'declaration'
  if (reason === 'AI_LOGIN_REQUIRED') return 'login'
  if (reason && outageCodes.has(reason)) return 'stopped'
  if (reason === 'COMPLIANCE_REJECT' || result.status === 'rejected') return 'rejected'
  if (reason || result.providerName === 'llm_unavailable') return 'unavailable'
  return 'rejected'
}
