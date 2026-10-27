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
  chevron?: boolean
  /** 诚实状态短句（读取中 / 读取失败）。不传就不画。 */
  badge?: string
  /** 失败后的可见重试提示，不进 badge。 */
  cue?: string
  onClick?: () => void
  index?: number
  label?: string
  actionId?: string
  dataAttrs?: Record<string, string | undefined>
}

export function QxTouchTile({
  icon,
  title,
  desc,
  tone = 'teal',
  off = false,
  layout = 'row',
  chevron = true,
  badge,
  cue,
  onClick,
  index = 0,
  label,
  actionId,
  dataAttrs,
}: QxTouchTileProps) {
  const className = `qxt-tile qxt-rise${off ? ' qxt-off qxt-hold' : ''}${layout === 'stack' ? ' qxt-tile-stack' : ''}`
  const style = { '--i': index } as CSSProperties
  const body = (
    <>
      <span className={`qxt-ic${tone === 'teal' ? '' : ` qxt-ic-${tone}`}`}>
        <QxTouchIcon name={icon} size={34} strokeWidth={2} />
      </span>
      <span className="qxt-tx">
        <b>{title}</b>
        {badge ? <em className="qxt-tile-mark">{badge}</em> : null}
        <small>{desc}</small>
        {cue ? <span className="qxt-tile-cue">{cue}</span> : null}
      </span>
      {off || !chevron ? null : <span className="qxt-chev"><QxTouchIcon name="chevR" size={30} strokeWidth={2.2} /></span>}
    </>
  )
  const markers: Record<string, string> = {}
  if (actionId) markers['data-action'] = actionId
  for (const [key, value] of Object.entries(dataAttrs ?? {})) {
    if (value !== undefined) markers[`data-${key}`] = value
  }
  if (!off && !onClick) {
    return (
      <div className={className} style={style} {...markers}>
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
      {...markers}
      onClick={() => {
        if (off) return
        onClick?.()
      }}
    >
      {body}
    </button>
  )
}
