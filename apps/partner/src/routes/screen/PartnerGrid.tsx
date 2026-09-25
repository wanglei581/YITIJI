import { formatTime } from '@ai-job-print/shared'
import type { ScreenFleetCell, ScreenSnapshotMetrics } from '@ai-job-print/shared'
import {
  ScreenFleetWall,
  TWIN_STAGE_H,
  TWIN_STAGE_W,
  TwinAlertList,
  TwinBarList,
  TwinCity,
  TwinCityToolbar,
  TwinLegend,
  TwinMetricPanel,
  TwinPanel,
  TwinRing,
  TwinSceneBox,
  TwinSlot,
  TwinStateLegend,
  TwinTiles,
  parseTwinHighlight,
  screenCount,
  screenFleetScopeNote,
  screenReasonCopy,
  twinAreas,
  twinCountStates,
  twinTerminalState,
  twinTerminalsFromCells,
  type TwinAlertItem,
  type TwinState,
} from '@ai-job-print/ui'
import { buildPartnerGapEntries, countPartnerGapMetrics } from './metricLabels'
import { screenHref } from './screenTabs'
import { TwinShell, TwinShellEmpty, snapshotMeta, usePartnerSnapshot, type ScreenChrome } from './screenView'

/**
 * 机构总览：本机构服务点位孪生 + 七块面板。块位照设计稿「机构版 · 本机构数字孪生」。
 *
 * 只画本机构的数据 —— 服务端的 orgId 只从鉴权用户回源，前端一个机构标识都不发，
 * 跨机构数据在这里不可达。与设计稿不同的地方一律以契约为准、不补假值：
 *   1. 终端按「服务点位」分组；点位没填的归到「未设置服务点位」，不猜。
 *   2. 告警取自本机构终端心跳（离线 / 打印机异常 / 从未上报），与告警中心全量明细不是同一口径，
 *      后者暂未按机构下发，列在「建设中的指标」里。
 *   3. 机队分类必须标样本：服务端对机构机队有取数上限，截断时写明「前 N 台」。
 *   4. 打印、AI 的记录还没有机构归属，不出数，只在「建设中的指标」里如实列名。
 */

const TITLE = '本机构运营概览'
const SUBTITLE = '数字孪生 · 机构总览 · 只含本机构终端与本机构发布的信息'
const UNASSIGNED = '未设置服务点位'
const POLL_SECONDS = 60

interface AlertStyle {
  severity: TwinAlertItem['severity']
  text: string
  rank: number
}

const ALERT_STATE: Partial<Record<TwinState, AlertStyle>> = {
  off: { severity: 'err', text: '离线', rank: 0 },
  wa: { severity: 'warn', text: '告警', rank: 1 },
  un: { severity: 'un', text: '未上报', rank: 2 },
}

function placeOf(cell: ScreenFleetCell): string {
  return cell.locationLabel ?? cell.areaLabel ?? UNASSIGNED
}

/** 心跳推算出的本机构终端告警：严重的在前，同级按发生时间倒序，再按编号。 */
function terminalAlerts(cells: readonly ScreenFleetCell[], onOpen: (id: string) => void): TwinAlertItem[] {
  const rows: Array<{ cell: ScreenFleetCell; style: AlertStyle }> = []
  for (const cell of cells) {
    const style = ALERT_STATE[twinTerminalState(cell)]
    if (style) rows.push({ cell, style })
  }
  rows.sort(
    (a, b) =>
      a.style.rank - b.style.rank
      || (b.cell.alert?.since ?? '').localeCompare(a.cell.alert?.since ?? '')
      || a.cell.terminalCode.localeCompare(b.cell.terminalCode),
  )
  return rows.map(({ cell, style }) => ({
    key: cell.terminalId,
    severity: style.severity,
    severityText: style.text,
    code: cell.terminalCode,
    text: cell.alert?.title ? `${placeOf(cell)} · ${cell.alert.title}` : placeOf(cell),
    whenText: cell.alert?.since ? formatTime(cell.alert.since) : undefined,
    onClick: () => onOpen(cell.terminalId),
  }))
}

