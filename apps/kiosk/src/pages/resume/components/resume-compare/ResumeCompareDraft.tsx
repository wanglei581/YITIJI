import { useMemo, useState } from 'react'
import type { GeneratedResume } from '@ai-job-print/shared'
import { OptimizeDraftPreview } from '../resume-deliver/OptimizeDraftPreview'
import {
  exportResumeDocument,
  exportUsageOf,
  type DraftPreviewItem,
} from '../resume-deliver/optimizeOverviewModel'
import type { ResumeCompareDecisions, ResumeCompareItem } from './resumeCompareModel'
import { moduleKeyOf } from './resumeCompareModel'

export const COMPARE_PREVIEW_NOTE = '对照页上的选择还没写进这份优化稿，回到优化页确认应用之后才会进入导出。'

const CHOICE_LABEL = {
  optimized: '已采纳',
  original: '保留原文',
  custom: '自己写',
  todo: '待定',
} as const

/** 没点过的条目在表里没有键。索引类型不会标成可空，返回值单独写出「待定」。 */
function recordedChoice(
  decisions: ResumeCompareDecisions,
  key: string,
): 'original' | 'optimized' | 'custom' | 'todo' {
  return decisions[key] ?? 'todo'
}

function comparePreviewItems(
  items: ResumeCompareItem[],
  decisions: ResumeCompareDecisions,
  resume: GeneratedResume | null,
): DraftPreviewItem[] {
  return items.map((item, index) => {
    const choice = recordedChoice(decisions, moduleKeyOf(item, index))
    // 对照页还没改导出稿，对不上的句子不能算成「自己写」。
    const label = resume ? exportUsageOf(resume, item, false) : '未写入稿'
    const note = choice === 'custom'
      ? '你在对照页另写的那一版还没进这份优化稿。'
      : choice === 'todo'
        ? '还没点选。上面全文才是现在会导出的内容。'
        : null
    return {
      index,
      title: item.title || `第 ${index + 1} 条`,
      label,
      choice,
      choiceLabel: CHOICE_LABEL[choice],
      text: label === '原文' ? item.before : label === '改写' ? item.after : '',
      note,
    }
  })
}

/** 对照页不再另放一份「选择草稿」。打开的就是优化页那层草稿预览。 */
export function ResumeCompareDraft(props: {
  items: ResumeCompareItem[]
  decisions: ResumeCompareDecisions
  resume: GeneratedResume | null
  onEdit: () => void
}) {
  const [open, setOpen] = useState(false)
  const items = useMemo(
    () => comparePreviewItems(props.items, props.decisions, props.resume),
    [props.items, props.decisions, props.resume],
  )
  return (
    <>
      <p className="qxc-draft-note">{COMPARE_PREVIEW_NOTE}</p>
      <button type="button" className="qx-btn qx-opt-draft-open" data-variant="ghost" data-testid="resume-optimize-final-open" onClick={() => setOpen(true)}>
        草稿预览
      </button>
      {open ? (
        <OptimizeDraftPreview
          documentText={props.resume ? exportResumeDocument(props.resume) : ''}
          items={items}
          notice={COMPARE_PREVIEW_NOTE}
          onClose={() => setOpen(false)}
          onEdit={props.onEdit}
        />
      ) : null}
    </>
  )
}
