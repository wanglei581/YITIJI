import type { ScreenSnapshotMetrics } from '@ai-job-print/shared'
import {
  ScreenCard,
  ScreenFleetWall,
  ScreenGapList,
  ScreenGrid,
  ScreenKpi,
  ScreenMetricCard,
  ScreenMiniGrid,
  screenCount,
  screenFleetOnlineText,
  screenFleetScopeNote,
} from '@ai-job-print/ui'
import { buildPartnerGapEntries, countPartnerGapMetrics } from './metricLabels'

/**
 * 合作机构版大屏。只画本机构的数据 —— 服务端的 orgId 只从鉴权用户回源，
 * 前端一个机构标识都不发，跨机构数据在这里不可达。
 *
 * 两处刻意与管理员版不同：
 *
 * 1. **不画「来源机构数」**。契约里它是「本机构在架岗位按来源机构分组的组数」，
 *    对机构自己永远是 0 或 1，写「来自 1 家信息来源机构」毫无信息量，
 *    还容易被读成跨机构统计。所以在架岗位只给条数。
 *
 * 2. **机队分类必须标样本**。服务端对机构机队列表有 200 台取数上限，
 *    正常 / 告警 / 离线是**样本内**计数，`matchedCount` 才是全量。
 *    截断时绝不能把「样本里 33 台正常」说成「共 640 台里 33 台正常」。
 */

export function PartnerGrid({ metrics }: { metrics: ScreenSnapshotMetrics }) {
  const gaps = buildPartnerGapEntries(metrics)
  const gapCount = countPartnerGapMetrics(gaps)
  return (
    <ScreenGrid layout="partner">
      <ScreenMetricCard
        title="本机构在网终端"
        metric={metrics.terminalsOnline}
        span={3}
        foot={
          metrics.terminalsOnline?.available
            ? `终端心跳投影，只取本机构终端。${screenFleetScopeNote(metrics.terminalsOnline.value, '本机构')}。`
            : ''
        }
        render={(value) => {
          const text = screenFleetOnlineText(value)
          return (
            <ScreenKpi
              value={text.value}
              unit={text.unit}
              label={`最近 ${value.onlineWindowSeconds} 秒有心跳${value.truncated ? '（分母为样本台数）' : ''}`}
            />
          )
        }}
      />

      <ScreenMetricCard
        title="本机构在架岗位"
        metric={metrics.jobsOnShelf}
        span={3}
        foot="已审核通过 + 已发布 + 未过期，且来源机构为本机构。岗位只作第三方来源信息展示，本平台不收简历。"
        render={(value) => (
          <ScreenKpi value={screenCount(value.published)} unit="条" label="终端与小程序上可见的条数" />
        )}
      />

      <ScreenMetricCard
        title="待管理员审核"
        metric={metrics.pendingReview}
        span={3}
        foot="本机构四类内容 pending + reviewing 的服务端计数。审核由平台侧执行，通过后才在终端展示。"
        render={(value) => (
          <ScreenKpi
            value={screenCount(value.total)}
            unit="条"
            tone={value.total > 0 ? 'warn' : 'normal'}
            label={`岗位 ${value.jobs} · 招聘会 ${value.fairs} · 政策 ${value.policies} · 企业 ${value.companies}`}
          />
        )}
      />

      <ScreenMetricCard
        title="同步成功率"
        metric={metrics.syncSuccessRate24h}
        span={3}
        foot="本机构数据源近 24 小时的同步批次结果，部分失败按失败计。逐批明细见同步日志页。"
        render={(value) =>
          value.successRate === null ? (
            <ScreenKpi value="近 24 小时无同步批次" label="没有分母，因此不给百分比" labelMuted />
          ) : (
            <ScreenKpi
              value={value.successRate.toFixed(1)}
              unit="%"
              tone={value.successRate < 90 ? 'warn' : 'normal'}
              label={`近 24 小时 · ${screenCount(value.total)} 个批次`}
            />
          )
        }
      />

      <ScreenMetricCard
        title="本机构终端状态墙"
        tag={metrics.fleetWall?.available ? `${screenCount(metrics.fleetWall.value.matchedCount)} 台` : undefined}
        metric={metrics.fleetWall}
        span={6}
        tall
        foot={
          metrics.fleetWall?.available
            ? `每格一台本机构终端，按终端编号排序。${screenFleetScopeNote(metrics.fleetWall.value, '本机构')}。「从未上报」= 已注册但没有过任何心跳，与「离线」分开计。`
            : ''
        }
        render={(value) => <ScreenFleetWall value={value} scopeLabel="本机构" />}
      />

      <ScreenMetricCard
        title="本机构信息归集"
        tag="在架量"
        metric={metrics.contentInventory}
        span={6}
        tall
        foot="「在架」= 审核通过且已发布且未过期。待审核为 pending 与 reviewing 的合计，服务端不单独下发两者，故此处不拆。"
        render={(value) => (
          <ScreenMiniGrid
            items={[
              {
                value: screenCount(value.jobsPublished),
                label: '岗位信息',
                hint: `待审核 ${screenCount(value.jobsPending)} 条（含审核中）`,
              },
              {
                value: screenCount(value.fairsPublished),
                label: '招聘会信息',
                hint: `待审核 ${screenCount(value.fairsPending)} 条（含审核中）`,
              },
              {
                value: screenCount(value.policiesPublished),
                label: '政策公告',
                hint: `待审核 ${screenCount(value.policiesPending)} 条（含审核中）`,
              },
              {
                value: screenCount(value.companiesPublished),
                label: '企业资料',
                hint: `待审核 ${screenCount(value.companiesPending)} 条（含审核中）`,
              },
            ]}
          />
        )}
      />

      <ScreenMetricCard
        title="招聘会结构"
        tag={
          metrics.fairStructure?.available
            ? `进行中 ${screenCount(metrics.fairStructure.value.ongoingFairs)} 场`
            : undefined
        }
        metric={metrics.fairStructure}
        span={4}
        foot="只统计本机构进行中的场次，结构数直接来自招聘会子表。"
        render={(value) => (
          <ScreenMiniGrid
            compact
            items={[
              { value: screenCount(value.companies), label: '参展企业', hint: '进行中场次合计' },
              { value: screenCount(value.zones), label: '展区', hint: '已配置导览' },
              { value: screenCount(value.publishedMaterials), label: '活动资料', hint: '已发布可打印' },
              value.materialPrintCount.available
                ? { value: screenCount(value.materialPrintCount.value), label: '资料打印量', hint: '累计' }
                : { label: '资料打印量', unavailableReason: value.materialPrintCount.reason },
            ]}
          />
        )}
      />

      <ScreenCard
        title="本机构暂不可用的指标"
        tag={`${gapCount} 项`}
        span={8}
        foot="这些指标不是被隐藏，是服务端确实给不出机构维度的数据。全屏演示只列「原因 · 指标名」，完整的原因与接入方式在后台页面里逐条可读。数据层补齐后会自动出现在上方栅格里，不需要改页面。"
      >
        <ScreenGapList
          entries={gaps}
          emptyText="本机构的全部指标都已接入，没有需要说明的缺口"
        />
      </ScreenCard>
    </ScreenGrid>
  )
}
