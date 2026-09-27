import { AigcMark } from '../../../ai'

interface DecisionSummaryBarProps {
  jobTitle: string
  company?: string | null
  summary?: string
}

/**
 * 简历对照摘要 —— 稿 46 结果屏的摘要条。
 *
 * 2026-09-26（next-tasks 3.14）起服务端不再返回 fitLevel，本条也不再复述任何档位：
 * 只写对照的是哪份岗位要求，以及服务端给的不带评价的对照概述。AI 标识用全站共享的
 * AigcMark（文案归 AI 标识那一路统一维护，这里不另写一份）。
 */
export function DecisionSummaryBar({ jobTitle, company, summary }: DecisionSummaryBarProps) {
  return (
    <section className="jfq-summary" aria-label="简历对照摘要">
      <p className="jfq-summary-eyebrow">
        简历对照 · <AigcMark />
      </p>
      <h2 className="jfq-summary-title">{jobTitle}{company ? ` · ${company}` : ''}</h2>
      {summary && <p className="jfq-summary-body">{summary}</p>}
      <p className="jfq-summary-disclaimer">
        对照结果只供本人准备，不代表录用结果；结果不会提供给任何企业。
      </p>
    </section>
  )
}
