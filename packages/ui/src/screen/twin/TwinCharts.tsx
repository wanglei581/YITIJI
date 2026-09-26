import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { screenCount } from '../ScreenPrimitives'
import { TwinReasonChip } from './TwinReasonChip'

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

export function TwinTiles({ items, cols = 2, compact = false }: { items: TwinTileItem[]; cols?: 2 | 3 | 4; compact?: boolean }) {
  return (
    <div className={cn('twin-tiles', cols === 3 && 'is-3', cols === 4 && 'is-4', compact && 'is-compact')}>
      {items.map((item) => {
        return (
          <div className="twin-tile" key={item.label}>
            {item.unavailableReason ? (
              <TwinReasonChip reason={item.unavailableReason} />
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
  /** 行里的说明文字；放不下时省略号截断，完整一句在悬停提示里。 */
  text: string
  whenText?: string
  /** 链接目标（中键 / Ctrl 点击新开）。有 onClick 时普通点击走 onClick。 */
  href?: string
  /** 点这一行做什么。给了它这一行就可点、可 Tab 聚焦：有 href 是链接，没有 href 是按钮。 */
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
            <span className="twin-alert-text" title={item.text}>
              {item.text}
            </span>
            {item.whenText ? <span className="twin-when">{item.whenText}</span> : null}
          </>
        )
        if (item.href) {
          return (
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
          )
        }
        // 没有链接目标、但有动作（展示档、机构端）：仍是一个可聚焦、可按回车的真按钮，不是一块死的 div
        if (item.onClick) {
          return (
            <button key={item.key} type="button" className="twin-alert" onClick={item.onClick}>
              {body}
            </button>
          )
        }
        return (
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

/** 少于 5 的计数服务端给 null：一律写「少于 5」，不补 0。 */
export function twinSmall(count: number | null): string {
  return count === null ? '少于 5' : screenCount(count)
}

export interface TwinHeatProps {
  /** 每行一天：label 如「周六」「今天」，hours 24 项；null = 少于 5 或尚未到来。 */
  rows: Array<{ key: string; label: string; hours: Array<number | null>; future?: number }>
}

/** 7 天 × 24 小时热力：颜色深浅按全图最大值的真实比例，少于 5 的格子只画虚线框。 */
export function TwinHeat({ rows }: TwinHeatProps) {
  let max = 0
  for (const row of rows) {
    for (const value of row.hours) {
      if (value !== null && value > max) max = value
    }
  }
  return (
    <div className="twin-heat" role="img" aria-label="近 7 天每小时使用次数热力">
      {rows.map((row) => (
        <div key={row.key} style={{ display: 'contents' }}>
          <b>{row.label}</b>
          {row.hours.map((value, hour) => {
            if (row.future !== undefined && hour >= row.future) return <i key={hour} />
            if (value === null) return <i key={hour} className="is-hidden" />
            const ratio = max > 0 ? value / max : 0
            return (
              <i
                key={hour}
                style={{
                  background: `rgba(46,230,168,${(0.12 + ratio * 0.82).toFixed(2)})`,
                  boxShadow: ratio > 0.85 ? '0 0 8px rgba(46,230,168,.6)' : undefined,
                }}
              />
            )
          })}
        </div>
      ))}
      <b />
      {Array.from({ length: 24 }, (_, hour) => (
        <b key={`axis-${hour}`} style={{ textAlign: 'center' }}>
          {hour % 6 === 0 ? hour : ''}
        </b>
      ))}
    </div>
  )
}

export interface TwinPulseProps {
  buckets: Array<{ key: string; info: number | null; ai: number | null; print: number | null }>
}

const PULSE_COLOR = { info: '#8fb2ee', ai: '#2ee6a8', print: '#72d6ff' } as const

/** 每 5 分钟一柱：信息 / AI / 打印三段堆叠；少于 5 的段不画（服务端已置 null）。 */
export function TwinPulse({ buckets }: TwinPulseProps) {
  const max = buckets.reduce((best, b) => {
    const sum = (b.info === null ? 0 : b.info) + (b.ai === null ? 0 : b.ai) + (b.print === null ? 0 : b.print)
    return sum > best ? sum : best
  }, 0)
  const scale = max > 0 ? 70 / max : 0
  return (
    <div className="twin-pulse" role="img" aria-label="近 2 小时每 5 分钟调用次数">
      {buckets.map((b, i) => (
        <span key={b.key} className={i === buckets.length - 1 ? 'is-now' : undefined}>
          {(['info', 'ai', 'print'] as const).map((lane) => {
            const value = b[lane]
            if (value === null || value === 0) return null
            return <i key={lane} style={{ height: Math.max(2, Math.round(value * scale)), background: PULSE_COLOR[lane], color: PULSE_COLOR[lane] }} />
          })}
        </span>
      ))}
    </div>
  )
}

export interface TwinStepItem {
  label: string
  /** 数字；null = 少于 5；unavailableReason 有值 = 还没有记录。 */
  count: number | null
  unavailableReason?: string
}

export function TwinSteps({ items }: { items: TwinStepItem[] }) {
  return (
    <div className="twin-steps">
      {items.map((item, i) => {
        return (
          <div key={item.label} style={{ display: 'contents' }}>
            {i > 0 ? <span className="twin-arrow" aria-hidden="true">›</span> : null}
            <div className={cn('twin-step', i === items.length - 1 && 'is-end')}>
              {item.unavailableReason ? <TwinReasonChip reason={item.unavailableReason} /> : <b>{twinSmall(item.count)}</b>}
              <span>{item.label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
