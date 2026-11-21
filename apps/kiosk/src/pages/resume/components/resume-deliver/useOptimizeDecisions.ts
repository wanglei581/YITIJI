// 优化页逐条/批量采纳裁决、草稿续编与重开：从 ResumeOptimizePage 拆出，行为不变。
import { useState } from 'react'
import type { GeneratedResume, ResumeLayoutSettings, ResumeOptimizeModule } from '@ai-job-print/shared'
import { DEFAULT_RESUME_LAYOUT } from '../../hooks/useResumeLayout'
import {
  applyDecisionChanges,
  applyResumeDecisions,
  defaultModuleDecision,
  isModuleSwitchable,
  isNoActionModule,
  moduleKeyOf,
  parseDecisionMap,
  toggleModuleDecision,
  type ResumeDecisionFailure,
  type ResumeModuleDecision,
} from './resumeDecisions'
import { useCompareDecisionsReturn } from './useCompareDecisionsReturn'

interface Options {
  state: Record<string, unknown> | null
  viewOnly: boolean
  editorOpen: boolean
  modules: ResumeOptimizeModule[]
  optimizedResume: GeneratedResume | null
  baseResume: GeneratedResume | null
  decisions: Record<string, ResumeModuleDecision>
  remoteDraft: { resume?: GeneratedResume; decisions?: Record<string, unknown>; layout?: Partial<ResumeLayoutSettings> } | null
  hasPendingEditOriginal: () => boolean
  formatIssue: (failure: ResumeDecisionFailure, attempted?: ResumeModuleDecision) => string
  setOptimizedResume: (next: GeneratedResume | null) => void
  setDecisions: (next: Record<string, ResumeModuleDecision> | ((prev: Record<string, ResumeModuleDecision>) => Record<string, ResumeModuleDecision>)) => void
  setLayout: (next: Required<ResumeLayoutSettings>) => void
  setIsDirty: (dirty: boolean) => void
  setDraftAccepted: (accepted: boolean) => void
  setWorkView: (pane: 'overview' | 'editor' | 'export') => void
  requestOverwriteDraft: () => void
  markEdited: () => void
}

export function useOptimizeDecisions(opts: Options) {
  const {
    state, viewOnly, editorOpen, modules, optimizedResume, baseResume, decisions,
    remoteDraft, hasPendingEditOriginal, formatIssue,
    setOptimizedResume, setDecisions, setLayout, setIsDirty, setDraftAccepted,
    setWorkView, requestOverwriteDraft, markEdited,
  } = opts
  const [clearedChoices, setClearedChoices] = useState<ReadonlySet<string>>(new Set())
  const [decisionIssues, setDecisionIssues] = useState<Record<string, string>>({})

  const setDecisionFailures = (
    failures: ResumeDecisionFailure[],
    attempted?: ResumeModuleDecision | Record<string, ResumeModuleDecision>,
  ) => {
    setDecisionIssues(Object.fromEntries(failures.map((failure) => {
      const choice = typeof attempted === 'string' ? attempted : attempted?.[failure.key]
      return [failure.key, formatIssue(failure, choice)]
    })))
  }

  const handleDecisionChange = (key: string, next: ResumeModuleDecision) => {
    if (viewOnly) return
    const index = modules.findIndex((item, i) => moduleKeyOf(item, i) === key)
    if (index < 0 || !optimizedResume) return
    const result = toggleModuleDecision(
      optimizedResume,
      modules[index],
      decisions[key] ?? defaultModuleDecision(baseResume, modules[index]),
      next,
      baseResume,
      { modules, decisions, index },
    )
    if (!result.applied) {
      setDecisionFailures(result.reason ? [{ key, reason: result.reason }] : [], next)
      return
    }
    setClearedChoices((previous) => { const nextSet = new Set(previous); nextSet.delete(key); return nextSet })
    setOptimizedResume(result.resume)
    setDecisions((prev) => ({ ...prev, [key]: next }))
    setDecisionIssues((prev) => { const nextIssues = { ...prev }; delete nextIssues[key]; return nextIssues })
    markEdited()
  }

  /** 总览的两个批量动作：全部用改写 / 全部保留原文。与逐条切换走同一个替换函数，结果一致。 */
  const handleBatch = (next: ResumeModuleDecision) => {
    if (viewOnly || !optimizedResume) return
    const changes = modules.flatMap((module, index): Array<[string, ResumeModuleDecision]> => {
      if (isNoActionModule(module)) return []
      if (!isModuleSwitchable(baseResume, module, decisions[moduleKeyOf(module, index)])) return []
      return [[moduleKeyOf(module, index), next]]
    })
    const applied = applyDecisionChanges(optimizedResume, modules, decisions, changes, baseResume)
    setClearedChoices((previous) => {
      const nextSet = new Set(previous)
      const failedKeys = new Set(applied.failures.map((failure) => failure.key))
      changes.forEach(([key]) => { if (!failedKeys.has(key)) nextSet.delete(key) })
      return nextSet
    })
    setOptimizedResume(applied.resume)
    setDecisions(applied.decisions)
    setDecisionFailures(applied.failures, next)
    if (applied.failures.length < changes.length) markEdited()
  }

  const compareReturn = useCompareDecisionsReturn({
    state,
    modules,
    optimizedResume,
    baseResume,
    decisions,
    ready: editorOpen,
    apply: (changes) => {
      if (!optimizedResume) return
      const next = applyDecisionChanges(optimizedResume, modules, decisions, changes, baseResume)
      setOptimizedResume(next.resume)
      setDecisions(next.decisions)
      setDecisionFailures(next.failures, Object.fromEntries(changes))
      if (next.failures.length < changes.length) markEdited()
    },
  })

  const handleContinueDraft = () => {
    // 草稿没有生成稿下标。优化页按各字段全文和原文比，不读下标，也不按名称、相似度或同名序号配对，所以续上时不盖下标。
    if (remoteDraft?.resume) {
      const nextDecisions = parseDecisionMap(remoteDraft.decisions)
      setDecisions(nextDecisions)
      setOptimizedResume(applyResumeDecisions(remoteDraft.resume, modules, nextDecisions))
      if (remoteDraft.layout) setLayout({ ...DEFAULT_RESUME_LAYOUT, ...remoteDraft.layout })
    }
    setIsDirty(false)
    setDraftAccepted(true)
    setWorkView('editor')
  }

  const handleRestartDraft = () => {
    setDecisions({})
    setDecisionIssues({})
    setClearedChoices(new Set())
    if (baseResume) setOptimizedResume(structuredClone(baseResume))
    requestOverwriteDraft()
    setDraftAccepted(true)
    setWorkView(hasPendingEditOriginal() ? 'editor' : 'overview')
  }

  return {
    clearedChoices,
    setClearedChoices,
    decisionIssues,
    handleDecisionChange,
    handleBatch,
    compareReturn,
    handleContinueDraft,
    handleRestartDraft,
  }
}
