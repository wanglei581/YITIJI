import { AlertTriangleIcon, InfoIcon, LockIcon } from 'lucide-react'
import type { StatusCopy } from './signStampModel'

export function SignStampStatus({ copy }: { copy: StatusCopy }) {
  const Icon = copy.kind === 'lock' ? LockIcon : copy.kind === 'info' ? InfoIcon : AlertTriangleIcon
  return (
    <div className="ss-state" data-kind={copy.kind} data-testid="sign-stamp-fallback">
      <div className="ss-state-h">
        <Icon size={28} aria-hidden />
        {copy.title}
      </div>
      <p className="ss-state-p">{copy.body}</p>
      <div className="ss-chips">
        {copy.chips.map((chip) => (
          <span key={chip.text} className="ss-chip" data-tone={chip.tone}>
            {chip.text}
          </span>
        ))}
      </div>
    </div>
  )
}
