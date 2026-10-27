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
  held?: boolean
  pressable?: boolean
  dark?: boolean
  onClick?: () => void
  index?: number
  label?: string
  extra?: ReactNode
  testId?: string
  disabledReason?: string
  className?: string
}

export function QxTouchTask({
  icon,
  title,
  desc,
  chip,
  chipTone = 'teal',
  visual,
  take,
  held = false,
  pressable = false,
  dark = false,
  onClick,
  index = 0,
  label,
  extra,
  testId,
  disabledReason,
  className: classNameProp,
}: QxTouchTaskProps) {
  const interactive = Boolean(onClick) && (!held || pressable)
  const className = [
    'qxt-task',
    'qxt-rise',
    held ? 'qxt-hold' : '',
    pressable ? 'qxt-press' : '',
    dark ? 'qxt-task-dark' : '',
    classNameProp ?? '',
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
          <QxTouchIcon name="arrowR" size={24} strokeWidth={2.6} />
          <span>{take}</span>
        </div>
      ) : null}
      {extra}
    </>
  )
  if (!interactive) {
    return (
      <div
        className={className}
        style={style}
        role="group"
        aria-disabled="true"
        aria-label={label ?? title}
        data-testid={testId}
        data-disabled-reason={disabledReason}
      >
        {body}
      </div>
    )
  }
  return (
    <button type="button" className={className} style={style} onClick={onClick} aria-label={label} data-testid={testId}>
      {body}
    </button>
  )
}
