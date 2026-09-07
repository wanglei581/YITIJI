import { AlertCircleIcon, Loader2Icon } from 'lucide-react'

export function ResumeCompareState(props: {
  title: string
  description: string
  busy?: boolean
  actionLabel?: string
  onAction?: () => void
}) {
  const Icon = props.busy ? Loader2Icon : AlertCircleIcon
  return (
    <div className="qx-state qxc-state" data-tone={props.busy ? 'info' : 'empty'} role={props.busy ? 'status' : 'alert'}>
      <span className="qx-state-ic"><Icon size={32} className={props.busy ? 'qxc-spin' : undefined} aria-hidden="true" /></span>
      <div>
        <p className="qx-state-t">{props.title}</p>
        <p className="qx-state-d">{props.description}</p>
        {props.actionLabel && props.onAction ? <button type="button" className="qx-btn qxc-state-action" data-variant="ghost" onClick={props.onAction}>{props.actionLabel}</button> : null}
      </div>
    </div>
  )
}
