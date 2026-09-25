import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { screenCount } from '../ScreenPrimitives'
import { screenReasonCopy } from '../screenCopy'
import { TWIN_BILLBOARD, TWIN_WORLD, stageToGround } from './twinMath'

/**
 * 服务调用网络：渠道 → 服务中枢 →（AI 能力中枢）→ 各项服务 → 产出。
 *
 * 柱高与线宽只按真实计数取平方根缩放；少于 5 的计数服务端给 null，这里画成最矮的柱、
 * 标「少于 5」，不补数。节点位置是固定版式（设计稿舞台坐标换算到地面），不表达任何数量。
 */

export type TwinNetworkLane = 'info' | 'ai' | 'print'

export interface TwinNetworkService {
  key: string
  /** 服务名由调用方给（与轻量模式的条形图同一份），这里只管摆放。 */
  label: string
  lane: TwinNetworkLane
  count: number | null
}

/** 数字 = 真实计数；null = 服务端因样本少于 5 置空；{ reason } = 该指标本次不可用，按原因写「未接入」或「暂时取不到」。 */
export type TwinNetworkCount = number | null | { reason: string }

export interface TwinNetworkProps {
  channels: Array<{ key: 'kiosk' | 'miniapp'; label: string; count: TwinNetworkCount; caption: string }>
  services: TwinNetworkService[]
  outcomes: Array<{ key: 'sourceOpens' | 'favorites' | 'aiReports' | 'printed'; label: string; count: number | null }>
  hubLabel: string
  hubCaption: string
  aiLabel: string
  aiCaption: string
}

/** 版式：舞台坐标（976×780）上的锚点与标签抬高，来自设计稿「服务调用孪生」。没有版式的服务不画。 */
const SERVICE_LAYOUT: Record<string, { at: [number, number]; lift: number }> = {
  jobs: { at: [462, 250], lift: 116 },
  fairs: { at: [574, 236], lift: 64 },
  policy: { at: [688, 250], lift: 116 },
  company: { at: [800, 236], lift: 60 },
  aiResume: { at: [560, 462], lift: 118 },
  aiAdvisor: { at: [656, 476], lift: 62 },
  interview: { at: [752, 462], lift: 118 },
  careerPlan: { at: [844, 476], lift: 62 },
  jobAi: { at: [628, 566], lift: 58 },
  print: { at: [520, 668], lift: 108 },
  scan: { at: [664, 680], lift: 64 },
}

/** 信息服务一排（上方那道）按这个次序排。 */
const INFO_ROW = ['jobs', 'fairs', 'policy', 'company'] as const
const INFO_ROW_MID = (SERVICE_LAYOUT.jobs.at[0] + SERVICE_LAYOUT.company.at[0]) / 2
const INFO_ROW_STEP = (SERVICE_LAYOUT.company.at[0] - SERVICE_LAYOUT.jobs.at[0]) / (INFO_ROW.length - 1)

/**
 * 本次要画的服务锚点。四类信息服务都在时就是设计稿的固定版式（逐像素不变）；
 * 招聘内容托管关闭时服务端只下发政策这一类信息服务，剩下的在这一排里居中排开，
 * 不在原来岗位、招聘会、企业的位置上留空洞，也不画灰色占位节点。
 */
function serviceLayoutFor(placed: readonly TwinNetworkService[]): Record<string, { at: [number, number]; lift: number }> {
  const info = INFO_ROW.filter((key) => placed.some((s) => s.key === key))
  if (info.length === 0 || info.length === INFO_ROW.length) return SERVICE_LAYOUT
  const out: Record<string, { at: [number, number]; lift: number }> = { ...SERVICE_LAYOUT }
  info.forEach((key, i) => {
    const x = Math.round(INFO_ROW_MID + (i - (info.length - 1) / 2) * INFO_ROW_STEP)
    out[key] = { at: [x, i % 2 === 0 ? 250 : 236], lift: i % 2 === 0 ? 116 : 64 }
  })
  return out
}

const CHANNEL_AT: Record<'kiosk' | 'miniapp', [number, number]> = { kiosk: [112, 318], miniapp: [112, 590] }
const HUB_AT: [number, number] = [292, 470]
const AI_AT: [number, number] = [480, 440]
const OUTCOME_LAYOUT: Record<string, { at: [number, number]; lift: number; from: string[] }> = {
  sourceOpens: { at: [908, 206], lift: 104, from: ['jobs', 'fairs', 'policy', 'company'] },
  favorites: { at: [908, 318], lift: 58, from: ['jobs', 'fairs', 'policy'] },
  aiReports: { at: [908, 470], lift: 146, from: ['aiResume', 'interview', 'careerPlan'] },
  printed: { at: [884, 668], lift: 104, from: ['print'] },
}

