import type { CSSProperties } from 'react'
import { QxTouchIcon, type QxTouchIconName } from './QxTouchIcon'
import { qxTouchDataMarkers, type QxTouchHubMarker } from './qxTouchMarkers'

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
  /** 停用原因，画在说明下面。不传就不画。 */
  reason?: string
  /** 标题标签。默认 b。 */
  titleAs?: 'b' | 'h3'
  testId?: string
  actionId?: string
  dataAttrs?: Record<string, string | undefined>
  /** 服务台走查钩子。不传则不写 data-hub-*。 */
  hub?: QxTouchHubMarker
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
  reason,
  titleAs = 'b',
  testId,
  actionId,
  dataAttrs,
  hub,
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
        {badge ? <em className="qxt-tile-mark">{badge}</em> : null}
        <small>{desc}</small>
        {reason ? <span className="qxt-tile-why">{reason}</span> : null}
        {cue ? <span className="qxt-tile-cue">{cue}</span> : null}
      </span>
      {off || !chevron ? null : <span className="qxt-chev"><QxTouchIcon name="chevR" size={30} strokeWidth={2.2} /></span>}
    </>
  )
  const markers = qxTouchDataMarkers({ actionId, dataAttrs, hub, testId })
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
