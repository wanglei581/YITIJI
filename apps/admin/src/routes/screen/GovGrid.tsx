import type { ScreenSnapshotMetrics } from '@ai-job-print/shared'
import {
  ScreenBarList,
  ScreenFleetWall,
  ScreenGrid,
  ScreenKpi,
  ScreenMetricCard,
  ScreenMiniGrid,
  ScreenSparkline,
  screenCount,
  screenFleetOnlineText,
  screenFleetScopeNote,
  screenReasonCopy,
  type ScreenBarItem,
} from '@ai-job-print/ui'
import { aiOperationLabel } from './metricLabels'

/**
 * 政务版（`?profile=gov`）：4 列 × 3 行共 10 块，与契约的
 * `ADMIN_GOV_METRIC_KEYS` 一一对应，块位照 docs/design/ops-screen-2026-09/01-gov-screen.html。
 *
 * 与原型不同的三处，都是「原型画了但契约给不出」，一律以契约为准、不补假值：
 *   1. 累计打印的「黑白 X · 彩色 Y」——分色恒 `available:false`，副行换成未接入说明。
 *   2. 信息归集的「待审 46 · 审核中 12」——契约里待审是 pending+reviewing 的**合并**计数，
 *      拆不出来，所以写「待审核 N 条（含审核中）」。
 *   3. 观众是上级检查与来访参观，所以本版不含告警与成本（契约也没下发）。
 */

export function GovGrid({ metrics }: { metrics: ScreenSnapshotMetrics }) {
  return (
    <ScreenGrid layout="gov">
      <ScreenMetricCard
        title="在网终端"
        metric={metrics.terminalsOnline}
        span={3}
        foot={
          metrics.terminalsOnline?.available
            ? `${metrics.terminalsOnline.source}。${screenFleetScopeNote(metrics.terminalsOnline.value, '')}。「从未上报」单列，不计入在线分子。`
            : ''
        }
        render={(value) => {
          const text = screenFleetOnlineText(value)
          return (
            <ScreenKpi
              value={text.value}
              unit={text.unit}
              label={`最近 ${value.onlineWindowSeconds} 秒有心跳`}
            />
          )
        }}
      />

      <ScreenMetricCard
        title="累计打印"
        metric={metrics.printPagesCumulative}
        span={3}
        foot="打印订单的计费页数求和。双面不单独计价，故不拆双面。"
        render={(value) => (
          <ScreenKpi
            value={screenCount(value.totalPages)}
            unit="页"
            labelMuted={!value.byColor.available}
            label={
              value.byColor.available
                ? `黑白 ${screenCount(value.byColor.value.blackWhite)} · 彩色 ${screenCount(value.byColor.value.color)}`
                : `分色未接入：${screenReasonCopy(value.byColor.reason).howTo}`
            }
          />
        )}
      />

      <ScreenMetricCard
        title="AI 服务调用"
        metric={metrics.aiCallsCumulative}
        span={3}
        foot="AI 服务日志累计。该日志为尽力写入，只作趋势，不作台账。"
        render={(value) => (
          <ScreenKpi
            value={screenCount(value.totalCalls)}
            unit="次"
            label="简历诊断 / 优化 / 模拟面试 / 职业规划等"
          />
        )}
      />

      <ScreenMetricCard
        title="在架岗位信息"
        metric={metrics.jobsOnShelf}
        span={3}
        foot="已审核通过 + 已发布 + 未过期。均为第三方 / 官方来源信息，本平台不收简历。"
        render={(value) => (
          <ScreenKpi
            value={screenCount(value.published)}
            unit="条"
            label={`来自 ${screenCount(value.sourceOrgCount)} 家信息来源机构`}
          />
        )}
      />

      <ScreenMetricCard
        title="终端状态墙"
        tag={metrics.fleetWall?.available ? `${screenCount(metrics.fleetWall.value.matchedCount)} 台` : undefined}
        metric={metrics.fleetWall}
        span={6}
        tall
        foot={
          metrics.fleetWall?.available
            ? `每格一台终端，按终端编号排序。${screenFleetScopeNote(metrics.fleetWall.value, '')}。「从未上报」= 已注册但没有过任何心跳，与「离线」分开计。`
            : ''
        }
        render={(value) => <ScreenFleetWall value={value} scopeLabel="" />}
      />

      <ScreenMetricCard
        title="信息归集"
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
                label: '企业展示',
                hint: `待审核 ${screenCount(value.companiesPending)} 条（含审核中）`,
              },
            ]}
          />
        )}
      />

      <ScreenMetricCard
        title="AI 服务分项"
        tag="近 24 小时"
        metric={metrics.aiBreakdown24h}
        span={3}
        foot="AI 服务日志近 24 小时滚动窗（非自然日）。失败含超时与上游拒绝。"
        render={(value) => {
          const rows: ScreenBarItem[] = Object.entries(value.byOperation)
            .map(([operation, count]) => ({ label: aiOperationLabel(operation), value: count }))
            .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
            .slice(0, 4)
          if (value.failedCalls > 0 || value.totalCalls > 0) {
            rows.push({ label: '调用失败', value: value.failedCalls, tone: 'error' })
          }
          return <ScreenBarList items={rows} emptyText="近 24 小时没有 AI 调用记录" />
        }}
      />

      <ScreenMetricCard
        title="打印量"
        tag="近 14 日"
        metric={metrics.printTrend14d}
        span={3}
        foot={
          metrics.printTrend14d?.available
            ? metrics.printTrend14d.value.peak
              ? `按自然日聚合，Asia/Shanghai。峰值 ${screenCount(metrics.printTrend14d.value.peak.pages)} 页 / 日（${metrics.printTrend14d.value.peak.date}）。`
              : '按自然日聚合，Asia/Shanghai。近 14 日无打印记录，折线为真实的零线。'
            : ''
        }
        render={(value) => <ScreenSparkline days={value.days} seriesLabel="每日打印页数" />}
      />

      <ScreenMetricCard
        title="服务人次"
        metric={metrics.visitCount}
        span={3}
        foot=""
        render={() => null}
      />

      <ScreenMetricCard
        title="耗材余量 / 终端地图"
        metric={metrics.suppliesAndMap}
        span={3}
        foot=""
        render={() => null}
      />
    </ScreenGrid>
  )
}
