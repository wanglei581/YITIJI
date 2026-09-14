import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { screenReasonCopy } from './screenCopy'

/**
 * 大屏里的两种列表，都是 panel-2 平面行，**不是卡片**（无边框、圆角不同），
 * 所以不构成卡中卡。
 *
 *   ScreenAlertList —— 实时告警。截断必须如实说「已列出 N / 共 M 条」，
 *     这是 CLAUDE.md §9「不伪造能力」在列表上的具体形态：
 *     列了 20 条不等于只有 20 条。
 *
 *   ScreenGapList —— 未接入指标的归并面板（合作机构侧 21 个指标里 14 个不可用）。
 *     为什么不铺 14 张一模一样的虚线卡：那不是诚实，是噪音 ——
 *     它让屏看起来是坏的，还把 6 种不同成因压成同一个视觉。
 *     归并按原因分组，每一个指标名、每一条原因、每一条接入方式都照写，信息量不减。
 */

export interface ScreenAlertRow {
  key: string
  severity: string
  text: string
  time: string
}

export interface ScreenAlertListProps {
  rows: ScreenAlertRow[]
  /** 服务端给的仍在发生的总数，可能大于 rows.length。 */
  firingCount: number
  listedCount: number
  truncated: boolean
  emptyText: string
}

function severityClass(severity: string): string {
  if (severity === 'error') return 'is-error'
  if (severity === 'warning' || severity === 'warn') return 'is-warn'
  return ''
}

export function ScreenAlertList({
  rows,
  firingCount,
  listedCount,
  truncated,
  emptyText,
}: ScreenAlertListProps) {
  if (rows.length === 0) {
    return <p className="ops-empty">{emptyText}</p>
  }
  return (
    <div className="ops-list">
      {rows.map((row) => (
        <div className="ops-li" key={row.key}>
          <span className={cn('ops-sev', severityClass(row.severity))} aria-hidden="true" />
          <span className="ops-tx" title={row.text}>
            {row.severity === 'error' ? '严重 · ' : row.severity === 'warning' ? '警告 · ' : '提示 · '}
            {row.text}
          </span>
          <span className="ops-tm">{row.time}</span>
        </div>
      ))}
      {truncated ? (
        <p className="ops-more">已列出 {listedCount} / 共 {firingCount} 条</p>
      ) : null}
    </div>
  )
}

export interface ScreenGapEntry {
  /** 该原因下的指标中文名。 */
  labels: string[]
  reason: string
}

export interface ScreenGapListProps {
  entries: ScreenGapEntry[]
  emptyText: ReactNode
}

export function ScreenGapList({ entries, emptyText }: ScreenGapListProps) {
  if (entries.length === 0) {
    return <p className="ops-empty">{emptyText}</p>
  }
  return (
    <div className="ops-gap-list">
      {entries.map((entry) => {
        const copy = screenReasonCopy(entry.reason)
        return (
          <div className="ops-gap-row" key={entry.reason}>
            <div className="ops-gap-keys">
              {copy.title} · {entry.labels.join('、')}
            </div>
            <div className="ops-gap-why">
              {copy.detail}
              {copy.howTo}
            </div>
          </div>
        )
      })}
    </div>
  )
}
