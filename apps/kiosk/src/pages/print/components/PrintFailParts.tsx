// 结果类屏共用的三步与摘要（稿 st-unconfirmed 的骨架）。完成页的少见失败态、出纸页的查询超时与已知失败共用。
// 只画传进来的文字：不发请求、不判定状态、不改金额。样式在 print-fail-touch.css。

import type { FailureStep, SummaryRow } from './printDoneFailedModel'
import '../styles/print-fail-touch.css'

export function FailSteps({ steps, label }: { steps: FailureStep[]; label: string }) {
  return (
    <section aria-label={label}>
      <ol className="qxt-steps qxt-steps-big pft-unc-steps" style={{ gridTemplateColumns: '1fr' }}>
        {steps.map((step, index) => (
          <li key={step.title} className="qxt-step">
            <span className="qxt-step-n">{index + 1}</span>
            <b>{step.title}</b>
            <small>{step.detail}</small>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** 订单摘要。内容多（失败态四五行）用紧凑行高；内容少（费用说明）沿用未确认页的大行高。 */
export function FailSummary({ rows, testId, compact = true }: { rows: SummaryRow[]; testId?: string; compact?: boolean }) {
  return (
    <dl className={compact ? 'qxt-sum pft-unc-sum pft-fail-sum' : 'qxt-sum pft-unc-sum'} data-testid={testId}>
      {rows.map((row) => (
        <div key={row.key} className="qxt-sum-r">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
          <span />
        </div>
      ))}
    </dl>
  )
}
