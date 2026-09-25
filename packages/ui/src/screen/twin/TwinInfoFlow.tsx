import { cn } from '../../lib/cn'
import { screenCount } from '../ScreenPrimitives'
import { TwinPill, TwinPrism } from './TwinNetwork'
import { TWIN_BILLBOARD, TWIN_WORLD, stageToGround } from './twinMath'

/**
 * 信息流向：本机构信息 → 四类内容 → 收藏 / 打开来源平台入口。机构版「信息使用」的场景。
 *
 * 柱高与线宽只按真实计数取平方根缩放；服务端对少于 5 的计数给 null，这里画最矮的柱、
 * 写「少于 5」，不补数。合计里只要有一类是 null，就写「至少 N」，不把未知当 0 加进去。
 * 节点位置是固定版式，不表达任何数量。
 */

export interface TwinInfoFlowType {
  key: string
  label: string
  browse: number | null
  favorites: number | null
  sourceOpens: number | null
}

export interface TwinInfoFlowProps {
  /** 最多四类，按给定顺序落在固定锚点上。 */
  types: TwinInfoFlowType[]
  hubLabel: string
  hubCaption: string
}

/** 版式：舞台坐标（976×780）上的锚点，四类内容排成一道弧。 */
const HUB_AT: [number, number] = [236, 452]
const TYPE_AT: ReadonlyArray<[number, number]> = [
  [508, 244],
  [616, 382],
  [616, 548],
  [508, 690],
]
const TYPE_LIFT = [112, 62, 112, 62]
const FAVORITES_AT: [number, number] = [864, 320]
const OPENS_AT: [number, number] = [864, 580]

function countText(count: number | null): string {
  return count === null ? '少于 5' : screenCount(count)
}

/** 合计：全部已知才给确数；有 null 就是「至少」；全是 null 就说每类都少于 5。prefix 用小字另排。 */
export function twinInfoTotalParts(values: ReadonlyArray<number | null>): { prefix: string | null; text: string } {
  const known = values.filter((v): v is number => v !== null)
  if (values.length === 0) return { prefix: null, text: '—' }
  if (known.length === 0) return { prefix: '每类', text: '少于 5' }
  const sum = known.reduce((a, b) => a + b, 0)
  return { prefix: known.length === values.length ? null : '至少', text: screenCount(sum) }
}

export function twinInfoTotal(values: ReadonlyArray<number | null>): string {
  const parts = twinInfoTotalParts(values)
  return parts.prefix ? `${parts.prefix} ${parts.text}` : parts.text
}

function flowWidth(count: number | null, base: number, div: number): number {
  return count === null ? base : base + Math.sqrt(count) / div
}

export function TwinInfoFlow({ types, hubLabel, hubCaption }: TwinInfoFlowProps) {
  const placed = types.slice(0, TYPE_AT.length)
  const flows: Array<{ d: string; stroke: string; width: number; dash: string; delay: number }> = []
  const flow = (a: [number, number], b: [number, number], stroke: string, width: number, bend: number, dash: string, delay: number) => {
    const p1 = stageToGround(a[0], a[1])
    const p2 = stageToGround(b[0], b[1])
    const mid = stageToGround((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - bend)
    const qx = 2 * mid.u - (p1.u + p2.u) / 2
    const qy = 2 * mid.v - (p1.v + p2.v) / 2
    flows.push({ d: `M${p1.u.toFixed(0)} ${p1.v.toFixed(0)} Q${qx.toFixed(0)} ${qy.toFixed(0)} ${p2.u.toFixed(0)} ${p2.v.toFixed(0)}`, stroke, width, dash, delay })
  }
  placed.forEach((t, i) => {
    flow(HUB_AT, TYPE_AT[i], '#8fb2ee', flowWidth(t.browse, 1.6, 8), i < 2 ? 36 : -36, '6 12', i * 0.3)
    flow(TYPE_AT[i], FAVORITES_AT, '#f2c879', flowWidth(t.favorites, 1.1, 10), 22, '3 10', 0.2 + i * 0.25)
    flow(TYPE_AT[i], OPENS_AT, '#f2c879', flowWidth(t.sourceOpens, 1.1, 10), -22, '3 10', 0.4 + i * 0.25)
  })

  const hub = stageToGround(HUB_AT[0], HUB_AT[1])
  const solids = [
    ...placed.map((t, i) => ({
      y: TYPE_AT[i][1],
      node: <TwinPrism key={`tp-${t.key}`} at={TYPE_AT[i]} size={52} h={t.browse === null ? 10 : 12 + Math.sqrt(t.browse) * 1.8} className={t.browse === null ? 'p-na' : 'p-info'} />,
    })),
    { y: FAVORITES_AT[1], node: <TwinPrism key="op-fav" at={FAVORITES_AT} size={46} h={18} className="p-out" /> },
    { y: OPENS_AT[1], node: <TwinPrism key="op-open" at={OPENS_AT} size={46} h={18} className="p-out" /> },
  ].sort((a, b) => a.y - b.y)

  return (
    <div className="tw3-stage">
      <div className="tw3-world">
        <div className="tw3-ground" />
        <div className="tw3-sweep" style={{ left: hub.u - 250, top: hub.v - 250, width: 500, height: 500 }} />
        <div className="tw3-hubring is-dashed" style={{ left: hub.u - 70, top: hub.v - 70, width: 140, height: 140 }} />
        <div className="tw3-hubring" style={{ left: hub.u - 36, top: hub.v - 36, width: 72, height: 72 }} />
        <svg className="tw3-flows" width={TWIN_WORLD} height={TWIN_WORLD} viewBox={`0 0 ${TWIN_WORLD} ${TWIN_WORLD}`} aria-hidden="true">
          {flows.map((f, i) => (
            <path key={i} className="tw3-flow" d={f.d} style={{ stroke: f.stroke, strokeWidth: f.width, strokeDasharray: f.dash, animationDelay: `-${f.delay.toFixed(2)}s` }} />
          ))}
        </svg>
        {solids.map((s) => s.node)}
        <div className="tw3-bb" style={{ left: hub.u - 60, top: hub.v - 150, width: 120, height: 150, transform: TWIN_BILLBOARD }}>
          <div className="tw3-tower" style={{ height: 116 }} />
        </div>
        {placed.map((t, i) => (
          <TwinPill key={`tl-${t.key}`} at={TYPE_AT[i]} lift={TYPE_LIFT[i]} width={176} className={cn('tw3-svc', t.browse === null ? 'p-na' : 'p-info')}>
            <b>{t.label}</b>
            <span>浏览 {countText(t.browse)}</span>
          </TwinPill>
        ))}
        <TwinPill at={FAVORITES_AT} lift={96} width={190} className="tw3-big p-out">
          <b>收藏</b>
          <span>{twinInfoTotal(placed.map((t) => t.favorites))}</span>
          <i>记在用户本人名下</i>
        </TwinPill>
        <TwinPill at={OPENS_AT} lift={96} width={190} className="tw3-big p-out">
          <b>打开来源平台入口</b>
          <span>{twinInfoTotal(placed.map((t) => t.sourceOpens))}</span>
          <i>不是投递或预约结果</i>
        </TwinPill>
        <TwinPill at={HUB_AT} lift={178} width={176} className="tw3-core">
          <b>{hubLabel}</b>
          <span>{hubCaption}</span>
        </TwinPill>
      </div>
    </div>
  )
}
