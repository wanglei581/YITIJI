import { FLOW_RAIL, REPORT_HEAD, type ReportViewState } from '../../resume-report-model'

export function ResumeReportHead({ viewState }: { viewState: ReportViewState }) {
  const head = REPORT_HEAD[viewState]
  return (
    <header className="rrp-head">
      <div className="rrp-head-row">
        <span className="rrp-head-tx">
          <h1>{head.title}</h1>
          <p>{head.sub}</p>
        </span>
        <span className="rrp-head-tag">{head.tag}</span>
      </div>
      <div className="rrp-rail" aria-label="简历服务四步">
        {FLOW_RAIL.map((label, i) => (
          <span key={label} data-now={i === head.rail ? '1' : undefined} data-done={i < head.rail ? '1' : undefined}>
            <i>{i + 1}</i>{label}
          </span>
        ))}
      </div>
    </header>
  )
}
