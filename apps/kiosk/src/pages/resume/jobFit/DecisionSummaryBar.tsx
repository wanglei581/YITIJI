import type { JobFitResponse } from '@ai-job-print/shared'
import { ClockIcon } from 'lucide-react'

const FIT_META: Record<NonNullable<JobFitResponse['fitLevel']>, { label: string; cls: string }> = {
  reference_high:   { label: '匹配参考：较高', cls: 'jf-fit-badge jf-fit-badge--high' },
  reference_medium: { label: '匹配参考：中等', cls: 'jf-fit-badge jf-fit-badge--medium' },
  reference_low:    { label: '匹配参考：偏低', cls: 'jf-fit-badge jf-fit-badge--low' },
}

interface DecisionSummaryBarProps {
  jobTitle: string
  company?: string | null
  fitLevel?: JobFitResponse['fitLevel']
  summary?: string
}

/** 岗位决策摘要卡 — 对齐原型屏55 a-clay accented card */
export function DecisionSummaryBar({ jobTitle, company, fitLevel, summary }: DecisionSummaryBarProps) {
  const fit = fitLevel ? FIT_META[fitLevel] : null
  return (
    <section className="job-fit-summary jf-decision-summary" aria-label="岗位匹配摘要">
      <div className="jf-decision-summary__head">
        <div className="jf-decision-summary__titles">
          <p className="jf-decision-summary__eyebrow">岗位决策参考</p>
          <h2 className="jf-decision-summary__title">
            {jobTitle}{company ? ` · ${company}` : ''}
          </h2>
        </div>
        {fit && (
          <span className={fit.cls} aria-label={fit.label}>
            <ClockIcon aria-hidden="true" />
            {fit.label}
          </span>
        )}
      </div>
      {summary && <p className="jf-decision-summary__body">{summary}</p>}
      <p className="jf-decision-summary__disclaimer">
        匹配等级仅供本人参考，不代表录用结果；结果不会提供给任何企业。
      </p>
    </section>
  )
}
