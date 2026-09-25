import type {
  ScreenAlertItem,
  ScreenFleetCell,
  ScreenFleetWallValue,
  ScreenMetric,
  ScreenSnapshot,
  ScreenSnapshotLimits,
  ScreenSnapshotWindow,
  ScreenTerminalTwin,
  ScreenUsageCoverage,
  ScreenUsageLane,
  ScreenUsageRange,
  ScreenUsageServiceItem,
  ScreenUsageServiceKey,
  ScreenUsageSnapshot,
} from '@ai-job-print/shared'

/**
 * 管理员大屏夹具。
 *
 * 这些不是「假数据进产物」—— 它们只存在于 tests/，由 page.route 在网络层供数，
 * 应用侧代码没有任何分支知道它们存在。类型直接取自契约（packages/shared 的
 * consoleScreen.ts），契约改了字段这里会先编译不过，而不是悄悄喂一份旧形状。
 *
 * 时间一律按运行时刻相对计算，不写死日期：钉住某一天的常量会在做对事的时候慢慢转红。
 */

export function isoAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString()
}

/** 上海自然日 YYYY-MM-DD（offsetDays 天前）。趋势、热力的日期键与服务端同口径。 */
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

export const WINDOW: ScreenSnapshotWindow = {
  timezone: 'Asia/Shanghai',
  onlineWindowSeconds: 180,
  realtimeTtlSeconds: 15,
  countsTtlSeconds: 60,
  cumulativeTtlSeconds: 300,
}

/** 默认夹具是「招聘内容托管已开启」的部署（私有化 b）；托管关闭另有专门夹具。 */
export const LIMITS: ScreenSnapshotLimits = {
  minAggregateSample: 5,
  displayToken: 'not_issued',
  displayTokenReason: 'display_token_not_issued',
  access: 'authenticated_console',
  recruitmentHosting: 'enabled',
}

/* ── 机队：七个区，编号与告警行对齐（GZ-HZ-007 等），区名牌才写得出 area ── */

