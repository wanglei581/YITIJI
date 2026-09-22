import type { JobFitResponse } from '@ai-job-print/shared'

const FIT_LABEL: Record<NonNullable<JobFitResponse['fitLevel']>, string> = {
  reference_high: '匹配参考：较高',
  reference_medium: '匹配参考：中等',
  reference_low: '匹配参考：偏低',
}

interface DecisionSummaryBarProps {
  jobTitle: string
  company?: string | null
  fitLevel?: JobFitResponse['fitLevel']
  summary?: string
}

/**
 * 目标岗位摘要 —— 稿 46 结果屏「岗位匹配参考」分区里紧贴判定卡的那一条。
 *
 * 三档等级由上层的判定卡承担视觉重量，这里只复述一次文字等级（读屏与打印
 * 的等价信息），不再画第二个徽章 —— 同一屏两个等级徽章会让人以为是两件事。
 */
export function DecisionSummaryBar({ jobTitle, company, fitLevel, summary }: DecisionSummaryBarProps) {
  return (
    <section className="jfq-summary" aria-label="岗位匹配摘要">
      <p className="jfq-summary-eyebrow">
        岗位决策参考{fitLevel ? ` · ${FIT_LABEL[fitLevel]}` : ''}
      </p>
      <h2 className="jfq-summary-title">{jobTitle}{company ? ` · ${company}` : ''}</h2>
      {summary && <p className="jfq-summary-body">{summary}</p>}
      <p className="jfq-summary-disclaimer">
        匹配等级仅供本人参考，不代表录用结果；结果不会提供给任何企业。
      </p>
    </section>
  )
}
