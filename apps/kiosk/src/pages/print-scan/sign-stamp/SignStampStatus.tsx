import { AlertTriangleIcon, InfoIcon, LockIcon } from 'lucide-react'
import type { StatusCopy } from './signStampModel'

/** 这一屏的状态卡：标题、一句话、几枚标签。按种类换底色（稿的 .fs-fact 同一副样子）。 */
export function SignStampStatus({ copy }: { copy: StatusCopy }) {
  const Icon = copy.kind === 'lock' ? LockIcon : copy.kind === 'info' ? InfoIcon : AlertTriangleIcon
  return (
    <div className="ss-card" data-kind={copy.kind} data-testid="sign-stamp-fallback">
      <div className="ss-card-h">
        <Icon size={28} aria-hidden />
        {copy.title}
      </div>
      <p className="ss-card-p">{copy.body}</p>
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
