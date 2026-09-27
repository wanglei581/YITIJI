import type { ReactNode } from 'react'
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
