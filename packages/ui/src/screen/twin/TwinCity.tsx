import { useMemo } from 'react'
import { cn } from '../../lib/cn'
import type { TwinState } from './TwinCharts'
import {
  HUB_R,
  TWIN_BILLBOARD,
  TWIN_WORLD,
  focusCamera,
  placeBlocks,
  placeDistricts,
  placeTerminals,
  type DistrictPlacement,
} from './twinMath'

/**
 * 城区孪生：按「所在区」把终端聚成街区，立柱就是终端。
 *
 * 呈现规则（都绑定真实数据，没有一处装饰值冒充数据）：
 *   - 立柱颜色 = 健康态 / 活动态；立柱高度只由状态决定（打印中最高、离线最低）。
 *   - 区名牌上的台数 = 该区终端数；街区大小随台数。
 *   - 楼宇体块是按区名哈希出的固定装饰，不表达任何数量。
 *   - 标签只挂最要紧的几条告警，避免把楼群写满。完整清单在告警面板里。
 * 位置是示意：有经纬度按相对方位摆，没有就按台数排；页面脚注必须写明这一点。
 */

export interface TwinCityTerminal {
  id: string
  code: string
  name: string | null
  area: string | null
  /** 服务点位（例如「人才服务大厅」）；机构版按它把终端聚成点位。 */
  location: string | null
  geo: { lat: number; lng: number } | null
  health: 'healthy' | 'degraded' | 'offline' | 'unknown'
  activity: 'idle' | 'printing' | 'scanning' | null
  alert: { kind: 'offline' | 'printer_issue' | 'never_reported'; title: string } | null
}

export type TwinCityHighlight = 'all' | 'alert' | 'offline' | 'printing'

export interface TwinCityProps {
  terminals: TwinCityTerminal[]
  focusArea: string | null
  selectedId?: string | null
  highlight?: TwinCityHighlight
  /** 没填所在区的终端归到这一组。 */
  unassignedLabel: string
  hubLabel: string
  emptyText: string
  maxAlertLabels?: number
  onSelectArea?: (area: string | null) => void
  onSelectTerminal?: (terminal: TwinCityTerminal) => void
}

const NO_AREA = '\u0000none'

export function twinTerminalState(t: Pick<TwinCityTerminal, 'health' | 'activity' | 'alert'>): TwinState {
  if (t.health === 'offline') return 'off'
  if (t.health === 'unknown') return 'un'
  if (t.health === 'degraded' || t.alert?.kind === 'printer_issue') return 'wa'
  if (t.activity === 'printing' || t.activity === 'scanning') return 'pr'
  return 'ok'
}

export const TWIN_STATE_TEXT: Record<TwinState, string> = {
  ok: '在线空闲',
  pr: '打印 / 扫描中',
  wa: '打印机告警',
  off: '离线',
  un: '未上报',
}

/** 纵深绑定真实状态：打印中最高、离线最低、未上报最矮。 */
const PILLAR_HEIGHT: Record<TwinState, number> = { pr: 130, ok: 95, wa: 95, off: 58, un: 46 }
const ALERT_RANK: Record<'offline' | 'printer_issue' | 'never_reported', number> = { offline: 0, printer_issue: 1, never_reported: 2 }
const ALERT_LIFTS = [72, 142, 104, 176]

interface PlacedTerminal {
  terminal: TwinCityTerminal
  x: number
  y: number
  state: TwinState
  areaKey: string
}

function matchesHighlight(state: TwinState, t: TwinCityTerminal, highlight: TwinCityHighlight): boolean {
  if (highlight === 'all') return true
  if (highlight === 'alert') return t.alert !== null
  if (highlight === 'offline') return state === 'off'
  return state === 'pr'
}

