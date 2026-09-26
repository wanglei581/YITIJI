import type { ScreenUsageSnapshot } from '@ai-job-print/shared'
import { SCREEN_HOSTING_OFF_NOTE, TwinMetricPanel, TwinRankList, twinSmall } from '@ai-job-print/ui'

/**
 * 信息使用在招聘内容托管关闭（托管 a）时的两块：服务端只下发政策一类。
 *
 * 「打开来源平台入口」按类型的条形图与「使用概况」重复（只剩一类），不再渲染；
 * 「按信息类型」换成底栏的「热门政策」（从右栏挪来，底栏更宽，按列铺开）并在这里说一次边界；
 * 「收藏」只剩政策一类，画成一个大数。
 */

type UsageMetrics = ScreenUsageSnapshot['metrics']

export function OrgTopPoliciesPanel({ metric, rangeText, limit, membersNote }: { metric: UsageMetrics['partnerTop']; rangeText: string; limit: number; membersNote: string }) {
  return (
    <TwinMetricPanel
      title="热门政策"
      sub={`${rangeText} · 按浏览`}
      tone="info"
      metric={metric}
      source={`${membersNote}只列浏览达到 5 次的政策公告，按浏览次数排序。`}
      render={(value) => (
        <>
          <TwinRankList
            wide
            items={value.items.slice(0, limit).map((item, i) => ({ key: `${item.type}-${i}`, title: item.title, value: item.browse }))}
            emptyText="没有浏览达到 5 次的政策"
          />
          <p className="twin-cap twin-push">{SCREEN_HOSTING_OFF_NOTE}</p>
        </>
      )}
    />
  )
}

export function OrgFavoritesPanel({ metric, rangeText, membersNote }: { metric: UsageMetrics['partnerContent']; rangeText: string; membersNote: string }) {
  return (
    <TwinMetricPanel
      title="收藏"
      sub={rangeText}
      metric={metric}
      source={`${membersNote}收藏记在用户本人名下，这里只有合计，看不到是谁收藏的。`}
      render={(value) => {
        const policy = value.byType.find((row) => row.type === 'policy')
        return policy ? (
          <>
            <div className="twin-hero is-center">
              <span className="twin-big">{twinSmall(policy.favorites)}</span>
              <span className="twin-unit">次</span>
              <span className="twin-muted">政策公告收藏</span>
            </div>
            <p className="twin-cap">只有合计，看不到是谁收藏的</p>
          </>
        ) : (
          <p className="twin-empty">所选时间内没有政策收藏记录</p>
        )
      }}
    />
  )
}
