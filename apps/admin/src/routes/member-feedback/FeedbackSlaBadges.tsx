// 意见反馈页的分类标签与「AI 内容投诉」答复时限展示。时限一律由 ./feedbackSla 的纯函数算，
// 这里只负责渲染（门禁 verify:feedback-sla 真执行那份纯函数）。
import { ClockIcon } from 'lucide-react'
import type { FeedbackCategory, FeedbackStatus } from '../../services/api/memberFeedbackAdmin'
import { aiComplaintSla, type AiComplaintSlaUrgency } from './feedbackSla'

/** 列表上的分类标签：AI 内容投诉有答复时限，要一眼能认出来。 */
const CATEGORY_CHIP_CLASS: Record<FeedbackCategory, string> = {
  device: 'bg-neutral-100 text-neutral-600',
  print: 'bg-neutral-100 text-neutral-600',
  file_process: 'bg-neutral-100 text-neutral-600',
  general: 'bg-neutral-100 text-neutral-600',
  ai_content: 'bg-error-bg text-error-fg font-semibold ring-1 ring-error/30',
}

const SLA_CLASS: Record<AiComplaintSlaUrgency, string> = {
  normal: 'bg-info-bg text-info-fg',
  soon: 'bg-warning-bg text-warning-fg',
  today: 'bg-error-bg text-error-fg',
  overdue: 'bg-error-bg text-error-fg',
}

interface SlaTicket {
  category: FeedbackCategory
  status: FeedbackStatus
  createdAt: string
  hasAdminReply: boolean
  submitterType?: string
}

/** 列表项：分类标签始终显示；AI 内容投诉在计时时再加「剩 N 个工作日 / 今天到期 / 已超期」。 */
export function FeedbackListChips({ item, categoryLabel }: { item: SlaTicket; categoryLabel: string }) {
  const sla = aiComplaintSla(item)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className={['rounded-md px-2 py-0.5 text-xs', CATEGORY_CHIP_CLASS[item.category]].join(' ')}>
        {categoryLabel}
      </span>
      {sla?.kind === 'running' && (
        <span className={['inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold', SLA_CLASS[sla.urgency]].join(' ')}>
          <ClockIcon className="h-3 w-3" aria-hidden="true" />
          {sla.listLabel}
        </span>
      )}
    </div>
  )
}

/** 详情里的答复时限：只有 AI 内容投诉显示；已回复 / 已关闭写明不再计时。 */
export function DetailSla({ detail }: { detail: SlaTicket }) {
  const sla = aiComplaintSla(detail)
  if (!sla) return null
  if (sla.kind === 'stopped') {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2.5 py-1 text-xs text-neutral-500">
        <ClockIcon className="h-3.5 w-3.5" aria-hidden="true" />
        答复时限：{sla.label}
      </p>
    )
  }
  return (
    <div className={['mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-sm', SLA_CLASS[sla.urgency]].join(' ')}>
      <ClockIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="font-semibold">{sla.listLabel}</span>
      <span>{sla.detailLabel}</span>
    </div>
  )
}
