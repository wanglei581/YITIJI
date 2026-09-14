import { PARTNER_METRIC_KEYS, type ScreenMetricKey, type ScreenSnapshotMetrics } from '@ai-job-print/shared'
import type { ScreenGapEntry } from '@ai-job-print/ui'

/**
 * 合作机构侧的指标中文名，以及「未接入指标归并」的计算。
 *
 * 契约给机构下发 21 个指标，其中只有 7 个能按机构切分（终端、在架岗位、内容归集、
 * 待审、同步成功率、招聘会结构、机队墙）。剩下 14 个**必须如实告诉机构没有**，
 * 但不能铺 14 张一模一样的虚线卡 —— 那不是诚实，是噪音：屏看起来像坏的，
 * 6 种不同成因还被压成同一个视觉。
 *
 * 所以按 reason 归并，每个指标名、每条原因、每条接入方式都照写，信息量不减。
 *
 * 归并是**从响应算出来的**，不是写死的清单：哪天后端把打印补上机构字段，
 * 它会自动从归并面板里消失、出现在主栅格里，不需要改这个文件。
 */

export const PARTNER_METRIC_LABELS: Readonly<Record<ScreenMetricKey, string>> = {
  terminalsOnline: '在网终端',
  fleetWall: '终端状态墙',
  jobsOnShelf: '在架岗位',
  contentInventory: '信息归集',
  pendingReview: '待审内容',
  syncSuccessRate24h: '同步成功率',
  fairStructure: '招聘会结构',
  printInProgress: '进行中打印',
  printFailedToday: '今日打印失败',
  printPagesCumulative: '累计打印页数',
  printTrend14d: '打印量趋势',
  taskFlow24h: '任务流',
  aiCallsCumulative: 'AI 调用累计',
  aiBreakdown24h: 'AI 服务分项',
  aiSuccessRate24h: 'AI 成功率',
  aiCost24h: 'AI 成本与用量',
  alertsRealtime: '实时告警',
  sourceEntryOpensTop: '打开来源平台入口 Top',
  visitCount: '服务人次',
  suppliesAndMap: '耗材余量 / 终端地图',
  reviewSlaAndOrgDimension: '审核时效 / 按机构维度',
}

/** 主栅格里已经单独出卡的指标，不再进归并面板。 */
export const PARTNER_PRIMARY_KEYS: readonly ScreenMetricKey[] = [
  'terminalsOnline',
  'fleetWall',
  'jobsOnShelf',
  'contentInventory',
  'pendingReview',
  'syncSuccessRate24h',
  'fairStructure',
]

export function buildPartnerGapEntries(metrics: ScreenSnapshotMetrics): ScreenGapEntry[] {
  const byReason = new Map<string, string[]>()
  for (const key of PARTNER_METRIC_KEYS) {
    if (PARTNER_PRIMARY_KEYS.includes(key)) continue
    const metric = metrics[key]
    if (!metric || metric.available !== false) continue
    const labels = byReason.get(metric.reason) ?? []
    labels.push(PARTNER_METRIC_LABELS[key])
    byReason.set(metric.reason, labels)
  }
  return Array.from(byReason.entries()).map(([reason, labels]) => ({ reason, labels }))
}

/** 归并面板覆盖了多少个指标 —— 用于脚注，避免「藏起来了」的观感。 */
export function countPartnerGapMetrics(entries: ScreenGapEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.labels.length, 0)
}
