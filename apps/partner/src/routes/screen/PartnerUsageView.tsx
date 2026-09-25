import { useCallback, useMemo } from 'react'
import { replaceIfChanged, useRefreshable } from '@ai-job-print/refresh'
import {
  SCREEN_UNAVAILABLE_REASON,
  type ScreenContentType,
  type ScreenPartnerContentUsageValue,
  type ScreenUsageRange,
  type ScreenUsageSnapshot,
} from '@ai-job-print/shared'
import {
  SCREEN_SOURCE_ENTRY_NOTE,
  TWIN_STAGE_H,
  TWIN_STAGE_W,
  TwinAreaTrend,
  TwinBarList,
  TwinInfoFlow,
  TwinMetricPanel,
  TwinPanel,
  TwinRankList,
  TwinSceneBox,
  TwinSlot,
  TwinTiles,
  screenReasonCopy,
  twinInfoTotalParts,
  twinSmall,
  type TwinBarItem,
  type TwinInfoFlowType,
  type TwinTileItem,
} from '@ai-job-print/ui'
import { loadPartnerUsage, normalizeUsageRange } from '../../services/api/consoleScreen'
import { TwinShell, TwinShellEmpty, failureOf, stampText, type ScreenChrome, type ShellMeta } from './screenView'

/**
 * 信息使用：本机构发布的信息被浏览、收藏、打开来源平台入口了多少次。
 *
 * 口径（与后端统计接口一致，面板说明里逐条写明）：
 *   - 只含登录会员的行为记录；匿名浏览按小时计数接入后纳入。
 *   - 按内容当前的来源机构归属计入本机构（内容换了机构，历史记录跟着内容走）。
 *   - 任何分组少于 5 次一律显示「少于 5」（服务端已置空），合计里有未知就写「至少」，不补数。
 *   - 「打开来源平台入口」不是投递或预约结果；本平台不收简历、不代投递。
 */

const TITLE = '本机构信息使用态势'
const SUBTITLE = '数字孪生 · 信息使用'
const POLL_SECONDS = 60
const RANGES: ReadonlyArray<{ key: ScreenUsageRange; label: string }> = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
]
const RANGE_LABEL: Record<ScreenUsageRange, string> = { today: '今日', '7d': '近 7 天', '30d': '近 30 天' }
const TYPE_ORDER: readonly ScreenContentType[] = ['job', 'job_fair', 'policy', 'company_profile']
const TYPE_LABEL: Record<ScreenContentType, string> = { job: '岗位信息', job_fair: '招聘会', policy: '政策公告', company_profile: '企业资料' }
const TYPE_TAG: Record<ScreenContentType, string> = { job: '岗位', job_fair: '招聘会', policy: '政策', company_profile: '企业' }
const MEMBERS_NOTE = '只含登录会员的浏览、收藏与打开来源平台入口记录，按内容当前的来源机构归属计入本机构；少于 5 次不显示。'

type TypeRow = ScreenPartnerContentUsageValue['byType'][number]

function usageMeta(usage: ScreenUsageSnapshot): ShellMeta {
  const failed = Object.values(usage.metrics).filter((m) => m && m.available === false && m.reason === 'source_query_failed').length
  return { generatedAtText: stampText(usage.generatedAt), status: usage.status, failedSlices: failed, access: '访问口径：仅本机构已登录后台会话可见；只出聚合数字，少于 5 次不显示' }
}

/** 按固定顺序排四类；服务端没下发的类型不凭空补一行（契约里四类总是齐的）。 */
function orderedTypes(value: ScreenPartnerContentUsageValue): TypeRow[] {
  const rows: TypeRow[] = []
  for (const type of TYPE_ORDER) {
    const row = value.byType.find((item) => item.type === type)
    if (row) rows.push(row)
  }
  return rows
}

/** 条形只画已知的数；少于 5 的类型不画成零长条，改在脚注里点名。 */
function barsOf(rows: TypeRow[], pick: (row: TypeRow) => number | null, tone: TwinBarItem['tone']): { items: TwinBarItem[]; small: string[] } {
  const items: TwinBarItem[] = []
  const small: string[] = []
  for (const row of rows) {
    const v = pick(row)
    if (v === null) small.push(TYPE_LABEL[row.type])
    else items.push({ label: TYPE_LABEL[row.type], value: v, tone })
  }
  items.sort((a, b) => b.value - a.value)
  return { items, small }
}

