import type { CSSProperties, ReactNode } from 'react'
import { QxTouchChip, type QxTouchChipTone } from './QxTouchChip'
import { QxTouchIcon, type QxTouchIconName } from './QxTouchIcon'

export type QxTouchTaskProps = {
  icon: QxTouchIconName
  title: string
  desc: ReactNode
  chip?: string
  chipTone?: QxTouchChipTone
  visual?: ReactNode
  take?: string
  /** 不传时仍是箭头，和改前一样。 */
  takeIcon?: QxTouchIconName
  /** 不传时不加重前缀。 */
  takePrefix?: string
  held?: boolean
  pressable?: boolean
  dark?: boolean
  onClick?: () => void
  index?: number
  label?: string
}

export function QxTouchTask({
  icon,
  title,
  desc,
  chip,
  chipTone = 'teal',
  visual,
  take,
  takeIcon = 'arrowR',
  takePrefix = '',
  held = false,
  pressable = false,
  dark = false,
  onClick,
  index = 0,
  label,
}: QxTouchTaskProps) {
  const interactive = Boolean(onClick) && (!held || pressable)
  const className = [
    'qxt-task',
    'qxt-rise',
    held ? 'qxt-hold' : '',
    pressable ? 'qxt-press' : '',
    dark ? 'qxt-task-dark' : '',
  ].filter(Boolean).join(' ')
  const style = { '--i': index } as CSSProperties
  const body = (
    <>
      <div className="qxt-top">
        <span className="qxt-ic"><QxTouchIcon name={icon} size={held && !pressable ? 36 : 40} strokeWidth={2} /></span>
        {chip ? <QxTouchChip tone={chipTone}>{chip}</QxTouchChip> : null}
      </div>
      <h3>{title}</h3>
      <p>{desc}</p>
      {visual ? <div className="qxt-mini">{visual}</div> : null}
      {take ? (
        <div className="qxt-take">
          <QxTouchIcon name={takeIcon} size={24} strokeWidth={2.6} />
          <span>{takePrefix}{take}</span>
        </div>
      ) : null}
    </>
  )
  if (!interactive) {
    return (
      <div className={className} style={style} role="group" aria-disabled="true" aria-label={label ?? title}>
        {body}
      </div>
    )
  }
  return (
    <button type="button" className={className} style={style} onClick={onClick} aria-label={label}>
      {body}
    </button>
  )
}