const LANE_CLASS: Record<TwinNetworkLane, string> = { info: 'p-info', ai: 'p-ai', print: 'p-print' }
const LANE_STROKE: Record<TwinNetworkLane, string> = { info: '#8fb2ee', ai: '#2ee6a8', print: '#72d6ff' }

function countText(count: TwinNetworkCount): string {
  if (count === null) return '少于 5'
  if (typeof count === 'number') return screenCount(count)
  // 不可用：取数失败写「暂时取不到」，数据层缺口写「未接入」，两者不能说成一回事
  const copy = screenReasonCopy(count.reason)
  return copy.short ?? copy.title
}

function flowWidth(count: TwinNetworkCount, base: number, div: number): number {
  return typeof count === 'number' ? base + Math.sqrt(count) / div : base
}

/** 地面锚点上立起的标签牌；lift 是标签相对锚点的抬高（舞台像素）。 */
export function TwinPill({ at, lift, width, className, children }: { at: [number, number]; lift: number; width: number; className: string; children: ReactNode }) {
  const g = stageToGround(at[0], at[1])
  const height = lift / g.scale
  return (
    <div className={cn('tw3-bb', className)} style={{ left: g.u - width / 2, top: g.v - height, width, height, transform: TWIN_BILLBOARD }}>
      <div className="tw3-lbl" style={{ height }}>
        <div className="c">{children}</div>
        <div className="stem" />
      </div>
    </div>
  )
}

/** 地面锚点上的发光棱柱；h 是柱高（像素），只按真实计数缩放。 */
export function TwinPrism({ at, size, h, className }: { at: [number, number]; size: number; h: number; className: string }) {
  const g = stageToGround(at[0], at[1])
  return (
    <div className={cn('tw3-prism', className)} style={{ left: g.u - size / 2, top: g.v - size / 2, width: size, height: size, ['--h' as string]: `${Math.round(h)}px` }}>
      <i className="t" />
      <i className="s" />
      <i className="w" />
    </div>
  )
}

