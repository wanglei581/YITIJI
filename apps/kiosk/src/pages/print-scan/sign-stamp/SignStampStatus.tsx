import type { ReactNode } from 'react'
import { AlertTriangleIcon, InfoIcon, LockIcon } from 'lucide-react'
import type { StatusCopy } from './signStampModel'

/** 文案里的 `<b>` 只加粗稿上点名的那几个词，不解析其它标签。 */
function richInline(text: string): ReactNode {
  const nodes: ReactNode[] = []
  const re = /<b>([\s\S]*?)<\/b>/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    nodes.push(<b key={key}>{match[1]}</b>)
    key += 1
    last = match.index + match[0].length
  }
  if (nodes.length === 0) return text
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function SignStampStatus({ copy }: { copy: StatusCopy }) {
  const Icon = copy.kind === 'lock' ? LockIcon : copy.kind === 'info' ? InfoIcon : AlertTriangleIcon
  return (
    <div className="ss-state" data-kind={copy.kind} data-testid="sign-stamp-fallback">
      <div className="ss-state-h">
        <Icon size={28} aria-hidden />
        {richInline(copy.title)}
      </div>
      <p className="ss-state-p">{richInline(copy.body)}</p>
      {copy.more ? <p className="ss-state-p">{richInline(copy.more)}</p> : null}
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