export function TwinCity({
  terminals,
  focusArea,
  selectedId = null,
  highlight = 'all',
  unassignedLabel,
  hubLabel,
  emptyText,
  maxAlertLabels = 4,
  onSelectArea,
  onSelectTerminal,
}: TwinCityProps) {
  const model = useMemo(() => {
    const groups = new Map<string, TwinCityTerminal[]>()
    for (const t of terminals) {
      const key = t.area ?? NO_AREA
      const list = groups.get(key)
      if (list) list.push(t)
      else groups.set(key, [t])
    }
    const districts = placeDistricts(
      Array.from(groups.entries()).map(([key, list]) => {
        const geos = list.filter((t) => t.geo !== null)
        const geo = geos.length
          ? {
              lat: geos.reduce((sum, t) => sum + (t.geo as { lat: number }).lat, 0) / geos.length,
              lng: geos.reduce((sum, t) => sum + (t.geo as { lng: number }).lng, 0) / geos.length,
            }
          : null
        return { key, count: list.length, geo: key === NO_AREA ? null : geo }
      }),
    )
    const tallestKey = districts[0]?.key
    const byKey = new Map<string, DistrictPlacement>(districts.map((d) => [d.key, d]))
    const placedTerminals: PlacedTerminal[] = []
    for (const [key, list] of groups) {
      const district = byKey.get(key)
      if (!district) continue
      const sorted = [...list].sort((a, b) => a.code.localeCompare(b.code))
      const spots = placeTerminals(district, sorted.length)
      sorted.forEach((terminal, i) => {
        placedTerminals.push({ terminal, x: spots[i].x, y: spots[i].y, state: twinTerminalState(terminal), areaKey: key })
      })
    }
    placedTerminals.sort((a, b) => a.y - b.y || a.x - b.x)
    const blocks = districts
      .flatMap((d) => placeBlocks(d, (groups.get(d.key) ?? []).length, d.key === tallestKey).map((b) => ({ ...b, areaKey: d.key })))
      .sort((a, b) => a.y + a.d - (b.y + b.d) || a.x - b.x)
    return { groups, districts, byKey, placedTerminals, blocks, tallestKey }
  }, [terminals])

  const focusKey = focusArea === null ? null : focusArea
  const focusDistrict = focusKey === null ? null : (model.byKey.get(focusKey) ?? null)
  const camera = focusCamera(focusDistrict)
  const dim = (areaKey: string) => (focusDistrict !== null && areaKey !== focusDistrict.key ? 'is-dim' : undefined)

  // 挂标签的告警：聚焦时只看本区；否则全城最要紧的几条
  const alertLabels = model.placedTerminals
    .filter((p) => p.terminal.alert !== null && (focusDistrict === null || p.areaKey === focusDistrict.key))
    .sort((a, b) => {
      const ka = ALERT_RANK[(a.terminal.alert as { kind: keyof typeof ALERT_RANK }).kind]
      const kb = ALERT_RANK[(b.terminal.alert as { kind: keyof typeof ALERT_RANK }).kind]
      return ka - kb || a.terminal.code.localeCompare(b.terminal.code)
    })
    .slice(0, maxAlertLabels)
  const selected = selectedId === null ? null : (model.placedTerminals.find((p) => p.terminal.id === selectedId) ?? null)

  const center = TWIN_WORLD / 2
  // 聚焦某区时中枢也退为背景，不压在被看的街区前面
  const hubDim = focusDistrict !== null ? 'is-dim' : undefined
  const flows = model.placedTerminals.filter((p, i) => p.state === 'pr' || (p.state === 'ok' && i % 3 === 0))

  return (
    <div className="tw3-stage">
      <div
        className={cn('tw3-world', focusDistrict !== null && 'is-focus', highlight !== 'all' && 'is-filtered')}
        style={{
          ['--tw3-zoom' as string]: String(camera.zoom),
          ['--tw3-dx' as string]: `${camera.dx}px`,
          ['--tw3-dy' as string]: `${camera.dy}px`,
        }}
      >
        <div className="tw3-ground" />
        <div className={cn('tw3-sweep', hubDim)} style={{ left: center - 300, top: center - 300, width: 600, height: 600 }} />
        <div className={cn('tw3-hubring is-dashed', hubDim)} style={{ left: center - HUB_R, top: center - HUB_R, width: HUB_R * 2, height: HUB_R * 2 }} />
        <div className={cn('tw3-hubring is-rev', hubDim)} style={{ left: center - 110, top: center - 110, width: 220, height: 220 }} />
        <div className={cn('tw3-hubring', hubDim)} style={{ left: center - 36, top: center - 36, width: 72, height: 72 }} />

        <svg className="tw3-flows" width={TWIN_WORLD} height={TWIN_WORLD} viewBox={`0 0 ${TWIN_WORLD} ${TWIN_WORLD}`} aria-hidden="true">
          {flows.map((p, i) => {
            const mx = (p.x + center) / 2
            const my = (p.y + center) / 2
            const off = i % 2 === 0 ? 60 : -60
            return (
              <path
                key={p.terminal.id}
                className={cn('tw3-fl', dim(p.areaKey))}
                d={`M${p.x} ${p.y} Q${mx + off} ${my - off} ${center} ${center}`}
                style={{ stroke: p.state === 'pr' ? '#72d6ff' : 'var(--tw-acc)', animationDelay: `-${((i * 0.41) % 2.4).toFixed(2)}s` }}
              />
            )
          })}
        </svg>

        {model.placedTerminals.map((p, i) => (
          <div
            key={`ring-${p.terminal.id}`}
            className={cn('tw3-ring', `s-${p.state}`, dim(p.areaKey))}
            style={{ left: p.x - 20, top: p.y - 20, animationDelay: `${((i * 0.37) % 2.6).toFixed(2)}s` }}
          />
        ))}

        {model.blocks.map((b, i) => (
          <div
            key={`bx-${b.areaKey}-${i}`}
            className={cn('tw3-bx', b.cbd && 'is-cbd', dim(b.areaKey))}
            style={{ left: b.x, top: b.y, width: b.w, height: b.d, ['--h' as string]: `${b.h}px` }}
          >
            <i className="t" />
            <i className="s" />
            <i className="w" />
          </div>
        ))}

        {model.placedTerminals.map((p) => {
          const h = PILLAR_HEIGHT[p.state]
          const label = `${p.terminal.code}${p.terminal.name ? ` ${p.terminal.name}` : ''} · ${TWIN_STATE_TEXT[p.state]}`
          return (
            <button
              key={`pl-${p.terminal.id}`}
              type="button"
              tabIndex={-1}
              className={cn(
                'tw3-bb tw3-pillar',
                `s-${p.state}`,
                dim(p.areaKey),
                !matchesHighlight(p.state, p.terminal, highlight) && 'is-muted',
              )}
              style={{ left: p.x - 12, top: p.y - h - 12, width: 24, height: h + 12 }}
              aria-label={label}
              aria-pressed={selectedId === p.terminal.id}
              title={label}
              onClick={() => onSelectTerminal?.(p.terminal)}
            >
              <span className="tw3-beam" style={{ height: h }} />
              <span className="tw3-kio" />
            </button>
          )
        })}

        <div className={cn('tw3-bb', hubDim)} style={{ left: center - 60, top: center - 150, width: 120, height: 150, transform: TWIN_BILLBOARD }}>
          <div className="tw3-tower" style={{ height: 116 }} />
        </div>
        <div className={cn('tw3-bb', hubDim)} style={{ left: center - 70, top: center - 40, width: 140, height: 40, transform: `translateZ(-2px) ${TWIN_BILLBOARD}` }}>
          <div className="tw3-lbl" style={{ height: 40 }}>
            <div className="c" style={{ ['--c' as string]: 'var(--tw-acc)', minHeight: 28 }}>{hubLabel}</div>
          </div>
        </div>

        {model.districts.map((d) => {
          const count = (model.groups.get(d.key) ?? []).length
          // 聚焦时本区的告警标签会抬高，区名牌再抬一截，二者不叠在一起
          const lift = (d.key === model.tallestKey ? 210 : 150) + (focusDistrict !== null && focusDistrict.key === d.key ? 150 : 0)
          const areaName = d.key === NO_AREA ? unassignedLabel : d.key
          const focused = focusDistrict !== null && focusDistrict.key === d.key
          return (
            <div
              key={`dl-${d.key}`}
              className={cn('tw3-bb tw3-district', dim(d.key))}
              style={{ left: d.cx - 110, top: d.cy - d.r * 0.9 - lift, width: 220, height: lift }}
            >
              <div className="tw3-lbl" style={{ height: lift }}>
                <button
                  type="button"
                  className="c tw3-district-btn"
                  aria-pressed={focused}
                  aria-label={`${areaName}，${count} 台终端，${focused ? '退出聚焦' : '聚焦该区'}`}
                  onClick={() => onSelectArea?.(focused ? null : d.key === NO_AREA ? null : d.key)}
                  disabled={d.key === NO_AREA}
                >
                  {areaName} <b>{count} 台</b>
                </button>
                <div className="stem" />
              </div>
            </div>
          )
        })}

        {alertLabels.map((p, i) => {
          // 聚焦时镜头更平、楼更近：标签再抬高，免得被前排楼顶遮住
          const lift = PILLAR_HEIGHT[p.state] + ALERT_LIFTS[i % ALERT_LIFTS.length] + (focusDistrict !== null ? 120 : 0)
          return (
            <div
              key={`al-${p.terminal.id}`}
              className={cn('tw3-bb', `s-${p.state}`, dim(p.areaKey))}
              style={{ left: p.x - 130, top: p.y - lift, width: 260, height: lift }}
            >
              <div className="tw3-lbl" style={{ height: lift }}>
                <div className="c">
                  {p.terminal.code} {(p.terminal.alert as { title: string }).title}
                </div>
                <div className="stem" />
              </div>
            </div>
          )
        })}

        {selected && !alertLabels.includes(selected) ? (
          <div
            className={cn('tw3-bb', `s-${selected.state}`)}
            style={{ left: selected.x - 150, top: selected.y - PILLAR_HEIGHT[selected.state] - 60, width: 300, height: PILLAR_HEIGHT[selected.state] + 60 }}
          >
            <div className="tw3-lbl" style={{ height: PILLAR_HEIGHT[selected.state] + 60 }}>
              <div className="c">
                {selected.terminal.code} · {TWIN_STATE_TEXT[selected.state]}
              </div>
              <div className="stem" />
            </div>
          </div>
        ) : null}
      </div>
      {terminals.length === 0 ? <div className="tw3-empty">{emptyText}</div> : null}
    </div>
  )
}

