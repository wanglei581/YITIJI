import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { screenCount } from '../ScreenPrimitives'
import { screenReasonCopy } from '../screenCopy'

/**
 * 孪生大屏的图表小件。只画调用方给的真实值：条长、弧长都按真实比例，不做视觉放大；
 * 没有值的格子显示原因，不显示 0。
 */

export type TwinState = 'ok' | 'pr' | 'wa' | 'off' | 'un'

const DOT_CLASS: Record<TwinState, string> = {
  ok: 's-ok',
  pr: 's-pr',
  wa: 's-wa is-warn',
  off: 's-off is-off',
  un: 's-un is-un',
}

export function TwinDot({ state }: { state: TwinState }) {
  return <i className={cn('twin-dot', DOT_CLASS[state])} aria-hidden="true" />
}

export interface TwinLegendItem {
  state: TwinState
  label: string
}

export function TwinLegend({ items }: { items: TwinLegendItem[] }) {
  return (
    <div className="twin-legend">
      {items.map((item) => (
        <span className="twin-lg" key={item.label}>
          <TwinDot state={item.state} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

export interface TwinRingProps {
  value: number
  total: number
  size?: number
  children?: ReactNode
}

/** 环形占比：弧长 = value / total 的真实比例；total 为 0 时整圈空。 */
export function TwinRing({ value, total, size = 168, children }: TwinRingProps) {
  const sw = 13
  const r = (size - sw) / 2
  const c = 2 * Math.PI * r
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={sw} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--tw-acc)"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${(c * ratio).toFixed(1)} ${c.toFixed(1)}`}
          style={{ filter: 'drop-shadow(0 0 8px rgba(46,230,168,.7))' }}
        />
        <circle cx={size / 2} cy={size / 2} r={r - sw - 6} fill="none" stroke="rgba(46,230,168,.25)" strokeWidth="1" strokeDasharray="3 6" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </div>
    </div>
  )
}

export interface TwinTrendDay {
  /** Asia/Shanghai 自然日，YYYY-MM-DD。 */
  date: string
  value: number
}

export interface TwinAreaTrendProps {
  days: TwinTrendDay[]
  seriesLabel: string
  width?: number
  height?: number
}

function shortDay(date: string): string {
  const parts = date.split('-')
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : date
}

/** 面积折线。纵轴从 0 起，按真实最大值取整到千位；全为 0 时画真实的零线。 */
export function TwinAreaTrend({ days, seriesLabel, width = 380, height = 190 }: TwinAreaTrendProps) {
  const gradientId = useId()
  if (days.length === 0) return <p className="twin-empty">没有可画的日数据</p>
  const top = 22
  const bottom = 30
  const left = 38
  const right = 10
  const max = days.reduce((best, day) => (day.value > best ? day.value : best), 0)
  const step = max <= 1000 ? 500 : 1000
  const yMax = Math.max(step, Math.ceil(max / step) * step)
  const xs = days.map((_, i) => left + (i * (width - left - right)) / Math.max(days.length - 1, 1))
  const ys = days.map((day) => top + (1 - day.value / yMax) * (height - top - bottom))
  const line = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ')
  const area = `${line} L${xs[xs.length - 1].toFixed(1)} ${height - bottom} L${xs[0].toFixed(1)} ${height - bottom} Z`
  const peakIndex = max > 0 ? days.findIndex((day) => day.value === max) : -1
  const ticks = [0, yMax / 2, yMax]
  const labelEvery = Math.max(1, Math.ceil(days.length / 5))
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={seriesLabel} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2ee6a8" stopOpacity=".45" />
          <stop offset="1" stopColor="#2ee6a8" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => {
        const y = top + (1 - tick / yMax) * (height - top - bottom)
        return (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y} y2={y} stroke="rgba(255,255,255,.07)" />
            <text x={left - 6} y={y + 4} fill="#8fb3a8" fontSize="13" textAnchor="end">
              {tick >= 1000 ? `${tick / 1000}k` : String(tick)}
            </text>
          </g>
        )
      })}
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke="var(--tw-acc)" strokeWidth="2.5" style={{ filter: 'drop-shadow(0 0 6px rgba(46,230,168,.8))' }} />
      {peakIndex >= 0 ? (
        <g>
          <circle cx={xs[peakIndex]} cy={ys[peakIndex]} r="5" fill="#04140f" stroke="var(--tw-acc)" strokeWidth="2.5" />
          <text x={xs[peakIndex]} y={ys[peakIndex] - 12} fill="#f4fdfa" fontSize="13" fontWeight="700" textAnchor="middle">
            峰值 {screenCount(max)}
          </text>
        </g>
      ) : null}
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="6" fill="var(--tw-acc)" style={{ filter: 'drop-shadow(0 0 6px #2ee6a8)' }} />
      {days.map((day, i) =>
        i % labelEvery === 0 || i === days.length - 1 ? (
          <text key={day.date} x={xs[i]} y={height - 8} fill="#8fb3a8" fontSize="13" textAnchor="middle">
            {shortDay(day.date)}
          </text>
        ) : null,
      )}
    </svg>
  )
}

