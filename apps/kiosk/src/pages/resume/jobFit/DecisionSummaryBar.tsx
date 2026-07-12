import type { JobFitResponse } from '@ai-job-print/shared'

const FIT_META: Record<NonNullable<JobFitResponse['fitLevel']>, { label: string; cls: string }> = {
  reference_high: { label: '匹配参考：较高', cls: 'bg-success-bg text-success-fg' },
  reference_medium: { label: '匹配参考：中等', cls: 'bg-primary-50 text-primary-700' },
  reference_low: { label: '匹配参考：偏低', cls: 'bg-warning-bg text-warning-fg' },
}

interface DecisionSummaryBarProps {
  jobTitle: string
  company?: string | null
  fitLevel?: JobFitResponse['fitLevel']
  summary?: string
}

/** 可由既有 JobFitResponse 完整支撑的决策摘要，不补造任何结论。 */
export function DecisionSummaryBar({ jobTitle, company, fitLevel, summary }: DecisionSummaryBarProps) {
  const fit = fitLevel ? FIT_META[fitLevel] : null
  return (
    <section className="job-fit-summary rounded-2xl border border-primary-100 bg-primary-50/40 p-5" aria-label="岗位匹配摘要">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary-600">岗位决策参考</p>
          <h2 className="mt-0.5 truncate text-base font-bold text-neutral-900">
            {jobTitle}{company ? ` · ${company}` : ''}
          </h2>
        </div>
        {fit && <span className={['shrink-0 rounded-full px-3 py-1 text-sm font-semibold', fit.cls].join(' ')}>{fit.label}</span>}
      </div>
      {summary && <p className="mt-3 text-sm leading-relaxed text-neutral-700">{summary}</p>}
    </section>
  )
}
