export function CompareDecisionsApplyDialog(props: {
  count: number
  customCount: number
  onApply: () => void
  onSkip: () => void
}) {
  return (
    <div className="qx-rd-overlay" role="dialog" aria-modal="true" aria-labelledby="compare-apply-title">
      <div className="qx-rd-dialog">
        <h2 id="compare-apply-title">对照页有 {props.count} 条裁决</h2>
        <p>应用后会改写下面编辑区的对应文字；只有编辑区的内容会进入导出。</p>
        {props.customCount > 0 ? (
          <p className="qx-rd-pending" role="note">
            自己写的 {props.customCount} 条不会被应用，请在编辑区自行修改。
          </p>
        ) : null}
        <div className="qx-rd-dialog-actions">
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onSkip}>
            暂不应用
          </button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={props.onApply}>
            应用到编辑区
          </button>
        </div>
      </div>
    </div>
  )
}
