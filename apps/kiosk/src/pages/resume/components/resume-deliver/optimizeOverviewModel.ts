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

function resumeHas(resume: unknown, text: string): boolean {
  if (!text) return false
  if (typeof resume === 'string') return resume.includes(text)
  if (Array.isArray(resume)) return resume.some((value) => resumeHas(value, text))
  if (resume && typeof resume === 'object') {
    return Object.values(resume as Record<string, unknown>).some((value) => resumeHas(value, text))
  }
  return false
}

export type ExportUsage = '原文' | '改写' | '自己写' | '未写入稿'

/**
 * 看将要导出的那份稿里，这一条实际落的是哪一句。
 * 改写常常把原文包在更长的句子里，两句都能对上时认更长的那句。
 * 切不了、两句又都不在稿里的，不算自己写。
 */
export function exportUsageOf(
  resume: GeneratedResume,
  module: ResumeOptimizeModule,
  switchable: boolean,
): ExportUsage {
  const before = module.before.trim()
  const after = module.after.trim()
  const hasBefore = before.length > 0 && resumeHas(resume, before)
  const hasAfter = after.length > 0 && resumeHas(resume, after)
  if (hasBefore && hasAfter) {
    if (before !== after && after.includes(before)) return '改写'
    if (before !== after && before.includes(after)) return '原文'
    return '改写'
  }
  if (hasBefore) return '原文'
  if (hasAfter) return '改写'
  return switchable ? '自己写' : '未写入稿'
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.map((part) => part?.trim() ?? '').filter(Boolean).join(' · ')
}

/** 和导出请求体同一份简历：只拼用户能看见的字段，顺序固定。 */
export function exportResumeDocument(resume: GeneratedResume): string {
  const lines: string[] = []
  const push = (line: string | null | undefined) => {
    const text = line?.trim() ?? ''
    if (text) lines.push(text)
  }
  push(resume.basic?.name)
  push(joinParts([resume.basic?.phone, resume.basic?.email, resume.basic?.city]))
  push(joinParts([resume.intention?.position, resume.intention?.city, resume.intention?.jobType, resume.intention?.salary]))
  push(resume.summary)
  for (const item of resume.education ?? []) {
    push(joinParts([item.school, item.major, item.degree, item.period]))
    push(item.description)
  }
  for (const item of resume.experience ?? []) {
    push(joinParts([item.company, item.role, item.period]))
    push(item.description)
  }
  for (const item of resume.projects ?? []) {
    push(joinParts([item.name, item.role]))
    push(item.description)
  }
  push((resume.skills ?? []).map((item) => item.trim()).filter(Boolean).join('、'))
  push((resume.certificates ?? []).map((item) => item.trim()).filter(Boolean).join('、'))
  return lines.join('\n')
}

export function overviewStats(rows: OverviewRow[], resume: GeneratedResume | null) {
  const adopt = rows.filter((row) => row.decision === 'optimized').length
  const keep = rows.filter((row) => row.decision === 'original').length
  const custom = resume
    ? rows.filter((row) => row.switchable && exportUsageOf(resume, row.module, true) === '自己写').length
    : 0
  return {
    total: rows.length,
    decided: adopt + keep,
    adopt,
    keep,
    custom,
    facts: rows.filter((row) => row.additions.length > 0).length,
    canSwitch: rows.some((row) => row.switchable),
  }
}

export interface DraftPreviewItem {
  index: number
  title: string
  label: ExportUsage
  choice: 'todo' | 'optimized' | 'original' | 'custom'
  choiceLabel: string
  text: string
  note: string | null
}

const OVERVIEW_CHOICE_LABEL: Record<OverviewChoice, string> = {
  optimized: '采纳',
  original: '保留原文',
  todo: '待定',
}

export function overviewPreviewItems(rows: OverviewRow[], resume: GeneratedResume): DraftPreviewItem[] {
  return rows.map((row) => {
    const title = row.module.title || `第 ${row.index + 1} 条`
    const label = exportUsageOf(resume, row.module, row.switchable)
    const fact = row.additions.length > 0
      ? `这一条还有 ${row.additions.length} 处待确认事实（${row.additions.join('、')}）。导出前要逐项确认。`
      : null
    const choiceLabel = OVERVIEW_CHOICE_LABEL[row.decision]
    if (label === '未写入稿') {
      return {
        index: row.index,
        title,
        label,
        choice: row.decision,
        choiceLabel,
        text: '',
        note: row.block === 'original-empty'
          ? '这条是新加的一句，原文里没有对应的句子。导出里有没有它，以上面全文为准。'
          : '这条改写没有原样写进优化稿。要改哪一句，请到编辑区里对照着改。',
      }
    }
    if (label === '自己写') {
      return {
        index: row.index,
        title,
        label,
        choice: row.decision,
        choiceLabel,
        text: '',
        note: '这一句在编辑区里改过，和原文、改写都对不上。上面全文才是将要导出的内容。',
      }
    }
    const pending = row.decision === 'todo' ? '还没点选，导出仍用稿里的这一句改写。' : null
    const note = [fact, pending].filter(Boolean).join('') || null
    return {
      index: row.index,
      title,
      label,
      choice: row.decision,
      choiceLabel,
      text: label === '原文' ? row.module.before : row.module.after,
      note,
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
