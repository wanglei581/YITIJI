import type { ReactNode } from 'react'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import { SYNTHETIC_BANNER } from '../components/resume-deliver/constants'

/** 优化建议还没有时的状态说明：读取中（转圈）/ 没有建议 / 失败 / AI 暂时用不了。先说原因，下面接出路。 */
export function OptimizeStateCard(props: {
  tone: 'info' | 'empty' | 'error'
  title: string
  description: ReactNode
  synthetic?: boolean
  actions?: ReactNode
}) {
  return (
    <div className="qxt-state qxt-rise" data-tone={props.tone} role="status">
      {props.tone === 'info' ? <span className="qxt-state-spin" aria-hidden="true" /> : <QxTouchIcon name="alert" size={40} strokeWidth={2} />}
      <div>
        <b>{props.title}</b>
        <p>{props.description}</p>
        {props.synthetic ? <p>{SYNTHETIC_BANNER}</p> : null}
        {props.actions ? <div className="qxt-note-actions">{props.actions}</div> : null}
      </div>
    </div>
  )
}
