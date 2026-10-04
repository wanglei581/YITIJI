import type { ScreenSnapshot, ScreenMetric, ScreenUsageRange } from '@ai-job-print/shared'
import { ok, na, fleetFromCells, trendDays, govFull, opsFull, shanghaiDate } from './snapshots-cases-01'
import { PRINTED_PAGES_SOURCE, PRINTED_PAGES_TREND_SOURCE, LIMITS, SAFE_RANGES } from './snapshots-cases-04'



export function govEmpty(): ScreenSnapshot {
  const base = govFull()
  const emptyFleet = fleetFromCells([], 0, 0)
  base.metrics.terminalsOnline = ok('Terminal+TerminalHeartbeat / device-fleet', '180s', emptyFleet)
  base.metrics.fleetWall = ok('Terminal+TerminalHeartbeat / device-fleet', '180s', emptyFleet)
  base.metrics.printPagesCumulative = ok(PRINTED_PAGES_SOURCE, 'cumulative', {
    totalPages: 0,
    byColor: na('Order.itemsJson', 'cumulative', 'color_split_not_indexed'),
  })
  base.metrics.aiCallsCumulative = ok('AiServiceLog.count', 'cumulative', { totalCalls: 0 })
  base.metrics.jobsOnShelf = ok('Job approved+published+validThrough', 'current', { published: 0, sourceOrgCount: 0 })
  base.metrics.contentInventory = ok('Job/JobFair/PolicyPost/CompanyProfile counts', 'current', {
    jobsPublished: 0,
    jobsPending: 0,
    fairsPublished: 0,
    fairsPending: 0,
    policiesPublished: 0,
    policiesPending: 0,
    companiesPublished: 0,
    companiesPending: 0,
  })
  base.metrics.aiBreakdown24h = ok('AiServiceLog.groupBy(operation,status)', '24h', { byOperation: {}, failedCalls: 0, totalCalls: 0 })
  base.metrics.printTrend14d = ok(PRINTED_PAGES_TREND_SOURCE, '14d', trendDays(Array.from({ length: 14 }, () => 0)))
  base.metrics.taskFlow24h = ok('PrintTask/ScanTask.groupBy(status)', '24h', { printByStatus: {}, scanByStatus: {} })
  base.metrics.alertsRealtime = ok('derived-alerts', 'current', { firingCount: 0, listedCount: 0, truncated: false, items: [] })
  base.metrics.visitCount = ok('KioskSession.startedAt', 'shanghai-day', 0)
  return base
}


export function opsNoDenominator(): ScreenSnapshot {
  const base = opsFull()
  base.metrics.aiSuccessRate24h = ok('AiServiceLog.status', '24h', { total: 0, success: 0, failed: 0, successRate: null })
  base.metrics.syncSuccessRate24h = ok('SyncLog.result', '24h', { total: 0, success: 0, failed: 0, successRate: null })
  base.metrics.aiCost24h = ok('AiServiceLog.estimatedCostCny', '24h', {
    estimatedCostCny: 0,
    measuredCalls: 0,
    unmeasuredCalls: 0,
    avgLatencyMs: null,
    tokenTotals: na('AiServiceLog.tokenUsageJson', '24h', 'token_usage_json_not_numeric'),
    p95LatencyMs: na('AiServiceLog.latencyMs', '24h', 'percentile_not_aggregated'),
  })
  base.metrics.sourceEntryOpensTop = ok('ExternalJumpLog.sourceName', '30d', { copy: '打开来源平台入口', minSampleThreshold: 5, items: [] })
  base.metrics.alertsRealtime = ok('derived-alerts', 'current', { firingCount: 0, listedCount: 0, truncated: false, items: [] })
  return base
}


export function govDegraded(): ScreenSnapshot {
  const base = govFull()
  base.status = 'degraded'
  base.degraded = true
  base.metrics.printPagesCumulative = na(PRINTED_PAGES_SOURCE, 'cumulative', 'source_query_failed')
  base.metrics.aiBreakdown24h = na('AiServiceLog.groupBy(operation,status)', '24h', 'source_query_failed')
  base.metrics.printTrend14d = na(PRINTED_PAGES_TREND_SOURCE, '14d', 'source_query_failed')
  return base
}


export function opsDegraded(): ScreenSnapshot {
  const base = opsFull()
  base.status = 'degraded'
  base.degraded = true
  base.metrics.aiSuccessRate24h = na('AiServiceLog.status', '24h', 'source_query_failed')
  base.metrics.syncSuccessRate24h = na('SyncLog.result', '24h', 'source_query_failed')
  base.metrics.taskFlow24h = na('PrintTask/ScanTask.groupBy(status)', '24h', 'source_query_failed')
  return base
}