export function TwinNetwork({ channels, services, outcomes, hubLabel, hubCaption, aiLabel, aiCaption }: TwinNetworkProps) {
  const flows: Array<{ d: string; stroke: string; width: number; dash: string; delay: number }> = []
  const flow = (a: [number, number], b: [number, number], stroke: string, width: number, bend: number, dash: string, delay: number) => {
    const p1 = stageToGround(a[0], a[1])
    const p2 = stageToGround(b[0], b[1])
    const mid = stageToGround((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - bend)
    const qx = 2 * mid.u - (p1.u + p2.u) / 2
    const qy = 2 * mid.v - (p1.v + p2.v) / 2
    flows.push({ d: `M${p1.u.toFixed(0)} ${p1.v.toFixed(0)} Q${qx.toFixed(0)} ${qy.toFixed(0)} ${p2.u.toFixed(0)} ${p2.v.toFixed(0)}`, stroke, width, dash, delay })
  }

  const placed = services.filter((s) => SERVICE_LAYOUT[s.key] !== undefined)
  const layoutOf = serviceLayoutFor(placed)
  const hasAi = placed.some((s) => s.lane === 'ai')
  channels.forEach((c, i) => flow(CHANNEL_AT[c.key], HUB_AT, '#2ee6a8', flowWidth(c.count, 1.6, 9), i === 0 ? -30 : 30, '6 12', i * 0.4))
  if (hasAi) flow(HUB_AT, AI_AT, '#57d7ff', 7.5, 24, '10 10', 0)
  placed.forEach((s, k) => {
    const layout = layoutOf[s.key]
    const from = s.lane === 'ai' ? AI_AT : HUB_AT
    flow(from, layout.at, LANE_STROKE[s.lane], flowWidth(s.count, 1.6, 9), s.lane === 'info' ? 40 : s.lane === 'print' ? -30 : 18, '6 12', k * 0.23)
  })
  const byKey = new Map(placed.map((s) => [s.key, s]))
  outcomes.forEach((o, j) => {
    const layout = OUTCOME_LAYOUT[o.key]
    for (const src of layout.from) {
      const s = byKey.get(src)
      if (s) flow(layoutOf[src].at, layout.at, '#f2c879', flowWidth(o.count, 1.2, 14), 26, '3 10', j * 0.3)
    }
  })

  const hub = stageToGround(HUB_AT[0], HUB_AT[1])
  const ai = stageToGround(AI_AT[0], AI_AT[1])
  const solids = [
    ...channels.map((c) => ({ y: CHANNEL_AT[c.key][1], node: <TwinPrism key={`cp-${c.key}`} at={CHANNEL_AT[c.key]} size={70} h={26} className="p-ai" /> })),
    ...placed.map((s) => ({
      y: layoutOf[s.key].at[1],
      node: <TwinPrism key={`sp-${s.key}`} at={layoutOf[s.key].at} size={50} h={s.count === null ? 10 : 12 + Math.sqrt(s.count) * 1.6} className={s.count === null ? 'p-na' : LANE_CLASS[s.lane]} />,
    })),
    ...outcomes.map((o) => ({ y: OUTCOME_LAYOUT[o.key].at[1], node: <TwinPrism key={`op-${o.key}`} at={OUTCOME_LAYOUT[o.key].at} size={44} h={18} className="p-out" /> })),
  ].sort((a, b) => a.y - b.y)

  return (
    <div className="tw3-stage">
      <div className="tw3-world">
        <div className="tw3-ground" />
        <div className="tw3-sweep" style={{ left: hub.u - 250, top: hub.v - 250, width: 500, height: 500 }} />
        <div className="tw3-hubring is-dashed" style={{ left: hub.u - 70, top: hub.v - 70, width: 140, height: 140 }} />
        <div className="tw3-hubring" style={{ left: hub.u - 36, top: hub.v - 36, width: 72, height: 72 }} />
        {hasAi ? <div className="tw3-hubring is-rev" style={{ left: ai.u - 58, top: ai.v - 58, width: 116, height: 116, borderColor: 'rgba(87,215,255,.6)' }} /> : null}
        <svg className="tw3-flows" width={TWIN_WORLD} height={TWIN_WORLD} viewBox={`0 0 ${TWIN_WORLD} ${TWIN_WORLD}`} aria-hidden="true">
          {flows.map((f, i) => (
            <path key={i} className="tw3-flow" d={f.d} style={{ stroke: f.stroke, strokeWidth: f.width, strokeDasharray: f.dash, animationDelay: `-${f.delay.toFixed(2)}s` }} />
          ))}
        </svg>
        {solids.map((s) => s.node)}
        <div className="tw3-bb" style={{ left: hub.u - 60, top: hub.v - 150, width: 120, height: 150, transform: TWIN_BILLBOARD }}>
          <div className="tw3-tower" style={{ height: 116 }} />
        </div>
        {hasAi ? (
          <div className="tw3-bb" style={{ left: ai.u - 60, top: ai.v - 130, width: 120, height: 130, transform: TWIN_BILLBOARD }}>
            <div className="tw3-tower is-ai" style={{ height: 96 }} />
          </div>
        ) : null}
        {channels.map((c) => (
          <TwinPill key={`cl-${c.key}`} at={CHANNEL_AT[c.key]} lift={118} width={176} className={cn('tw3-big', typeof c.count === 'object' && c.count !== null ? 'p-na' : 'p-ai')}>
            <b>{c.label}</b>
            <span>{countText(c.count)}</span>
            <i>{c.caption}</i>
          </TwinPill>
        ))}
        {placed.map((s) => (
          <TwinPill key={`sl-${s.key}`} at={layoutOf[s.key].at} lift={layoutOf[s.key].lift} width={170} className={cn('tw3-svc', s.count === null ? 'p-na' : LANE_CLASS[s.lane])}>
            <b>{s.label}</b>
            <span>{countText(s.count)}</span>
          </TwinPill>
        ))}
        {outcomes.map((o) => (
          <TwinPill key={`ol-${o.key}`} at={OUTCOME_LAYOUT[o.key].at} lift={OUTCOME_LAYOUT[o.key].lift} width={170} className="tw3-big p-out">
            <b>{o.label}</b>
            <span>{countText(o.count)}</span>
          </TwinPill>
        ))}
        <TwinPill at={HUB_AT} lift={178} width={170} className="tw3-core">
          <b>{hubLabel}</b>
          <span>{hubCaption}</span>
        </TwinPill>
        {hasAi ? (
          <TwinPill at={AI_AT} lift={160} width={230} className="tw3-core">
            <b>{aiLabel}</b>
            <span>{aiCaption}</span>
          </TwinPill>
        ) : null}
      </div>
    </div>
  )
}
