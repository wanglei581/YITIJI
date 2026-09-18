/**
 * 机构大屏快照夹具。只存在于 tests/，由 page.route 在网络层供数。
 * generatedAt 按运行时刻相对计算，不写死日期。
 */

type Metric = Record<string, unknown>

export function isoAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString()
}

const ok = (source: string, window: string, value: unknown): Metric => ({ available: true, source, window, value })
const na = (source: string, window: string, reason: string): Metric => ({ available: false, source, window, reason })

const MISSING_ORG = 'missing_org_id_on_ai_and_orders'

function fleet(sampled: number, matched: number, cap: number) {
  const healthy = Math.max(0, sampled - 5)
  const cells: Array<{ health: string }> = []
  for (let i = 0; i < healthy; i++) cells.push({ health: 'healthy' })
  for (let i = 0; i < Math.min(2, sampled); i++) cells.push({ health: 'degraded' })
  for (let i = 0; i < Math.min(2, sampled); i++) cells.push({ health: 'offline' })
  for (let i = 0; i < Math.min(1, sampled); i++) cells.push({ health: 'unknown' })
  return {
    healthy,
    total: sampled,
    degraded: Math.min(2, sampled),
    offline: Math.min(2, sampled),
    unknown: Math.min(1, sampled),
    neverReported: 1,
    onlineWindowSeconds: 180,
    sampledCount: sampled,
    matchedCount: matched,
    truncated: matched > cap,
    sampleCap: cap,
    cells,
  }
}

function base(fleetValue: ReturnType<typeof fleet>) {
  return {
    generatedAt: isoAgo(20),
    audience: 'partner',
    profile: 'partner',
    status: 'ok',
    degraded: false,
    window: {
      timezone: 'Asia/Shanghai',
      onlineWindowSeconds: 180,
      realtimeTtlSeconds: 15,
      countsTtlSeconds: 60,
      cumulativeTtlSeconds: 300,
    },
    limits: {
      minAggregateSample: 5,
      displayToken: 'not_issued',
      displayTokenReason: 'display_token_not_issued',
      access: 'authenticated_console',
    },
    freshness: { realtime: 'miss', counts: 'hit' },
    metrics: {
      terminalsOnline: ok('Terminal+TerminalHeartbeat / device-fleet', '180s', fleetValue),
      fleetWall: ok('Terminal+TerminalHeartbeat / device-fleet', '180s', fleetValue),
      jobsOnShelf: ok('Job approved+published+validThrough', 'current', { published: 328, sourceOrgCount: 1 }),
      contentInventory: ok('Job/JobFair/PolicyPost/CompanyProfile counts', 'current', {
        jobsPublished: 328,
        jobsPending: 4,
        fairsPublished: 12,
        fairsPending: 1,
        policiesPublished: 9,
        policiesPending: 0,
        companiesPublished: 26,
        companiesPending: 2,
      }),
      pendingReview: ok('reviewStatus pending+reviewing', 'current', {
        total: 7, jobs: 4, fairs: 1, policies: 0, companies: 2,
      }),
      syncSuccessRate24h: ok('SyncLog.result', '24h', { total: 17, success: 16, failed: 1, successRate: 94.1 }),
      fairStructure: ok('FairCompany/FairZone/FairMaterial', 'ongoing', {
        ongoingFairs: 2,
        companies: 58,
        zones: 6,
        publishedMaterials: 21,
        materialPrintCount: na('FairMaterial.printCount', 'cumulative', 'print_count_never_incremented'),
      }),
      printInProgress: na('PrintTask', 'current', MISSING_ORG),
      printFailedToday: na('PrintTask', 'current', MISSING_ORG),
      printPagesCumulative: na('Order', 'current', MISSING_ORG),
      printTrend14d: na('Order', 'current', MISSING_ORG),
      taskFlow24h: na('PrintTask/ScanTask', 'current', MISSING_ORG),
      aiCallsCumulative: na('AiServiceLog', 'current', MISSING_ORG),
      aiBreakdown24h: na('AiServiceLog', 'current', MISSING_ORG),
      aiSuccessRate24h: na('AiServiceLog', 'current', MISSING_ORG),
      aiCost24h: na('AiServiceLog', 'current', MISSING_ORG),
      alertsRealtime: na('derived-alerts', 'current', 'alerts_not_org_scoped'),
      sourceEntryOpensTop: na('ExternalJumpLog', 'current', 'missing_immutable_source_org_snapshot'),
      visitCount: na('KioskSession', 'current', 'kiosk_session_unwritten'),
      suppliesAndMap: na('TerminalHeartbeat', 'current', 'no_consumable_or_geo_fields'),
      reviewSlaAndOrgDimension: na('ReviewDecision / Order.orgId / AiServiceLog.orgId', 'current', 'review_decision_unwritten'),
    },
  }
}

export function partnerFull() {
  return base(fleet(12, 12, 200))
}

/** 机队被 200 台上限截断：分类计数是样本内的，绝不能当成全量。 */
export function partnerTruncated() {
  return base(fleet(200, 640, 200))
}

export function partnerDegraded() {
  const snapshot = base(fleet(12, 12, 200))
  snapshot.status = 'degraded'
  snapshot.degraded = true
  snapshot.metrics.syncSuccessRate24h = na('SyncLog.result', '24h', 'source_query_failed')
  return snapshot
}
