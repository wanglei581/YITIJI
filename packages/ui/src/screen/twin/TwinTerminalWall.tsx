import { cn } from '../../lib/cn'
import { screenCount } from '../ScreenPrimitives'
import { TWIN_STATE_TEXT, twinTerminalState, type TwinCityTerminal } from './TwinCity'
import { twinSortByState } from './TwinCityControls'
import type { TwinState } from './TwinCharts'

/**
 * 终端状态墙：一台终端一格，颜色 = 心跳推算的真实状态，点一格进入该终端的孪生。
 *
 * 最要紧的排前面（离线 → 告警 → 未上报 → 打印中 → 在线）。格数固定为 limit：机队更大时
 * 最后一格如实写「另 N 台」，块位高度不随机队大小变化，也不把格子缩到看不清。
 * 格子均分墙的高度：台数少时格子大，台数多时每格收到触控下限为止。
 */

const SHORT_STATE: Record<TwinState, string> = {
  off: '离线',
  wa: '告警',
  un: '未上报',
  pr: '打印中',
  ok: '在线',
}

export interface TwinTerminalWallProps {
  terminals: readonly TwinCityTerminal[]
  /** 最多画几格（块位放得下的格数，含「另 N 台」那一格）。 */
  limit: number
  onOpen: (terminal: TwinCityTerminal) => void
  emptyText: string
  /** 给了就在每格第三行写服务点位（没填点位的写这句）；已聚焦到一个点位时不给，免得每格都写同一个名字。 */
  unassignedPlace?: string
}

export function TwinTerminalWall({ terminals, limit, onOpen, emptyText, unassignedPlace }: TwinTerminalWallProps) {
  if (terminals.length === 0) return <p className="twin-empty">{emptyText}</p>
  const sorted = twinSortByState(terminals)
  const overflow = sorted.length > limit
  const shown = overflow ? sorted.slice(0, limit - 1) : sorted
  return (
    <ul className="twin-fleet">
      {shown.map((t) => {
        const state = twinTerminalState(t)
        return (
          <li key={t.id}>
            <button
              type="button"
              className={cn('twin-fleet-cell', `s-${state}`)}
              aria-label={`${t.code} · ${TWIN_STATE_TEXT[state]}，打开终端孪生`}
              title={`${t.code} · ${TWIN_STATE_TEXT[state]}`}
              onClick={() => onOpen(t)}
            >
              <b className="twin-code">{t.code}</b>
              <span>{SHORT_STATE[state]}</span>
              {unassignedPlace === undefined ? null : <i className="twin-fleet-place">{t.area ?? unassignedPlace}</i>}
            </button>
          </li>
        )
      })}
      {overflow ? (
        <li className="twin-fleet-more">
          <b>另 {screenCount(sorted.length - shown.length)} 台</b>
          <span>在终端孪生里看</span>
        </li>
      ) : null}
    </ul>
  )
}
