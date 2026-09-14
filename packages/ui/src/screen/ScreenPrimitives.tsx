import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { screenReasonCopy } from './screenCopy'

/**
 * 大屏卡片原语。
 *
 * 三条硬约束写进了类型与结构，不靠评审保证：
 *   1. `foot` 是必填 prop —— 设计稿第一条硬约束是「每块卡片都必须带来源脚注」。
 *      做成可选，早晚会有一块漏掉。
 *   2. `ScreenMetricCard` 是唯一的取数渲染入口，available 分支由它统一收口，
 *      调用方只写「有值的时候长什么样」，没有机会写出 `?? 0` 这种兜底。
 *   3. 卡内一切子块（mini / li / gap-row）都是 panel-2 平面块，没有边框、圆角也不同，
 *      不构成第二层卡片。`.ops-card` 里不允许再出现 `.ops-card`。
 *
 * 本文件不 import `@ai-job-print/shared`（UI 包没有该依赖）。`ScreenMetricLike`
 * 与契约的 `ScreenMetric` 结构相同，调用方传真类型进来结构兼容。
 */

export type ScreenMetricLike<T> =
  | { available: true; source: string; window: string; value: T }
  | { available: false; source: string; window: string; reason: string }

export type ScreenTone = 'normal' | 'warn' | 'error'

const TONE_CLASS: Record<ScreenTone, string> = {
  normal: '',
  warn: 'is-warn',
  error: 'is-error',
}

/** 固定千分位，不走 toLocaleString —— 那东西随浏览器 locale 变，断言会飘。 */
export function screenCount(value: number): string {
  const sign = value < 0 ? '-' : ''
  const digits = Math.abs(Math.trunc(value)).toString()
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export interface ScreenCardProps {
  title: string
  /** 标题右侧的窗口标签，例「近 24 小时」。 */
  tag?: string
  /** 口径脚注：写清模型 / 端点、统计窗口与口径。必填。 */
  foot: ReactNode
  /** 12 列栅格跨列数。 */
  span?: 2 | 3 | 4 | 6 | 8 | 12
  /** 占两行的高卡（设备墙 / 告警 / 任务流）。 */
  tall?: boolean
  /** 结构性未接入走虚线，本次取数失败走陶色实线，两者必须一眼可分。 */
  variant?: 'normal' | 'unavailable' | 'failed'
  className?: string
  children: ReactNode
}

export function ScreenCard({
  title,
  tag,
  foot,
  span = 3,
  tall = false,
  variant = 'normal',
  className,
  children,
}: ScreenCardProps) {
  const headingId = `ops-card-${title.replace(/\s+/g, '-')}`
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'ops-card',
        `ops-span-${span}`,
        tall && 'ops-tall',
        variant === 'unavailable' && 'is-na',
        variant === 'failed' && 'is-na is-failed',
        className,
      )}
    >
      <h2 id={headingId}>
        <span className="ops-h2-text">{title}</span>
        {tag ? <span className="ops-tag">{tag}</span> : null}
      </h2>
      <div className="ops-body">{children}</div>
      <div className="ops-foot">{foot}</div>
    </section>
  )
}

export interface ScreenUnavailableProps {
  reason: string
}

/** 未接入块：一句为什么 + 一句怎么接。绝不显示 0，绝不放占位动画。 */
export function ScreenUnavailable({ reason }: ScreenUnavailableProps) {
  const copy = screenReasonCopy(reason)
  return (
    <div className="ops-na" role="note">
      <div className="ops-na-t">{copy.title}</div>
      <div className="ops-na-d">{copy.detail}</div>
    </div>
  )
}

export interface ScreenMetricCardProps<T> {
  title: string
  tag?: string
  metric: ScreenMetricLike<T> | undefined
  /** 有值时怎么画。只有这里能碰数字。 */
  render: (value: T) => ReactNode
  /** 有值时的脚注。未接入时自动换成「原因 + 接入方式」。 */
  foot: ReactNode
  span?: 2 | 3 | 4 | 6 | 8 | 12
  tall?: boolean
  /** 该 profile 不下发这个指标时的兜底说明（正常不会出现）。 */
  absentReason?: string
}

/**
 * 唯一的取数渲染入口。
 *
 * available:false → 未接入块 + 原因脚注；available:true → 调用方的 render。
 * 指标整个缺席（服务端没下发这个 key）按「本 profile 不含该指标」处理，
 * 同样不显示 0。
 */
