import type { GeneratedResume, ResumeOptimizeModule } from '@ai-job-print/shared'
import { detectUnconfirmedTextAdditions } from '../resume-deliver/facts'
import {
  isNoActionModule,
  moduleBaseState,
  moduleKeyOf as decisionKeyOf,
  moduleSwitchBlock,
  type ResumeModuleDecision,
} from '../resume-deliver/resumeDecisions'

export type ResumeCompareDecision = 'original' | 'optimized' | 'custom'
export type ResumeCompareDecisions = Record<string, ResumeCompareDecision>

export interface ResumeCompareItem extends ResumeOptimizeModule {
  additions: string[]
  /** 在优化结果 modules 里的原序号。过滤无需操作条目后，裁决键仍用它，不用可见位置。 */
  sourceIndex: number
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
  return modules.map((module, sourceIndex) => ({
    ...module,
    sourceIndex,
    additions: detectUnconfirmedTextAdditions(module.after, module.before),
  }))
}

/** 对照页逐条看时跳过的条目：K 类说明条和同文条目。序号是原 modules 下标。 */
export function visibleCompareIndices(modules: ResumeOptimizeModule[]): number[] {
  return modules.flatMap((module, index) => (isNoActionModule(module) ? [] : [index]))
}

/**
 * 总览带来的 focusIndex 是原条目序号。
 * 正好是可见条目就停在它；若指到无需操作条目，停在它之后的第一条可见条目，后面没有就停在最后一条。
 * 返回值是可见列表里的位置，不是原序号。
 */
export function focusToVisiblePosition(modules: ResumeOptimizeModule[], focusIndex: number): number {
  const visible = visibleCompareIndices(modules)
  if (visible.length === 0) return 0
  const exact = visible.indexOf(focusIndex)
  if (exact >= 0) return exact
  const later = visible.findIndex((index) => index >= focusIndex)
  return later >= 0 ? later : visible.length - 1
}

function sourceIndexOf(item: ResumeCompareItem, fallback: number): number {
  return typeof item.sourceIndex === 'number' ? item.sourceIndex : fallback
}

/**
 * 这一条在对照页换不上：D 类、原文为空的新增句、以及未确认之外的非 C 类阻断。
 * C 类确认后可以切换，不算换不上。没有基准稿时，非 K 条目按可以切换处理。
 */
export function isManualCompareItem(
  module: ResumeOptimizeModule,
  decision: string | undefined,
  base?: GeneratedResume | null,
): boolean {
  if (isNoActionModule(module)) return false
  if (moduleBaseState(base, module).kind === 'C') return false
  const moduleDecision: ResumeModuleDecision | undefined = decision === 'original' || decision === 'optimized' ? decision : undefined
  return moduleSwitchBlock(base, module, moduleDecision) !== null
}

/** 带回总览的裁决里不为无需操作条目写任何选择。 */
export function decisionsWithoutNoAction(
  modules: ResumeOptimizeModule[],
  decisions: ResumeCompareDecisions,
): ResumeCompareDecisions {
  const next: ResumeCompareDecisions = {}
  for (const [key, value] of Object.entries(decisions)) {
    const index = modules.findIndex((module, i) => moduleKeyOf(module, i) === key)
    if (index >= 0 && isNoActionModule(modules[index])) continue
    next[key] = value
  }
  return next
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
  const decision = decisions[moduleKeyOf(item, sourceIndexOf(item, index))]
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
  base?: GeneratedResume | null,
): { next: ResumeCompareDecisions; adopted: number; skipped: number } {
  const next = { ...current }
  let adopted = 0
  let skipped = 0
  items.forEach((item, index) => {
    const key = moduleKeyOf(item, sourceIndexOf(item, index))
    if (isNoActionModule(item)) return
    const pending = pendingFacts(item.additions, confirmedByModule[key] ?? []).length > 0
    if (pending || isManualCompareItem(item, current[key], base)) {
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
  base?: GeneratedResume | null,
): { next: ResumeCompareDecisions; count: number } {
  const next = { ...current }
  let count = 0
  items.forEach((item, index) => {
    const key = moduleKeyOf(item, sourceIndexOf(item, index))
    if (isNoActionModule(item) || isManualCompareItem(item, current[key], base)) return
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
    const decision = decisions[moduleKeyOf(item, sourceIndexOf(item, index))]
    if (decision === 'optimized') adopt += 1
    else if (decision === 'original') keep += 1
    else if (decision === 'custom') custom += 1
    else todo += 1
  })
  return { adopt, keep, custom, todo, total: items.length, decided: items.length - todo }
}
