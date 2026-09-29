import { cn } from '../lib/cn'
import { screenCount } from './ScreenPrimitives'

/**
 * 终端状态墙 / 在网终端摘要。
 *
 * 这里唯一容易出错、也最值得写下来的一件事：**样本 ≠ 全量**。
 *
 * 服务端对机队列表有取数上限（合作机构侧 200 台）。于是响应里有两个数：
 *   - `sampledCount`（= `total`）：本次真正读到并判过健康态的台数；
 *   - `matchedCount`：符合范围条件的全部台数。
 * `healthy / degraded / offline / unknown / neverReported` 全部是**样本内**的计数。
 *
 * 所以被截断时，绝不能把「样本里 33 台正常」说成「共 640 台里 33 台正常」——
 * 那会让人以为 607 台不正常。截断时：分类计数明确标注「样本内」，
 * 脚注写「显示前 N 台 / 共 M 台」，点阵只画样本。
 *
 * 「从未上报」= 已注册但没有过任何心跳，与「离线」分开计，不并进在线率的分子。
 */

export type ScreenFleetHealthLike = 'healthy' | 'degraded' | 'offline' | 'unknown'

export interface ScreenFleetValueLike {
  healthy: number
  total: number
  degraded: number
  offline: number
  unknown: number
  neverReported: number
  onlineWindowSeconds: number
  sampledCount: number
  matchedCount: number
  truncated: boolean
  sampleCap: number
  cells?: Array<{ health: ScreenFleetHealthLike }>
}

const CELL_CLASS: Record<ScreenFleetHealthLike, string> = {
  healthy: 'is-ok',
  degraded: 'is-warn',
  offline: 'is-err',
  unknown: 'is-unk',
}

const LEGEND: Array<{ key: keyof Pick<ScreenFleetValueLike, 'healthy' | 'degraded' | 'offline'>; label: string; color: string }> = [
  { key: 'healthy', label: '正常', color: 'var(--ops-ok)' },
  { key: 'degraded', label: '打印机告警', color: 'var(--ops-warn)' },
  { key: 'offline', label: '离线', color: 'var(--ops-err)' },
]

export interface ScreenFleetWallProps {
  value: ScreenFleetValueLike
  /** 机构侧写「本机构终端」，平台侧写「终端」。 */
  scopeLabel: string
}

/** 被截断时统一的样本前缀，屏上与无障碍描述共用一份措辞。 */
export function screenFleetScopeNote(value: ScreenFleetValueLike, scopeLabel: string): string {
  return value.truncated
    ? `以下分类基于前 ${screenCount(value.sampledCount)} 台样本，${scopeLabel}共 ${screenCount(value.matchedCount)} 台`
    : `${scopeLabel}共 ${screenCount(value.matchedCount)} 台`
}

export function ScreenFleetWall({ value, scopeLabel }: ScreenFleetWallProps) {
  const cells = value.cells ?? []
  const describe =
    `${screenFleetScopeNote(value, scopeLabel)}：` +
    `正常 ${value.healthy}、打印机告警 ${value.degraded}、离线 ${value.offline}、` +
    `从未上报 ${value.neverReported}、状态未知 ${value.unknown}`
  return (
    <div className="ops-fleet">
      <div className="ops-fleet-sum">
        {LEGEND.map((entry) => (
          <div className="ops-frow" key={entry.key}>
            <span className="ops-dot" style={{ background: entry.color }} aria-hidden="true" />
            <span className="ops-v">{screenCount(value[entry.key])}</span>
            <span className="ops-k">{entry.label}</span>
          </div>
        ))}
        <div className="ops-frow">
          <span className="ops-dot" style={{ background: '#33564d' }} aria-hidden="true" />
          <span className="ops-v">{screenCount(value.neverReported)}</span>
          <span className="ops-k">从未上报</span>
        </div>
      </div>
      <div className="ops-dots" role="img" aria-label={describe}>
        {cells.map((cell, index) => (
          <span
            key={index}
            className={cn('ops-d', CELL_CLASS[cell.health])}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  )
}

/** KPI 版：只给在网台数与分母，不画点阵。分母是样本数，不是全量。 */
export function screenFleetOnlineText(value: ScreenFleetValueLike): {
  value: string
  unit: string
} {
  return {
    value: screenCount(value.healthy),
    unit: `/ ${screenCount(value.sampledCount)} 台`,
  }
}
