import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { GeneratedResume, ResumeOptimizeModule } from '@ai-job-print/shared'
import { moduleKeyOf, parseDecisionMap, type ResumeDecisionMap, type ResumeModuleDecision } from './resumeDecisions'

/**
 * 从 /resume/optimize/compare 带着 state.decisions 回到优化页时，把逐条裁决应用到当前优化稿并进入草稿自动保存。
 * 只应用一次；应用后把路由 state 里的 decisions 去掉，刷新不会重复套用。
 */
export function useCompareDecisionsReturn(opts: {
  state: Record<string, unknown> | null
  modules: ResumeOptimizeModule[]
  optimizedResume: GeneratedResume | null
  decisions: ResumeDecisionMap
  ready: boolean
  apply: (changes: Array<[string, ResumeModuleDecision]>) => void
}) {
  const { state, modules, optimizedResume, decisions, ready, apply } = opts
  const navigate = useNavigate()
  const location = useLocation()
  const appliedRef = useRef(false)
  const incoming = state && typeof state.decisions === 'object' && state.decisions
    ? parseDecisionMap(state.decisions as Record<string, unknown>)
    : null

  useEffect(() => {
    if (appliedRef.current || !incoming || !ready || !optimizedResume || modules.length === 0) return
    appliedRef.current = true
    const changes: Array<[string, ResumeModuleDecision]> = []
    modules.forEach((module, index) => {
      const key = moduleKeyOf(module, index)
      const next = incoming[key]
      if (next && (decisions[key] ?? 'optimized') !== next) changes.push([key, next])
    })
    if (changes.length > 0) apply(changes)
    const rest = { ...(state ?? {}) }
    delete rest.decisions
    navigate(location.pathname, { replace: true, state: rest })
  }, [incoming, ready, optimizedResume, modules, decisions, apply, navigate, location.pathname, state])
}
