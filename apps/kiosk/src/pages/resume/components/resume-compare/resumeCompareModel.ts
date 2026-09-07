import type { ResumeOptimizeModule } from '@ai-job-print/shared'
import { detectUnconfirmedTextAdditions } from '../resume-deliver/facts'
import { moduleKeyOf as decisionKeyOf, parseDecisionMap } from '../resume-deliver/resumeDecisions'

export type ResumeCompareDecision = 'original' | 'optimized'
export type ResumeCompareDecisions = Record<string, ResumeCompareDecision>

export interface ResumeCompareItem extends ResumeOptimizeModule {
  additions: string[]
}

/** 裁决键与优化页（resume-deliver/resumeDecisions.ts）同源，两页对同一模块写同一个键。 */
export const moduleKeyOf = (module: ResumeOptimizeModule | undefined, index: number): string =>
  module ? decisionKeyOf(module, index) : `m${index}`

export function initialDecisionsFrom(state: Record<string, unknown> | null): ResumeCompareDecisions {
  const raw = state && typeof state.decisions === 'object' && state.decisions ? (state.decisions as Record<string, unknown>) : undefined
  return parseDecisionMap(raw)
}

export function buildCompareItems(modules: ResumeOptimizeModule[]): ResumeCompareItem[] {
  return modules.map((module) => ({
    ...module,
    additions: detectUnconfirmedTextAdditions(module.after, module.before),
  }))
}

export function draftTextFor(
  item: ResumeCompareItem,
  index: number,
  decisions: ResumeCompareDecisions,
): { label: string; text: string } {
  const decision = decisions[moduleKeyOf(item, index)]
  if (decision === 'optimized') return { label: '用改写', text: item.after }
  if (decision === 'original') return { label: '保留原文', text: item.before }
  return { label: '待决定，草稿暂用原文', text: item.before }
}
