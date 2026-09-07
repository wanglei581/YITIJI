export function ResumeCompareBatchBar(props: {
  note: string | null
  onAdoptEligible: () => void
  onKeepUndecided: () => void
  onClear: () => void
}) {
  return (
    <div className="qxc-batch-wrap">
      <div className="qxc-batch" data-testid="resume-optimize-compare-batch">
        <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onAdoptEligible}>
          可采纳的全部采纳
          <small>跳过有待确认事实的那几条</small>
        </button>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onKeepUndecided}>
          其余保留原文
          <small>把还没决定的都记为保留</small>
        </button>
        <button type="button" className="qx-btn" data-tone="danger" onClick={props.onClear}>
          清空全部裁决
          <small>全部回到待定</small>
        </button>
      </div>
      {props.note ? <p className="qxc-notice qxc-batch-note" role="status">{props.note}</p> : null}
    </div>
  )
}
