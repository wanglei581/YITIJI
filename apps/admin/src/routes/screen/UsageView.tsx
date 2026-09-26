import { useCallback, useMemo } from 'react'
import { replaceIfChanged, useRefreshable } from '@ai-job-print/refresh'
import { formatTime, type ScreenUsageRange, type ScreenUsageSnapshot } from '@ai-job-print/shared'
import {
  SCREEN_SOURCE_ENTRY_NOTE,
  TWIN_STAGE_H,
  TWIN_STAGE_W,
  TwinBarList,
  TwinHeat,
  TwinMetricPanel,
  TwinNetwork,
  TwinPanel,
  TwinPulse,
  TwinSceneBox,
  TwinSlot,
  TwinSteps,
  TwinTiles,
  screenCount,
  twinSmall,
  type TwinTileItem,
} from '@ai-job-print/ui'
import { loadAdminUsage, normalizeUsageRange } from '../../services/api/consoleScreen'
import { aiOperationLabel, usageServiceLabel } from './metricLabels'
import { TwinShell, TwinShellEmpty, failureOf, stampText, type ScreenChrome, type ShellMeta } from './screenView'
import { metricReason } from './screenMeta'
import { UsageAiPanel, UsageAiQualityPanel, UsagePolicyPanel } from './UsageHostingOff'

/**
 * 服务调用：系统里每一类服务被用了多少次，按渠道、时段、步骤、AI 功能与模型拆开。
 *
 * 口径（与后端统计接口一致，面板角标与口径说明里逐条写明）：
 *   - 只统计系统已经记下来的行为；访问人次、匿名浏览、上传与检查计数尚未记录，如实标「待接入」。
 *   - 任何分组少于 5 次一律显示「少于 5」（服务端已置空），不补数、不估算。
 *   - 岗位、招聘会、政策、企业的浏览与外跳只含登录会员；外跳是「打开来源平台入口」，不是投递结果。
 *   - 渠道拆分只来自已付款订单（订单才有渠道字段），不是全部调用的渠道。
 *   - 招聘内容托管关闭时服务端不下发岗位、招聘会、企业三个节点与「岗位信息使用」；
 *     右栏换成 AI 服务 / AI 质量 / 政策服务使用（UsageHostingOff.tsx），「岗位 AI」节点改叫「简历对照」。
 */

const TITLE = '职易达 · 系统使用与服务调用态势'
const SUBTITLE = '数字孪生 · 服务调用'
const POLL_SECONDS = 60
const RANGES: ReadonlyArray<{ key: ScreenUsageRange; label: string }> = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
]
const RANGE_LABEL: Record<ScreenUsageRange, string> = { today: '今日', '7d': '近 7 天', '30d': '近 30 天' }
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const MEMBERS_NOTE = '只含登录会员的浏览与外跳；匿名使用按小时计数接入后纳入。'

function usageMeta(usage: ScreenUsageSnapshot): ShellMeta {
  const failed = Object.values(usage.metrics).filter((m) => m && m.available === false && m.reason === 'source_query_failed').length
  return { generatedAtText: stampText(usage.generatedAt), status: usage.status, failedSlices: failed, access: '访问口径：仅已登录后台会话可见；只出聚合数字，少于 5 次不显示' }
}

function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** 访问人次三态：已接入给数，未接入给原因；契约里它现在是 never，接入后类型会随之放开。 */
function visitsTile(metric: ScreenUsageSnapshot['metrics']['visits']): TwinTileItem {
  if (!metric) return { label: '访问人次', unavailableReason: 'kiosk_session_unwritten' }
  if (metric.available === false) return { label: '访问人次', unavailableReason: metric.reason }
  const value = (metric as { value: unknown }).value
  return typeof value === 'number' ? { value: twinSmall(value), unit: '人次', label: '访问人次' } : { label: '访问人次', unavailableReason: 'source_query_failed' }
}

