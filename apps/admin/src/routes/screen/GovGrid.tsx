import { formatTime } from '@ai-job-print/shared'
import type { ScreenAlertItem, ScreenSnapshotMetrics } from '@ai-job-print/shared'
import {
  ScreenFleetWall,
  SCREEN_SOURCE_ENTRY_NOTE,
  TWIN_STAGE_H,
  TWIN_STAGE_W,
  TwinAlertList,
  TwinAreaTrend,
  TwinBarList,
  TwinCity,
  TwinLegend,
  TwinMetricPanel,
  TwinPanel,
  TwinRing,
  TwinSceneBox,
  TwinSlot,
  TwinCityToolbar,
  TwinStateLegend,
  TwinTiles,
  parseTwinHighlight,
  screenCount,
  screenFleetScopeNote,
  twinAreas,
  twinCountStates,
  twinSortByState,
  twinTerminalState,
  twinTerminalsFromCells,
  type TwinAlertItem,
  type TwinBarItem,
} from '@ai-job-print/ui'
import { aiOperationLabel, taskStatusLabel } from './metricLabels'
import { screenHref } from './screenTabs'
import { TwinShell, TwinShellEmpty, snapshotMeta, useAdminSnapshot, type ScreenChrome } from './screenView'

/**
 * 政务总览：城区数字孪生 + 六块面板。块位照设计稿「政务版 · 城区数字孪生」。
 *
 * 数据只来自两份真实快照（gov：终端 / 打印 / AI / 在架信息；ops：任务流、来源入口、告警），
 * 与设计稿不同的地方一律以契约为准、不补假值：
 *   1. 打印趋势的「今日」是上海自然日到现在的累计，不与昨天整日比涨跌（半天比一天会误导），只并列写出。
 *   2. 按区聚焦时，终端类数字切成本区（由机队格子算出，截断时写明样本）；打印、AI、来源入口
 *      的记录还没有区域归属，保持全市口径并在角标写明，不冒充本区数字。
 *   3. 在架信息都是第三方 / 官方来源，本平台不收简历、不代投递。
 */

const TITLE = '职易达 · 就业服务终端运行态势'
const SUBTITLE = '数字孪生 · 政务总览'
const UNASSIGNED = '未设置所在区'

function alertRows(items: ScreenAlertItem[], onOpen: (code: string) => void, presenting: boolean): TwinAlertItem[] {
  return items.slice(0, 4).map((item, index) => ({
    key: `${item.terminalCode ?? 'none'}-${item.type}-${index}`,
    severity: item.severity === 'error' ? 'err' : item.severity === 'warning' ? 'warn' : 'un',
    severityText: item.severity === 'error' ? '严重' : item.severity === 'warning' ? '警告' : '提示',
    code: item.terminalCode ?? '—',
    text: item.title,
    whenText: formatTime(item.occurredAt),
    href: item.terminalCode && !presenting ? '/alerts' : undefined,
    onClick: item.terminalCode ? () => onOpen(item.terminalCode as string) : undefined,
  }))
}

function TaskFlow({ printByStatus, scanByStatus }: { printByStatus: Record<string, number>; scanByStatus: Record<string, number> }) {
  // 只累加服务端实际下发的状态键：没下发的状态就是这 24 小时里一条都没有，不另补数
  const count = (source: Record<string, number>, keys: string[]) =>
    Object.entries(source).reduce((sum, [key, value]) => (keys.includes(key) ? sum + value : sum), 0)
  return (
    <div className="twin-flow">
      <div className="twin-flow-node"><b>{screenCount(count(printByStatus, ['pending']))}</b><span>{taskStatusLabel('pending')}</span></div>
      <i className="twin-pipe" aria-hidden="true" />
      <div className="twin-flow-node is-pr"><b>{screenCount(count(printByStatus, ['claimed', 'printing']))}</b><span>打印中</span></div>
      <i className="twin-pipe" aria-hidden="true" />
      <div className="twin-flow-node is-ok"><b>{screenCount(count(printByStatus, ['completed']))}</b><span>打印完成</span></div>
      <i className="twin-flow-sep" aria-hidden="true" />
      <div className="twin-flow-node"><b>{screenCount(count(scanByStatus, ['completed']))}</b><span>扫描完成</span></div>
      <div className="twin-flow-node is-warn"><b>{screenCount(count(printByStatus, ['failed']))}</b><span>失败待核查</span></div>
      <div className="twin-flow-node is-muted"><b>{screenCount(count(printByStatus, ['cancelled', 'canceled']))}</b><span>已取消</span></div>
    </div>
  )
}

