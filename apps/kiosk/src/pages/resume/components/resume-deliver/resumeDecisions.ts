import type { GeneratedResume, ResumeOptimizeModule } from '@ai-job-print/shared'
import { detectUnconfirmedTextAdditions } from './facts'

export type ResumeModuleDecision = 'original' | 'optimized'
export type ResumeDecisionMap = Record<string, ResumeModuleDecision>
export type ResumeDecisionFailureReason = 'original-empty' | 'edited' | 'not-found'
/** 按基准稿就能判定、与编辑区无关的「切换不了」原因。 */
export type ResumeSwitchBlock = Extract<ResumeDecisionFailureReason, 'not-found' | 'original-empty'>
export type ResumeDecisionFailure = { key: string; reason: ResumeDecisionFailureReason }
export type ResumeTextReplacement = { resume: GeneratedResume; applied: boolean }

/** 覆盖补回条目的固定说明句。任何选择都不得把原文换成这一句。 */
const KEEP_ORIGINAL_NOTE = '这一段没有改动，保留原文'

export type ResumeModuleBaseKind = 'K' | 'A' | 'B' | 'C' | 'D' | 'unloaded'

export interface ResumeModuleBaseState {
  kind: ResumeModuleBaseKind
  defaultDecision: ResumeModuleDecision
}

export function moduleKeyOf(module: ResumeOptimizeModule, index: number): string {
  const title = module.title.trim()
  return title ? `m${index}:${title}` : `m${index}`
}

export function parseDecisionMap(raw: Record<string, unknown> | undefined): ResumeDecisionMap {
  if (!raw) return {}
  const next: ResumeDecisionMap = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === 'original' || value === 'optimized') next[key] = value
  }
  return next
}

export function replaceResumeTextWithStatus(resume: GeneratedResume, from: string, to: string): ResumeTextReplacement {
  if (!from || from === to) return { resume, applied: false }
  let replaced = false
  const walk = (value: unknown): unknown => {
    if (replaced) return value
    if (typeof value === 'string') {
      const index = value.indexOf(from)
      if (index === -1) return value
      replaced = true
      return value.slice(0, index) + to + value.slice(index + from.length)
    }
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) out[key] = walk(nested)
      return out
    }
    return value
  }
  return { resume: walk(resume) as GeneratedResume, applied: replaced }
}

/** 保留旧的纯函数入口；需要判断是否真的换到时使用 replaceResumeTextWithStatus。 */
export function replaceResumeText(resume: GeneratedResume, from: string, to: string): GeneratedResume {
  return replaceResumeTextWithStatus(resume, from, to).resume
}

function resumeContainsText(resume: unknown, text: string): boolean {
  if (!text) return false
  if (typeof resume === 'string') return resume.includes(text)
  if (Array.isArray(resume)) return resume.some((value) => resumeContainsText(value, text))
  if (resume && typeof resume === 'object') return Object.values(resume as Record<string, unknown>).some((value) => resumeContainsText(value, text))
  return false
}

/** 全部字符串字段里，不重叠出现次数的合计。 */
function countTextOccurrences(resume: unknown, text: string): number {
  if (!text) return 0
  if (typeof resume === 'string') {
    let count = 0
    let from = 0
    while (from < resume.length) {
      const index = resume.indexOf(text, from)
      if (index < 0) break
      count += 1
      from = index + text.length
    }
    return count
  }
  if (Array.isArray(resume)) return resume.reduce((sum: number, value: unknown) => sum + countTextOccurrences(value, text), 0)
  if (resume && typeof resume === 'object') {
    return Object.values(resume as Record<string, unknown>).reduce((sum: number, value: unknown) => sum + countTextOccurrences(value, text), 0)
  }
  return 0
}

/**
 * 按基准稿给一条建议分类。原文用 before.trim() 计数；改写是否已在稿里仍用 after 原文。
 * 没有基准稿时无法分类（unloaded），默认仍是用改写，页面按可以切换处理。
 */
export function moduleBaseState(
  base: GeneratedResume | null | undefined,
  module: ResumeOptimizeModule,
): ResumeModuleBaseState {
  if (module.after.trim() === KEEP_ORIGINAL_NOTE) return { kind: 'K', defaultDecision: 'optimized' }
  if (!base) return { kind: 'unloaded', defaultDecision: 'optimized' }
  if (module.after && resumeContainsText(base, module.after)) return { kind: 'A', defaultDecision: 'optimized' }
  const before = module.before.trim()
  if (module.after && before && countTextOccurrences(base, before) === 1) {
    const additions = detectUnconfirmedTextAdditions(module.after, module.before)
    if (additions.length === 0) return { kind: 'B', defaultDecision: 'original' }
    return { kind: 'C', defaultDecision: 'original' }
  }
  return { kind: 'D', defaultDecision: 'optimized' }
}

