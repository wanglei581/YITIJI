import { FileText, Lightbulb, Monitor, Printer, Sparkles, type LucideIcon } from 'lucide-react'
import type { FeedbackCategory } from '../../../../services/api/memberFeedback'
import { CATEGORY_TONE } from './feedbackRules'

const ICONS: Record<FeedbackCategory, LucideIcon> = {
  device: Monitor,
  print: Printer,
  file_process: FileText,
  general: Lightbulb,
  ai_content: Sparkles,
}

/** 稿 40 的行图标：58px 方块里放 28px 线框图标，列表行和结构行同一套。 */
export function FeedbackMark({ category, off = false }: { category: FeedbackCategory; off?: boolean }) {
  const Icon = ICONS[category]
  const tone = off ? 'off' : CATEGORY_TONE[category]
  return (
    <span className="qx-me-row-ico" data-tone={tone} aria-hidden="true">
      <Icon size={28} strokeWidth={1.95} />
    </span>
  )
}
