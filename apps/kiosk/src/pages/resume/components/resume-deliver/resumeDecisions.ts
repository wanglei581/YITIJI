import type { GeneratedResume, ResumeOptimizeModule } from '@ai-job-print/shared'

export type ResumeModuleDecision = 'original' | 'optimized'
export type ResumeDecisionMap = Record<string, ResumeModuleDecision>
export type ResumeDecisionFailureReason = 'original-empty' | 'edited' | 'not-found'
/** 按基准稿就能判定、与编辑区无关的「切换不了」原因。 */
export type ResumeSwitchBlock = Extract<ResumeDecisionFailureReason, 'not-found' | 'original-empty'>
export type ResumeDecisionFailure = { key: string; reason: ResumeDecisionFailureReason }
export type ResumeTextReplacement = { resume: GeneratedResume; applied: boolean }

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

/**
 * 这一条能不能在页面上来回切换，按刚加载的优化稿（基准稿）判断，不看编辑区：
 * - 'not-found'：改写没有原样写进优化稿（服务端不校验这一点，演示模式的建议句也不在正文里），换不了；
 * - 'original-empty'：原文为空的新增句，删掉后没有位置能换回来，不给单向的开关；
 * - null：可以切换。没有基准稿时（尚未加载）按可以切换处理。
 */
export function moduleSwitchBlock(
  base: GeneratedResume | null | undefined,
  module: ResumeOptimizeModule,
): ResumeSwitchBlock | null {
  if (!base) return null
  if (!module.after || !resumeContainsText(base, module.after)) return 'not-found'
  if (!module.before.trim()) return 'original-empty'
  return null
}

export function isModuleSwitchable(base: GeneratedResume | null | undefined, module: ResumeOptimizeModule): boolean {
  return moduleSwitchBlock(base, module) === null
}

export function toggleModuleDecision(
  resume: GeneratedResume,
  module: ResumeOptimizeModule,
  current: ResumeModuleDecision,
  next: ResumeModuleDecision,
  base?: GeneratedResume | null,
): { resume: GeneratedResume; applied: boolean; reason?: ResumeDecisionFailureReason } {
  if (current === next) return { resume, applied: true }
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
    const result = toggleModuleDecision(nextResume, modules[index], nextDecisions[key] ?? 'optimized', next, base)
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
    if (decisions[moduleKeyOf(module, index)] !== 'original') return
    const result = replaceResumeTextWithStatus(current, module.after, module.before)
    current = result.resume
    if (!result.applied && module.before && !resumeContainsText(current, module.before)) failures.push({
      key: moduleKeyOf(module, index),
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
