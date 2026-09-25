import type { ScreenSnapshotMetrics } from '@ai-job-print/shared'
import {
  SCREEN_HOSTING_OFF_NOTE,
  TwinMetricPanel,
  TwinTerminalWall,
  screenCount,
  screenReasonCopy,
  type ScreenGapEntry,
  type TwinCityTerminal,
} from '@ai-job-print/ui'

/**
 * 机构总览在招聘内容托管关闭（托管 a，我们云上的默认部署）时的几块。
 *
 * 托管关闭时岗位、招聘会、企业资料不在本平台云上，数据源也不再同步：原来的「数据同步」「招聘会」
 * 「本机构在架信息」三块整块是招聘内容，不再渲染成「未开启」或「没有同步批次」的说明块，
 * 块位让给真实数据 —— 左中「终端状态墙」、左下「本机构政策」（全屏唯一一处边界句）；
 * 右栏「待审核」只算政策，告警长进腾出的块位。「建设中的指标」在展示档不上屏，桌面档收成一行。
 */

type Metrics = ScreenSnapshotMetrics

export function OrgFleetWallPanel({
  metric,
  terminals,
  focus,
  onOpen,
}: {
  metric: Metrics['fleetWall']
  terminals: readonly TwinCityTerminal[]
  focus: string | null
  onOpen: (terminal: TwinCityTerminal) => void
}) {
  return (
    <TwinMetricPanel
      title={focus === null ? '终端状态墙' : `${focus}终端状态墙`}
      sub={`${screenCount(terminals.length)} 台 · 点一格进入孪生`}
      metric={metric}
      source="终端心跳投影，一格一台，只含登记在本机构名下的终端。最要紧的排前面：离线 → 告警 → 未上报 → 打印中 → 在线。点一格进入该终端的孪生。"
      render={() => (
        <TwinTerminalWall
          terminals={terminals}
          limit={12}
          onOpen={onOpen}
          emptyText={focus === null ? '本机构还没有登记的终端' : `${focus}没有登记的终端`}
        />
      )}
    />
  )
}

export function OrgPolicyPanel({ metric, scope }: { metric: Metrics['contentInventory']; scope?: string }) {
  return (
    <TwinMetricPanel
      title="本机构政策"
      sub="本机构审核发布"
      scope={scope}
      tone="info"
      metric={metric}
      source="「在架」= 本机构审核通过、已发布且在有效期内的政策公告；「待审核」为待审与审核中的合计。政策由本机构在本平台自行审核发布。"
      render={(value) => (
        <>
          <div className="twin-hero">
            <span className="twin-big">{screenCount(value.policiesPublished)}</span>
            <span className="twin-unit">条</span>
            <span className="twin-muted">在架政策</span>
          </div>
          <div className="twin-stat-list">
            <div className="twin-stat">
              <span>待本机构审核</span>
              <b>
                {screenCount(value.policiesPending)}
                <span className="twin-unit">条</span>
              </b>
            </div>
          </div>
          <p className="twin-cap twin-push">{SCREEN_HOSTING_OFF_NOTE}</p>
        </>
      )}
    />
  )
}

export function OrgPendingPanel({ metric, scope }: { metric: Metrics['pendingReview']; scope?: string }) {
  return (
    <TwinMetricPanel
      title="待审核"
      sub="本机构政策"
      scope={scope}
      tone="warn"
      metric={metric}
      source="本机构政策公告待审核与审核中的合计（服务端计数）。审核通过并发布后才对外展示。托管关闭前提交的岗位、招聘会、企业资料不再进入审核，只在这里提一句存量。"
      render={(value) => {
        const stock = value.jobs + value.fairs + value.companies
        return (
          <>
            <div className="twin-big-row">
              <span className={value.policies > 0 ? 'twin-big is-warn' : 'twin-big'}>{screenCount(value.policies)}</span>
              <span className="twin-unit">条</span>
            </div>
            <p className="twin-cap">{value.policies > 0 ? '政策公告等待本机构审核' : '本机构没有待审核的政策'}</p>
            {stock > 0 ? <p className="twin-cap twin-muted twin-push">另有岗位类存量 {screenCount(stock)} 条（托管关闭后不再审核）</p> : null}
          </>
        )
      }}
    />
  )
}

/**
 * 桌面档底栏：「建设中的指标」收成一行，点开看是哪些、为什么没有。不是面板，不占一整块。
 * 托管关闭带来的那一类（打开来源平台入口等）不在这里重复列 —— 边界已在政策面板里说过一次。
 */
export function OrgGapLine({ entries, count }: { entries: ScreenGapEntry[]; count: number }) {
  if (count === 0) return null
  return (
    <details className="twin-gapline">
      <summary>另有 {screenCount(count)} 项指标待补齐机构归属等数据后显示</summary>
      <div className="twin-chips is-flow">
        {entries.flatMap((entry) =>
          entry.labels.map((label) => (
            <span key={`${entry.reason}-${label}`} className="twin-pend" title={screenReasonCopy(entry.reason).detail}>
              {label}
            </span>
          )),
        )}
      </div>
    </details>
  )
}
