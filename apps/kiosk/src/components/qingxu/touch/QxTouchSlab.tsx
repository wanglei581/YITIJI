import type { CSSProperties, ReactNode } from 'react'
import { QxTouchChip, type QxTouchChipTone } from './QxTouchChip'
import { QxTouchIcon } from './QxTouchIcon'

export type QxTouchSlabProps = {
  title: string
  desc: string
  chip?: string
  chipTone?: QxTouchChipTone
  visual?: ReactNode
  take?: string
  takeStyle?: 'object' | 'plain'
  row?: boolean
  dark?: boolean
  off?: boolean
  compact?: boolean
  lock?: string
  onClick?: () => void
  index?: number
}

export function QxTouchSlab({
  title,
  desc,
  chip,
  chipTone = 'teal',
  visual,
  take,
  takeStyle = 'object',
  row = false,
  dark = false,
  off = false,
  compact = false,
  lock,
  onClick,
  index = 0,
}: QxTouchSlabProps) {
  const className = [
    'qxt-slab',
    'qxt-rise',
    row ? 'qxt-slab-row' : '',
    dark ? 'qxt-slab-dark' : '',
    off ? 'qxt-slab-off' : '',
    compact ? 'qxt-slab-compact' : '',
  ].filter(Boolean).join(' ')
  const style = { '--i': index } as CSSProperties
  const text = (
    <div className="qxt-slab-txt">
      {chip ? <QxTouchChip tone={chipTone}>{chip}</QxTouchChip> : null}
      <h3>{title}</h3>
      <p>{desc}</p>
      {lock ? <span className="qxt-lock">{lock}</span> : null}
      <div className="qxt-take">
        {take && takeStyle === 'object' ? (
          <>
            <QxTouchIcon name="check" size={26} strokeWidth={2.6} />
            <span>带走：{take}</span>
          </>
        ) : null}
        {take && takeStyle === 'plain' ? (
          <>
            <QxTouchIcon name="arrowR" size={26} strokeWidth={2.4} />
            <span>{take}</span>
          </>
        ) : null}
        {takeStyle === 'plain' ? null : (
          <span className="qxt-go"><QxTouchIcon name="arrowR" size={30} strokeWidth={2.4} /></span>
        )}
      </div>
    </div>
  )
  const art = <div className="qxt-vis">{visual}</div>
  const body = row ? <>{art}{text}</> : <>{text}{art}</>
  if (off || !onClick) {
    return <div className={className} style={style} role="group" aria-disabled={off ? 'true' : undefined}>{body}</div>
  }
  return <button type="button" className={className} style={style} onClick={onClick}>{body}</button>
}
