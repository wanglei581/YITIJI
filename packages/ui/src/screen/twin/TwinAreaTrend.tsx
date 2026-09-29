import { useCallback, useId, useRef, useState } from 'react'
import { screenCount } from '../ScreenPrimitives'

/**
 * 每日趋势面积折线。只画调用方给的真实值：纵轴从 0 起，上限按真实最大值取整档；全为 0 时画真实的零线。
 *
 * 服务端对少于 5 的计数给 null（「少于 5」，不是 0）。没有 null 的图照旧画（政务总览的打印趋势就是这一种，
 * 一个像素都不变）；只要有一天是 null，换成「有空缺」的画法：
 *   - 每一天占一个等宽的日格，点落在日格正中、日期写在点的正下方 —— 图边上不会有一个和日期对不上的孤点；
 *   - 少于 5 的日子画成日格底部的一段斜纹带，标「<5」（连续几天并成一段、只标一次）：标签放在带子上方，
 *     那里有真值的点或线挡着时（只有第二条少于 5 的日子常见）改写在带子里，不压线；
 *     两条序列都少于 5 用灰绿斜纹，只有第二条（虚线）少于 5 用金色斜纹；
 *   - 前后都是空缺的那一天是孤立点：画成空心圆点并写出它的数，不再是一个说不清的小圆点；
 *   - 小注「斜纹 = 少于 5，不显示具体数」写一次：缺省写在图的左上角；调用方有自己的图例行时
 *     传 gapNote={false}，用 twinTrendHasGaps 判断后把 TWIN_TREND_GAP_NOTE 写进图例（图里省下一行给折线）。
 * 坐标轴刻度与日期带 twin-axis 类：它们是刻度，不是读数（「每屏一个数只出现一次」的体检据此剔除）。
 */

export interface TwinTrendDay {
  /** Asia/Shanghai 自然日，YYYY-MM-DD。 */
  date: string
  /** null = 服务端因样本少于 5 置空：画成底部斜纹带，不连线、不补数。 */
  value: number | null
}

export interface TwinAreaTrendProps {
  days: TwinTrendDay[]
  seriesLabel: string
  /** 第二条序列（虚线、无面积），与 days 逐日对齐。 */
  secondary?: { label: string; values: ReadonlyArray<number | null> }
  width?: number
  height?: number
  /**
   * 宽度跟着容器走：viewBox 的宽 = 实际像素宽，字与圆点不被横向拉伸（宽而矮的底栏用）。
   * 不传时按 width 画、横向拉满容器（窄面板里的老画法）。
   */
  fluid?: boolean
  /** 有空缺时是否在图里写那一行小注；调用方把小注写进自己的图例时传 false。 */
  gapNote?: boolean
}

/** 有「少于 5」的日子时写一次的小注。 */
export const TWIN_TREND_GAP_NOTE = '斜纹 = 少于 5，不显示具体数'

/** 这几条序列里有没有少于 5（null）的日子，即图会不会画成有空缺的样子。 */
export function twinTrendHasGaps(...series: ReadonlyArray<ReadonlyArray<number | null>>): boolean {
  return series.some((values) => values.includes(null))
}

function shortDay(date: string): string {
  const parts = date.split('-')
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : date
}

/** 纵轴上限取 1 / 2 / 5 整档，至少 10：小机构几十次的曲线不会贴在底边，中点刻度也是整数。 */
function niceMax(max: number): number {
  if (max <= 10) return 10
  const pow = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 2, 5, 10]) if (m * pow >= max) return m * pow
  return 10 * pow
}

/** 连续的非空点连成一段；null 处断开。 */
function runsOf(xs: number[], values: ReadonlyArray<number | null>, yOf: (v: number) => number): Array<Array<[number, number]>> {
  const runs: Array<Array<[number, number]>> = []
  let current: Array<[number, number]> = []
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) runs.push(current)
      current = []
    } else current.push([xs[i], yOf(v)])
  })
  if (current.length) runs.push(current)
  return runs
}

function pathOf(run: Array<[number, number]>): string {
  return run.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
}

