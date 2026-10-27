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
  /** 停用原因。不传则不渲染原因句。 */
  reason?: string
  /** 标题标签。默认 b，与改前一致。 */
  titleAs?: 'b' | 'h3'
  testId?: string
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
  reason,
  titleAs = 'b',
  testId,
}: QxTouchTileProps) {
  const className = `qxt-tile qxt-rise${off ? ' qxt-off qxt-hold' : ''}${layout === 'stack' ? ' qxt-tile-stack' : ''}`
  const style = { '--i': index } as CSSProperties
  const TitleTag = titleAs === 'h3' ? 'h3' : 'b'
  const body = (
    <>
      <span className={`qxt-ic${tone === 'teal' ? '' : ` qxt-ic-${tone}`}`}>
        <QxTouchIcon name={icon} size={34} strokeWidth={2} />
      </span>
      <span className="qxt-tx">
        <TitleTag>{title}</TitleTag>
        <small>{desc}</small>
        {reason ? <span className="qxt-tile-why">{reason}</span> : null}
      </span>
      {off ? null : <span className="qxt-chev"><QxTouchIcon name="chevR" size={30} strokeWidth={2.2} /></span>}
    </>
  )
  if (!off && !onClick) {
    return (
      <div className={className} style={style} data-testid={testId}>
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
      data-testid={testId}
      onClick={() => {
        if (off) return
        onClick?.()
      }}
    >
      {body}
    </button>
  )
}
