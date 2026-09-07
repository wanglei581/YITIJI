import type { ResumeOptimizeModule } from '@ai-job-print/shared'
import { detectUnconfirmedTextAdditions } from '../resume-deliver/facts'
import { moduleKeyOf as decisionKeyOf } from '../resume-deliver/resumeDecisions'

export type ResumeCompareDecision = 'original' | 'optimized' | 'custom'
export type ResumeCompareDecisions = Record<string, ResumeCompareDecision>

export interface ResumeCompareItem extends ResumeOptimizeModule {
  additions: string[]
}

export interface ResumeDraftLine {
  label: string
  text: string
  reason?: string
}

/** 裁决键与优化页（resume-deliver/resumeDecisions.ts）同源，两页对同一模块写同一个键。 */
export const moduleKeyOf = (module: ResumeOptimizeModule | undefined, index: number): string =>
  module ? decisionKeyOf(module, index) : `m${index}`

export function parseCompareDecisionMap(raw: Record<string, unknown> | undefined): ResumeCompareDecisions {
  if (!raw) return {}
  const next: ResumeCompareDecisions = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === 'original' || value === 'optimized' || value === 'custom') next[key] = value
  }
  return next
}

export function initialDecisionsFrom(state: Record<string, unknown> | null): ResumeCompareDecisions {
  const raw = state && typeof state.decisions === 'object' && state.decisions ? (state.decisions as Record<string, unknown>) : undefined
  return parseCompareDecisionMap(raw)
}

export function buildCompareItems(modules: ResumeOptimizeModule[]): ResumeCompareItem[] {
  return modules.map((module) => ({
    ...module,
    additions: detectUnconfirmedTextAdditions(module.after, module.before),
  }))
}

function pendingFacts(additions: string[], confirmed: string[]): string[] {
  const ok = new Set(confirmed)
  return additions.filter((item) => !ok.has(item))
}

function blockedDraft(item: ResumeCompareItem, pending: string[]): ResumeDraftLine {
  return {
    label: '待定',
    text: item.before,
    reason: `这一条还有 ${pending.length} 处事实没确认（${pending.join('、')}），所以草稿里用的是原文，不是那一版改写。`,
  }
}

export function draftTextFor(
  item: ResumeCompareItem,
  index: number,
  decisions: ResumeCompareDecisions,
  confirmed: string[] = [],
  customText?: string,
): ResumeDraftLine {
  const decision = decisions[moduleKeyOf(item, index)]
  if (decision === 'optimized') {
    const pending = pendingFacts(item.additions, confirmed)
    if (pending.length > 0) return blockedDraft(item, pending)
    return { label: '已采纳', text: item.after }
  }
  if (decision === 'original') return { label: '保留原文', text: item.before }
  if (decision === 'custom') {
    const text = customText?.trim() || item.before
    const pending = pendingFacts(detectUnconfirmedTextAdditions(text, item.before), confirmed)
    if (pending.length > 0) return blockedDraft(item, pending)
    return { label: '自己写', text }
  }
  return { label: '待定', text: item.before }
}

export function adoptEligible(
  items: ResumeCompareItem[],
  confirmedByModule: Record<string, string[]>,
  current: ResumeCompareDecisions,
): { next: ResumeCompareDecisions; adopted: number; skipped: number } {
  const next = { ...current }
  let adopted = 0
  let skipped = 0
  items.forEach((item, index) => {
    const key = moduleKeyOf(item, index)
    if (pendingFacts(item.additions, confirmedByModule[key] ?? []).length > 0) {
      skipped += 1
      return
    }
    if (next[key] !== 'optimized') {
      next[key] = 'optimized'
      adopted += 1
    }
  })
  return { next, adopted, skipped }
}

export function keepUndecided(
  items: ResumeCompareItem[],
  current: ResumeCompareDecisions,
): { next: ResumeCompareDecisions; count: number } {
  const next = { ...current }
  let count = 0
  items.forEach((item, index) => {
    const key = moduleKeyOf(item, index)
    if (!next[key]) {
      next[key] = 'original'
      count += 1
    }
  })
  return { next, count }
}

export function decisionStats(items: ResumeCompareItem[], decisions: ResumeCompareDecisions) {
  let adopt = 0
  let keep = 0
  let custom = 0
  let todo = 0
  items.forEach((item, index) => {
    const decision = decisions[moduleKeyOf(item, index)]
    if (decision === 'optimized') adopt += 1
    else if (decision === 'original') keep += 1
    else if (decision === 'custom') custom += 1
    else todo += 1
  })
  return { adopt, keep, custom, todo, total: items.length, decided: items.length - todo }
}
