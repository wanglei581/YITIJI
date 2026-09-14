/**
 * 大屏快照夹具。
 *
 * 这些不是「假数据进产物」—— 它们只存在于 tests/，由 page.route 在网络层供数，
 * 应用侧代码没有任何分支知道它们存在。
 *
 * generatedAt 一律按运行时刻相对计算，不写死日期：钉住某一天的常量会在
 * 做对事的时候慢慢转红。
 */

type Metric = Record<string, unknown>

export function isoAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString()
}

export const WINDOW = {
  timezone: 'Asia/Shanghai',
  onlineWindowSeconds: 180,
  realtimeTtlSeconds: 15,
  countsTtlSeconds: 60,
  cumulativeTtlSeconds: 300,
}

export const LIMITS = {
  minAggregateSample: 5,
  displayToken: 'not_issued',
  displayTokenReason: 'display_token_not_issued',
  access: 'authenticated_console',
}

const ok = (source: string, window: string, value: unknown): Metric => ({
  available: true,
  source,
  window,
  value,
})
const na = (source: string, window: string, reason: string): Metric => ({
  available: false,
  source,
  window,
  reason,
})

function fleetValue(options: {
  sampled: number
  matched: number
  cap: number
  healthy: number
  degraded: number
  offline: number
  unknown: number
  neverReported: number
}) {
  const cells: Array<{ health: string }> = []
  for (let i = 0; i < options.healthy; i++) cells.push({ health: 'healthy' })
  for (let i = 0; i < options.degraded; i++) cells.push({ health: 'degraded' })
  for (let i = 0; i < options.offline; i++) cells.push({ health: 'offline' })
  for (let i = 0; i < options.unknown; i++) cells.push({ health: 'unknown' })
  return {
    healthy: options.healthy,
    total: options.sampled,
    degraded: options.degraded,
    offline: options.offline,
    unknown: options.unknown,
    neverReported: options.neverReported,
    onlineWindowSeconds: 180,
    sampledCount: options.sampled,
    matchedCount: options.matched,
    truncated: options.matched > options.cap,
    sampleCap: options.cap,
    cells,
  }
}

const FLEET = fleetValue({
  sampled: 42,
  matched: 42,
  cap: 42,
  healthy: 33,
  degraded: 4,
  offline: 3,
  unknown: 2,
  neverReported: 2,
})

function trendDays(values: number[]) {
  const days = values.map((pages, index) => {
    const date = new Date(Date.now() - (values.length - 1 - index) * 86_400_000)
    return { date: date.toISOString().slice(0, 10), pages }
  })
  const peak = days.reduce<{ date: string; pages: number } | null>(
    (best, day) => (!best || day.pages > best.pages ? day : best),
    null,
  )
  return { days, peak: peak && peak.pages > 0 ? peak : null }
}

export function govFull() {
  return {
    generatedAt: isoAgo(12),
    audience: 'admin',
    profile: 'gov',
    status: 'ok',
    degraded: false,
    window: WINDOW,
    limits: LIMITS,
    freshness: { realtime: 'miss', counts: 'hit', cumulative: 'hit' },
    metrics: {
      terminalsOnline: ok('Terminal+TerminalHeartbeat / device-fleet', '180s', FLEET),
      fleetWall: ok('Terminal+TerminalHeartbeat / device-fleet', '180s', FLEET),
      printPagesCumulative: ok('Order.billablePages', 'cumulative', {
        totalPages: 128431,
        byColor: na('Order.itemsJson', 'cumulative', 'color_split_not_indexed'),
      }),
      aiCallsCumulative: ok('AiServiceLog.count', 'cumulative', { totalCalls: 9706 }),
      jobsOnShelf: ok('Job approved+published+validThrough', 'current', {
        published: 2184,
        sourceOrgCount: 23,
      }),
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
        'Order.createdAt+billablePages',
        '14d',
        trendDays([620, 780, 720, 1180, 1040, 1480, 1320, 1640, 1390, 1750, 1520, 1842, 1610, 1780]),
      ),
      visitCount: na('KioskSession', 'current', 'kiosk_session_unwritten'),
      suppliesAndMap: na('TerminalHeartbeat', 'current', 'no_consumable_or_geo_fields'),
    },
  }
}

