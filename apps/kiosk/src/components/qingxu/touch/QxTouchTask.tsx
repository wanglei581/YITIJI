import { useId, type CSSProperties, type ReactNode } from 'react'
import { QxTouchChip, type QxTouchChipTone } from './QxTouchChip'
import { QxTouchIcon, type QxTouchIconName } from './QxTouchIcon'
import { qxTouchDataMarkers } from './qxTouchMarkers'

export type QxTouchTaskProps = {
  icon: QxTouchIconName
  title: string
  desc: ReactNode
  chip?: string
  chipTone?: QxTouchChipTone
  chipAi?: boolean
  visual?: ReactNode
  take?: string
  takeIcon?: QxTouchIconName
  /** 加在去处文字前面、不加重的前缀。 */
  takePrefix?: string
  note?: string
  held?: boolean
  pressable?: boolean
  dark?: boolean
  onClick?: () => void
  index?: number
  label?: string
  actionId?: string
  dataAttrs?: Record<string, string | undefined>
}

export function QxTouchTask({
  icon,
  title,
  desc,
  chip,
  chipTone = 'teal',
  chipAi = false,
  visual,
  take,
  takeIcon = 'arrowR',
  takePrefix = '',
  note,
  held = false,
  pressable = false,
  dark = false,
  onClick,
  index = 0,
  label,
  actionId,
  dataAttrs,
}: QxTouchTaskProps) {
  const titleId = useId()
  const descId = useId()
  const chipId = useId()
  const noteId = useId()
  const describedBy = [descId, chip ? chipId : '', note ? noteId : ''].filter(Boolean).join(' ')
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
        {chip ? <QxTouchChip id={chipId} tone={chipTone} ai={chipAi}>{chip}</QxTouchChip> : null}
      </div>
      <h3 id={titleId}>{title}</h3>
      <p id={descId}>{desc}</p>
      {note ? <small id={noteId} className="qxt-task-note">{note}</small> : null}
      {visual ? <div className="qxt-mini">{visual}</div> : null}
      {take ? (
        <div className="qxt-take">
          <QxTouchIcon name={takeIcon} size={24} strokeWidth={2.6} />
          <span>{takePrefix}{take}</span>
        </div>
      ) : null}
    </>
  )
  const markers = qxTouchDataMarkers({ actionId, dataAttrs })
  if (!interactive) {
    return (
      <div
        className={className}
        style={style}
        role="group"
        aria-disabled="true"
        aria-labelledby={label ? undefined : titleId}
        aria-describedby={label ? undefined : describedBy}
        aria-label={label}
        {...markers}
      >
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={onClick}
      aria-labelledby={label ? undefined : titleId}
      aria-describedby={label ? undefined : describedBy}
      aria-label={label}
      {...markers}
    >
      {body}
    </button>
  )
}