/** 契约里的机队格子（结构类型，与 ScreenFleetCell 同形）→ 城区孪生的终端。 */
export interface TwinFleetCellLike {
  health: 'healthy' | 'degraded' | 'offline' | 'unknown'
  terminalId: string
  terminalCode: string
  displayName: string | null
  areaLabel: string | null
  locationLabel: string | null
  geo: { lat: number; lng: number } | null
  activity: 'idle' | 'printing' | 'scanning' | null
  alert: { kind: 'offline' | 'printer_issue' | 'never_reported'; title: string } | null
}

/**
 * groupBy：'area' 按所在区聚成街区（政务版）；'location' 按服务点位聚合（机构版），
 * 点位没填时退回所在区，再没有就归入「未设置」。
 */
export function twinTerminalsFromCells(cells: readonly TwinFleetCellLike[], groupBy: 'area' | 'location' = 'area'): TwinCityTerminal[] {
  return cells.map((cell) => ({
    id: cell.terminalId,
    code: cell.terminalCode,
    name: cell.displayName,
    area: groupBy === 'location' ? cell.locationLabel ?? cell.areaLabel : cell.areaLabel,
    location: cell.locationLabel,
    geo: cell.geo,
    health: cell.health,
    activity: cell.activity,
    alert: cell.alert ? { kind: cell.alert.kind, title: cell.alert.title } : null,
  }))
}

/** 所在区列表（筛选下拉用），按终端数降序。 */
export function twinAreas(terminals: readonly TwinCityTerminal[]): Array<{ area: string; count: number }> {
  const counts = new Map<string, number>()
  for (const t of terminals) {
    if (t.area === null) continue
    const prev = counts.get(t.area)
    counts.set(t.area, prev === undefined ? 1 : prev + 1)
  }
  return Array.from(counts.entries())
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area))
}