/** 访问人次三态：已接入给数，未接入给原因；契约里它现在是 never，接入后类型会随之放开。 */
function VisitsValue({ metric }: { metric: ScreenUsageSnapshot['metrics']['visits'] }) {
  const reason = !metric ? 'kiosk_session_unwritten' : metric.available === false ? metric.reason : null
  if (reason !== null) {
    const copy = screenReasonCopy(reason)
    return (
      <span className="twin-pend" title={copy.detail}>
        {copy.title}
      </span>
    )
  }
  const value = (metric as { value: unknown }).value
  return typeof value === 'number' ? (
    <b>
      {twinSmall(value)}
      <span className="twin-unit">人次</span>
    </b>
  ) : (
    <span className="twin-pend">{screenReasonCopy('source_query_failed').title}</span>
  )
}

function useUsage(range: ScreenUsageRange) {
  const fetcher = useCallback(() => loadPartnerUsage(range), [range])
  const result = useRefreshable<ScreenUsageSnapshot>(
    `partner:screen:usage:${range}`,
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

export function PartnerUsageView({ chrome }: { chrome: ScreenChrome }) {
  const range = normalizeUsageRange(chrome.params.get('range'))
  const usage = useUsage(range)
  if (!usage.data) {
    return <TwinShellEmpty chrome={chrome} title={TITLE} subtitle={SUBTITLE} failure={usage.failure} onRetry={() => void usage.refresh()} />
  }
  const u = usage.data.metrics
  const rangeText = RANGE_LABEL[usage.data.range]
  const content = u.partnerContent?.available ? orderedTypes(u.partnerContent.value) : null
  // 托管 a：服务端只下发政策一类；岗位、招聘会、企业照样占位，写「未开启」，不当成没人看
  const hostingOff = usage.data.limits.recruitmentHosting === 'disabled'
  const flowTypes: TwinInfoFlowType[] = content
    ? TYPE_ORDER.flatMap((type): TwinInfoFlowType[] => {
        const row = content.find((item) => item.type === type)
        if (row) return [{ key: type, label: TYPE_LABEL[type], browse: row.browse, favorites: row.favorites, sourceOpens: row.sourceOpens }]
        return hostingOff ? [{ key: type, label: TYPE_LABEL[type], browse: null, favorites: null, sourceOpens: null, disabled: true }] : []
      })
    : []
  const topLimit = chrome.presenting ? 5 : 8

  const toolbar = (
    <div className="twin-fgrp" role="group" aria-label="统计时间">
      <span className="twin-flabel">时间</span>
      {RANGES.map((r) => (
        <button key={r.key} type="button" className="twin-chip" aria-pressed={range === r.key} onClick={() => chrome.setParam('range', r.key === 'today' ? null : r.key)}>
          {r.label}
        </button>
      ))}
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
    >
      <TwinSlot slot="l1">
        <TwinMetricPanel
          title="使用概况"
          sub={rangeText}
          metric={u.partnerContent}
          source={`${MEMBERS_NOTE}合计里有少于 5 的类型时写「至少」，不把未知当 0 加进去。不含投递、预约结果。`}
          render={(value) => {
            const rows = orderedTypes(value)
            const stats: Array<[string, Array<number | null>]> = [
              ['浏览', rows.map((r) => r.browse)],
              ['收藏', rows.map((r) => r.favorites)],
              ['打开来源平台入口', rows.map((r) => r.sourceOpens)],
            ]
            return (
              <>
                <div className="twin-stat-list">
                  {stats.map(([label, values]) => {
                    const total = twinInfoTotalParts(values)
                    return (
                      <div key={label} className="twin-stat">
                        <span>{label}</span>
                        <b>
                          {total.prefix ? <small>{total.prefix}</small> : null}
                          {total.text}
                          <span className="twin-unit">次</span>
                        </b>
                      </div>
                    )
                  })}
                </div>
              </>
            )
          }}
        />
      </TwinSlot>

      <TwinSlot slot="l2">
        <TwinMetricPanel
          title="每日趋势"
          sub={rangeText}
          metric={u.partnerDaily}
          source="按上海自然日统计本机构信息的浏览与打开来源平台入口次数。少于 5 次的日子画在底线上的空心点，不连线、不补数。"
          render={(value) =>
            value.days.length <= 1 ? (
              <>
                <TwinTiles
                  items={[
                    { value: value.days.length ? twinSmall(value.days[0].browse) : '—', unit: '次', label: '今日浏览' },
                    { value: value.days.length ? twinSmall(value.days[0].sourceOpens) : '—', unit: '次', label: '今日打开来源平台' },
                  ]}
                />
                <p className="twin-cap twin-push">选「近 7 天」或「近 30 天」查看趋势</p>
              </>
            ) : (
              <>
                <TwinAreaTrend
                  days={value.days.map((d) => ({ date: d.date, value: d.browse }))}
                  seriesLabel={`${rangeText}每日浏览次数`}
                  secondary={{ label: `${rangeText}每日打开来源平台入口次数`, values: value.days.map((d) => d.sourceOpens) }}
                />
                <p className="twin-cap twin-push">
                  <span className="twin-key is-acc" aria-hidden="true" />浏览{'\u3000'}<span className="twin-key is-gold" aria-hidden="true" />打开来源平台入口
                </p>
              </>
            )
          }
        />
      </TwinSlot>

      <TwinSlot slot="l3">
        <TwinPanel title="统计口径" sub="本页数字怎么来的" source={MEMBERS_NOTE}>
          <ul className="twin-notes">
            <li>只统计登录会员的浏览、收藏与打开来源平台入口</li>
            <li>按内容当前的来源机构归属计入本机构</li>
            <li>任何分组少于 5 次都不显示具体数字</li>
            <li>打开来源平台入口不是投递或预约结果，本平台不收简历、不代投递</li>
          </ul>
          <div className="twin-kv twin-push">
            <span>访问人次</span>
            <VisitsValue metric={u.visits} />
          </div>
        </TwinPanel>
      </TwinSlot>

      <TwinSlot slot="scene">
        {content ? (
          <TwinSceneBox baseWidth={TWIN_STAGE_W} baseHeight={TWIN_STAGE_H} label="本机构信息流向">
            <TwinInfoFlow
              types={flowTypes}
              hubLabel="本机构信息"
              hubCaption={`${rangeText} · 登录会员`}
            />
          </TwinSceneBox>
        ) : (
          <TwinMetricPanel title="信息流向" metric={u.partnerContent} source={MEMBERS_NOTE} render={() => null} />
        )}
        {content ? (
          <div className="twin-overlay is-tl">
            <span>本机构信息 → 浏览 → 收藏 / 打开来源平台入口 · 柱高与线宽按真实次数</span>
          </div>
        ) : null}
      </TwinSlot>

      <TwinSlot slot="bottom">
        <TwinMetricPanel
          title="按信息类型"
          sub={rangeText}
          tone="info"
          metric={u.partnerContent}
          source={MEMBERS_NOTE}
          render={(value) => (
            <TwinTiles
              cols={4}
              compact
              items={TYPE_ORDER.flatMap((type): TwinTileItem[] => {
                const row = value.byType.find((item) => item.type === type)
                if (row) {
                  return [{ value: twinSmall(row.browse), unit: '次浏览', label: TYPE_LABEL[type], hint: `收藏 ${twinSmall(row.favorites)} · 来源 ${twinSmall(row.sourceOpens)}` }]
                }
                return hostingOff ? [{ label: TYPE_LABEL[type], unavailableReason: SCREEN_UNAVAILABLE_REASON.recruitmentHostingDisabled }] : []
              })}
            />
          )}
        />
      </TwinSlot>

      <TwinSlot slot="r1">
        <TwinMetricPanel
          title="打开来源平台入口"
          sub={rangeText}
          tone="info"
          metric={u.partnerContent}
          source={SCREEN_SOURCE_ENTRY_NOTE}
          render={(value) => {
            const bars = barsOf(orderedTypes(value), (row) => row.sourceOpens, 'info')
            return (
              <>
                <TwinBarList items={bars.items} emptyText="没有达到 5 次的类型" />
                <p className="twin-cap twin-push">
                  {bars.small.length ? `少于 5 次：${bars.small.join('、')} · ` : ''}统计打开来源平台入口的次数，不是投递结果
                </p>
              </>
            )
          }}
        />
      </TwinSlot>

      <TwinSlot slot="r2">
        <TwinMetricPanel
          title="收藏"
          sub={rangeText}
          metric={u.partnerContent}
          source={`${MEMBERS_NOTE}收藏记在用户本人名下，这里只有按类型的合计，看不到是谁收藏的。`}
          render={(value) => {
            const bars = barsOf(orderedTypes(value), (row) => row.favorites, 'acc')
            return (
              <>
                <TwinBarList items={bars.items} emptyText="没有达到 5 次的类型" />
                <p className="twin-cap twin-push">{bars.small.length ? `少于 5 次：${bars.small.join('、')}` : '只有合计，看不到是谁收藏的'}</p>
              </>
            )
          }}
        />
      </TwinSlot>

      <TwinSlot slot="r3">
        <TwinMetricPanel
          title="热门内容"
          sub={`${rangeText} · 按浏览`}
          tone="info"
          metric={u.partnerTop}
          source={`${MEMBERS_NOTE}只列浏览达到 5 次的内容，按浏览次数排序。`}
          render={(value) => (
            <>
              <TwinRankList
                items={value.items.slice(0, topLimit).map((item, i) => ({ key: `${item.type}-${i}`, title: item.title, tag: TYPE_TAG[item.type], value: item.browse }))}
                emptyText="没有浏览达到 5 次的内容"
              />
              <p className="twin-cap twin-push">少于 5 次的内容不列出</p>
            </>
          )}
        />
      </TwinSlot>
    </TwinShell>
  )
}
