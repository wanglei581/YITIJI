import { TwinLegend, type TwinState } from './TwinCharts'
import { twinTerminalState, type TwinCityHighlight, type TwinCityTerminal } from './TwinCity'

/**
 * 城区孪生的筛选栏、状态图例与状态计数。政务总览（按所在区）与机构总览（按服务点位）共用，
 * 两端只在「分组叫什么」上不同，筛选全部写进地址，由调用方的 setParam 落地。
 */

export const TWIN_HIGHLIGHTS: ReadonlyArray<{ key: TwinCityHighlight; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'alert', label: '告警' },
  { key: 'offline', label: '离线' },
  { key: 'printing', label: '打印中' },
]

/** 地址上的 status 参数 → 高亮；非法值一律回到「全部」。 */
export function parseTwinHighlight(raw: string | null): TwinCityHighlight {
  return raw === 'alert' || raw === 'offline' || raw === 'printing' ? raw : 'all'
}

export function twinCountStates(terminals: readonly TwinCityTerminal[]): Record<TwinState, number> {
  const out: Record<TwinState, number> = { ok: 0, pr: 0, wa: 0, off: 0, un: 0 }
  for (const t of terminals) out[twinTerminalState(t)] += 1
  return out
}

const STATE_RANK: Record<TwinState, number> = { off: 0, wa: 1, un: 2, pr: 3, ok: 4 }

/** 最要紧的排前面：离线 → 告警 → 未上报 → 打印中 → 在线，同状态按编号。 */
export function twinSortByState(terminals: readonly TwinCityTerminal[]): TwinCityTerminal[] {
  return [...terminals].sort((a, b) => STATE_RANK[twinTerminalState(a)] - STATE_RANK[twinTerminalState(b)] || a.code.localeCompare(b.code))
}

export function TwinStateLegend({ counts }: { counts: Record<TwinState, number> }) {
  return (
    <TwinLegend
      items={[
        { state: 'ok', label: `在线 ${counts.ok}` },
        { state: 'pr', label: `打印中 ${counts.pr}` },
        { state: 'wa', label: `告警 ${counts.wa}` },
        { state: 'off', label: `离线 ${counts.off}` },
        { state: 'un', label: `未上报 ${counts.un}` },
      ]}
    />
  )
}

export interface TwinCityToolbarProps {
  /** 分组的叫法：「区域」或「点位」。 */
  groupLabel: string
  /** 不筛选时的选项文字：「全市」「全部点位」。 */
  allLabel: string
  groups: ReadonlyArray<{ area: string; count: number }>
  focus: string | null
  highlight: TwinCityHighlight
  terminals: readonly TwinCityTerminal[]
  onFocus: (group: string | null) => void
  onHighlight: (highlight: TwinCityHighlight) => void
  onOpenTerminal: (terminal: TwinCityTerminal) => void
  /** 同一页里只有一个城区孪生，给 datalist 一个固定 id 即可。 */
  datalistId: string
}

export function TwinCityToolbar({
  groupLabel,
  allLabel,
  groups,
  focus,
  highlight,
  terminals,
  onFocus,
  onHighlight,
  onOpenTerminal,
  datalistId,
}: TwinCityToolbarProps) {
  return (
    <>
      <label className="twin-fgrp">
        <span className="twin-flabel">{groupLabel}</span>
        <select className="twin-select" value={focus ?? ''} onChange={(event) => onFocus(event.target.value === '' ? null : event.target.value)}>
          <option value="">{allLabel}</option>
          {groups.map((g) => (
            <option key={g.area} value={g.area}>
              {g.area}（{g.count} 台）
            </option>
          ))}
        </select>
      </label>
      <div className="twin-fgrp" role="group" aria-label="终端状态">
        <span className="twin-flabel">状态</span>
        {TWIN_HIGHLIGHTS.map((h) => (
          <button key={h.key} type="button" className="twin-chip" aria-pressed={highlight === h.key} onClick={() => onHighlight(h.key)}>
            {h.label}
          </button>
        ))}
      </div>
      <label className="twin-fgrp">
        <span className="twin-flabel">终端</span>
        <input
          className="twin-search"
          type="search"
          list={datalistId}
          placeholder="输入终端编号直达"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            const code = event.currentTarget.value.trim().toUpperCase()
            const hit = terminals.find((t) => t.code.toUpperCase() === code)
            if (hit) onOpenTerminal(hit)
          }}
        />
        <datalist id={datalistId}>
          {terminals.map((t) => (
            <option key={t.id} value={t.code} />
          ))}
        </datalist>
      </label>
    </>
  )
}
