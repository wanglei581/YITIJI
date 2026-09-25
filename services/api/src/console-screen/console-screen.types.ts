/**
 * 数据大屏快照契约本地副本。
 *
 * 契约源：packages/shared/src/types/consoleScreen.ts
 *
 * 真源：packages/shared/src/types/consoleScreen.ts
 * 本文件去掉文件头注释后必须与真源逐字节相同（verify 1z）。
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
  uploadCounterUnwritten: 'upload_counter_unwritten',
  inspectionCounterUnwritten: 'inspection_counter_unwritten',
} as const

export type ScreenUnavailableReason =
  (typeof SCREEN_UNAVAILABLE_REASON)[keyof typeof SCREEN_UNAVAILABLE_REASON]

export type ScreenFleetHealth = 'healthy' | 'degraded' | 'offline' | 'unknown'

export type ScreenTerminalActivity = 'idle' | 'printing' | 'scanning'

export interface ScreenFleetAlert {
  kind: 'offline' | 'printer_issue' | 'never_reported'
  title: string // 面向领导的一句话：「离线 34 分钟」「打印机缺纸」「从未上报」，不含用户信息
  since: string | null // ISO 时间
}

export interface ScreenFleetCell {
  health: ScreenFleetHealth
  terminalId: string // 用于下钻；机构端只会出现本机构终端
  terminalCode: string
  displayName: string | null
  areaLabel: string | null // 所在区，例如「天河区」；未设置为 null
  geo: { lat: number; lng: number } | null
  activity: ScreenTerminalActivity | null // 有 claimed/printing 打印任务 → printing；进行中扫描 → scanning；无数据 → null
  alert: ScreenFleetAlert | null
}

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
  cells: ScreenFleetCell[]
}

export type ScreenTimelineState = 'idle' | 'printing' | 'alert' | 'offline' | 'unknown'

export interface ScreenTerminalTwin {
  generatedAt: string
  audience: ScreenAudience
  terminal: {
    id: string
    code: string
    displayName: string | null
    areaLabel: string | null
    locationLabel: string | null
    geo: { lat: number; lng: number } | null
  }
  status: {
    health: ScreenFleetHealth
    lastHeartbeatAt: string | null
    onlineWindowSeconds: typeof SCREEN_ONLINE_WINDOW_SECONDS
    agentVersion: string | null
    wiredNetwork: string | null
  }
  printer: ScreenMetric<{
    name: string | null
    state: 'ready' | 'printing' | 'error' | 'offline' | 'unknown'
    errorLabel: string | null
    colorEnabled: boolean
    duplexEnabled: boolean
  }>
  scanner: ScreenMetric<{ state: 'ready' | 'busy' | 'error' | 'unknown'; label: string | null }>
  currentTask: ScreenMetric<{ pages: number; colorMode: 'bw' | 'color' | null; startedAt: string | null } | null>
  today: {
    printPages: number
    printTasks: number
    scans: number
    failed: number
    visits: ScreenMetric<number>
  }
  consumables: ScreenMetric<{ paper: string | null; toner: string | null }>
  timeline24h: ScreenMetric<Array<{ from: string; to: string; state: ScreenTimelineState }>>
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

// ── 服务调用 / 信息使用（第一步）──

export type ScreenUsageRange = 'today' | '7d' | '30d'
export type ScreenUsageLane = 'info' | 'ai' | 'print'
export type ScreenUsageServiceKey =
  | 'jobs' | 'fairs' | 'policy' | 'company'
  | 'aiResume' | 'aiAdvisor' | 'interview' | 'careerPlan' | 'jobAi'
  | 'print' | 'scan'
export type ScreenUsageCoverage = 'members_only' | 'all_recorded'
export type ScreenContentType = 'job' | 'job_fair' | 'policy' | 'company_profile'

export interface ScreenUsageServiceItem {
  key: ScreenUsageServiceKey
  lane: ScreenUsageLane
  count: number | null
  coverage: ScreenUsageCoverage
}

export interface ScreenUsageChannelsValue {
  paidOrders: number
  kiosk: number | null
  miniapp: number | null
  unlabeled: number | null
  memberOrders: number | null
}

export interface ScreenUsageOutcomesValue {
  sourceOpens: number | null
  favorites: number | null
  aiReports: number | null
  printed: number | null
}

export interface ScreenUsageHeatValue {
  days: Array<{ date: string; hours: Array<number | null> }>
  peakHour: number | null
}

export interface ScreenUsagePulseValue {
  bucketMinutes: 5
  buckets: Array<{ start: string; info: number | null; ai: number | null; print: number | null }>
}

export interface ScreenUsagePrintStepsValue {
  uploaded: ScreenMetric<number>
  inspected: ScreenMetric<number>
  paid: number
  printed: number
}

export interface ScreenUsageResumeStepsValue {
  uploaded: ScreenMetric<number>
  analyzed: number
  optimized: number
  exported: number
}

export interface ScreenUsageAiValue {
  total: number
  success: number
  failed: number
  successRate: number | null
  avgLatencyMs: number | null
  estimatedCostCny: number
  costMeasuredCalls: number
  fallbackCalls: number
  byOperation: Array<{ operation: string; count: number | null }>
  providers: Array<{ provider: string; label: string; count: number | null }>
}

export interface ScreenUsageJobsValue {
  browse: number | null
  favorites: number | null
  sourceOpens: number | null
  coverage: 'members_only'
}

export interface ScreenUsageContentValue {
  policy: number | null
  fair: number | null
  company: number | null
  coverage: 'members_only'
}

export interface ScreenPartnerContentUsageValue {
  byType: Array<{ type: ScreenContentType; browse: number | null; favorites: number | null; sourceOpens: number | null }>
  coverage: 'members_only'
  basis: 'current_content_join'
}

export interface ScreenPartnerDailyValue {
  days: Array<{ date: string; browse: number | null; sourceOpens: number | null }>
}

export interface ScreenPartnerTopContentValue {
  items: Array<{ type: ScreenContentType; title: string; browse: number }>
}

export interface ScreenUsageMetrics {
  channels?: ScreenMetric<ScreenUsageChannelsValue>
  visits?: ScreenMetric<never>
  services?: ScreenMetric<ScreenUsageServiceItem[]>
  outcomes?: ScreenMetric<ScreenUsageOutcomesValue>
  heat7d?: ScreenMetric<ScreenUsageHeatValue>
  pulse2h?: ScreenMetric<ScreenUsagePulseValue>
  printSteps?: ScreenMetric<ScreenUsagePrintStepsValue>
  resumeSteps?: ScreenMetric<ScreenUsageResumeStepsValue>
  ai?: ScreenMetric<ScreenUsageAiValue>
  jobs?: ScreenMetric<ScreenUsageJobsValue>
  topSources30d?: ScreenMetric<ScreenSourceEntryOpensValue>
  content?: ScreenMetric<ScreenUsageContentValue>
  partnerContent?: ScreenMetric<ScreenPartnerContentUsageValue>
  partnerDaily?: ScreenMetric<ScreenPartnerDailyValue>
  partnerTop?: ScreenMetric<ScreenPartnerTopContentValue>
}

export const ADMIN_USAGE_METRIC_KEYS = ['channels', 'visits', 'services', 'outcomes', 'heat7d', 'pulse2h', 'printSteps', 'resumeSteps', 'ai', 'jobs', 'topSources30d', 'content'] as const
export const PARTNER_USAGE_METRIC_KEYS = ['partnerContent', 'partnerDaily', 'partnerTop', 'visits'] as const

export interface ScreenUsageSnapshot {
  generatedAt: string
  audience: ScreenAudience
  range: ScreenUsageRange
  window: { timezone: typeof SCREEN_TIMEZONE; from: string; to: string }
  status: ScreenSnapshotStatus
  degraded: boolean
  limits: { minAggregateSample: typeof SCREEN_MIN_AGGREGATE_SAMPLE }
  metrics: ScreenUsageMetrics
}