export function GovGrid({ chrome }: { chrome: ScreenChrome }) {
  const gov = useAdminSnapshot('gov', 60)
  // 来源平台访问 Top 5 只在运营快照里；其余块都随政务快照下发
  const ops = useAdminSnapshot('ops', 60, 'gov-tab')
  if (!gov.data) {
    return <TwinShellEmpty chrome={chrome} title={TITLE} subtitle={SUBTITLE} failure={gov.failure} onRetry={() => void gov.refresh()} />
  }
  // 任务流与告警 9/26 起随政务快照下发（与运营版同一份实现、同一档缓存）
  const g: ScreenSnapshotMetrics = gov.data.metrics
  const sourcesPending = !ops.data && !ops.failure
  const cells = g.fleetWall?.available ? g.fleetWall.value.cells : []
  const terminals = twinTerminalsFromCells(cells)
  const areas = twinAreas(terminals)
  const rawArea = chrome.params.get('area')
  const focus = rawArea !== null && areas.some((a) => a.area === rawArea) ? rawArea : null
  const highlight = parseTwinHighlight(chrome.params.get('status'))
  const inView = focus === null ? terminals : terminals.filter((t) => t.area === focus)
  const counts = twinCountStates(inView)
  const cityScope = focus === null ? undefined : '全市口径'
  const openTerminal = (id: string) => chrome.onNavigate(screenHref('terminal', chrome.params, { id }))
  const areaCodes = new Set(inView.map((t) => t.code))
  const sortedArea = twinSortByState(inView)
  // 展示档底栏只有一行高：列最要紧的 3 台，其余合成一格；桌面档全列
  const chipLimit = chrome.presenting ? 3 : sortedArea.length
  const openAlertTerminal = (code: string) => {
    const hit = terminals.find((t) => t.code === code)
    if (hit) openTerminal(hit.id)
    // 展示档无人值守：找不到对应终端时原地不动，绝不跳出舞台进后台页面
    else if (!chrome.presenting) chrome.onNavigate('/alerts')
  }

  const toolbar = (
    <TwinCityToolbar
      groupLabel="区域"
      allLabel="全市"
      groups={areas}
      focus={focus}
      highlight={highlight}
      terminals={terminals}
      onFocus={(area) => chrome.setParam('area', area)}
      onHighlight={(next) => chrome.setParam('status', next === 'all' ? null : next)}
      onOpenTerminal={(t) => openTerminal(t.id)}
      datalistId="twin-terminal-codes"
    />
  )

  return (
    <TwinShell
      chrome={chrome}
      title={TITLE}
      subtitle={SUBTITLE}
      layout="city"
      toolbar={toolbar}
      meta={snapshotMeta(gov.data)}
      pollSeconds={60}
      failure={gov.failure}
      onRefresh={() => {
        void gov.refresh()
        void ops.refresh()
      }}
      refreshing={gov.status === 'loading'}
    >
      <TwinSlot slot="l1">
        <TwinMetricPanel
          title={focus === null ? '终端与服务' : `${focus}终端`}
          sub="实时"
          metric={g.terminalsOnline}
          source={
            '终端心跳投影。' +
            (g.terminalsOnline?.available
              ? `最近 ${g.terminalsOnline.value.onlineWindowSeconds} 秒有心跳算在线。${screenFleetScopeNote(g.terminalsOnline.value, '')}。`
              : '') +
            (focus === null ? '「未上报」含已注册但从未上报心跳的终端。' : '按终端所在区统计，由机队样本算出。')
          }
          render={(value) => {
            const online = focus === null ? value.healthy : counts.ok + counts.pr
            const total = focus === null ? value.sampledCount : inView.length
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                  <TwinRing value={online} total={total}>
                    <span className="twin-big">{screenCount(online)}</span>
                    <span className="twin-muted" style={{ marginTop: 6 }}>正常 · 共 {screenCount(total)} 台</span>
                  </TwinRing>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="twin-kv">
                      <span>累计打印</span>
                      {g.printPagesCumulative?.available ? (
                        <b>
                          {screenCount(g.printPagesCumulative.value.totalPages)}
                          <span className="twin-unit">页</span>
                        </b>
                      ) : (
                        <span className="twin-pend">未接入</span>
                      )}
                    </div>
                    <div className="twin-kv">
                      <span>AI 服务调用</span>
                      {g.aiCallsCumulative?.available ? (
                        <b>
                          {screenCount(g.aiCallsCumulative.value.totalCalls)}
                          <span className="twin-unit">次</span>
                        </b>
                      ) : (
                        <span className="twin-pend">未接入</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="twin-push">
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
              </>
            )
          }}
        />
      </TwinSlot>

      <TwinSlot slot="l2">
        <TwinMetricPanel
          title="打印量趋势"
          sub="近 14 天 · 页"
          scope={cityScope}
          metric={g.printTrend14d}
          source="按订单支付时间落入的上海自然日聚合已支付打印订单的内容页数；不乘份数，不代表物理出纸张数。「今日」是今天零点到现在的累计。"
          render={(value) => {
            const days = value.days
            const today = days.length ? days[days.length - 1].pages : null
            const yesterday = days.length > 1 ? days[days.length - 2].pages : null
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span className="twin-muted">今日</span>
                  <span className="twin-big" style={{ fontSize: '1.9em' }}>{today === null ? '—' : screenCount(today)}</span>
                  {yesterday !== null ? <span className="twin-muted">页 · 昨日 {screenCount(yesterday)} 页</span> : <span className="twin-muted">页</span>}
                </div>
                <TwinAreaTrend days={days.map((d) => ({ date: d.date, value: d.pages }))} seriesLabel="近 14 天每日打印页数" />
              </>
            )
          }}
        />
      </TwinSlot>

      <TwinSlot slot="l3">
        <TwinMetricPanel
          title="AI 服务分项"
          sub="近 24 小时"
          scope={cityScope}
          metric={g.aiBreakdown24h}
          source="AI 服务日志近 24 小时滚动窗（非自然日），只计次数，不含对话与简历内容。失败含超时与上游拒绝。"
          render={(value) => {
            const rows: TwinBarItem[] = Object.entries(value.byOperation)
              .map(([operation, count]) => ({ label: aiOperationLabel(operation), value: count }))
              .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
              .slice(0, 4)
            if (value.totalCalls > 0) rows.push({ label: '调用失败', value: value.failedCalls, tone: 'error' })
            return (
              <>
                <TwinBarList items={rows} emptyText="近 24 小时没有 AI 调用记录" />
                <p className="twin-cap twin-push">
                  共 {screenCount(value.totalCalls)} 次 · 失败 {screenCount(value.failedCalls)} 次
                </p>
              </>
            )
          }}
        />
      </TwinSlot>

      <TwinSlot slot="scene">
        {g.fleetWall?.available ? (
          chrome.lite ? (
            <div style={{ padding: 20 }}>
              <ScreenFleetWall value={g.fleetWall.value} scopeLabel="" />
            </div>
          ) : (
            <>
              <TwinSceneBox baseWidth={TWIN_STAGE_W} baseHeight={TWIN_STAGE_H} label="终端分布数字孪生">
                <TwinCity
                  terminals={terminals}
                  focusArea={focus}
                  highlight={highlight}
                  unassignedLabel={UNASSIGNED}
                  hubLabel="数据中枢"
                  emptyText="还没有登记的终端。终端注册并上报心跳后会出现在这里。"
                  onSelectArea={(area) => chrome.setParam('area', area)}
                  onSelectTerminal={(t) => openTerminal(t.id)}
                />
              </TwinSceneBox>
              <div className="twin-overlay is-tl">
                {focus === null ? (
                  <span>
                    终端分布 · {screenCount(g.fleetWall.value.matchedCount)} 台 · 按所在区示意
                    {g.fleetWall.value.truncated ? `（显示前 ${screenCount(g.fleetWall.value.sampledCount)} 台）` : ''}
                  </span>
                ) : (
                  <>
                    <button type="button" className="twin-crumb" onClick={() => chrome.setParam('area', null)}>
                      全市
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
          <TwinPanel title="终端分布" source="终端心跳投影。">
            <p className="twin-cap">终端列表本次没有取到，城区孪生暂不显示；其余面板不受影响。</p>
          </TwinPanel>
        )}
      </TwinSlot>

      <TwinSlot slot="bottom">
        {focus !== null ? (
          <TwinPanel title={`${focus}终端一览`} sub="按状态排序 · 点击进入单台孪生" source="按终端所在区筛选的机队样本。">
            <div className="twin-chips">
              {sortedArea.slice(0, chipLimit).map((t) => {
                  const st = twinTerminalState(t)
                  return (
                    <button key={t.id} type="button" className="twin-alert" onClick={() => openTerminal(t.id)}>
                      <span className={`twin-sev ${st === 'off' ? 'is-err' : st === 'un' ? 'is-un' : st === 'pr' ? 'is-pr' : st === 'ok' ? 'is-ok' : ''}`}>
                        {st === 'off' ? '离线' : st === 'wa' ? '告警' : st === 'un' ? '未上报' : st === 'pr' ? '打印中' : '在线'}
                      </span>
                      <span className="twin-code">{t.code}</span>
                    </button>
                  )
                })}
              {sortedArea.length > chipLimit ? (
                <span className="twin-alert">
                  <span className="twin-muted">另 {sortedArea.length - chipLimit} 台 · 在后台内查看全部</span>
                </span>
              ) : null}
            </div>
          </TwinPanel>
        ) : (
          <TwinMetricPanel
            title="近 24 小时任务流"
            sub="打印与扫描"
            metric={g.taskFlow24h}
            source="打印任务与扫描任务近 24 小时按当前状态计数；失败需人工核查，详见打印扫描运维。"
            render={(value) => <TaskFlow printByStatus={value.printByStatus} scanByStatus={value.scanByStatus} />}
          />
        )}
      </TwinSlot>

      <TwinSlot slot="r1">
        <TwinMetricPanel
          title="信息服务 · 在架"
          sub={focus === null ? '第三方 / 官方来源' : '全市发布 · 不分区'}
          tone="info"
          metric={g.contentInventory}
          source="「在架」= 审核通过且已发布且未过期。待审核为待审与审核中的合计。均为第三方 / 官方来源信息，本平台不收简历、不代投递。"
          render={(value) => (
            <>
              <TwinTiles
                items={[
                  { value: screenCount(value.jobsPublished), unit: '条', label: '岗位信息', hint: `待审核 ${screenCount(value.jobsPending)}` },
                  { value: screenCount(value.fairsPublished), unit: '场', label: '招聘会', hint: `待审核 ${screenCount(value.fairsPending)}` },
                  { value: screenCount(value.policiesPublished), unit: '条', label: '政策公告', hint: `待审核 ${screenCount(value.policiesPending)}` },
                  { value: screenCount(value.companiesPublished), unit: '家', label: '企业展示', hint: `待审核 ${screenCount(value.companiesPending)}` },
                ]}
              />
              <p className="twin-cap twin-push">
                {g.jobsOnShelf?.available ? `来自 ${screenCount(g.jobsOnShelf.value.sourceOrgCount)} 家来源机构 · ` : ''}本平台不收简历、不代投递
              </p>
            </>
          )}
        />
      </TwinSlot>

      <TwinSlot slot="r2">
        {sourcesPending ? (
          <TwinPanel title="来源平台访问" tone="info" source={SCREEN_SOURCE_ENTRY_NOTE}>
            <p className="twin-cap">正在取数…</p>
          </TwinPanel>
        ) : (
          <TwinMetricPanel
            title="来源平台访问"
            sub={cityScope ? '近 30 天' : '近 30 天 · Top 5'}
            scope={cityScope}
            tone="info"
            metric={ops.data?.metrics.sourceEntryOpensTop}
            source={SCREEN_SOURCE_ENTRY_NOTE}
            render={(value) => (
              <>
                <TwinBarList
                  items={value.items.slice(0, 5).map((item) => ({ label: item.sourceName, value: item.count, tone: 'info' as const }))}
                  emptyText={`近 30 天没有达到 ${value.minSampleThreshold} 次的来源入口`}
                />
                <p className="twin-cap twin-push">统计打开来源平台入口的次数，不是投递结果</p>
              </>
            )}
          />
        )}
      </TwinSlot>

      <TwinSlot slot="r3">
        <TwinMetricPanel
          title={focus === null ? '实时告警' : `${focus}告警`}
          sub={
            g.alertsRealtime?.available
              ? focus === null
                ? `当前 ${screenCount(g.alertsRealtime.value.firingCount)} 条`
                : `本区 ${screenCount(g.alertsRealtime.value.items.filter((item) => item.terminalCode !== null && areaCodes.has(item.terminalCode)).length)} 条 · 全市 ${screenCount(g.alertsRealtime.value.firingCount)} 条`
              : undefined
          }
          tone="err"
          metric={g.alertsRealtime}
          source="与告警中心同一份实时派生告警（终端离线、打印机异常等），按发生时间倒序。处置请到告警中心。"
          render={(value) => {
            const items = focus === null ? value.items : value.items.filter((item) => item.terminalCode !== null && areaCodes.has(item.terminalCode))
            return (
              <>
                <TwinAlertList items={alertRows(items, openAlertTerminal, chrome.presenting)} emptyText={focus === null ? '当前没有告警' : `${focus}当前没有告警`} />
                {chrome.presenting ? null : (
                  <a
                    className="twin-cap twin-push twin-link"
                    href="/alerts"
                    onClick={(event) => {
                      event.preventDefault()
                      chrome.onNavigate('/alerts')
                    }}
                  >
                    进入告警中心 →
                  </a>
                )}
              </>
            )
          }}
        />
      </TwinSlot>
    </TwinShell>
  )
}