export function ScreenMetricCard<T>({
  title,
  tag,
  metric,
  render,
  foot,
  span = 3,
  tall = false,
  absentReason = 'source_query_failed',
}: ScreenMetricCardProps<T>) {
  if (!metric || metric.available === false) {
    const reason = metric ? metric.reason : absentReason
    const copy = screenReasonCopy(reason)
    return (
      <ScreenCard
        title={title}
        tag={tag}
        span={span}
        tall={tall}
        variant={copy.transient ? 'failed' : 'unavailable'}
        foot={
          <>
            {copy.howTo}
            {metric ? <>（来源 {metric.source} · 窗口 {metric.window}）</> : null}
          </>
        }
      >
        <ScreenUnavailable reason={reason} />
      </ScreenCard>
    )
  }
  return (
    <ScreenCard title={title} tag={tag} span={span} tall={tall} foot={foot}>
      {render(metric.value)}
    </ScreenCard>
  )
}

export interface ScreenKpiProps {
  /** 已格式化的主数字。调用方负责格式化，这里不做任何缺省替换。 */
  value: string
  unit?: string
  /** 副行说明。为 null 时不渲染该行。 */
  label?: ReactNode
  tone?: ScreenTone
  /** 副行是灰字（说明性）而不是常规副标题。 */
  labelMuted?: boolean
}

export function ScreenKpi({ value, unit, label, tone = 'normal', labelMuted = false }: ScreenKpiProps) {
  return (
    <div className="ops-kpi">
      <div className={cn('ops-n', TONE_CLASS[tone])}>
        {value}
        {unit ? <span className="ops-u">{unit}</span> : null}
      </div>
      {label ? <div className={cn('ops-lb', labelMuted && 'ops-lb-muted')}>{label}</div> : null}
    </div>
  )
}

export interface ScreenBarItem {
  label: string
  /** 真实值。条长由本值与同组最大值的比例决定，不做视觉美化放大。 */
  value: number
  /** 已格式化的右侧数值文案；不传则用千分位整数。 */
  valueText?: string
  tone?: 'primary' | 'info' | 'warn' | 'error'
}

const BAR_TONE_CLASS: Record<NonNullable<ScreenBarItem['tone']>, string> = {
  primary: '',
  info: 'is-info',
  warn: 'is-warn',
  error: 'is-error',
}

export interface ScreenBarListProps {
  items: ScreenBarItem[]
  /** 全部为空时的说明句。真实为零与未接入是两回事，这句只用于真实为零。 */
  emptyText: string
}

export function ScreenBarList({ items, emptyText }: ScreenBarListProps) {
  if (items.length === 0) {
    return <p className="ops-empty">{emptyText}</p>
  }
  const max = items.reduce((best, item) => (item.value > best ? item.value : best), 0)
  return (
    <div className="ops-bars">
      {items.map((item) => {
        const percent = max > 0 ? Math.round((item.value / max) * 100) : 0
        return (
          <div className="ops-bar-r" key={item.label}>
            <span className="ops-bl" title={item.label}>
              {item.label}
            </span>
            <span
              className="ops-bar-t"
              role="progressbar"
              aria-label={item.label}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                className={cn('ops-bar-f', item.tone ? BAR_TONE_CLASS[item.tone] : '')}
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="ops-bv">{item.valueText ?? screenCount(item.value)}</span>
          </div>
        )
      })}
    </div>
  )
}

export interface ScreenMiniItem {
  /** 已格式化的主数字；unavailableReason 有值时忽略。 */
  value?: string
  label: string
  hint?: string
  /** 有值时该格降级为「未接入」，不显示 0。 */
  unavailableReason?: string
}

export interface ScreenMiniGridProps {
  items: ScreenMiniItem[]
  /** 紧凑档（定高行里放不下 40px 数字时用）。 */
  compact?: boolean
}

export function ScreenMiniGrid({ items, compact = false }: ScreenMiniGridProps) {
  return (
    <div className={cn('ops-mini', compact && 'is-sm')}>
      {items.map((item) => {
        const copy = item.unavailableReason ? screenReasonCopy(item.unavailableReason) : null
        return (
          <div className="ops-m" key={item.label}>
            <div className={cn('ops-mv', copy && 'is-na')}>{copy ? copy.title : item.value}</div>
            <div className="ops-mk">{item.label}</div>
            {copy || item.hint ? <div className="ops-ms">{copy ? copy.howTo : item.hint}</div> : null}
          </div>
        )
      })}
    </div>
  )
}