function percent(value: number | null): string {
  return value === null ? '样本不足' : `${value.toFixed(1)}%`
}

function useUsage(range: ScreenUsageRange) {
  const fetcher = useCallback(() => loadAdminUsage(range), [range])
  const result = useRefreshable<ScreenUsageSnapshot>(
    `admin:screen:usage:${range}`,
    fetcher,
    useMemo(
      () => ({
        intervalMs: POLL_SECONDS * 1000,
        merge: replaceIfChanged<ScreenUsageSnapshot>,
        failPolicy: 'keep-last' as const,
      }),
      [],
    ),
  )
  return { ...result, failure: failureOf(result.error) }
}

export function UsageView({ chrome }: { chrome: ScreenChrome }) {
  const range = normalizeUsageRange(chrome.params.get('range'))
  const usage = useUsage(range)
  if (!usage.data) {
    return <TwinShellEmpty chrome={chrome} title={TITLE} subtitle={SUBTITLE} failure={usage.failure} onRetry={() => void usage.refresh()} />
  }
  const u = usage.data.metrics
  const rangeText = RANGE_LABEL[usage.data.range]
  const hostingOff = usage.data.limits.recruitmentHosting === 'disabled'
  const nowHour = Number(formatTime(usage.data.generatedAt).split(':')[0])

  const toolbar = (
    <div className="twin-fgrp" role="group" aria-label="统计时间">
      <span className="twin-flabel">时间</span>
      {RANGES.map((r) => (
        <button key={r.key} type="button" className="twin-chip" aria-pressed={range === r.key} onClick={() => chrome.setParam('range', r.key === 'today' ? null : r.key)}>
          {r.label}
        </button>
      ))}
      <span className="twin-cap">热力固定近 7 天，脉冲固定近 2 小时</span>
    </div>
  )

  return (
    <TwinShell
      chrome={chrome}
      title={TITLE}
      subtitle={`${SUBTITLE} · ${rangeText}`}
      layout="city"
      toolbar={toolbar}
      meta={usageMeta(usage.data)}
      pollSeconds={POLL_SECONDS}
      failure={usage.failure}
      onRefresh={() => void usage.refresh()}
      refreshing={usage.status === 'loading'}
      hostingOff={hostingOff}
    >
      <TwinSlot slot="l1">
        <TwinMetricPanel
          title="下单渠道"
          sub={`${rangeText} · 已付款订单`}
          metric={u.channels}
          source="按订单支付时间统计已付款订单的渠道（一体机 / 小程序），存量没有渠道的单列「未标注」。只有订单记录渠道，这不是全部调用的渠道拆分。少于 5 单显示「少于 5」。"
          render={(value) => {
            const kiosk = value.kiosk === null ? 0 : value.kiosk
            const miniapp = value.miniapp === null ? 0 : value.miniapp
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="twin-big">{twinSmall(value.paidOrders)}</span>
                  <span className="twin-unit">单</span>
                </div>
                {kiosk + miniapp > 0 ? (
                  <div className="twin-split" aria-hidden="true">
                    <i style={{ flex: kiosk, background: 'linear-gradient(90deg,#1f9e86,#2ee6a8)' }} />
                    <i style={{ flex: miniapp, background: 'linear-gradient(90deg,#3f68b0,#8fb2ee)' }} />
                  </div>
                ) : null}
                <div className="twin-legend">
                  <span className="twin-lg">一体机 {twinSmall(value.kiosk)}</span>
                  <span className="twin-lg">小程序 {twinSmall(value.miniapp)}</span>
                  {value.unlabeled !== null && value.unlabeled > 0 ? <span className="twin-lg">未标注 {screenCount(value.unlabeled)}</span> : null}
                </div>
                <div className="twin-push">
                  <TwinTiles
                    items={[
                      {
                        value:
                          value.memberOrders !== null && value.paidOrders !== null && value.paidOrders > 0
                            ? String(Math.round((value.memberOrders / value.paidOrders) * 100))
                            : '样本不足',
                        unit: value.memberOrders !== null && value.paidOrders !== null && value.paidOrders > 0 ? '%' : undefined,
                        label: '会员下单占比',
                      },
                      visitsTile(u.visits),
                    ]}
                  />
                </div>
              </>
            )
          }}
        />
      </TwinSlot>

      <TwinSlot slot="l2">
        <TwinMetricPanel
          title="使用时段热力"
          sub="近 7 天 · 每小时"
          metric={u.heat7d}
          source="近 7 个上海自然日，按小时统计已记录的服务调用（AI、打印、扫描、会员浏览、外跳、收藏）。少于 5 次的格子不显示（虚线）。"
          render={(value) => (
            <>
              <TwinHeat
                rows={value.days.map((day, i) => ({
                  key: day.date,
                  label: i === value.days.length - 1 ? '今天' : weekdayOf(day.date),
                  hours: day.hours,
                  future: i === value.days.length - 1 ? nowHour + 1 : undefined,
                }))}
              />
              <p className="twin-cap twin-push">
                {value.peakHour === null ? '样本不足，暂不标高峰' : `高峰在 ${value.peakHour}–${value.peakHour + 1} 时`}；虚线格不足 5 次
              </p>
            </>
          )}
        />
      </TwinSlot>

      <TwinSlot slot="l3">
        <TwinPanel
          title="服务步骤完成数"
          sub={rangeText}
          source="各步分别计数，不是同一批文件的转化率。上传与材料检查的原始记录按隐私要求 24 小时内删除，需另记不含内容的计数后才能显示。"
        >
          <span className="twin-muted">打印</span>
          {u.printSteps?.available ? (
            <TwinSteps
              items={[
                u.printSteps.value.uploaded.available ? { label: '上传', count: u.printSteps.value.uploaded.value } : { label: '上传', count: null, unavailableReason: u.printSteps.value.uploaded.reason },
                u.printSteps.value.inspected.available ? { label: '通过检查', count: u.printSteps.value.inspected.value } : { label: '通过检查', count: null, unavailableReason: u.printSteps.value.inspected.reason },
                { label: '已付款', count: u.printSteps.value.paid },
                { label: '已出纸', count: u.printSteps.value.printed },
              ]}
            />
          ) : (
            <p className="twin-cap">打印步骤本次没有取到</p>
          )}
          <span className="twin-muted">AI 简历</span>
          {u.resumeSteps?.available ? (
            <TwinSteps
              items={[
                u.resumeSteps.value.uploaded.available ? { label: '上传', count: u.resumeSteps.value.uploaded.value } : { label: '上传', count: null, unavailableReason: u.resumeSteps.value.uploaded.reason },
                { label: '解析诊断', count: u.resumeSteps.value.analyzed },
                { label: '优化', count: u.resumeSteps.value.optimized },
                { label: '导出', count: u.resumeSteps.value.exported },
              ]}
            />
          ) : (
            <p className="twin-cap">AI 简历步骤本次没有取到</p>
          )}
          <p className="twin-cap twin-push">各步分别计数，不代表同一批文件的转化率</p>
        </TwinPanel>
      </TwinSlot>

      <TwinSlot slot="scene">
        {u.services?.available && u.outcomes?.available && !chrome.lite ? (
          <>
            <TwinSceneBox baseWidth={TWIN_STAGE_W} baseHeight={TWIN_STAGE_H} label="服务调用网络">
              <TwinNetwork
                channels={[
                  { key: 'kiosk', label: '一体机', count: u.channels?.available ? u.channels.value.kiosk : { reason: metricReason(u.channels) }, caption: '已付款订单' },
                  { key: 'miniapp', label: '小程序', count: u.channels?.available ? u.channels.value.miniapp : { reason: metricReason(u.channels) }, caption: '已付款订单' },
                ]}
                services={u.services.value.flatMap((s) => {
                  const label = usageServiceLabel(s.key, hostingOff)
                  return label === null ? [] : [{ key: s.key, label, lane: s.lane, count: s.count }]
                })}
                outcomes={[
                  { key: 'sourceOpens', label: '打开来源平台', count: u.outcomes.value.sourceOpens },
                  { key: 'favorites', label: '收藏', count: u.outcomes.value.favorites },
                  { key: 'aiReports', label: 'AI 报告', count: u.outcomes.value.aiReports },
                  { key: 'printed', label: '出纸完成', count: u.outcomes.value.printed },
                ]}
                hubLabel="服务中枢"
                hubCaption="一体机 · 小程序共用"
                aiLabel="AI 能力中枢"
                aiCaption="成功调用计入各项服务"
              />
            </TwinSceneBox>
            <div className="twin-overlay is-tl">服务调用网络 · {rangeText}</div>
            <div className="twin-overlay is-tr">
              <span className="twin-lg"><i className="twin-dot" style={{ ['--c' as string]: '#8fb2ee' }} />信息服务</span>
              <span className="twin-lg"><i className="twin-dot s-ok" />AI 服务</span>
              <span className="twin-lg"><i className="twin-dot s-pr" />打印扫描</span>
              <span className="twin-lg"><i className="twin-dot s-wa is-warn" />产出与去向</span>
              <span className="twin-muted">柱高、线宽 = 次数</span>
            </div>
          </>
        ) : (
          <TwinMetricPanel
            title="各项服务使用次数"
            sub={rangeText}
            metric={u.services}
            source="各项服务在所选时间内的使用次数，少于 5 次显示「少于 5」。"
            render={(value) => (
              <TwinBarList
                items={value.flatMap((s) => {
                  // 与 3D 服务网络同一份中文名；认不出来的键两边都不画，英文键不上屏
                  const label = usageServiceLabel(s.key, hostingOff)
                  return label === null ? [] : [{ label, value: s.count === null ? 0 : s.count, valueText: twinSmall(s.count) }]
                })}
                emptyText="所选时间内没有服务调用记录"
              />
            )}
          />
        )}
      </TwinSlot>

      <TwinSlot slot="bottom">
        <TwinMetricPanel
          title="实时调用脉冲"
          sub="近 2 小时 · 每 5 分钟汇总 · 不含个人明细"
          metric={u.pulse2h}
          source="每 5 分钟汇总一次信息浏览、AI 调用、打印扫描的次数；少于 5 次的段不画。只有汇总，不滚动任何一次个人操作。"
          render={(value) => {
            const last = value.buckets[value.buckets.length - 1]
            const first = value.buckets[0]
            return (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22 }}>
                <div style={{ width: 200, flex: 'none' }}>
                  <span className="twin-muted">最近 5 分钟</span>
                  <div className="twin-legend" style={{ marginTop: 6 }}>
                    <span className="twin-lg" style={{ color: '#8fb2ee' }}>信息 {last ? twinSmall(last.info) : '—'}</span>
                    <span className="twin-lg" style={{ color: '#2ee6a8' }}>AI {last ? twinSmall(last.ai) : '—'}</span>
                    <span className="twin-lg" style={{ color: '#72d6ff' }}>打印 {last ? twinSmall(last.print) : '—'}</span>
                  </div>
                </div>
                <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <TwinPulse buckets={value.buckets.map((b) => ({ key: b.start, info: b.info, ai: b.ai, print: b.print }))} />
                  <div className="twin-num twin-muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{first ? formatTime(first.start) : ''}</span>
                    <span>现在</span>
                  </div>
                </div>
              </div>
            )
          }}
        />
      </TwinSlot>

      <TwinSlot slot="r1">
        {hostingOff ? (
          <UsageAiPanel metric={u.ai} rangeText={rangeText} presenting={chrome.presenting} />
        ) : (
          <TwinMetricPanel
            title="AI 服务"
            sub={`${rangeText} · 按功能`}
            metric={u.ai}
            source="AI 服务日志：按功能计次，成功率 = 成功 ÷（成功 + 失败），平均耗时只算成功调用，成本只加已采集的估算。模型按调用方记录的提供方统计。少于 5 次不显示。"
            render={(value) => (
              <>
                <TwinBarList
                  items={value.byOperation
                    .map((row) => ({ label: aiOperationLabel(row.operation), value: row.count === null ? 0 : row.count, valueText: twinSmall(row.count) }))
                    .sort((a, b) => b.value - a.value)
                    .slice(0, chrome.presenting ? 4 : 6)}
                  emptyText="所选时间内没有 AI 调用"
                />
                <p className="twin-cap">
                  模型：{value.providers.length ? value.providers.map((p) => `${p.label} ${twinSmall(p.count)}`).join(' · ') : '暂无调用'}
                </p>
                <div className="twin-push">
                  <TwinTiles
                    cols={4}
                    compact
                    items={[
                      { value: percent(value.successRate), label: '成功率' },
                      // 单位另起一个小号 span：「2.18 秒」整串放在四列紧凑磁贴里，舞台档会折成两行把面板撑出块位
                      value.avgLatencyMs === null
                        ? { value: '样本不足', label: '平均耗时' }
                        : { value: (value.avgLatencyMs / 1000).toFixed(2), unit: '秒', label: '平均耗时' },
                      { value: value.estimatedCostCny === null ? '样本不足' : `¥${value.estimatedCostCny.toFixed(2)}`, label: '估算成本' },
                      { value: twinSmall(value.fallbackCalls), label: '降级兜底' },
                    ]}
                  />
                </div>
              </>
            )}
          />
        )}
      </TwinSlot>

      <TwinSlot slot="r2">
        {hostingOff ? (
          <UsageAiQualityPanel metric={u.ai} rangeText={rangeText} />
        ) : (
          <TwinMetricPanel
            title="岗位信息使用"
            sub={rangeText}
            tone="info"
            metric={u.jobs}
            source={`${MEMBERS_NOTE} ${SCREEN_SOURCE_ENTRY_NOTE}`}
            render={(value) => (
              <>
                <TwinTiles
                  cols={3}
                  compact
                  items={[
                    { value: twinSmall(value.browse), label: '浏览' },
                    { value: twinSmall(value.favorites), label: '收藏' },
                    { value: twinSmall(value.sourceOpens), label: '打开来源平台' },
                  ]}
                />
                {u.topSources30d?.available ? (
                  <TwinBarList
                    items={u.topSources30d.value.items.slice(0, chrome.presenting ? 3 : 5).map((item) => ({ label: item.sourceName, value: item.count, tone: 'info' as const }))}
                    emptyText="近 30 天没有达到 5 次的来源入口"
                  />
                ) : null}
                <p className="twin-cap twin-push">只统计浏览、收藏与打开来源平台入口，不是投递结果</p>
              </>
            )}
          />
        )}
      </TwinSlot>

      <TwinSlot slot="r3">
        {hostingOff ? (
          <UsagePolicyPanel metric={u.content} rangeText={rangeText} membersNote={MEMBERS_NOTE} />
        ) : (
          <TwinMetricPanel
            title="信息内容浏览"
            sub={rangeText}
            tone="info"
            metric={u.content}
            source={MEMBERS_NOTE}
            render={(value) => (
              <>
                <TwinTiles
                  cols={3}
                  compact
                  items={[
                    { value: twinSmall(value.policy), label: '政策服务' },
                    { value: twinSmall(value.fair), label: '招聘会' },
                    { value: twinSmall(value.company), label: '企业展示' },
                  ]}
                />
                <p className="twin-cap twin-push">{MEMBERS_NOTE}</p>
              </>
            )}
          />
        )}
      </TwinSlot>
    </TwinShell>
  )
}