export function PartnerGrid({ chrome }: { chrome: ScreenChrome }) {
  const snap = usePartnerSnapshot(POLL_SECONDS)
  if (!snap.data) {
    return <TwinShellEmpty chrome={chrome} title={TITLE} subtitle={SUBTITLE} failure={snap.failure} onRetry={() => void snap.refresh()} />
  }
  const g: ScreenSnapshotMetrics = snap.data.metrics
  const cells = g.fleetWall?.available ? g.fleetWall.value.cells : []
  const terminals = twinTerminalsFromCells(cells, 'location')
  const groups = twinAreas(terminals)
  const rawGroup = chrome.params.get('place')
  const focus = rawGroup !== null && groups.some((a) => a.area === rawGroup) ? rawGroup : null
  const highlight = parseTwinHighlight(chrome.params.get('status'))
  const inView = focus === null ? terminals : terminals.filter((t) => t.area === focus)
  const counts = twinCountStates(inView)
  // 告警与孪生用同一份分组结果：聚焦时只看孪生里落在该点位的那些终端
  const idsInView = new Set(inView.map((t) => t.id))
  const cellsInView = focus === null ? cells : cells.filter((c) => idsInView.has(c.terminalId))
  const openTerminal = (id: string) => chrome.onNavigate(screenHref('terminal', chrome.params, { id }))
  const alerts = terminalAlerts(cellsInView, openTerminal)
  const alertLimit = chrome.presenting ? 4 : 6
  const gaps = buildPartnerGapEntries(g)
  const gapCount = countPartnerGapMetrics(gaps)

  const toolbar = (
    <TwinCityToolbar
      groupLabel="点位"
      allLabel="全部点位"
      groups={groups}
      focus={focus}
      highlight={highlight}
      terminals={terminals}
      onFocus={(place) => chrome.setParam('place', place)}
      onHighlight={(next) => chrome.setParam('status', next === 'all' ? null : next)}
      onOpenTerminal={(t) => openTerminal(t.id)}
      datalistId="twin-partner-terminal-codes"
    />
  )

  return (
    <TwinShell
      chrome={chrome}
      title={TITLE}
      subtitle={SUBTITLE}
      layout="city"
      toolbar={toolbar}
      meta={snapshotMeta(snap.data)}
      pollSeconds={POLL_SECONDS}
      failure={snap.failure}
      onRefresh={() => void snap.refresh()}
      refreshing={snap.status === 'loading'}
    >
      <TwinSlot slot="l1">
        <TwinMetricPanel
          title={focus === null ? '本机构终端' : `${focus}终端`}
          sub="实时"
          metric={g.terminalsOnline}
          source={
            '终端心跳投影，只统计登记在本机构名下的终端。' +
            (g.terminalsOnline?.available
              ? `最近 ${g.terminalsOnline.value.onlineWindowSeconds} 秒有心跳算在线。${screenFleetScopeNote(g.terminalsOnline.value, '本机构')}。`
              : '') +
            (focus === null ? '「未上报」含已注册但从未上报心跳的终端。' : '按终端所在服务点位统计，由机队样本算出。')
          }
          render={(value) => {
            const online = focus === null ? value.healthy : counts.ok + counts.pr
            const total = focus === null ? value.sampledCount : inView.length
            return (
              <>
                <div className="twin-ring-row">
                  <TwinRing value={online} total={total}>
                    <span className="twin-big">{screenCount(online)}</span>
                    <span className="twin-muted twin-ring-cap">正常 · 共 {screenCount(total)} 台</span>
                  </TwinRing>
                  <div className="twin-legend-col">
                    {focus === null ? (
                      <TwinLegend
                        items={[
                          { state: 'ok', label: `正常 ${value.healthy}` },
                          { state: 'wa', label: `告警 ${value.degraded}` },
                          { state: 'off', label: `离线 ${value.offline}` },
                          { state: 'un', label: `未上报 ${value.unknown}` },
                        ]}
                      />
                    ) : (
                      <TwinStateLegend counts={counts} />
                    )}
                  </div>
                </div>
                <p className="twin-cap twin-push">
                  只统计登记在本机构名下的终端{value.truncated ? `（显示前 ${screenCount(value.sampledCount)} 台，共 ${screenCount(value.matchedCount)} 台）` : ''}
                </p>
              </>
            )
          }}
        />
      </TwinSlot>

      <TwinSlot slot="l2">
        <TwinMetricPanel
          title="数据同步"
          sub={g.syncSuccessRate24h?.available && focus === null ? `近 24 小时 · ${screenCount(g.syncSuccessRate24h.value.total)} 个批次` : '近 24 小时'}
          scope={focus === null ? undefined : '全机构口径'}
          metric={g.syncSuccessRate24h}
          source="本机构数据源近 24 小时的同步批次结果，部分失败按失败计。逐批明细见同步日志页。"
          render={(value) =>
            value.successRate === null ? (
              <>
                <p className="twin-empty">近 24 小时没有同步批次</p>
                <p className="twin-cap twin-push">没有分母，因此不给成功率</p>
              </>
            ) : (
              <>
                <div className="twin-ring-row">
                  <TwinRing value={value.success} total={value.total} size={150}>
                    <span className="twin-big twin-big-sm">
                      {value.successRate.toFixed(1)}
                      <span className="twin-unit">%</span>
                    </span>
                    <span className="twin-muted twin-ring-cap">成功率</span>
                  </TwinRing>
                  <div className="twin-legend-col">
                    <div className="twin-kv">
                      <span>成功</span>
                      <b>
                        {screenCount(value.success)}
                        <span className="twin-unit">批</span>
                      </b>
                    </div>
                    <div className="twin-kv">
                      <span>失败（含部分失败）</span>
                      <b className={value.failed > 0 ? 'is-warn' : undefined}>
                        {screenCount(value.failed)}
                        <span className="twin-unit">批</span>
                      </b>
                    </div>
                  </div>
                </div>
                {chrome.presenting ? (
                  <p className="twin-cap twin-push">失败明细见同步日志</p>
                ) : (
                  <a
                    className="twin-cap twin-push twin-link"
                    href="/sync-logs"
                    onClick={(event) => {
                      event.preventDefault()
                      chrome.onNavigate('/sync-logs')
                    }}
                  >
                    查看同步日志 →
                  </a>
                )}
              </>
            )
          }
        />
      </TwinSlot>

      <TwinSlot slot="l3">
        <TwinMetricPanel
          title="招聘会"
          sub={g.fairStructure?.available ? `进行中 ${screenCount(g.fairStructure.value.ongoingFairs)} 场` : '进行中'}
          scope={focus === null ? undefined : '全机构口径'}
          tone="info"
          metric={g.fairStructure}
          source="只统计本机构进行中的场次，结构数直接来自招聘会子表。招聘会是第三方 / 官方来源信息，预约与投递在来源平台完成。"
          render={(value) => (
            <>
              <TwinTiles
                cols={3}
                items={[
                  { value: screenCount(value.companies), unit: '家', label: '参展企业' },
                  { value: screenCount(value.zones), unit: '个', label: '展区' },
                  { value: screenCount(value.publishedMaterials), unit: '份', label: '活动资料', hint: '已发布可打印' },
                ]}
              />
              <div className="twin-kv">
                <span>资料打印量</span>
                {value.materialPrintCount.available ? (
                  <b>
                    {screenCount(value.materialPrintCount.value)}
                    <span className="twin-unit">次</span>
                  </b>
                ) : (
                  <span className="twin-pend" title={screenReasonCopy(value.materialPrintCount.reason).detail}>
                    {screenReasonCopy(value.materialPrintCount.reason).title}
                  </span>
                )}
              </div>
              <p className="twin-cap twin-push">预约与投递在来源平台完成，本平台不代预约、不收简历</p>
            </>
          )}
        />
      </TwinSlot>

      <TwinSlot slot="scene">
        {g.fleetWall?.available ? (
          chrome.lite ? (
            <div className="twin-lite-wall">
              <ScreenFleetWall value={g.fleetWall.value} scopeLabel="本机构" />
            </div>
          ) : (
            <>
              <TwinSceneBox baseWidth={TWIN_STAGE_W} baseHeight={TWIN_STAGE_H} label="本机构服务点位数字孪生">
                <TwinCity
                  terminals={terminals}
                  focusArea={focus}
                  highlight={highlight}
                  unassignedLabel={UNASSIGNED}
                  hubLabel="本机构"
                  hub={false}
                  emptyText="本机构还没有登记的终端。终端注册并上报心跳后会出现在这里。"
                  onSelectArea={(place) => chrome.setParam('place', place)}
                  onSelectTerminal={(t) => openTerminal(t.id)}
                />
              </TwinSceneBox>
              <div className="twin-overlay is-tl">
                {focus === null ? (
                  <span>
                    本机构 {screenCount(groups.length)} 个服务点位 · {screenCount(g.fleetWall.value.matchedCount)} 台 · 分布示意
                    {g.fleetWall.value.truncated ? `（显示前 ${screenCount(g.fleetWall.value.sampledCount)} 台）` : ''}
                  </span>
                ) : (
                  <>
                    <button type="button" className="twin-crumb" onClick={() => chrome.setParam('place', null)}>
                      全部点位
                    </button>
                    <span aria-hidden="true">›</span>
                    <b>{focus}</b>
                    <span className="twin-muted">· 点立柱查看单台终端</span>
                  </>
                )}
              </div>
              <div className="twin-overlay is-tr">
                <TwinStateLegend counts={counts} />
              </div>
            </>
          )
        ) : (
          <TwinPanel title="服务点位分布" source="终端心跳投影。">
            <p className="twin-cap">终端列表本次没有取到，点位孪生暂不显示；其余面板不受影响。</p>
          </TwinPanel>
        )}
      </TwinSlot>

      <TwinSlot slot="bottom">
        <TwinPanel
          title="建设中的指标"
          sub={gapCount > 0 ? `${gapCount} 项 · 记录补上机构归属后按本机构统计显示` : undefined}
          tone="warn"
          source="这些指标不是被隐藏，是服务端确实给不出本机构维度的数据（多为打印订单与 AI 记录还没有机构归属）。每一项的原因写在提示里；数据层补齐后会自动出现在上方，不需要改页面。"
        >
          {gaps.length === 0 ? (
            <p className="twin-empty">本机构的全部指标都已接入</p>
          ) : (
            <div className="twin-chips is-flow">
              {gaps.flatMap((entry) =>
                entry.labels.map((label) => (
                  <span key={`${entry.reason}-${label}`} className="twin-pend" title={screenReasonCopy(entry.reason).detail}>
                    {label}
                  </span>
                )),
              )}
            </div>
          )}
        </TwinPanel>
      </TwinSlot>

      <TwinSlot slot="r1">
        <TwinMetricPanel
          title="本机构在架信息"
          sub={focus === null ? '已发布 · 有效期内' : undefined}
          scope={focus === null ? undefined : '全机构口径'}
          tone="info"
          metric={g.contentInventory}
          source="「在架」= 审核通过且已发布且未过期，且来源机构为本机构。待审核为待审与审核中的合计。均为第三方 / 官方来源信息，本平台不收简历、不代投递。"
          render={(value) => (
            <>
              <TwinTiles
                items={[
                  { value: screenCount(value.jobsPublished), unit: '条', label: '岗位信息', hint: `待审核 ${screenCount(value.jobsPending)}` },
                  { value: screenCount(value.fairsPublished), unit: '场', label: '招聘会', hint: `待审核 ${screenCount(value.fairsPending)}` },
                  { value: screenCount(value.policiesPublished), unit: '条', label: '政策公告', hint: `待审核 ${screenCount(value.policiesPending)}` },
                  { value: screenCount(value.companiesPublished), unit: '家', label: '企业资料', hint: `待审核 ${screenCount(value.companiesPending)}` },
                ]}
              />
              <p className="twin-cap twin-push">已审核通过、已发布且在有效期内</p>
            </>
          )}
        />
      </TwinSlot>

      <TwinSlot slot="r2">
        <TwinMetricPanel
          title="待审核"
          sub="本机构提交"
          scope={focus === null ? undefined : '全机构口径'}
          tone="warn"
          metric={g.pendingReview}
          source="本机构四类内容待审核与审核中的合计（服务端计数）。审核通过并发布后才对外展示。"
          render={(value) => (
            <>
              <div className="twin-big-row">
                <span className={value.total > 0 ? 'twin-big is-warn' : 'twin-big'}>{screenCount(value.total)}</span>
                <span className="twin-unit">条</span>
              </div>
              <TwinBarList
                items={[
                  { label: '岗位信息', value: value.jobs },
                  { label: '招聘会', value: value.fairs },
                  { label: '政策公告', value: value.policies },
                  { label: '企业资料', value: value.companies },
                ]
                  .filter((row) => row.value > 0)
                  .sort((a, b) => b.value - a.value)}
                emptyText="本机构没有待审核的内容"
              />
            </>
          )}
        />
      </TwinSlot>

      <TwinSlot slot="r3">
        <TwinMetricPanel
          title={focus === null ? '本机构终端告警' : `${focus}告警`}
          sub={g.fleetWall?.available ? `当前 ${screenCount(alerts.length)} 台` : undefined}
          tone="err"
          metric={g.fleetWall}
          source="由本机构终端心跳推算：离线、打印机异常（如缺纸）、从未上报，按严重度与发生时间排序。告警中心的全量明细与处置记录暂未按机构下发，见「建设中的指标」。"
          render={() => (
            <>
              <TwinAlertList items={alerts.slice(0, alertLimit)} emptyText={focus === null ? '本机构终端当前没有告警' : `${focus}当前没有告警`} />
              {alerts.length > alertLimit ? <p className="twin-cap twin-push">另 {alerts.length - alertLimit} 台 · 点立柱或在终端孪生里查看</p> : null}
            </>
          )}
        />
      </TwinSlot>
    </TwinShell>
  )
}