function tickText(tick: number): string {
  return tick >= 1000 ? `${tick / 1000}k` : String(tick)
}

/** 容器的布局宽度（不受舞台 transform 缩放影响）。用回调 ref：容器晚于首帧才出现时也量得到。 */
function useBoxWidth(): [number, (el: HTMLDivElement | null) => void] {
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    observer.current = ro
  }, [])
  return [width, ref]
}

interface ChartInput {
  days: TwinTrendDay[]
  primary: Array<number | null>
  second: Array<number | null>
  secondary?: TwinAreaTrendProps['secondary']
  seriesLabel: string
  width: number
  height: number
  ids: string
  gapNote: boolean
}

export function TwinAreaTrend({ days, seriesLabel, secondary, width = 380, height = 190, fluid = false, gapNote = true }: TwinAreaTrendProps) {
  const ids = useId()
  const [boxWidth, boxRef] = useBoxWidth()
  if (days.length === 0) return <p className="twin-empty">没有可画的日数据</p>
  const primary = days.map((day) => day.value)
  const second = secondary ? days.map((_, i) => secondary.values[i] ?? null) : []
  const gaps = twinTrendHasGaps(primary, second)
  const chart = (w: number) => {
    const input: ChartInput = { days, primary, second, secondary, seriesLabel, width: w, height, ids, gapNote }
    return gaps ? <GapChart {...input} /> : <PlainChart {...input} />
  }
  if (!fluid) return chart(width)
  return (
    <div ref={boxRef} className="twin-trend" style={{ height }}>
      {boxWidth > 0 ? chart(boxWidth) : null}
    </div>
  )
}

/** 没有空缺的老画法：点从左边线排到右边线。与改版前逐字节一致（刻度多了一个 twin-axis 类名，不影响渲染）。 */
function PlainChart({ days, primary, second, secondary, seriesLabel, width, height, ids }: ChartInput) {
  const gradientId = ids
  const top = 22
  const bottom = 30
  const left = 38
  const right = 10
  const base = height - bottom
  let max = 0
  for (const v of [...primary, ...second]) if (v !== null && v > max) max = v
  const yMax = niceMax(max)
  const yOf = (v: number) => top + (1 - v / yMax) * (height - top - bottom)
  const xs = days.map((_, i) => left + (i * (width - left - right)) / Math.max(days.length - 1, 1))
  const runs = runsOf(xs, primary, yOf)
  const secondRuns = secondary ? runsOf(xs, second, yOf) : []
  let peak = 0
  for (const v of primary) if (v !== null && v > peak) peak = v
  const peakIndex = peak > 0 ? primary.findIndex((v) => v === peak) : -1
  const last = primary[primary.length - 1]
  const ticks = [0, yMax / 2, yMax]
  const labelEvery = Math.max(1, Math.ceil(days.length / 5))
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={secondary ? `${seriesLabel}；${secondary.label}` : seriesLabel} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2ee6a8" stopOpacity=".45" />
          <stop offset="1" stopColor="#2ee6a8" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => {
        const y = yOf(tick)
        return (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y} y2={y} stroke="rgba(255,255,255,.07)" />
            <text className="twin-axis" x={left - 6} y={y + 4} fill="#8fb3a8" fontSize="13" textAnchor="end">
              {tickText(tick)}
            </text>
          </g>
        )
      })}
      {runs.map((run, i) =>
        run.length > 1 ? (
          <path key={`a-${i}`} d={`${pathOf(run)} L${run[run.length - 1][0].toFixed(1)} ${base} L${run[0][0].toFixed(1)} ${base} Z`} fill={`url(#${gradientId})`} />
        ) : null,
      )}
      {runs.map((run, i) => (
        <path key={`l-${i}`} d={pathOf(run)} fill="none" stroke="var(--tw-acc)" strokeWidth="2.5" style={{ filter: 'drop-shadow(0 0 6px rgba(46,230,168,.8))' }} />
      ))}
      {runs.map((run, i) => (run.length === 1 ? <circle key={`s-${i}`} cx={run[0][0]} cy={run[0][1]} r="3.5" fill="var(--tw-acc)" /> : null))}
      {secondRuns.map((run, i) =>
        run.length > 1 ? (
          <path key={`b-${i}`} d={pathOf(run)} fill="none" stroke="#f2c879" strokeWidth="2" strokeDasharray="4 6" />
        ) : (
          <circle key={`b-${i}`} cx={run[0][0]} cy={run[0][1]} r="3" fill="#f2c879" />
        ),
      )}
      {peakIndex >= 0 ? (
        <g>
          <circle cx={xs[peakIndex]} cy={yOf(peak)} r="5" fill="#04140f" stroke="var(--tw-acc)" strokeWidth="2.5" />
          <text x={xs[peakIndex]} y={yOf(peak) - 12} fill="#f4fdfa" fontSize="13" fontWeight="700" textAnchor="middle">
            峰值 {screenCount(peak)}
          </text>
        </g>
      ) : null}
      {last !== null ? <circle cx={xs[xs.length - 1]} cy={yOf(last)} r="6" fill="var(--tw-acc)" style={{ filter: 'drop-shadow(0 0 6px #2ee6a8)' }} /> : null}
      {days.map((day, i) =>
        // 常规刻度与末尾刻度至少隔一整档，末尾右对齐的日期不会和前一个挤在一起
        (i % labelEvery === 0 && days.length - 1 - i >= labelEvery) || i === days.length - 1 ? (
          <text className="twin-axis" key={day.date} x={xs[i]} y={height - 8} fill="#8fb3a8" fontSize="13" textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}>
            {shortDay(day.date)}
          </text>
        ) : null,
      )}
    </svg>
  )
}

