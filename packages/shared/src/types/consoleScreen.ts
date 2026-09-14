/**
 * 管理员 / 合作机构数据大屏快照契约。
 *
 * GET /api/v1/admin/screen/snapshot?profile=gov|ops
 * GET /api/v1/partner/screen/snapshot
 *
 * 硬约束（docs/design/ops-screen-2026-09 + compliance-boundary）：
 * - 没有数据的指标 `available:false` 并给出 reason，不用 0 冒充未接入。
 * - 外部跳转只能表述为「打开来源平台入口」，不得宣称投递成功。
 * - 用户行为只给聚合，分组样本 N&lt;5 不得给出数字。
 * - 大屏在线口径只认 device-fleet 的 180 秒窗口。
 * - 领导/客户展示只允许已登录后台会话（access=authenticated_console）。
 *   可吊销只读展示令牌是后续独立需求，本契约 fail-closed：displayToken=not_issued。
 *
 * 本文件是契约真源。API 因 tsc TS6059/TS2307 不能 import 本包，只保留一份
 * 去掉文件头注释后必须逐字节相同的副本（verify:console-screen-snapshot 1z）。
 */

export const SCREEN_TIMEZONE = 'Asia/Shanghai' as const
export const SCREEN_ONLINE_WINDOW_SECONDS = 180 as const
export const SCREEN_MIN_AGGREGATE_SAMPLE = 5 as const
export const SCREEN_CACHE_TTL_SECONDS = {
  realtime: 15,
  counts: 60,
  cumulative: 300,
} as const

export const SCREEN_JUMP_COPY = '打开来源平台入口' as const

export type AdminScreenProfile = 'gov' | 'ops'
export type ScreenAudience = 'admin' | 'partner'
export type ScreenSnapshotProfile = AdminScreenProfile | 'partner'

export type ScreenMetric<T> =
  | {
      available: true
      source: string
      window: string
      value: T
    }
  | {
      available: false
      source: string
      window: string
      reason: string
    }

export const SCREEN_UNAVAILABLE_REASON = {
  kioskSessionUnwritten: 'kiosk_session_unwritten',
  noConsumableOrGeo: 'no_consumable_or_geo_fields',
  reviewDecisionUnwritten: 'review_decision_unwritten',
  missingOrgIdOnAiAndOrders: 'missing_org_id_on_ai_and_orders',
  missingImmutableSourceOrg: 'missing_immutable_source_org_snapshot',
  printCountNeverIncremented: 'print_count_never_incremented',
  colorSplitNotIndexed: 'color_split_not_indexed',
  tokenUsageNotNumeric: 'token_usage_json_not_numeric',
  percentileNotAggregated: 'percentile_not_aggregated',
  sampleBelowThreshold: 'sample_below_threshold',
  windowRowCapExceeded: 'window_row_cap_exceeded',
  partnerAlertsUnscoped: 'alerts_not_org_scoped',
  displayTokenNotIssued: 'display_token_not_issued',
  sourceQueryFailed: 'source_query_failed',
} as const

export type ScreenUnavailableReason =
  (typeof SCREEN_UNAVAILABLE_REASON)[keyof typeof SCREEN_UNAVAILABLE_REASON]

export type ScreenFleetHealth = 'healthy' | 'degraded' | 'offline' | 'unknown'

export interface ScreenTerminalsOnlineValue {
  healthy: number
  total: number
  degraded: number
  offline: number
  unknown: number
  neverReported: number
  onlineWindowSeconds: typeof SCREEN_ONLINE_WINDOW_SECONDS
  sampledCount: number
  matchedCount: number
  truncated: boolean
  sampleCap: number
}

export interface ScreenFleetWallValue extends ScreenTerminalsOnlineValue {
  cells: Array<{ health: ScreenFleetHealth }>
}

export interface ScreenPrintPagesValue {
  totalPages: number
  byColor: ScreenMetric<{ blackWhite: number; color: number }>
}

export interface ScreenAiCallsValue {
  totalCalls: number
}

export interface ScreenJobsOnShelfValue {
  published: number
  sourceOrgCount: number
}

export interface ScreenContentInventoryValue {
  jobsPublished: number
  jobsPending: number
  fairsPublished: number
  fairsPending: number
  policiesPublished: number
  policiesPending: number
  companiesPublished: number
  companiesPending: number
}

export interface ScreenAiBreakdownValue {
  byOperation: Record<string, number>
  failedCalls: number
  totalCalls: number
}

export interface ScreenPrintTrendDay {
  date: string
  pages: number
}

export interface ScreenPrintTrendValue {
  days: ScreenPrintTrendDay[]
  peak: ScreenPrintTrendDay | null
}

export interface ScreenPrintInProgressValue {
  queued: number
  printing: number
  total: number
}

export interface ScreenPrintFailedTodayValue {
  failed: number
}

export interface ScreenPendingReviewValue {
  total: number
  jobs: number
  fairs: number
  policies: number
  companies: number
}

export interface ScreenRateValue {
  total: number
  success: number
  failed: number
  successRate: number | null
}

export interface ScreenAlertItem {
  type: string
  severity: string
  title: string
  occurredAt: string
  terminalCode: string | null
}

export interface ScreenAlertsValue {
  firingCount: number
  listedCount: number
  truncated: boolean
  items: ScreenAlertItem[]
}

export interface ScreenTaskFlowValue {
  printByStatus: Record<string, number>
  scanByStatus: Record<string, number>
}

export interface ScreenSourceEntryOpenItem {
  sourceName: string
  count: number
}