export function defaultModuleDecision(
  base: GeneratedResume | null | undefined,
  module: ResumeOptimizeModule,
): ResumeModuleDecision {
  return moduleBaseState(base, module).defaultDecision
}

/**
 * 这一条能不能在页面上来回切换，按刚加载的优化稿（基准稿）判断，不看编辑区：
 * - B：稿里是唯一原文、改写不带新增事实，可以切换；
 * - C：同样是唯一原文，但改写带新增事实。裁决里记过 optimized 之后可以切换，否则只能手改；
 * - K：保持原文的说明条，不能切换；
 * - 'not-found'：改写没有原样写进优化稿，且不能按唯一原文替换（D 类、未确认的 C 类）；
 * - 'original-empty'：原文为空的新增句，删掉后没有位置能换回来；
 * - null：可以切换。没有基准稿时（尚未加载，且不是 K）按可以切换处理。
 */
export function moduleSwitchBlock(
  base: GeneratedResume | null | undefined,
  module: ResumeOptimizeModule,
  decision?: ResumeModuleDecision,
): ResumeSwitchBlock | null {
  const state = moduleBaseState(base, module)
  if (state.kind === 'K') {
    if (base && module.after && resumeContainsText(base, module.after) && !module.before.trim()) return 'original-empty'
    return 'not-found'
  }
  if (!base) return null
  if (state.kind === 'B') return null
  if (state.kind === 'C') return decision === 'optimized' ? null : 'not-found'
  if (!module.after || !resumeContainsText(base, module.after)) return 'not-found'
  if (!module.before.trim()) return 'original-empty'
  return null
}

export function isModuleSwitchable(
  base: GeneratedResume | null | undefined,
  module: ResumeOptimizeModule,
  decision?: ResumeModuleDecision,
): boolean {
  return moduleSwitchBlock(base, module, decision) === null
}

/**
 * 同文条目：不是保持原文说明条，且改写去掉首尾空白后与原文相同。
 * 这种条目改写已经就是原文，切换不得增删任何空白。
 */
function isSameTextEntry(module: ResumeOptimizeModule): boolean {
  const after = module.after.trim()
  if (!after || after === KEEP_ORIGINAL_NOTE) return false
  return after === module.before.trim()
}

/**
 * 对照页带回的选择里，哪些要真正去改编辑区。
 * 默认选择按基准稿分类：B、C 是保留原文，所以带回「用改写」一定算变更。
 * 默认已经是用改写、但改写仍不在当前稿里时也要带上，避免被当成已经应用。
 * 保持原文说明条（K）没有可换的改写，带回哪一边都不算变更。
 */
export function compareDecisionChanges(
  resume: GeneratedResume,
  modules: ResumeOptimizeModule[],
  current: ResumeDecisionMap,
  incoming: ResumeDecisionMap,
  base?: GeneratedResume | null,
): Array<[string, ResumeModuleDecision]> {
  const changes: Array<[string, ResumeModuleDecision]> = []
  modules.forEach((module, index) => {
    const key = moduleKeyOf(module, index)
    const next = incoming[key]
    if (!next) return
    const state = moduleBaseState(base, module)
    if (state.kind === 'K') return
    const now = current[key] ?? state.defaultDecision
    if (now !== next) {
      changes.push([key, next])
      return
    }
    if (next === 'optimized' && !resumeContainsText(resume, module.after)) changes.push([key, next])
  })
  return changes
}

function keepOriginal(resume: GeneratedResume, module: ResumeOptimizeModule): { resume: GeneratedResume; applied: boolean; reason?: ResumeDecisionFailureReason } {
  const original = module.before.trim()
  const afterCount = module.after ? countTextOccurrences(resume, module.after) : 0
  if (afterCount === 0) {
    if (original && resumeContainsText(resume, original)) return { resume, applied: true }
    return { resume, applied: false, reason: 'edited' }
  }
  if (afterCount !== 1) return { resume, applied: false, reason: 'edited' }
  const result = replaceResumeTextWithStatus(resume, module.after, original)
  return result.applied ? result : { resume, applied: false, reason: 'edited' }
}

/** B、C：当前编辑区里 before.trim() 恰好一处才换成 after，零处或多处都不换。 */
function replaceUniqueOriginal(resume: GeneratedResume, module: ResumeOptimizeModule): { resume: GeneratedResume; applied: boolean; reason?: ResumeDecisionFailureReason } {
  const from = module.before.trim()
  if (countTextOccurrences(resume, from) !== 1) return { resume, applied: false, reason: 'edited' }
  const result = replaceResumeTextWithStatus(resume, from, module.after)
  return result.applied ? result : { resume, applied: false, reason: 'edited' }
}

