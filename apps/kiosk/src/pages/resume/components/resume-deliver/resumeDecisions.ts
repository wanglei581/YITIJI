import type { GeneratedResume, ResumeOptimizeModule } from '@ai-job-print/shared'

export type ResumeModuleDecision = 'original' | 'optimized'
export type ResumeDecisionMap = Record<string, ResumeModuleDecision>

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

export function replaceResumeText(resume: GeneratedResume, from: string, to: string): GeneratedResume {
  if (!from || from === to) return resume
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return value.includes(from) ? value.split(from).join(to) : value
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) out[key] = walk(nested)
      return out
    }
    return value
  }
  return walk(resume) as GeneratedResume
}

export function toggleModuleDecision(
  resume: GeneratedResume,
  module: ResumeOptimizeModule,
  current: ResumeModuleDecision,
  next: ResumeModuleDecision,
): GeneratedResume {
  if (current === next) return resume
  if (next === 'original') return replaceResumeText(resume, module.after, module.before)
  return replaceResumeText(resume, module.before, module.after)
}

/** 导出时按裁决组装：已回退原文的模块不得再带出优化稿。 */
export function applyResumeDecisions(
  resume: GeneratedResume,
  modules: ResumeOptimizeModule[],
  decisions: ResumeDecisionMap,
): GeneratedResume {
  return modules.reduce((current, module, index) => {
    if (decisions[moduleKeyOf(module, index)] !== 'original') return current
    return replaceResumeText(current, module.after, module.before)
  }, resume)
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
