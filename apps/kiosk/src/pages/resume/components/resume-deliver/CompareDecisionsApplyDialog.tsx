import { QxTouchOverlay } from '../../../../components/qingxu/touch/QxTouchOverlay'

/** 从对照页带回裁决时先问一句：应用会改写编辑区里对应的文字，不应用则不动。 */
export function CompareDecisionsApplyDialog(props: {
  count: number
  customCount: number
  onApply: () => void
  onSkip: () => void
}) {
  return (
    <QxTouchOverlay
      kind="dialog"
      title={`对照页有 ${props.count} 条裁决`}
      onClose={props.onSkip}
      actions={(
        <>
          <button type="button" className="qxt-btn qxt-btn-pri" onClick={props.onApply}>应用到编辑区</button>
          <button type="button" className="qxt-btn qxt-btn-sec" onClick={props.onSkip}>暂不应用</button>
        </>
      )}
    >
      <p>应用后会改写下面编辑区的对应文字；只有编辑区的内容会进入导出。</p>
      {props.customCount > 0 ? (
        <p role="note">自己写的 {props.customCount} 条不会被应用，请在编辑区自行修改。</p>
      ) : null}
    </QxTouchOverlay>
  )
}