type GapKind = 'main' | 'second'

/** 连续同类的空缺日并成一段：main = 主序列少于 5（第二条也按少于 5 看待），second = 只有第二条少于 5。 */
function gapRuns(primary: ReadonlyArray<number | null>, second: ReadonlyArray<number | null>, hasSecond: boolean) {
  const runs: Array<{ from: number; to: number; kind: GapKind }> = []
  primary.forEach((v, i) => {
    const kind: GapKind | null = v === null ? 'main' : hasSecond && second[i] === null ? 'second' : null
    if (kind === null) return
    const prev = runs[runs.length - 1]
    if (prev && prev.kind === kind && prev.to === i - 1) prev.to = i
    else runs.push({ from: i, to: i, kind })
  })
  return runs
}

/** 前后都不是真值的那一天：画不成线，单独画点并写数。 */
function isolatedAt(values: ReadonlyArray<number | null>, i: number): boolean {
  return values[i] !== null && (i === 0 || values[i - 1] === null) && (i === values.length - 1 || values[i + 1] === null)
}

const GAP_INK: Record<GapKind, string> = { main: '#8fb3a8', second: '#f2c879' }

/** 有空缺的画法：日格等宽，点在日格正中；少于 5 画斜纹带并标「<5」；孤立点写数。 */
function GapChart({ days, primary, second, secondary, seriesLabel, width, height, ids, gapNote }: ChartInput) {
  // 图里写小注时顶上多留一行；峰值标签在点上方 12 像素，顶边至少留 26
  const top = gapNote ? 40 : 26
  const bottom = 30
  const left = 38
  const right = 10
  const base = height - bottom
  const plotH = base - top
  const n = days.length
  let max = 0
  for (const v of [...primary, ...second]) if (v !== null && v > max) max = v
  const yMax = niceMax(max)
  const yOf = (v: number) => top + (1 - v / yMax) * plotH
  const slot = (width - left - right) / n
  const xs = days.map((_, i) => left + (i + 0.5) * slot)
  // 斜纹带的高 = 纵轴上 0–5 这一段；至少 16 像素（看得见，也放得下一行「<5」），至多占图高的四成
  const band = Math.min(plotH * 0.4, Math.max(16, (5 / yMax) * plotH))
  // 「<5」先放带子上方；那一段日格里有真值的点落在标签的高度上就改写进带子里，不压线
  const aboveBaseline = base - band - 4
  const blocked = (from: number, to: number) => {
    for (let i = from; i <= to; i += 1) {
      for (const v of [primary[i], second[i]]) {
        if (v !== null && yOf(v) > aboveBaseline - 16) return true
      }
    }
    return false
  }
  const runs = runsOf(xs, primary, yOf).filter((run) => run.length > 1)
  const secondRuns = secondary ? runsOf(xs, second, yOf).filter((run) => run.length > 1) : []
  const gaps = gapRuns(primary, second, Boolean(secondary))
  let peak = 0
  for (const v of primary) if (v !== null && v > peak) peak = v
  const peakIndex = peak > 0 ? primary.findIndex((v) => v === peak) : -1
  const lastIndex = n - 1
  const lastValue = primary[lastIndex]
  const ticks = [0, yMax / 2, yMax]
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - left - right) / 56))))
  const gradientId = `${ids}-area`
  const hatchId = (kind: GapKind) => `${ids}-hatch-${kind}`
  const labelAnchor = (x: number): { x: number; anchor: 'start' | 'middle' | 'end' } => {
    if (x - 20 < 2) return { x: Math.max(2, x - slot / 2), anchor: 'start' }
    if (x + 20 > width - 2) return { x: Math.min(width - 2, x + slot / 2), anchor: 'end' }
    return { x, anchor: 'middle' }
  }
  return (
    <svg
      className="twin-trend-gaps"
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${secondary ? `${seriesLabel}；${secondary.label}` : seriesLabel}；${TWIN_TREND_GAP_NOTE}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2ee6a8" stopOpacity=".45" />
          <stop offset="1" stopColor="#2ee6a8" stopOpacity="0" />
        </linearGradient>
        {(['main', 'second'] as const).map((kind) => (
          <pattern key={kind} id={hatchId(kind)} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={kind === 'main' ? 'rgba(143,179,168,.08)' : 'rgba(242,200,121,.08)'} />
            <line x1="1" y1="0" x2="1" y2="6" stroke={kind === 'main' ? 'rgba(143,179,168,.55)' : 'rgba(242,200,121,.6)'} strokeWidth="2" />
          </pattern>
        ))}
      </defs>
      {gapNote ? (
        <g className="twin-trend-note">
          <rect x={left} y={5} width={12} height={12} rx={2} fill={`url(#${hatchId('main')})`} stroke="rgba(143,179,168,.6)" />
          <text x={left + 18} y={15.5} fill="#8fb3a8" fontSize="13">
            {TWIN_TREND_GAP_NOTE}
          </text>
        </g>
      ) : null}
      {ticks.map((tick) => {
        const y = yOf(tick)
        return (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y} y2={y} stroke="rgba(255,255,255,.07)" />
            <text className="twin-axis" x={left - 6} y={y + 4} fill="#8fb3a8" fontSize="13" textAnchor="end">
              {tickText(tick)}
            </text>
          </g>
        )
      })}
      {xs.map((x, i) => (
        <line key={`t-${days[i].date}`} className="twin-trend-tick" x1={x} x2={x} y1={base} y2={base + 4} stroke="rgba(255,255,255,.22)" />
      ))}
      {gaps.map((gap) => {
        const x0 = left + gap.from * slot + Math.min(3, slot * 0.08)
        const x1 = left + (gap.to + 1) * slot - Math.min(3, slot * 0.08)
        const mid = (x0 + x1) / 2
        const inside = blocked(gap.from, gap.to)
        return (
          <g key={`g-${gap.from}`} className="twin-trend-gap" data-kind={gap.kind} data-from={days[gap.from].date} data-to={days[gap.to].date}>
            <rect x={x0} y={base - band} width={Math.max(1, x1 - x0)} height={band} rx={2} fill={`url(#${hatchId(gap.kind)})`} />
            <line x1={x0} x2={x1} y1={base - band} y2={base - band} stroke={GAP_INK[gap.kind]} strokeOpacity=".5" strokeDasharray="3 3" />
            {/* 「<5」约 15 像素宽：日格窄到放不下（30 天画进窄面板）就只画斜纹，由小注说明 */}
            {x1 - x0 >= 18 ? (
              <text
                className="twin-trend-gap-label"
                data-place={inside ? 'inside' : 'above'}
                x={mid}
                y={inside ? base - band / 2 + 4.5 : aboveBaseline}
                fill={GAP_INK[gap.kind]}
                fontSize="13"
                textAnchor="middle"
                stroke={inside ? '#04140f' : undefined}
                strokeWidth={inside ? 3 : undefined}
                paintOrder={inside ? 'stroke' : undefined}
              >
                {'<5'}
              </text>
            ) : null}
          </g>
        )
      })}
      {runs.map((run, i) => (
        <path key={`a-${i}`} d={`${pathOf(run)} L${run[run.length - 1][0].toFixed(1)} ${base} L${run[0][0].toFixed(1)} ${base} Z`} fill={`url(#${gradientId})`} />
      ))}
      {runs.map((run, i) => (
        <path key={`l-${i}`} className="twin-trend-line" d={pathOf(run)} fill="none" stroke="var(--tw-acc)" strokeWidth="2.5" style={{ filter: 'drop-shadow(0 0 6px rgba(46,230,168,.8))' }} />
      ))}
      {secondRuns.map((run, i) => (
        <path key={`b-${i}`} className="twin-trend-line is-second" d={pathOf(run)} fill="none" stroke="#f2c879" strokeWidth="2" strokeDasharray="4 6" />
      ))}
      {primary.map((v, i) => {
        if (v === null || !isolatedAt(primary, i) || i === peakIndex) return null
        const y = yOf(v)
        const below = y - 23 < top - 6
        return (
          <g key={`p-${days[i].date}`} className="twin-trend-dot" data-series="main" data-date={days[i].date}>
            <circle cx={xs[i]} cy={y} r="4.5" fill="#04140f" stroke="var(--tw-acc)" strokeWidth="2.5" />
            <text className="twin-trend-val" x={xs[i]} y={below ? y + 20 : y - 10} fill="#f4fdfa" fontSize="13" fontWeight="700" textAnchor="middle">
              {screenCount(v)}
            </text>
          </g>
        )
      })}
      {secondary
        ? second.map((v, i) => {
            if (v === null || !isolatedAt(second, i)) return null
            const y = yOf(v)
            const onLeft = xs[i] + 36 > width - right
            return (
              <g key={`s-${days[i].date}`} className="twin-trend-dot" data-series="second" data-date={days[i].date}>
                <circle cx={xs[i]} cy={y} r="4" fill="#04140f" stroke="#f2c879" strokeWidth="2" />
                <text className="twin-trend-val" x={onLeft ? xs[i] - 9 : xs[i] + 9} y={y + 4.5} fill="#f2c879" fontSize="13" fontWeight="700" textAnchor={onLeft ? 'end' : 'start'}>
                  {screenCount(v)}
                </text>
              </g>
            )
          })
        : null}
      {peakIndex >= 0 ? (
        <g className="twin-trend-dot" data-series="peak" data-date={days[peakIndex].date}>
          <circle cx={xs[peakIndex]} cy={yOf(peak)} r="5" fill="#04140f" stroke="var(--tw-acc)" strokeWidth="2.5" />
          <text x={xs[peakIndex]} y={yOf(peak) - 12} fill="#f4fdfa" fontSize="13" fontWeight="700" textAnchor="middle">
            峰值 {screenCount(peak)}
          </text>
        </g>
      ) : null}
      {lastValue !== null && !isolatedAt(primary, lastIndex) && lastIndex !== peakIndex ? (
        <circle cx={xs[lastIndex]} cy={yOf(lastValue)} r="6" fill="var(--tw-acc)" style={{ filter: 'drop-shadow(0 0 6px #2ee6a8)' }} />
      ) : null}
      {days.map((day, i) => {
        if (!((i % every === 0 && n - 1 - i >= every) || i === n - 1)) return null
        const at = labelAnchor(xs[i])
        return (
          <text className="twin-axis" key={day.date} x={at.x} y={height - 8} fill="#8fb3a8" fontSize="13" textAnchor={at.anchor}>
            {shortDay(day.date)}
          </text>
        )
      })}
    </svg>
  )
}
