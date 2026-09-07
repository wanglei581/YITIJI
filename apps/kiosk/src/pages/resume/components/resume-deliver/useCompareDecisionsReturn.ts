import { useCallback, useEffect, useRef, useState } from 'react'
import type { GeneratedResume, ResumeOptimizeModule } from '@ai-job-print/shared'
import { moduleKeyOf, parseDecisionMap, type ResumeDecisionMap, type ResumeModuleDecision } from './resumeDecisions'

export type CompareApplyPending = {
  count: number
  customCount: number
  changes: Array<[string, ResumeModuleDecision]>
}

/**
 * 从对照页带着 state.decisions 回到优化页时，只收集待应用裁决，不自动改写简历。
 * 优化页弹出确认后才 apply；选「暂不应用」则丢弃，不落草稿。
 */
export function useCompareDecisionsReturn(opts: {
  state: Record<string, unknown> | null
  modules: ResumeOptimizeModule[]
  optimizedResume: GeneratedResume | null
  decisions: ResumeDecisionMap
  ready: boolean
  apply: (changes: Array<[string, ResumeModuleDecision]>) => void
}): {
  pending: { count: number; customCount: number } | null
  confirm: () => void
  dismiss: () => void
} {
  const { state, modules, optimizedResume, decisions, ready, apply } = opts
  const promptedRef = useRef(false)
  const applyRef = useRef(apply)
  applyRef.current = apply
  const [pending, setPending] = useState<CompareApplyPending | null>(null)

  useEffect(() => {
    if (promptedRef.current || !ready || !optimizedResume || modules.length === 0) return
    const raw = state && typeof state.decisions === 'object' && state.decisions
      ? state.decisions as Record<string, unknown>
      : null
    if (!raw) return
    const incoming = parseDecisionMap(raw)
    const customCount = Object.values(raw).filter((value) => value === 'custom').length
    const count = Object.keys(incoming).length + customCount
    if (count === 0) {
      promptedRef.current = true
      return
    }
    const changes: Array<[string, ResumeModuleDecision]> = []
    modules.forEach((module, index) => {
      const key = moduleKeyOf(module, index)
      const next = incoming[key]
      if (next && (decisions[key] ?? 'optimized') !== next) changes.push([key, next])
    })
    promptedRef.current = true
    setPending({ count, customCount, changes })
  }, [state, ready, optimizedResume, modules, decisions])

  const confirm = useCallback(() => {
    if (!pending) return
    const changes = pending.changes
    setPending(null)
    if (changes.length > 0) applyRef.current(changes)
  }, [pending])

  const dismiss = useCallback(() => {
    setPending(null)
  }, [])

  return {
    pending: pending ? { count: pending.count, customCount: pending.customCount } : null,
    confirm,
    dismiss,
  }
}
