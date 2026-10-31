import { AigcMark } from '../../../ai'
import { ResumeDocArt } from '../touch/ResumeDocArt'
import '../touch/resume-fit.css'

interface DecisionSummaryBarProps {
  jobTitle: string
  company?: string | null
  summary?: string
  /** 已经写到的要求条数（matchPoints 的长度）。 */
  matched: number
  /** 还没体现的要求条数（gapPoints 的长度）。 */
  missing: number
}

/**
 * 简历对照摘要 —— 稿 jobfit-result 的头部：纸张小样 +「写到 N 条，还有 M 条没写到」。
 *
 * 2026-09-26（next-tasks 3.14）起服务端不再返回 fitLevel，本条也不再复述任何档位：
 * 只写对照的是哪份岗位要求、各有几条，以及服务端给的不带评价的对照概述。条数就是两个数组的长度，不是 AI 判断。
 * AI 标识用全站共享的 AigcMark（文案归 AI 标识那一路统一维护，这里不另写一份）。
 * 小样只表示「这是一份报告」，不是用户的内容。
 */
export function DecisionSummaryBar({ jobTitle, company, summary, matched, missing }: DecisionSummaryBarProps) {
  const heading = matched + missing > 0 ? `写到 ${matched} 条，还有 ${missing} 条没写到` : '这次没有逐条对照的内容'
  return (
    <section className="jfq-summary rtp-fit-hero" aria-label="简历对照摘要">
      <div className="rtp-fit-art"><ResumeDocArt kind="report" /></div>
      <div className="rtp-fit-tx">
        <p className="jfq-summary-eyebrow">
          简历对照 · <AigcMark />
        </p>
        <h2 className="jfq-summary-title">{heading}</h2>
        <p className="rtp-fit-job">{jobTitle}{company ? ` · ${company}` : ''}</p>
        {summary && <p className="jfq-summary-body">{summary}</p>}
        <p className="jfq-summary-disclaimer">
          对照结果只供本人准备，不代表录用结果；结果不会提供给任何企业。
        </p>
      </div>
    </section>
  )
}