export interface ScreenSourceEntryOpensValue {
  copy: typeof SCREEN_JUMP_COPY
  minSampleThreshold: typeof SCREEN_MIN_AGGREGATE_SAMPLE
  items: ScreenSourceEntryOpenItem[]
}

export interface ScreenFairStructureValue {
  ongoingFairs: number
  companies: number
  zones: number
  publishedMaterials: number
  materialPrintCount: ScreenMetric<number>
}

export interface ScreenAiCostValue {
  estimatedCostCny: number
  measuredCalls: number
  unmeasuredCalls: number
  avgLatencyMs: number | null
  tokenTotals: ScreenMetric<never>
  p95LatencyMs: ScreenMetric<never>
}

export const ADMIN_GOV_METRIC_KEYS = [
  'terminalsOnline',
  'fleetWall',
  'printPagesCumulative',
  'aiCallsCumulative',
  'jobsOnShelf',
  'contentInventory',
  'aiBreakdown24h',
  'printTrend14d',
  'visitCount',
  'suppliesAndMap',
] as const

export const ADMIN_OPS_METRIC_KEYS = [
  'terminalsOnline',
  'printInProgress',
  'printFailedToday',
  'pendingReview',
  'aiSuccessRate24h',
  'syncSuccessRate24h',
  'alertsRealtime',
  'taskFlow24h',
  'sourceEntryOpensTop',
  'fairStructure',
  'aiCost24h',
  'reviewSlaAndOrgDimension',
] as const

export const PARTNER_METRIC_KEYS = [
  'terminalsOnline',
  'fleetWall',
  'jobsOnShelf',
  'contentInventory',
  'pendingReview',
  'syncSuccessRate24h',
  'fairStructure',
  'printInProgress',
  'printFailedToday',
  'printPagesCumulative',
  'printTrend14d',
  'taskFlow24h',
  'aiCallsCumulative',
  'aiBreakdown24h',
  'aiSuccessRate24h',
  'aiCost24h',
  'alertsRealtime',
  'sourceEntryOpensTop',
  'visitCount',
  'suppliesAndMap',
  'reviewSlaAndOrgDimension',
] as const

export type AdminGovMetricKey = (typeof ADMIN_GOV_METRIC_KEYS)[number]
export type AdminOpsMetricKey = (typeof ADMIN_OPS_METRIC_KEYS)[number]
export type PartnerMetricKey = (typeof PARTNER_METRIC_KEYS)[number]
export type ScreenMetricKey = AdminGovMetricKey | AdminOpsMetricKey | PartnerMetricKey

export interface ScreenSnapshotLimits {
  minAggregateSample: typeof SCREEN_MIN_AGGREGATE_SAMPLE
  displayToken: 'not_issued'
  displayTokenReason: typeof SCREEN_UNAVAILABLE_REASON.displayTokenNotIssued
  access: 'authenticated_console'
}

export interface ScreenSnapshotWindow {
  timezone: typeof SCREEN_TIMEZONE
  onlineWindowSeconds: typeof SCREEN_ONLINE_WINDOW_SECONDS
  realtimeTtlSeconds: typeof SCREEN_CACHE_TTL_SECONDS.realtime
  countsTtlSeconds: typeof SCREEN_CACHE_TTL_SECONDS.counts
  cumulativeTtlSeconds: typeof SCREEN_CACHE_TTL_SECONDS.cumulative
}

export interface ScreenSnapshotMetrics {
  terminalsOnline?: ScreenMetric<ScreenTerminalsOnlineValue>
  fleetWall?: ScreenMetric<ScreenFleetWallValue>
  printPagesCumulative?: ScreenMetric<ScreenPrintPagesValue>
  aiCallsCumulative?: ScreenMetric<ScreenAiCallsValue>
  jobsOnShelf?: ScreenMetric<ScreenJobsOnShelfValue>
  contentInventory?: ScreenMetric<ScreenContentInventoryValue>
  aiBreakdown24h?: ScreenMetric<ScreenAiBreakdownValue>
  printTrend14d?: ScreenMetric<ScreenPrintTrendValue>
  visitCount?: ScreenMetric<never>
  suppliesAndMap?: ScreenMetric<never>
  printInProgress?: ScreenMetric<ScreenPrintInProgressValue>
  printFailedToday?: ScreenMetric<ScreenPrintFailedTodayValue>
  pendingReview?: ScreenMetric<ScreenPendingReviewValue>
  aiSuccessRate24h?: ScreenMetric<ScreenRateValue>
  syncSuccessRate24h?: ScreenMetric<ScreenRateValue>
  alertsRealtime?: ScreenMetric<ScreenAlertsValue>
  taskFlow24h?: ScreenMetric<ScreenTaskFlowValue>
  sourceEntryOpensTop?: ScreenMetric<ScreenSourceEntryOpensValue>
  fairStructure?: ScreenMetric<ScreenFairStructureValue>
  aiCost24h?: ScreenMetric<ScreenAiCostValue>
  reviewSlaAndOrgDimension?: ScreenMetric<never>
}

export type ScreenCacheState = 'hit' | 'miss'
export type ScreenSnapshotStatus = 'ok' | 'degraded' | 'unavailable'

export interface ScreenSnapshotFreshness {
  realtime: ScreenCacheState
  counts: ScreenCacheState
  cumulative?: ScreenCacheState
}

export interface ScreenSnapshot {
  generatedAt: string
  audience: ScreenAudience
  profile: ScreenSnapshotProfile
  status: ScreenSnapshotStatus
  degraded: boolean
  window: ScreenSnapshotWindow
  limits: ScreenSnapshotLimits
  freshness: ScreenSnapshotFreshness
  metrics: ScreenSnapshotMetrics
}