export interface TwinBarItem {
  label: string
  value: number
  valueText?: string
  tone?: 'acc' | 'info' | 'error'
}

export function TwinBarList({ items, emptyText }: { items: TwinBarItem[]; emptyText: string }) {
  if (items.length === 0) return <p className="twin-empty">{emptyText}</p>
  const max = items.reduce((best, item) => (item.value > best ? item.value : best), 0)
  return (
    <div className="twin-bars">
      {items.map((item) => {
        const percent = max > 0 ? Math.round((item.value / max) * 100) : 0
        return (
          <div className="twin-bar-row" key={item.label}>
            <span title={item.label}>{item.label}</span>
            <span
              className={cn('twin-hbar', item.tone === 'info' && 'is-info', item.tone === 'error' && 'is-error')}
              role="progressbar"
              aria-label={item.label}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ width: `${percent}%` }} />
            </span>
            <b>{item.valueText ?? screenCount(item.value)}</b>
          </div>
        )
      })}
    </div>
  )
}

export interface TwinTileItem {
  /** 已格式化的主数字；unavailableReason 有值时忽略。 */
  value?: string
  unit?: string
  label: string
  hint?: string
  unavailableReason?: string
}

export function TwinTiles({ items }: { items: TwinTileItem[] }) {
  return (
    <div className="twin-tiles">
      {items.map((item) => {
        const copy = item.unavailableReason ? screenReasonCopy(item.unavailableReason) : null
        return (
          <div className="twin-tile" key={item.label}>
            {copy ? (
              <span className="twin-pend" title={copy.detail}>{copy.title}</span>
            ) : (
              <b>
                {item.value}
                {item.unit ? <span className="twin-unit">{item.unit}</span> : null}
              </b>
            )}
            <span>
              {item.label}
              {item.hint ? <small> · {item.hint}</small> : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export interface TwinAlertItem {
  key: string
  severity: 'err' | 'warn' | 'un'
  severityText: string
  code: string
  text: string
  whenText?: string
  href?: string
  onClick?: () => void
}

export function TwinAlertList({ items, emptyText }: { items: TwinAlertItem[]; emptyText: string }) {
  if (items.length === 0) return <p className="twin-empty">{emptyText}</p>
  return (
    <div className="twin-alerts">
      {items.map((item) => {
        const body = (
          <>
            <span className={cn('twin-sev', item.severity === 'err' && 'is-err', item.severity === 'un' && 'is-un')}>{item.severityText}</span>
            <span className="twin-code">{item.code}</span>
            <span>{item.text}</span>
            {item.whenText ? <span className="twin-when">{item.whenText}</span> : null}
          </>
        )
        return item.href ? (
          <a
            key={item.key}
            className="twin-alert"
            href={item.href}
            onClick={(event) => {
              if (!item.onClick || event.metaKey || event.ctrlKey) return
              event.preventDefault()
              item.onClick()
            }}
          >
            {body}
          </a>
        ) : (
          <div key={item.key} className="twin-alert">
            {body}
          </div>
        )
      })}
    </div>
  )
}

export interface TwinTimelineSegment {
  from: string
  to: string
  state: 'idle' | 'printing' | 'alert' | 'offline' | 'unknown'
}

const TIMELINE_COLOR: Record<TwinTimelineSegment['state'], string> = {
  idle: '#2ee6a8',
  printing: '#72d6ff',
  alert: '#e8b45c',
  offline: '#e88b7d',
  unknown: 'rgba(125,143,137,.45)',
}

/** 24 小时状态条：段宽按真实时长。时间刻度由调用方按上海时区格式化后传入。 */
export function TwinTimeline({ segments, ticks }: { segments: TwinTimelineSegment[]; ticks: string[] }) {
  const spans = segments.map((seg) => Math.max(0, Date.parse(seg.to) - Date.parse(seg.from)))
  const total = spans.reduce((sum, value) => sum + value, 0)
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: 22 }} role="img" aria-label="近 24 小时状态">
        {segments.map((seg, i) => (
          <div
            key={`${seg.from}-${seg.state}`}
            style={{
              flexGrow: total > 0 ? spans[i] / total : 1,
              minWidth: 2,
              borderRadius: 4,
              background: TIMELINE_COLOR[seg.state],
              boxShadow: seg.state === 'unknown' ? 'none' : `0 0 10px ${TIMELINE_COLOR[seg.state]}`,
            }}
          />
        ))}
      </div>
      <div className="twin-num twin-muted" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        {ticks.map((tick, i) => (
          <span key={`${tick}-${i}`}>{tick}</span>
        ))}
      </div>
    </div>
  )
}
