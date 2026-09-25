import { useContext, useId, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { screenReasonCopy } from '../screenCopy'
import type { ScreenMetricLike } from '../ScreenPrimitives'
import { TwinPanelHeadingContext } from './TwinFrame'

/**
 * 孪生大屏的面板。
 *
 * 与卡片栅格版同一条硬约束：**每块都带来源口径**。设计稿面板很密，脚注挤不下，
 * 所以口径收进标题行的「i」按钮里（点开看，读屏器可达），但 `source` 仍是必填 prop ——
 * 做成可选，早晚会有一块漏掉。
 */

export type TwinTone = 'acc' | 'info' | 'warn' | 'err'

const TONE_BAR: Record<TwinTone, string | undefined> = {
  acc: undefined,
  info: '#8fb2ee',
  warn: '#e8b45c',
  err: '#e88b7d',
}

export interface TwinPanelProps {
  title: string
  /** 标题右侧的窗口说明，例「近 24 小时」。 */
  sub?: string
  /** 口径角标，例「全市口径」：本块不随当前筛选变化时必须标出。 */
  scope?: string
  tone?: TwinTone
  /** 来源与口径说明。必填。 */
  source: ReactNode
  className?: string
  children: ReactNode
}

export function TwinPanel({ title, sub, scope, tone = 'acc', source, className, children }: TwinPanelProps) {
  const [open, setOpen] = useState(false)
  const popId = useId()
  const headingId = useId()
  const bar = TONE_BAR[tone]
  const Heading = useContext(TwinPanelHeadingContext) === 2 ? 'h2' : 'h3'
  return (
    <section className={cn('twin-panel', className)} aria-labelledby={headingId}>
      <div className="twin-ph">
        <span className="twin-ph-bar" style={bar ? { ['--tw-bar' as string]: bar } : undefined} aria-hidden="true" />
        <Heading className="twin-ph-t" id={headingId}>{title}</Heading>
        {sub ? <span className="twin-ph-sub">{sub}</span> : null}
        {scope ? <span className="twin-scope">{scope}</span> : null}
        <button
          type="button"
          className="twin-info"
          aria-label={`${title}的口径说明`}
          aria-expanded={open}
          aria-controls={popId}
          onClick={() => setOpen(!open)}
          style={sub || scope ? undefined : { marginLeft: 'auto' }}
        >
          i
        </button>
      </div>
      {open ? (
        <div className="twin-pop" id={popId} role="note">
          {source}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export interface TwinUnavailableProps {
  reason: string
}

/** 未接入块：一句为什么 + 一句怎么接。绝不显示 0。取数失败用实线朱色，与结构性缺口一眼可分。 */
export function TwinUnavailable({ reason }: TwinUnavailableProps) {
  const copy = screenReasonCopy(reason)
  return (
    <div className={cn('twin-na', copy.transient && 'is-failed')} role="note">
      <b>{copy.title}</b>
      <span>{copy.detail}</span>
    </div>
  )
}

export interface TwinMetricPanelProps<T> extends Omit<TwinPanelProps, 'children' | 'source'> {
  metric: ScreenMetricLike<T> | undefined
  /** 有值时的口径说明；未接入时自动换成「原因 + 接入方式」。 */
  source: ReactNode
  /** 有值时怎么画。只有这里能碰数字。 */
  render: (value: T) => ReactNode
  /** 服务端没下发这个指标时的兜底原因。 */
  absentReason?: string
}

/**
 * 唯一的取数渲染入口：available:false 或缺席 → 未接入块；available:true → 调用方的 render。
 * 调用方没有机会写出 `?? 0` 这种兜底。
 */
export function TwinMetricPanel<T>({ metric, source, render, absentReason = 'source_query_failed', ...panel }: TwinMetricPanelProps<T>) {
  if (!metric || metric.available === false) {
    const reason = metric ? metric.reason : absentReason
    const copy = screenReasonCopy(reason)
    return (
      <TwinPanel
        {...panel}
        source={
          <>
            {copy.howTo}
            {metric ? <>（来源 {metric.source} · 窗口 {metric.window}）</> : null}
          </>
        }
      >
        <TwinUnavailable reason={reason} />
      </TwinPanel>
    )
  }
  return (
    <TwinPanel {...panel} source={source}>
      {render(metric.value)}
    </TwinPanel>
  )
}