export function opsFull() {
  return {
    generatedAt: isoAgo(8),
    audience: 'admin',
    profile: 'ops',
    status: 'ok',
    degraded: false,
    window: WINDOW,
    limits: LIMITS,
    freshness: { realtime: 'miss', counts: 'miss', cumulative: 'hit' },
    metrics: {
      terminalsOnline: ok('Terminal+TerminalHeartbeat / device-fleet', '180s', FLEET),
      printInProgress: ok('PrintTask.status', 'current', { queued: 2, printing: 4, total: 6 }),
      printFailedToday: ok('PrintTask.status=failed', 'shanghai-day', { failed: 3 }),
      pendingReview: ok('reviewStatus pending+reviewing', 'current', {
        total: 86,
        jobs: 58,
        fairs: 6,
        policies: 8,
        companies: 14,
      }),
      aiSuccessRate24h: ok('AiServiceLog.status', '24h', {
        total: 673,
        success: 656,
        failed: 17,
        successRate: 97.5,
      }),
      syncSuccessRate24h: ok('SyncLog.result', '24h', {
        total: 34,
        success: 32,
        failed: 2,
        successRate: 94.1,
      }),
      alertsRealtime: ok('derived-alerts', 'current', {
        firingCount: 137,
        listedCount: 6,
        truncated: true,
        items: [
          { type: 'terminal_offline', severity: 'error', title: '离线 34 分钟', occurredAt: isoAgo(2040), terminalCode: 'GZ-HZ-007' },
          { type: 'terminal_offline', severity: 'error', title: '离线 12 分钟', occurredAt: isoAgo(720), terminalCode: 'GZ-TH-002' },
          { type: 'printer_issue', severity: 'warning', title: '打印机缺纸', occurredAt: isoAgo(480), terminalCode: 'GZ-BY-011' },
          { type: 'printer_issue', severity: 'warning', title: '打印机故障', occurredAt: isoAgo(1380), terminalCode: 'GZ-YX-004' },
          { type: 'print_failed', severity: 'info', title: '打印任务失败未核查', occurredAt: isoAgo(3120), terminalCode: null },
          { type: 'print_failed', severity: 'info', title: '打印任务失败未核查', occurredAt: isoAgo(5640), terminalCode: null },
        ],
      }),
      taskFlow24h: ok('PrintTask/ScanTask.groupBy(status)', '24h', {
        printByStatus: { completed: 418, printing: 4, pending: 2, cancelled: 11, failed: 3 },
        scanByStatus: { completed: 92, failed: 1 },
      }),
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
        materialPrintCount: na('FairMaterial.printCount', 'cumulative', 'print_count_never_incremented'),
      }),
      aiCost24h: ok('AiServiceLog.estimatedCostCny', '24h', {
        estimatedCostCny: 38.74,
        measuredCalls: 612,
        unmeasuredCalls: 61,
        avgLatencyMs: 2180,
        tokenTotals: na('AiServiceLog.tokenUsageJson', '24h', 'token_usage_json_not_numeric'),
        p95LatencyMs: na('AiServiceLog.latencyMs', '24h', 'percentile_not_aggregated'),
      }),
      reviewSlaAndOrgDimension: na(
        'ReviewDecision / Order.orgId / AiServiceLog.orgId',
        'current',
        'review_decision_unwritten',
      ),
    },
  }
}

/** 真实为零：全部 available:true，但值是 0 / null / 空数组。屏上必须显示 0，不能说未接入。 */
export function govEmpty() {
  const base = govFull()
  const emptyFleet = fleetValue({
    sampled: 0, matched: 0, cap: 0, healthy: 0, degraded: 0, offline: 0, unknown: 0, neverReported: 0,
  })
  base.metrics.terminalsOnline = ok('Terminal+TerminalHeartbeat / device-fleet', '180s', emptyFleet)
  base.metrics.fleetWall = ok('Terminal+TerminalHeartbeat / device-fleet', '180s', emptyFleet)
  base.metrics.printPagesCumulative = ok('Order.billablePages', 'cumulative', {
    totalPages: 0,
    byColor: na('Order.itemsJson', 'cumulative', 'color_split_not_indexed'),
  })
  base.metrics.aiCallsCumulative = ok('AiServiceLog.count', 'cumulative', { totalCalls: 0 })
  base.metrics.jobsOnShelf = ok('Job approved+published+validThrough', 'current', {
    published: 0,
    sourceOrgCount: 0,
  })
  base.metrics.aiBreakdown24h = ok('AiServiceLog.groupBy(operation,status)', '24h', {
    byOperation: {},
    failedCalls: 0,
    totalCalls: 0,
  })
  base.metrics.printTrend14d = ok(
    'Order.createdAt+billablePages',
    '14d',
    trendDays(Array.from({ length: 14 }, () => 0)),
  )
  return base
}

/** 无分母：成功率 null，必须写「无调用」，绝不能显示 0%。 */
export function opsNoDenominator() {
  const base = opsFull()
  base.metrics.aiSuccessRate24h = ok('AiServiceLog.status', '24h', {
    total: 0, success: 0, failed: 0, successRate: null,
  })
  base.metrics.syncSuccessRate24h = ok('SyncLog.result', '24h', {
    total: 0, success: 0, failed: 0, successRate: null,
  })
  base.metrics.aiCost24h = ok('AiServiceLog.estimatedCostCny', '24h', {
    estimatedCostCny: 0,
    measuredCalls: 0,
    unmeasuredCalls: 0,
    avgLatencyMs: null,
    tokenTotals: na('AiServiceLog.tokenUsageJson', '24h', 'token_usage_json_not_numeric'),
    p95LatencyMs: na('AiServiceLog.latencyMs', '24h', 'percentile_not_aggregated'),
  })
  base.metrics.sourceEntryOpensTop = ok('ExternalJumpLog.sourceName', '30d', {
    copy: '打开来源平台入口',
    minSampleThreshold: 5,
    items: [],
  })
  base.metrics.alertsRealtime = ok('derived-alerts', 'current', {
    firingCount: 0, listedCount: 0, truncated: false, items: [],
  })
  return base
}

/** 局部失败：三块 source_query_failed，其余仍是真实取数。 */
export function govDegraded() {
  const base = govFull()
  base.status = 'degraded'
  base.degraded = true
  base.metrics.printPagesCumulative = na('Order.billablePages', 'cumulative', 'source_query_failed')
  base.metrics.aiBreakdown24h = na('AiServiceLog.groupBy(operation,status)', '24h', 'source_query_failed')
  base.metrics.printTrend14d = na('Order.createdAt+billablePages', '14d', 'source_query_failed')
  return base
}

/** 全部失败，但 HTTP 仍是 200。只判 res.ok 的实现会在这里渲染出一屏空壳。 */
export function govUnavailable() {
  const base = govFull()
  base.status = 'unavailable'
  base.degraded = true
  for (const key of Object.keys(base.metrics)) {
    const current = (base.metrics as Record<string, Metric>)[key]
    ;(base.metrics as Record<string, Metric>)[key] = na(
      String(current.source),
      String(current.window),
      'source_query_failed',
    )
  }
  return base
}
