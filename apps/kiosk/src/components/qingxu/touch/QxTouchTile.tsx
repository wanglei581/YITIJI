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
  /** 服务台走查钩子。不传则不写 data-hub-*，原有磁贴不变。 */
  hub?: { kind: 'card' | 'quick' | 'goal'; title: string; reason?: string | null }
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
  hub,
}: QxTouchTileProps) {
  const hubAttrs = hub ? {
    'data-hub-card': hub.kind === 'card' ? '' : undefined,
    'data-hub-quick': hub.kind === 'quick' ? '' : undefined,
    'data-hub-goal': hub.kind === 'goal' ? '' : undefined,
    'data-hub-title': hub.title,
    'data-hub-reason': hub.reason || undefined,
  } : undefined
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
      <div className={className} style={style} {...hubAttrs}>
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
      {...hubAttrs}
      onClick={() => {
        if (off) return
        onClick?.()
      }}
    >
      {body}
    </button>
  )
}