/** 每项写法：状态[:告警标题[:固定编号]]；pr:5 = 打印中且编号固定为 5。 */
const DISTRICT_PLAN: ReadonlyArray<[string, string, string[]]> = [
  ['海珠区', 'HZ', ['off:离线 34 分钟:7', 'pr', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']],
  ['天河区', 'TH', ['off:离线 12 分钟:2', 'pr:5', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']],
  ['白云区', 'BY', ['wa:打印机缺纸:11', 'pr', 'ok', 'ok', 'ok', 'ok']],
  ['越秀区', 'YX', ['wa:打印机故障:4', 'pr', 'ok', 'ok', 'ok', 'ok', 'ok']],
  ['荔湾区', 'LW', ['off:离线 2 小时', 'ok', 'ok', 'ok']],
  ['番禺区', 'PY', ['wa:打印机卡纸', 'un', 'ok', 'ok', 'ok']],
  ['黄埔区', 'HP', ['wa:打印机墨粉不足', 'un', 'ok']],
]

/** 各区与台数，按夹具算出，断言区名牌时用。 */
export const DISTRICTS: ReadonlyArray<{ area: string; count: number }> = DISTRICT_PLAN.map(([area, , list]) => ({ area, count: list.length }))

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

function fleet(): ScreenFleetWallValue {
  const cells = cityCells()
  return fleetFromCells(cells, cells.length, 200)
}

function trendDays(values: number[]) {
  const days = values.map((pages, index) => ({ date: shanghaiDate(values.length - 1 - index), pages }))
  const peak = days.reduce<{ date: string; pages: number } | null>((best, day) => (!best || day.pages > best.pages ? day : best), null)
  return { days, peak: peak && peak.pages > 0 ? peak : null }
}

/** 实时告警：前四条指向夹具里真实存在的终端，后两条没有终端编号。 */
function alertItems(): ScreenAlertItem[] {
  return [
    { type: 'terminal_offline', severity: 'error', title: '离线 34 分钟', occurredAt: isoAgo(2040), terminalCode: 'GZ-HZ-007' },
    { type: 'terminal_offline', severity: 'error', title: '离线 12 分钟', occurredAt: isoAgo(720), terminalCode: 'GZ-TH-002' },
    { type: 'printer_issue', severity: 'warning', title: '打印机缺纸', occurredAt: isoAgo(480), terminalCode: 'GZ-BY-011' },
    { type: 'printer_issue', severity: 'warning', title: '打印机故障', occurredAt: isoAgo(1380), terminalCode: 'GZ-YX-004' },
    { type: 'print_failed', severity: 'info', title: '打印任务失败未核查', occurredAt: isoAgo(3120), terminalCode: null },
    { type: 'print_failed', severity: 'info', title: '打印任务失败未核查', occurredAt: isoAgo(5640), terminalCode: null },
  ]
}

const TASK_FLOW = {
  printByStatus: { completed: 418, printing: 4, pending: 2, cancelled: 11, failed: 3 },
  scanByStatus: { completed: 92, failed: 1 },
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
      printPagesCumulative: ok('Order.payStatus=paid,billablePages', 'cumulative', {
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
        'Order.payStatus=paid,paidAt+billablePages',
        '14d',
        trendDays([620, 780, 720, 1180, 1040, 1480, 1320, 1640, 1390, 1750, 1520, 1842, 1610, 1780]),
      ),
      visitCount: na('KioskSession', 'current', 'kiosk_session_unwritten'),
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

/** 真实为零：全部 available:true，但值是 0 / 空数组。屏上必须显示 0，不能说未接入。 */
export function govEmpty(): ScreenSnapshot {
  const base = govFull()
  const emptyFleet = fleetFromCells([], 0, 0)
  base.metrics.terminalsOnline = ok('Terminal+TerminalHeartbeat / device-fleet', '180s', emptyFleet)
  base.metrics.fleetWall = ok('Terminal+TerminalHeartbeat / device-fleet', '180s', emptyFleet)
  base.metrics.printPagesCumulative = ok('Order.payStatus=paid,billablePages', 'cumulative', {
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
  base.metrics.printTrend14d = ok('Order.payStatus=paid,paidAt+billablePages', '14d', trendDays(Array.from({ length: 14 }, () => 0)))
  base.metrics.taskFlow24h = ok('PrintTask/ScanTask.groupBy(status)', '24h', { printByStatus: {}, scanByStatus: {} })
  base.metrics.alertsRealtime = ok('derived-alerts', 'current', { firingCount: 0, listedCount: 0, truncated: false, items: [] })
  return base
}

/** 无分母：成功率 null，必须写「无调用」，绝不能显示 0%。 */
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

/** 局部失败（政务版）：三块 source_query_failed，其余仍是真实取数。 */
export function govDegraded(): ScreenSnapshot {
  const base = govFull()
  base.status = 'degraded'
  base.degraded = true
  base.metrics.printPagesCumulative = na('Order.payStatus=paid,billablePages', 'cumulative', 'source_query_failed')
  base.metrics.aiBreakdown24h = na('AiServiceLog.groupBy(operation,status)', '24h', 'source_query_failed')
  base.metrics.printTrend14d = na('Order.payStatus=paid,paidAt+billablePages', '14d', 'source_query_failed')
  return base
}

/**
 * 局部失败（运营版）：三块 source_query_failed，另有一块结构性未接入（审核时效）。
 * 两种「没有数」在同一屏上同时出现，才量得出「必须长得不一样」。
 */
export function opsDegraded(): ScreenSnapshot {
  const base = opsFull()
  base.status = 'degraded'
  base.degraded = true
  base.metrics.aiSuccessRate24h = na('AiServiceLog.status', '24h', 'source_query_failed')
  base.metrics.syncSuccessRate24h = na('SyncLog.result', '24h', 'source_query_failed')
  base.metrics.taskFlow24h = na('PrintTask/ScanTask.groupBy(status)', '24h', 'source_query_failed')
  return base
}

function allFailed(snapshot: ScreenSnapshot): ScreenSnapshot {
  snapshot.status = 'unavailable'
  snapshot.degraded = true
  const metrics = snapshot.metrics as Record<string, ScreenMetric<unknown>>
  for (const key of Object.keys(metrics)) {
    const current = metrics[key]
    metrics[key] = na(current.source, current.window, 'source_query_failed')
  }
  return snapshot
}

/** 全部失败，但 HTTP 仍是 200。只判 res.ok 的实现会在这里渲染出一屏空壳或一屏 0。 */
export function govUnavailable(): ScreenSnapshot {
  return allFailed(govFull())
}

export function opsUnavailable(): ScreenSnapshot {
  return allFailed(opsFull())
}

/**
 * 招聘内容托管关闭（托管 a，我们云上）：岗位、招聘会、企业资料不在云上。
 * 存量计数故意给 0 —— 屏上必须写「未开启」，不能把 0 当成「没有」画出来。
 */
export function govHostingOff(): ScreenSnapshot {
  const base = govFull()
  base.limits = { ...LIMITS, recruitmentHosting: 'disabled' }
  base.metrics.jobsOnShelf = na('Job approved+published+validThrough', 'current', 'recruitment_hosting_disabled')
  base.metrics.contentInventory = ok('Job/JobFair/PolicyPost/CompanyProfile counts', 'current', {
    jobsPublished: 0,
    jobsPending: 0,
    fairsPublished: 0,
    fairsPending: 0,
    policiesPublished: 216,
    policiesPending: 8,
    companiesPublished: 0,
    companiesPending: 0,
  })
  return base
}

export function opsHostingOff(): ScreenSnapshot {
  const base = opsFull()
  base.limits = { ...LIMITS, recruitmentHosting: 'disabled' }
  base.metrics.sourceEntryOpensTop = na('ExternalJumpLog.sourceName', '30d', 'recruitment_hosting_disabled')
  base.metrics.fairStructure = na('FairCompany/FairZone/FairMaterial', 'ongoing', 'recruitment_hosting_disabled')
  return base
}

/* ── 服务调用 ─────────────────────────────────────────────────────────── */

const SAFE_RANGES: readonly ScreenUsageRange[] = ['today', '7d', '30d']

export function isUsageRange(raw: string | null): raw is ScreenUsageRange {
  return raw !== null && (SAFE_RANGES as readonly string[]).includes(raw)
}

/** 近 7 天 × 24 小时：今天未到的小时是 null（不是 0），少于 5 的格子也是 null。 */
function heatDays(nowMs: number) {
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
        return v < 5 ? null : v
      }),
    })
  }
  return days
}

/** 近 2 小时每 5 分钟一柱；少于 5 的段服务端给 null。 */
function pulseBuckets(nowMs: number) {
  const start = Math.floor(nowMs / 300_000) * 300_000 - 23 * 300_000
  const lanes = [
    [22, 19, 14], [25, 21, 12], [24, 18, 13], [27, 22, 11], [23, 20, 12], [21, 19, 10], [24, 17, 11], [20, 18, 9],
    [22, 16, 10], [19, 17, 8], [21, 15, 9], [18, 16, 7], [20, 14, 8], [17, 15, 6], [19, 13, 7], [16, 14, 5],
    [18, 12, 6], [15, 13, 4], [17, 11, 5], [14, 12, 4], [16, 13, 6], [15, 12, 5], [17, 14, 7], [17, 15, 9],
  ]
  return lanes.map(([info, ai, print], k) => ({
    start: new Date(start + k * 300_000).toISOString(),
    info: info < 5 ? null : info,
    ai: ai < 5 ? null : ai,
    print: print < 5 ? null : print,
  }))
}

/**
 * 服务调用快照。`ai.byOperation` 里合同审查的 count = null（服务端对 1–4 置空）：
 * 屏上必须写「少于 5」，绝不能画成 0。
 */
export function usageSnapshot(range: string): ScreenUsageSnapshot {
  const safe: ScreenUsageRange = isUsageRange(range) ? range : 'today'
  const nowMs = Date.now()
  const svc = (key: ScreenUsageServiceKey, lane: ScreenUsageLane, count: number | null, coverage: ScreenUsageCoverage): ScreenUsageServiceItem => ({
    key,
    lane,
    count,
    coverage,
  })
  return {
    generatedAt: isoAgo(9),
    audience: 'admin',
    range: safe,
    window: { timezone: 'Asia/Shanghai', from: new Date(nowMs - 12 * 3600_000).toISOString(), to: new Date(nowMs).toISOString() },
    status: 'ok',
    degraded: false,
    limits: { minAggregateSample: 5, recruitmentHosting: 'enabled' },
    metrics: {
      channels: ok('Order.channel', safe, { paidOrders: 415, kiosk: 290, miniapp: 118, unlabeled: 7, memberOrders: 158 }),
      visits: na('KioskSession', safe, 'kiosk_session_unwritten'),
      services: ok('mixed', safe, [
        svc('jobs', 'info', 1246, 'members_only'),
        svc('fairs', 'info', 328, 'members_only'),
        svc('policy', 'info', 412, 'members_only'),
        svc('company', 'info', 236, 'members_only'),
        svc('aiResume', 'ai', 439, 'all_recorded'),
        svc('aiAdvisor', 'ai', 486, 'all_recorded'),
        svc('interview', 'ai', 72, 'all_recorded'),
        svc('careerPlan', 'ai', 53, 'all_recorded'),
        svc('jobAi', 'ai', null, 'all_recorded'),
        svc('print', 'print', 402, 'all_recorded'),
        svc('scan', 'print', 84, 'all_recorded'),
      ]),
      outcomes: ok('mixed', safe, { sourceOpens: 532, favorites: 136, aiReports: 381, printed: 402 }),
      heat7d: ok('mixed', '7d', { days: heatDays(nowMs), peakHour: 11 }),
      pulse2h: ok('mixed', '2h', { bucketMinutes: 5 as const, buckets: pulseBuckets(nowMs) }),
      printSteps: ok('PrintTask/Order', safe, {
        uploaded: na<number>('FileObject', safe, 'upload_counter_unwritten'),
        inspected: na<number>('DocumentProcessTask', safe, 'inspection_counter_unwritten'),
        paid: 415,
        printed: 402,
      }),
      resumeSteps: ok('AiServiceLog/AuditLog', safe, {
        uploaded: na<number>('FileObject', safe, 'upload_counter_unwritten'),
        analyzed: 268,
        optimized: 171,
        exported: 118,
      }),
      ai: ok('AiServiceLog', safe, {
        total: 1086,
        success: 1058,
        failed: 28,
        successRate: 97.4,
        avgLatencyMs: 2180,
        estimatedCostCny: 38.74,
        costMeasuredCalls: 980,
        fallbackCalls: 9,
        byOperation: [
          { operation: 'chatAssistant', count: 486 },
          { operation: 'parseResume', count: 268 },
          { operation: 'optimizeResume', count: 171 },
          { operation: 'interviewQuestion', count: 72 },
          { operation: 'careerPlan', count: 53 },
          { operation: 'contractReview', count: null },
        ],
        providers: [
          { provider: 'llm:deepseek', label: 'DeepSeek', count: 1032 },
          { provider: 'llm:qwen', label: '千问', count: 45 },
          { provider: 'mock', label: '未就绪兜底', count: 9 },
        ],
      }),
      jobs: ok('BrowseLog/Favorite/ExternalJumpLog', safe, { browse: 1246, favorites: 97, sourceOpens: 388, coverage: 'members_only' }),
      topSources30d: ok('ExternalJumpLog.sourceName', '30d', {
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
      content: ok('BrowseLog', safe, { policy: 412, fair: 328, company: 236, coverage: 'members_only' }),
    },
  }
}

/**
 * 托管关闭时的服务调用：招聘会给 0、企业给 null —— 屏上两格都必须写「未开启」，
 * 既不能是 0，也不能是「少于 5」；政策照常出数。
 */
export function usageHostingOff(range: string): ScreenUsageSnapshot {
  const base = usageSnapshot(range)
  base.limits = { minAggregateSample: 5, recruitmentHosting: 'disabled' }
  base.metrics.content = ok('BrowseLog', base.range, { policy: 412, fair: 0, company: null, coverage: 'members_only' })
  base.metrics.topSources30d = na('ExternalJumpLog.sourceName', '30d', 'recruitment_hosting_disabled')
  return base
}

/* ── 单台终端孪生 ─────────────────────────────────────────────────────── */

/**
 * 按请求的 id 回一台夹具里真实存在的终端（页面只认 id 对得上的响应），状态随机队格子：
 * 离线的没有当前任务、心跳过期；告警的打印机报故障；打印中的才有当前任务。
 * 今日计数里两项为 null（服务端对 1–4 置空）：屏上必须写「少于 5」。
 */
export function terminalTwin(id: string): ScreenTerminalTwin | null {
  const cell = cityCells().find((c) => c.terminalId === id)
  if (!cell) return null
  const now = Date.now()
  const seg = (fromH: number, toH: number, state: 'idle' | 'printing' | 'alert' | 'offline' | 'unknown') => ({
    from: new Date(now - fromH * 3600_000).toISOString(),
    to: new Date(now - toH * 3600_000).toISOString(),
    state,
  })
  const printing = cell.activity === 'printing'
  const printerState = cell.health === 'offline' ? 'offline' : cell.health === 'unknown' ? 'unknown' : cell.health === 'degraded' ? 'error' : printing ? 'printing' : 'ready'
  return {
    generatedAt: new Date(now).toISOString(),
    audience: 'admin',
    terminal: { id, code: cell.terminalCode, displayName: '人才服务大厅一楼', areaLabel: cell.areaLabel, locationLabel: '人才服务大厅', geo: null },
    status: {
      health: cell.health,
      lastHeartbeatAt: cell.health === 'unknown' ? null : new Date(now - (cell.health === 'offline' ? 720_000 : 3000)).toISOString(),
      onlineWindowSeconds: 180,
      agentVersion: cell.health === 'unknown' ? null : '0.9.4',
      wiredNetwork: cell.health === 'unknown' ? null : 'connected',
    },
    printer: ok('TerminalHeartbeat+TerminalCapability', 'current', {
      name: null,
      state: printerState,
      errorLabel: cell.health === 'degraded' && cell.alert ? cell.alert.title : null,
      colorEnabled: false,
      duplexEnabled: true,
    }),
    scanner: ok('TerminalHeartbeat+ScanTask', 'current', { state: 'ready', label: null }),
    currentTask: ok('PrintTask.status', 'current', printing ? { pages: 12, colorMode: 'bw', startedAt: new Date(now - 40_000).toISOString() } : null),
    today: { printPages: 36, printTasks: 18, scans: null, failed: null, visits: na('KioskSession', 'current', 'kiosk_session_unwritten') },
    consumables: na('TerminalHeartbeat', 'current', 'no_consumable_or_geo_fields'),
    timeline24h: ok('TerminalHeartbeat+PrintTask', '24h', [
      seg(24, 17, 'offline'),
      seg(17, 9.5, 'idle'),
      seg(9.5, 9.2, 'printing'),
      seg(9.2, 7, 'idle'),
      seg(7, 6.7, 'alert'),
      seg(6.7, 3, 'idle'),
      seg(3, 2.8, 'printing'),
      seg(2.8, 0.02, 'idle'),
      seg(0.02, 0, printing ? 'printing' : 'idle'),
    ]),
  }
}
