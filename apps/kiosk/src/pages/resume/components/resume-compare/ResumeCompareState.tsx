import { QxTouchIcon } from '../../../../components/qingxu/touch/QxTouchIcon'

/** 没有可对照的内容时的说明：缺简历 / 读取中 / AI 不可用 / 没有候选。 */
export function ResumeCompareState(props: {
  title: string
  description: string
  busy?: boolean
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="qxt-state" data-tone={props.busy ? 'info' : 'empty'} role={props.busy ? 'status' : 'alert'}>
      {props.busy ? <span className="qxt-state-spin" aria-hidden="true" /> : <QxTouchIcon name="alert" size={40} strokeWidth={2} />}
      <div>
        <b>{props.title}</b>
        <p>{props.description}</p>
        {props.actionLabel && props.onAction ? <button type="button" className="qxt-use qxt-use-pri" onClick={props.onAction}>{props.actionLabel}</button> : null}
      </div>
    </div>
  )
}
