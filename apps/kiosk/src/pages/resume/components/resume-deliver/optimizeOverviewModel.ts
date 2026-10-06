import type { GeneratedResume, ResumeOptimizeModule } from '@ai-job-print/shared'
import { detectUnconfirmedTextAdditions } from './facts'
import {
  applyDecisionChanges,
  moduleKeyOf,
  moduleSwitchBlock,
  type ResumeDecisionFailure,
  type ResumeDecisionMap,
  type ResumeModuleDecision,
  type ResumeSwitchBlock,
} from './resumeDecisions'

export type OverviewChoice = ResumeModuleDecision | 'todo'
export type OverviewBatchAction = 'adopt-eligible' | 'keep-undecided' | 'clear'

export interface OverviewRow {
  key: string
  index: number
  module: ResumeOptimizeModule
  decision: OverviewChoice
  block: ResumeSwitchBlock | null
  switchable: boolean
  additions: string[]
}

/**
 * 没点过的条目是「待定」：优化稿里仍是服务端写好的改写，导出也用这一句。
 * 点了「用改写 / 保留原文」才记进选择，并立刻改稿。
 */
export function buildOverviewRows(
  modules: ResumeOptimizeModule[],
  decisions: ResumeDecisionMap,
  baseResume: GeneratedResume | null,
): OverviewRow[] {
  return modules.map((module, index) => {
    const key = moduleKeyOf(module, index)
    const block = moduleSwitchBlock(baseResume, module)
    const recorded = decisions[key]
    return {
      key,
      index,
      module,
      decision: recorded ?? 'todo',
      block,
      switchable: block === null,
      additions: detectUnconfirmedTextAdditions(module.after, module.before),
    }
  })
}

export function overviewStats(rows: OverviewRow[]) {
  const adopt = rows.filter((row) => row.decision === 'optimized').length
  const keep = rows.filter((row) => row.decision === 'original').length
  return {
    total: rows.length,
    decided: adopt + keep,
    adopt,
    keep,
    custom: 0,
    facts: rows.filter((row) => row.additions.length > 0).length,
    canSwitch: rows.some((row) => row.switchable),
  }
}

export interface DraftPreviewItem {
  index: number
  title: string
  label: string
  text: string
  note: string | null
}

export function draftPreviewItems(rows: OverviewRow[]): DraftPreviewItem[] {
  return rows.map((row) => {
    const title = row.module.title || `第 ${row.index + 1} 条`
    const fact = row.additions.length > 0
      ? `这一条还有 ${row.additions.length} 处待确认事实（${row.additions.join('、')}）。导出前要逐项确认。`
      : null
    if (!row.switchable) {
      return {
        index: row.index,
        title,
        label: '未写入稿',
        text: '',
        note: row.block === 'original-empty'
          ? '这条是新加的一句，原文里没有对应的句子。导出里有没有它，以编辑区为准。'
          : '这条改写没有原样写进优化稿。要改哪一句，请到编辑区里对照着改。',
      }
    }
    if (row.decision === 'original') {
      return { index: row.index, title, label: '原文', text: row.module.before, note: fact }
    }
    if (row.decision === 'optimized') {
      return {
        index: row.index,
        title,
        label: '改写',
        text: row.module.after,
        note: fact ? `${fact}这一句用的是改写。` : null,
      }
    }
    return {
      index: row.index,
      title,
      label: '待定',
      text: row.module.after,
      note: fact
        ? `${fact}还没点选，导出仍用稿里的这一句改写，不是原文。`
        : '还没点选，导出仍用稿里的这一句改写。',
    }
  })
}

function adoptChanges(rows: OverviewRow[]): { changes: Array<[string, ResumeModuleDecision]>; adopted: number; skipped: number } {
  const changes: Array<[string, ResumeModuleDecision]> = []
  let adopted = 0
  let skipped = 0
  for (const row of rows) {
    if (row.additions.length > 0) {
      skipped += 1
      continue
    }
    if (!row.switchable || row.decision === 'optimized') continue
    changes.push([row.key, 'optimized'])
    adopted += 1
  }
  return { changes, adopted, skipped }
}

export function applyOverviewBatch(
  resume: GeneratedResume,
  modules: ResumeOptimizeModule[],
  decisions: ResumeDecisionMap,
  rows: OverviewRow[],
  action: OverviewBatchAction,
  base: GeneratedResume | null,
): {
  resume: GeneratedResume
  decisions: ResumeDecisionMap
  failures: ResumeDecisionFailure[]
  note: string
  changed: boolean
} {
  if (action === 'clear') {
    const restores = rows
      .filter((row) => row.switchable && row.decision === 'original')
      .map((row): [string, ResumeModuleDecision] => [row.key, 'optimized'])
    const applied = applyDecisionChanges(resume, modules, decisions, restores, base)
    const failed = new Set(applied.failures.map((failure) => failure.key))
    const next: ResumeDecisionMap = {}
    for (const [key, value] of Object.entries(applied.decisions)) {
      if (value === 'original' && failed.has(key)) next[key] = 'original'
    }
    return {
      resume: applied.resume,
      decisions: next,
      failures: applied.failures,
      note: '已清空全部选择。已经换成原文的几条换回优化稿里的改写；还没点选的，导出仍用稿里的改写。',
      changed: restores.length > 0 || Object.keys(decisions).length > 0,
    }
  }
  if (action === 'adopt-eligible') {
    const plan = adoptChanges(rows)
    const applied = applyDecisionChanges(resume, modules, decisions, plan.changes, base)
    const adopted = plan.changes.length - applied.failures.length
    return {
      resume: applied.resume,
      decisions: applied.decisions,
      failures: applied.failures,
      note: `已采纳 ${adopted} 条；跳过 ${plan.skipped} 条 —— 那几条有待确认事实，这一颗按钮不会改它们。可以逐条点「用改写」。`,
      changed: adopted > 0,
    }
  }
  const changes = rows
    .filter((row) => row.switchable && row.decision === 'todo')
    .map((row): [string, ResumeModuleDecision] => [row.key, 'original'])
  const applied = applyDecisionChanges(resume, modules, decisions, changes, base)
  const kept = changes.length - applied.failures.length
  return {
    resume: applied.resume,
    decisions: applied.decisions,
    failures: applied.failures,
    note: `已把 ${kept} 条还没决定的记为「保留原文」。已经决定的不动。`,
    changed: kept > 0,
  }
}
