import type { ReactNode } from 'react'
import { PrinterIcon } from 'lucide-react'
import { QxAiHelp, QxStepActions } from '../../../components/qingxu/QxAiHelp'

/** 稿 24 底部那条问小青：预填本步问题，顾问页不自动发送。 */
const GENERATE_AI_DRAFT = '我想从零整理简历，请一步步问我的教育、经历和技能，帮我组织表达。'

export function ResumeGenerateAdvisor({
  eyebrow,
  ask,
  doing,
}: {
  eyebrow: string
  ask: ReactNode
  doing: ReactNode
}) {
  return (
    <section className="rg-xq" aria-label="小青提示">
      <div className="rg-xq-face" aria-hidden="true">青</div>
      <div className="rg-xq-main">
        <p className="rg-xq-eyebrow">{eyebrow}</p>
        <p className="rg-xq-ask">{ask}</p>
        <p className="rg-xq-doing">{doing}</p>
      </div>
    </section>
  )
}

/** 稿删掉了和主按钮重复的「上一步」，这里只留问小青。 */
export function ResumeGenerateAiRow() {
  return (
    <QxStepActions>
      <QxAiHelp label="让小青帮我整理经历 →" draft={GENERATE_AI_DRAFT} testId="resume-generate-ai-help" />
    </QxStepActions>
  )
}

/**
 * 核对步底栏。AI 失败、不可用、本人不同意那几态不渲染这一条，
 * 那些态仍用原来的「导出并打印我填的内容（未经 AI 润色）」。
 */
export function ResumeGenerateReviewBar(props: {
  generating: boolean
  exportingDraft: boolean
  onBack: () => void
  onExportDraft: () => void
  children: ReactNode
}) {
  return (
    <div className="qx-rg-review-bar">
      <button type="button" className="qx-btn" data-variant="ghost" disabled={props.generating} onClick={props.onBack}>
        上一步
      </button>
      <button
        type="button"
        className="qx-btn"
        data-variant="ghost"
        data-testid="resume-generate-draft-export"
        disabled={props.exportingDraft || props.generating}
        onClick={props.onExportDraft}
      >
        <PrinterIcon className="h-5 w-5" aria-hidden="true" />
        不用 AI，导出原样草稿
      </button>
      {props.children}
    </div>
  )
}
