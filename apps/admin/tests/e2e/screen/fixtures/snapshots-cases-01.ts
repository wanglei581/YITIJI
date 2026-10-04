import type { ScreenMetric, ScreenFleetCell, ScreenFleetWallValue, ScreenAlertItem, ScreenSnapshot } from '@ai-job-print/shared'
import { DISTRICT_PLAN, PRINTED_PAGES_SOURCE, PRINTED_PAGES_TREND_SOURCE, WINDOW, LIMITS, TASK_FLOW } from './snapshots-cases-04'



export function isoAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString()
}


export function shanghaiDate(offsetDays: number): string {
  const d = new Date(Date.now() + 8 * 3600_000 - offsetDays * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}


export function ok<T>(source: string, window: string, value: T): ScreenMetric<T> {
  return { available: true, source, window, value }
}


export function na<T = never>(source: string, window: string, reason: string): ScreenMetric<T> {
  return { available: false, source, window, reason }
}


export function cityCells(): ScreenFleetCell[] {
  const out: ScreenFleetCell[] = []
  for (const [area, code, list] of DISTRICT_PLAN) {
    const used = new Set(
      list
        .map((item) => {
          const parts = item.split(':')
          return parts[2] || (parts[0] === 'pr' ? parts[1] : '')
        })
        .filter(Boolean)
        .map(Number),
    )
    let next = 1
    for (const item of list) {
      const [state, title, fixed] = item.split(':')
      let n = fixed ? Number(fixed) : undefined
      if (state === 'pr' && title && !fixed) n = Number(title)
      if (n === undefined) {
        while (used.has(next)) next += 1
        n = next
        used.add(n)
      }
      const terminalCode = `GZ-${code}-${String(n).padStart(3, '0')}`
      const base = {
        terminalId: `t-${terminalCode.toLowerCase()}`,
        terminalCode,
        displayName: null,
        areaLabel: area,
        locationLabel: null,
        geo: null,
      }
      if (state === 'off') out.push({ ...base, health: 'offline', activity: null, alert: { kind: 'offline', title, since: isoAgo(720) } })
      else if (state === 'wa') out.push({ ...base, health: 'degraded', activity: 'idle', alert: { kind: 'printer_issue', title, since: isoAgo(480) } })
      else if (state === 'un') out.push({ ...base, health: 'unknown', activity: null, alert: { kind: 'never_reported', title: '从未上报', since: null } })
      else if (state === 'pr') out.push({ ...base, health: 'healthy', activity: 'printing', alert: null })
      else out.push({ ...base, health: 'healthy', activity: 'idle', alert: null })
    }
  }
  return out
}


export function fleetFromCells(cells: ScreenFleetCell[], matched: number, cap: number): ScreenFleetWallValue {
  const count = (health: ScreenFleetCell['health']) => cells.filter((cell) => cell.health === health).length
  return {
    healthy: count('healthy'),
    total: cells.length,
    degraded: count('degraded'),
    offline: count('offline'),
    unknown: count('unknown'),
    neverReported: count('unknown'),
    onlineWindowSeconds: 180,
    sampledCount: cells.length,
    matchedCount: matched,
    truncated: matched > cap,
    sampleCap: cap,
    cells,
  }
}


export function fleet(): ScreenFleetWallValue {
  const cells = cityCells()
  return fleetFromCells(cells, cells.length, 200)
}


export function trendDays(values: number[]) {
  const days = values.map((pages, index) => ({ date: shanghaiDate(values.length - 1 - index), pages }))
  const peak = days.reduce<{ date: string; pages: number } | null>((best, day) => (!best || day.pages > best.pages ? day : best), null)
  return { days, peak: peak && peak.pages > 0 ? peak : null }
}


export function alertItems(): ScreenAlertItem[] {
  return [
    { type: 'terminal_offline', severity: 'error', title: '离线 34 分钟', occurredAt: isoAgo(2040), terminalCode: 'GZ-HZ-007' },
    { type: 'terminal_offline', severity: 'error', title: '离线 12 分钟', occurredAt: isoAgo(720), terminalCode: 'GZ-TH-002' },
    { type: 'printer_issue', severity: 'warning', title: '打印机缺纸', occurredAt: isoAgo(480), terminalCode: 'GZ-BY-011' },
    { type: 'printer_issue', severity: 'warning', title: '打印机故障', occurredAt: isoAgo(1380), terminalCode: 'GZ-YX-004' },
    { type: 'print_failed', severity: 'info', title: '打印任务失败未核查', occurredAt: isoAgo(3120), terminalCode: null },
    { type: 'print_failed', severity: 'info', title: '打印任务失败未核查', occurredAt: isoAgo(5640), terminalCode: null },
  ]
}


export function govFull(): ScreenSnapshot {
  const f = fleet()
  return {
    generatedAt: isoAgo(12),
    audience: 'admin',
    profile: 'gov',
    status: 'ok',
    degraded: false,
    window: WINDOW,
    limits: { ...LIMITS },
    freshness: { realtime: 'miss', counts: 'hit', cumulative: 'hit' },
    metrics: {
      terminalsOnline: ok('Terminal+TerminalHeartbeat / device-fleet', '180s', f),
      fleetWall: ok('Terminal+TerminalHeartbeat / device-fleet', '180s', f),
      printPagesCumulative: ok(PRINTED_PAGES_SOURCE, 'cumulative', {
        totalPages: 128431,
        byColor: na('Order.itemsJson', 'cumulative', 'color_split_not_indexed'),
      }),
      aiCallsCumulative: ok('AiServiceLog.count', 'cumulative', { totalCalls: 9706 }),
      jobsOnShelf: ok('Job approved+published+validThrough', 'current', { published: 2184, sourceOrgCount: 23 }),
      contentInventory: ok('Job/JobFair/PolicyPost/CompanyProfile counts', 'current', {
        jobsPublished: 2184,
        jobsPending: 58,
        fairsPublished: 37,
        fairsPending: 6,
        policiesPublished: 216,
        policiesPending: 8,
        companiesPublished: 148,
        companiesPending: 14,
      }),
      aiBreakdown24h: ok('AiServiceLog.groupBy(operation,status)', '24h', {
        byOperation: { parseResume: 312, optimizeResume: 197, interviewQuestion: 84, careerPlan: 61 },
        failedCalls: 17,
        totalCalls: 671,
      }),
      printTrend14d: ok(
        PRINTED_PAGES_TREND_SOURCE,
        '14d',
        trendDays([620, 780, 720, 1180, 1040, 1480, 1320, 1640, 1390, 1750, 1520, 1842, 1610, 1780]),
      ),
      visitCount: ok('KioskSession.startedAt', 'shanghai-day', 86),
      suppliesAndMap: na('TerminalHeartbeat', 'current', 'no_consumable_or_geo_fields'),
      // 9/26 起任务流与实时告警随政务快照下发，与运营版同一份结构
      taskFlow24h: ok('PrintTask/ScanTask.groupBy(status)', '24h', TASK_FLOW),
      alertsRealtime: ok('derived-alerts', 'current', { firingCount: 137, listedCount: 6, truncated: true, items: alertItems() }),
    },
  }
}


export function opsFull(): ScreenSnapshot {
  return {
    generatedAt: isoAgo(8),
    audience: 'admin',
    profile: 'ops',
    status: 'ok',
    degraded: false,
    window: WINDOW,
    limits: { ...LIMITS },
    freshness: { realtime: 'miss', counts: 'miss', cumulative: 'hit' },
    metrics: {
      terminalsOnline: ok('Terminal+TerminalHeartbeat / device-fleet', '180s', fleet()),
      printInProgress: ok('PrintTask.status', 'current', { queued: 2, printing: 4, total: 6 }),
      printFailedToday: ok('PrintTaskStatusLog.toStatus=failed', 'shanghai-day', { failed: 3 }),
      pendingReview: ok('reviewStatus pending+reviewing', 'current', { total: 86, jobs: 58, fairs: 6, policies: 8, companies: 14 }),
      aiSuccessRate24h: ok('AiServiceLog.status', '24h', { total: 673, success: 656, failed: 17, successRate: 97.5 }),
      syncSuccessRate24h: ok('SyncLog.result', '24h', { total: 34, success: 32, failed: 2, successRate: 94.1 }),
      alertsRealtime: ok('derived-alerts', 'current', { firingCount: 137, listedCount: 6, truncated: true, items: alertItems() }),
      taskFlow24h: ok('PrintTask/ScanTask.groupBy(status)', '24h', TASK_FLOW),
      sourceEntryOpensTop: ok('ExternalJumpLog.sourceName', '30d', {
        copy: '打开来源平台入口',
        minSampleThreshold: 5,
        items: [
          { sourceName: '广东公共就业', count: 412 },
          { sourceName: '海珠海纳职通', count: 293 },
          { sourceName: '南方人才网', count: 198 },
          { sourceName: '广州人社局', count: 127 },
          { sourceName: '校园招聘专区', count: 89 },
        ],
      }),
      fairStructure: ok('FairCompany/FairZone/FairMaterial', 'ongoing', {
        ongoingFairs: 3,
        companies: 168,
        zones: 12,
        publishedMaterials: 54,
        materialPrintCount: na<number>('FairMaterial.printCount', 'cumulative', 'print_count_never_incremented'),
      }),
      aiCost24h: ok('AiServiceLog.estimatedCostCny', '24h', {
        estimatedCostCny: 38.74,
        measuredCalls: 612,
        unmeasuredCalls: 61,
        avgLatencyMs: 2180,
        tokenTotals: na('AiServiceLog.tokenUsageJson', '24h', 'token_usage_json_not_numeric'),
        p95LatencyMs: na('AiServiceLog.latencyMs', '24h', 'percentile_not_aggregated'),
      }),
      reviewSlaAndOrgDimension: na('ReviewDecision / Order.orgId / AiServiceLog.orgId', 'current', 'review_decision_unwritten'),
    },
  }
}