export function allFailed(snapshot: ScreenSnapshot): ScreenSnapshot {
  snapshot.status = 'unavailable'
  snapshot.degraded = true
  const metrics = snapshot.metrics as Record<string, ScreenMetric<unknown>>
  for (const key of Object.keys(metrics)) {
    const current = metrics[key]
    metrics[key] = na(current.source, current.window, 'source_query_failed')
  }
  return snapshot
}


export function govStructuralGap(): ScreenSnapshot {
  const base = govFull()
  base.metrics.printPagesCumulative = na(PRINTED_PAGES_SOURCE, 'cumulative', 'missing_org_id_on_ai_and_orders')
  return base
}


export function govUnavailable(): ScreenSnapshot {
  return allFailed(govFull())
}


export function opsUnavailable(): ScreenSnapshot {
  return allFailed(opsFull())
}


export function govHostingOff(): ScreenSnapshot {
  const base = govFull()
  base.limits = { ...LIMITS, recruitmentHosting: 'disabled' }
  base.metrics.jobsOnShelf = na('Job approved+published+validThrough', 'current', 'recruitment_hosting_disabled')
  // contentInventory 照样计数（岗位类存量）。招聘会待审取 9 而不是 govFull 的 6：6 与运营看板上「进行中打印 6」
  // 撞数，每屏一个数只出现一次的体检分不出撞数与复述，夹具里不留巧合
  base.metrics.contentInventory = ok('Job/JobFair/PolicyPost/CompanyProfile counts', 'current', {
    jobsPublished: 2184,
    jobsPending: 58,
    fairsPublished: 37,
    fairsPending: 9,
    policiesPublished: 216,
    policiesPending: 8,
    companiesPublished: 148,
    companiesPending: 14,
  })
  return base
}


export function opsHostingOff(): ScreenSnapshot {
  const base = opsFull()
  base.limits = { ...LIMITS, recruitmentHosting: 'disabled' }
  base.metrics.sourceEntryOpensTop = na('ExternalJumpLog.sourceName', '30d', 'recruitment_hosting_disabled')
  base.metrics.fairStructure = na('FairCompany/FairZone/FairMaterial', 'ongoing', 'recruitment_hosting_disabled')
  base.metrics.syncSuccessRate24h = ok('SyncLog.result', '24h', { total: 0, success: 0, failed: 0, successRate: null })
  // 待审里仍有岗位类存量（58 / 9 / 14，与政务快照的在架统计一致），政策 8 条是运营机构待审
  base.metrics.pendingReview = ok('reviewStatus pending+reviewing', 'current', { total: 89, jobs: 58, fairs: 9, policies: 8, companies: 14 })
  return base
}


export function isUsageRange(raw: string | null): raw is ScreenUsageRange {
  return raw !== null && (SAFE_RANGES as readonly string[]).includes(raw)
}


export function heatDays(nowMs: number) {
  const hourNow = new Date(nowMs + 8 * 3600_000).getUTCHours()
  const profile = [0, 0, 0, 0, 0, 1, 3, 12, 60, 190, 360, 400, 250, 210, 330, 390, 370, 300, 240, 200, 160, 110, 40, 6]
  const days: Array<{ date: string; hours: Array<number | null> }> = []
  for (let d = 6; d >= 0; d -= 1) {
    const weekend = [0, 6].includes(new Date(nowMs + 8 * 3600_000 - d * 86_400_000).getUTCDay())
    days.push({
      date: shanghaiDate(d),
      hours: profile.map((p, h) => {
        if (d === 0 && h > hourNow) return null
        const v = Math.round(p * (weekend ? 0.55 : 1) * (0.82 + ((d * 24 + h) % 7) * 0.04))
        return v > 0 && v < 5 ? null : v
      }),
    })
  }
  return days
}


export function pulseBuckets(nowMs: number) {
  const start = Math.floor(nowMs / 300_000) * 300_000 - 23 * 300_000
  const lanes = [
    [22, 19, 14], [25, 21, 12], [24, 18, 13], [27, 22, 11], [23, 20, 12], [21, 19, 10], [24, 17, 11], [20, 18, 9],
    [22, 16, 10], [19, 17, 8], [21, 15, 9], [18, 16, 7], [20, 14, 8], [17, 15, 6], [19, 13, 7], [16, 14, 5],
    [18, 12, 6], [15, 13, 4], [17, 11, 5], [14, 12, 4], [16, 13, 6], [15, 12, 5], [17, 14, 7], [17, 15, 9],
  ]
  return lanes.map(([info, ai, print], k) => ({
    start: new Date(start + k * 300_000).toISOString(),
    info: info > 0 && info < 5 ? null : info,
    ai: ai > 0 && ai < 5 ? null : ai,
    print: print > 0 && print < 5 ? null : print,
  }))
}
