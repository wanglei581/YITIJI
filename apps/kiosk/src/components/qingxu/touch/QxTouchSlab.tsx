import type { CSSProperties, ReactNode } from 'react'
import { QxTouchChip, type QxTouchChipTone } from './QxTouchChip'
import { QxTouchIcon } from './QxTouchIcon'

export type QxTouchSlabProps = {
  title: string
  desc: string
  chip?: string
  chipTone?: QxTouchChipTone
  /** 可选。芯片前加一个 AI 小圆点（稿的「AI 诊断改写」这类标）。默认不加。 */
  chipAi?: boolean
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
  /** 服务台走查钩子。不传则不写 data-hub-*，原有宽卡不变。 */
  hub?: { kind: 'card' | 'quick' | 'goal'; title: string; reason?: string | null }
}

export function QxTouchSlab({
  title,
  desc,
  chip,
  chipTone = 'teal',
  chipAi = false,
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
  hub,
}: QxTouchSlabProps) {
  const hubAttrs = hub ? {
    'data-hub-card': hub.kind === 'card' ? '' : undefined,
    'data-hub-quick': hub.kind === 'quick' ? '' : undefined,
    'data-hub-goal': hub.kind === 'goal' ? '' : undefined,
    'data-hub-title': hub.title,
    'data-hub-reason': hub.reason || undefined,
  } : undefined
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
      {chip ? <QxTouchChip tone={chipTone} ai={chipAi}>{chip}</QxTouchChip> : null}
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
    return <div className={className} style={style} role="group" aria-disabled={off ? 'true' : undefined} {...hubAttrs}>{body}</div>
  }
  return <button type="button" className={className} style={style} onClick={onClick} {...hubAttrs}>{body}</button>
}
