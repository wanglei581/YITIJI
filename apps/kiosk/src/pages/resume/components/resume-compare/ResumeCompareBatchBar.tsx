/** 三条批量动作（稿 compare）：可采纳的全部采纳 / 其余保留原文 / 清空全部选择。提示写在页面的「选择草稿」那一行。 */
export function ResumeCompareBatchBar(props: {
  onAdoptEligible: () => void
  onKeepUndecided: () => void
  onClear: () => void
}) {
  return (
    <div className="qxt-batch" aria-label="批量处理" data-testid="resume-optimize-compare-batch">
      <button type="button" onClick={props.onAdoptEligible}>
        <b>可采纳的全部采纳</b>
        <small>跳过有待确认事实的那几条</small>
      </button>
      <button type="button" onClick={props.onKeepUndecided}>
        <b>其余保留原文</b>
        <small>把还没决定的都记为保留</small>
      </button>
      <button type="button" data-tone="danger" onClick={props.onClear}>
        <b>清空全部选择</b>
        <small>全部回到待定</small>
      </button>
    </div>
  )
}
