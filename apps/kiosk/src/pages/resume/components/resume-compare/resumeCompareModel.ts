import type { ResumeOptimizeModule } from '@ai-job-print/shared'
import { detectUnconfirmedTextAdditions } from '../resume-deliver/facts'

export type ResumeCompareDecision = 'original' | 'optimized'
export type ResumeCompareDecisions = Record<string, ResumeCompareDecision>

export interface ResumeCompareItem extends ResumeOptimizeModule {
  additions: string[]
}

export const moduleKeyOf = (index: number) => `module-${index + 1}`

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
  const decision = decisions[moduleKeyOf(index)]
  if (decision === 'optimized') return { label: '用改写', text: item.after }
  if (decision === 'original') return { label: '保留原文', text: item.before }
  return { label: '待决定，草稿暂用原文', text: item.before }
}
