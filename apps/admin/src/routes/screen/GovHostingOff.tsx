import type { ScreenMetric, ScreenSnapshotMetrics } from '@ai-job-print/shared'
import { SCREEN_HOSTING_OFF_NOTE, TwinMetricPanel, TwinPanel, TwinTiles, screenCount, type TwinTileItem } from '@ai-job-print/ui'
import { printCompletion, smallCountText } from './metricLabels'

/**
 * 政务总览在招聘内容托管关闭（托管 a，我们云上的默认部署）时的右栏两块。
 *
 * 托管关闭时本平台云上不存岗位、招聘会、企业资料，原来的「信息服务 · 在架」与「来源平台访问」
 * 两块整块是招聘内容，不再渲染成一排「未开启」：
 *   - 右上换成「政策服务」：在架政策、待机构审核，并在这里说一次边界（全屏唯一一处）；
 *   - 右中换成「服务质量」：AI 成功率、打印完成率、今日打印失败、进行中打印，全是快照里已有的真实数字。
 * 小于 5 的计数写「少于 5」；比例的分母少于 5 不给百分比。
 */

export function GovPolicyPanel({ metric, focused }: { metric: ScreenSnapshotMetrics['contentInventory']; focused: boolean }) {
  return (
    <TwinMetricPanel
      title="政策服务"
      sub={focused ? '全市发布 · 不分区' : '运营机构审核发布'}
      tone="info"
      metric={metric}
      source="「在架」= 审核通过、已发布且在有效期内的政策公告；「待机构审核」为待审与审核中的合计。政策由运营机构在本平台自行审核发布，平台只保留紧急下架。"
      render={(value) => (
        <>
          <div className="twin-hero">
            <span className="twin-big">{screenCount(value.policiesPublished)}</span>
            <span className="twin-unit">条</span>
            <span className="twin-muted">在架政策</span>
          </div>
          <div className="twin-stat-list">
            <div className="twin-stat">
              <span>待机构审核</span>
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

/** 运营快照还没回来、或整份没取到时，三块取自运营快照的磁贴怎么写。 */
type OpsState = { metrics: ScreenSnapshotMetrics } | 'pending' | 'failed'

function fromOps<T>(ops: OpsState, pick: (metrics: ScreenSnapshotMetrics) => ScreenMetric<T> | undefined, label: string, present: (value: T) => TwinTileItem): TwinTileItem {
  if (ops === 'pending') return { value: '取数中', label }
  if (ops === 'failed') return { label, unavailableReason: 'source_query_failed' }
  const metric = pick(ops.metrics)
  if (!metric) return { label, unavailableReason: 'source_query_failed' }
  if (metric.available === false) return { label, unavailableReason: metric.reason }
  return present(metric.value)
}

export function GovQualityPanel({ taskFlow, ops, scope }: { taskFlow: ScreenSnapshotMetrics['taskFlow24h']; ops: OpsState; scope?: string }) {
  const aiRate = fromOps(ops, (m) => m.aiSuccessRate24h, 'AI 成功率', (v) =>
    v.successRate === null || v.total < 5
      ? { value: '样本不足', label: 'AI 成功率', hint: `${smallCountText(v.total)} 次` }
      : { value: v.successRate.toFixed(1), unit: '%', label: 'AI 成功率', hint: `${screenCount(v.total)} 次` },
  )
  const printRate: TwinTileItem = !taskFlow
    ? { label: '打印完成率', unavailableReason: 'source_query_failed' }
    : taskFlow.available === false
      ? { label: '打印完成率', unavailableReason: taskFlow.reason }
      : (() => {
          const c = printCompletion(taskFlow.value.printByStatus)
          return c.rate === null
            ? { value: '样本不足', label: '打印完成率', hint: `${smallCountText(c.finished)} 个` }
            : { value: c.rate.toFixed(1), unit: '%', label: '打印完成率', hint: `${smallCountText(c.completed)}/${smallCountText(c.finished)}` }
        })()
  const failed = fromOps(ops, (m) => m.printFailedToday, '今日打印失败', (v) => ({ value: smallCountText(v.failed), unit: '次', label: '今日打印失败' }))
  const inProgress = fromOps(ops, (m) => m.printInProgress, '进行中打印', (v) => ({ value: smallCountText(v.total), unit: '个', label: '进行中打印' }))
  return (
    <TwinPanel
      title="服务质量"
      sub="近 24 小时"
      scope={scope}
      source="AI 成功率 = 成功 ÷（成功 + 失败），近 24 小时滚动窗；打印完成率 = 已完成 ÷（已完成 + 失败），只看近 24 小时里已经结束的打印任务；今日打印失败按上海自然日计转入失败的次数；进行中打印是当前排队与打印中的任务。分母少于 5 不给百分比，少于 5 的计数只写「少于 5」。"
    >
      <TwinTiles items={[aiRate, printRate, failed, inProgress]} />
      <p className="twin-cap twin-push">失败与进行中按上海自然日与当前时刻计</p>
    </TwinPanel>
  )
}