export function toggleModuleDecision(
  resume: GeneratedResume,
  module: ResumeOptimizeModule,
  current: ResumeModuleDecision,
  next: ResumeModuleDecision,
  base?: GeneratedResume | null,
): { resume: GeneratedResume; applied: boolean; reason?: ResumeDecisionFailureReason } {
  const state = moduleBaseState(base, module)
  if (state.kind === 'K') {
    if (current === next && !(next === 'optimized' && !resumeContainsText(resume, module.after))) {
      return { resume, applied: true }
    }
    return { resume, applied: false, reason: moduleSwitchBlock(base, module) ?? 'not-found' }
  }
  // 编辑区里还有这句原文时，用改写和保留原文都已经对齐，不走替换（from === to 会被记成未应用）。
  if (isSameTextEntry(module) && resumeContainsText(resume, module.before.trim())) {
    return { resume, applied: true }
  }
  if (state.kind === 'B' || state.kind === 'C') {
    if (current === next && (next === 'original' || resumeContainsText(resume, module.after))) {
      return { resume, applied: true }
    }
    return next === 'optimized' ? replaceUniqueOriginal(resume, module) : keepOriginal(resume, module)
  }
  if (current === next) {
    if (next === 'optimized' && !resumeContainsText(resume, module.after)) {
      const block = moduleSwitchBlock(base, module)
      return { resume, applied: false, reason: block === 'original-empty' ? 'original-empty' : 'not-found' }
    }
    return { resume, applied: true }
  }
  const block = moduleSwitchBlock(base, module)
  if (block) return { resume, applied: false, reason: block }
  const from = next === 'original' ? module.after : module.before
  const to = next === 'original' ? module.before : module.after
  const result = replaceResumeTextWithStatus(resume, from, to)
  if (result.applied) return result
  return { ...result, reason: next === 'optimized' && !module.before ? 'original-empty' : 'edited' }
}

export function applyDecisionChanges(
  resume: GeneratedResume,
  modules: ResumeOptimizeModule[],
  current: ResumeDecisionMap,
  changes: Array<[string, ResumeModuleDecision]>,
  base?: GeneratedResume | null,
): { resume: GeneratedResume; decisions: ResumeDecisionMap; failures: ResumeDecisionFailure[] } {
  let nextResume = resume
  const nextDecisions = { ...current }
  const failures: ResumeDecisionFailure[] = []
  for (const [key, next] of changes) {
    const index = modules.findIndex((item, i) => moduleKeyOf(item, i) === key)
    if (index < 0) continue
    const currentDecision = nextDecisions[key] ?? moduleBaseState(base, modules[index]).defaultDecision
    const result = toggleModuleDecision(nextResume, modules[index], currentDecision, next, base)
    nextResume = result.resume
    if (result.applied) nextDecisions[key] = next
    else if (result.reason) failures.push({ key, reason: result.reason })
  }
  return { resume: nextResume, decisions: nextDecisions, failures }
}

export function applyResumeDecisionsWithStatus(
  resume: GeneratedResume,
  modules: ResumeOptimizeModule[],
  decisions: ResumeDecisionMap,
): { resume: GeneratedResume; failures: ResumeDecisionFailure[] } {
  let current = resume
  const failures: ResumeDecisionFailure[] = []
  modules.forEach((module, index) => {
    const key = moduleKeyOf(module, index)
    if (decisions[key] !== 'original') return
    if (isSameTextEntry(module)) {
      const original = module.before.trim()
      if (original && !resumeContainsText(current, original)) failures.push({
        key,
        reason: module.after ? 'edited' : 'original-empty',
      })
      return
    }
    const result = replaceResumeTextWithStatus(current, module.after, module.before)
    current = result.resume
    const original = module.before.trim()
    if (!result.applied && original && !resumeContainsText(current, original)) failures.push({
      key,
      reason: module.after ? 'edited' : 'original-empty',
    })
  })
  return { resume: current, failures }
}

/** 导出时按裁决组装：已回退原文的模块不得再带出优化稿。 */
export function applyResumeDecisions(
  resume: GeneratedResume,
  modules: ResumeOptimizeModule[],
  decisions: ResumeDecisionMap,
): GeneratedResume {
  return applyResumeDecisionsWithStatus(resume, modules, decisions).resume
}

export function formatClock(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return ''
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return ''
  return value.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
  })
}
