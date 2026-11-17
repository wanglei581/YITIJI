/** 对照页里换不上的那一条：不画选择按钮，说明用总览同一句，按钮去编辑区停在这句原文。 */
export function ResumeCompareManual(props: {
  note: string
  disabled: boolean
  title?: string
  onEdit: () => void
}) {
  return (
    <div className="qxt-manual" role="status" data-testid="compare-manual">
      <span className="qxt-hand">只能手改</span>
      <p>{props.note}</p>
      <button type="button" className="qxt-goedit" disabled={props.disabled} title={props.title} onClick={props.onEdit}>去编辑区改这一条</button>
    </div>
  )
}
