import type { ScreenUsageSnapshot } from '@ai-job-print/shared'
import {
  SCREEN_HOSTING_OFF_NOTE,
  TWIN_TREND_GAP_NOTE,
  TwinAreaTrend,
  TwinMetricPanel,
  TwinPanel,
  TwinRankList,
  twinSmall,
  twinTrendHasGaps,
} from '@ai-job-print/ui'

/**
 * 信息使用在招聘内容托管关闭（托管 a）时的三块：服务端只下发政策一类。
 *
 * 每屏一个数只出现一次：浏览、收藏、打开来源入口三个合计只在左上「使用概况」里写，
 * 场景牌子不写数、不再单列收藏；「打开来源平台入口」按类型的条形图只剩一类、与概况重复，不渲染。
 *   - 左下「统计口径」：访问人次写成一条说明，不再挂一枚「未接入」小牌子；
 *   - 中栏底部「每日趋势」：宽图，少于 5 的日子画斜纹带；选「今日」时只剩一行状态，不把概况的数放大重写一遍；
 *   - 右栏「热门政策」：竖排 Top 5，标题写全（最多两行），并在这里说一次边界。
 */

type UsageMetrics = ScreenUsageSnapshot['metrics']

/** 访问人次这一条：数据层缺口与取数失败分开说；接入后（契约放开）直接写数。 */
function visitsLine(metric: UsageMetrics['visits']): string {
  if (!metric || (metric.available === false && metric.reason === 'kiosk_session_unwritten')) return '访问人次暂未统计（一体机会话尚未记录）'
  if (metric.available === false) return '访问人次本次没有取到，稍后自动重试'
  const value = (metric as { value: unknown }).value
  return typeof value === 'number' ? `访问人次 ${twinSmall(value)} 人次` : '访问人次本次没有取到，稍后自动重试'
}

export function OrgUsageNotesPanel({ visits, membersNote }: { visits: UsageMetrics['visits']; membersNote: string }) {
  return (
    <TwinPanel title="统计口径" sub="本页数字怎么来的" source={membersNote}>
      <ul className="twin-notes">
        <li>只统计登录会员的浏览、收藏与打开来源平台入口</li>
        <li>按内容当前的来源机构归属计入本机构</li>
        <li>任何分组少于 5 次都不显示具体数字</li>
        <li>打开来源平台入口只计打开次数，不是办理结果</li>
        <li>{visitsLine(visits)}</li>
      </ul>
    </TwinPanel>
  )
}

export function OrgDailyTrendPanel({ metric, rangeText, presenting }: { metric: UsageMetrics['partnerDaily']; rangeText: string; presenting: boolean }) {
  return (
    <TwinMetricPanel
      title="每日趋势"
      sub={rangeText}
      metric={metric}
      source="按上海自然日统计本机构政策公告的浏览与打开来源入口次数。少于 5 次的日子画成底部的斜纹带，不连线、不补数；前后都少于 5 的那一天单独画点并写出次数。"
      render={(value) => {
        // 今日只有一天：不把使用概况里的两个数放大重写一遍；展示档没有时间选择，不提去哪里选
        if (value.days.length <= 1) {
          return <p className="twin-cap">{presenting ? '今日只有一天，画不出趋势' : '今日只有一天，画不出趋势 · 选近 7 天看趋势'}</p>
        }
        const browse = value.days.map((d) => d.browse)
        const opens = value.days.map((d) => d.sourceOpens)
        return (
          <>
            <TwinAreaTrend
              fluid
              gapNote={false}
              days={value.days.map((d) => ({ date: d.date, value: d.browse }))}
              seriesLabel={`${rangeText}每日浏览次数`}
              secondary={{ label: `${rangeText}每日打开来源平台入口次数`, values: opens }}
              height={presenting ? 170 : 180}
            />
            <p className="twin-cap">
              <span className="twin-key is-acc" aria-hidden="true" />浏览{'\u3000'}<span className="twin-key is-gold" aria-hidden="true" />打开来源平台入口
              {twinTrendHasGaps(browse, opens) ? (
                <>
                  {'\u3000'}
                  <span className="twin-key is-hatch" aria-hidden="true" />
                  {TWIN_TREND_GAP_NOTE}
                </>
              ) : null}
            </p>
          </>
        )
      }}
    />
  )
}

export function OrgTopPoliciesPanel({ metric, rangeText, membersNote }: { metric: UsageMetrics['partnerTop']; rangeText: string; membersNote: string }) {
  return (
    <TwinMetricPanel
      title="热门政策"
      sub={`${rangeText} · 按浏览 · Top 5`}
      tone="info"
      metric={metric}
      source={`${membersNote}只列浏览达到 5 次的政策公告，按浏览次数排序，取前 5 条。`}
      render={(value) => {
        const items = value.items.slice(0, 5)
        return (
          <>
            <TwinRankList
              tall
              items={items.map((item, i) => ({ key: `${item.type}-${i}`, title: item.title, value: item.browse }))}
              emptyText="没有浏览达到 5 次的政策"
            />
            {/* 不满 5 条时说一句为什么短：没列出的都是浏览少于 5 次的 */}
            {items.length > 0 && items.length < 5 ? <p className="twin-cap twin-muted">浏览少于 5 次的政策不列出</p> : null}
            <p className="twin-cap twin-push">{SCREEN_HOSTING_OFF_NOTE}</p>
          </>
        )
      }}
    />
  )
}
