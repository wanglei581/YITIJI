import type { CSSProperties } from 'react'
import { QxTouchIcon, type QxTouchIconName } from './QxTouchIcon'

export type QxTouchTileTone = 'teal' | 'slate' | 'clay'

export type QxTouchTileProps = {
  icon: QxTouchIconName
  title: string
  desc: string
  tone?: QxTouchTileTone
  off?: boolean
  layout?: 'row' | 'stack'
  onClick?: () => void
  index?: number
  label?: string
}

export function QxTouchTile({
  icon,
  title,
  desc,
  tone = 'teal',
  off = false,
  layout = 'row',
  onClick,
  index = 0,
  label,
}: QxTouchTileProps) {
  const className = `qxt-tile qxt-rise${off ? ' qxt-off qxt-hold' : ''}${layout === 'stack' ? ' qxt-tile-stack' : ''}`
  const style = { '--i': index } as CSSProperties
  const body = (
    <>
      <span className={`qxt-ic${tone === 'teal' ? '' : ` qxt-ic-${tone}`}`}>
        <QxTouchIcon name={icon} size={34} strokeWidth={2} />
      </span>
      <span className="qxt-tx"><b>{title}</b><small>{desc}</small></span>
      {off ? null : <span className="qxt-chev"><QxTouchIcon name="chevR" size={30} strokeWidth={2.2} /></span>}
    </>
  )
  if (!off && !onClick) {
    return (
      <div className={className} style={style}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-disabled={off ? true : undefined}
      aria-label={label}
      onClick={() => {
        if (off) return
        onClick?.()
      }}
    >
      {body}
    </button>
  )
}
