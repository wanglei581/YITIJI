import type { ReactNode } from 'react'

export type ResumeStateTone = 'empty' | 'error' | 'info' | 'warn'

export function ResumeStatePanel(props: {
  tone: ResumeStateTone
  title: string
  description: ReactNode
  actions?: ReactNode
  synthetic?: boolean
}) {
  return (
    <div className="qx-state qx-rd-state qx-grow" data-tone={props.tone} role="status">
      <span className="qx-state-ic" aria-hidden="true">i</span>
      <div>
        <div className="qx-state-t">{props.title}</div>
        <div className="qx-state-d">{props.description}</div>
        {props.synthetic ? <p className="qx-rd-synthetic">合成演示</p> : null}
        {props.actions ? <div className="qx-rd-state-actions">{props.actions}</div> : null}
      </div>
    </div>
  )
}
