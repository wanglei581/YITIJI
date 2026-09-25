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

/** 七个区的机队，编号与告警行对齐（GZ-HZ-007 等），区名牌才写得出 area。 */
const DISTRICT_PLAN: Record<string, { code: string; list: string[] }> = {
  海珠: { code: 'HZ', list: ['off:离线 34 分钟:7', 'pr', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'] },
  天河: { code: 'TH', list: ['off:离线 12 分钟:2', 'pr:5', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'] },
  白云: { code: 'BY', list: ['wa:打印机缺纸:11', 'pr', 'ok', 'ok', 'ok', 'ok'] },
  越秀: { code: 'YX', list: ['wa:打印机故障:4', 'pr', 'ok', 'ok', 'ok', 'ok', 'ok'] },
  荔湾: { code: 'LW', list: ['off:离线 2 小时', 'ok', 'ok', 'ok'] },
  番禺: { code: 'PY', list: ['wa:打印机卡纸', 'un', 'ok', 'ok', 'ok'] },
  黄埔: { code: 'HP', list: ['wa:打印机墨粉不足', 'un', 'ok'] },
}

function cityCells() {
  const out: Array<Record<string, unknown>> = []
  for (const [district, { code, list }] of Object.entries(DISTRICT_PLAN)) {
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
      const [st, title, fixed] = item.split(':')
      let n = fixed ? Number(fixed) : undefined
      if (st === 'pr' && title && !fixed) n = Number(title)
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
        areaLabel: `${district}区`,
        geo: null,
      }
      if (st === 'off') out.push({ ...base, health: 'offline', activity: null, alert: { kind: 'offline', title, since: isoAgo(720) } })
      else if (st === 'wa') out.push({ ...base, health: 'degraded', activity: 'idle', alert: { kind: 'printer_issue', title, since: isoAgo(480) } })
      else if (st === 'un') out.push({ ...base, health: 'unknown', activity: null, alert: { kind: 'never_reported', title: '从未上报', since: null } })
      else if (st === 'pr') out.push({ ...base, health: 'healthy', activity: 'printing', alert: null })
      else out.push({ ...base, health: 'healthy', activity: 'idle', alert: null })
    }
  }
  return out
}

function fleetFromCells(cells: Array<Record<string, unknown>>, matched: number, cap: number) {
  const count = (health: string) => cells.filter((cell) => cell.health === health).length
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

const FLEET = fleetFromCells(cityCells(), 42, 200)

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
      printPagesCumulative: ok('Order.payStatus=paid,billablePages', 'cumulative', {
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
        'Order.payStatus=paid,paidAt+billablePages',
        '14d',
        trendDays([620, 780, 720, 1180, 1040, 1480, 1320, 1640, 1390, 1750, 1520, 1842, 1610, 1780]),
      ),
      visitCount: na('KioskSession', 'current', 'kiosk_session_unwritten'),
      suppliesAndMap: na('TerminalHeartbeat', 'current', 'no_consumable_or_geo_fields'),
      // 9/26 起任务流与实时告警随政务快照下发，与运营版同一份结构
      taskFlow24h: ok('PrintTask/ScanTask.groupBy(status)', '24h', {
        printByStatus: { completed: 418, printing: 4, pending: 2, cancelled: 11, failed: 3 },
        scanByStatus: { completed: 92, failed: 1 },
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
        ],
      }),
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
      printFailedToday: ok('PrintTaskStatusLog.toStatus=failed', 'shanghai-day', { failed: 3 }),
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
  const emptyFleet = fleetFromCells([], 0, 0)
  base.metrics.terminalsOnline = ok('Terminal+TerminalHeartbeat / device-fleet', '180s', emptyFleet)
  base.metrics.fleetWall = ok('Terminal+TerminalHeartbeat / device-fleet', '180s', emptyFleet)
  base.metrics.printPagesCumulative = ok('Order.payStatus=paid,billablePages', 'cumulative', {
    totalPages: 0,
    byColor: na('Order.itemsJson', 'cumulative', 'color_split_not_indexed'),
  })
  base.metrics.aiCallsCumulative = ok('AiServiceLog.count', 'cumulative', { totalCalls: 0 })
  base.metrics.jobsOnShelf = ok('Job approved+published+validThrough', 'current', {
    published: 0,
    sourceOrgCount: 0,
  })
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
  base.metrics.aiBreakdown24h = ok('AiServiceLog.groupBy(operation,status)', '24h', {
    byOperation: {},
    failedCalls: 0,
    totalCalls: 0,
  })
  base.metrics.printTrend14d = ok(
    'Order.payStatus=paid,paidAt+billablePages',
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
  base.metrics.printPagesCumulative = na('Order.payStatus=paid,billablePages', 'cumulative', 'source_query_failed')
  base.metrics.aiBreakdown24h = na('AiServiceLog.groupBy(operation,status)', '24h', 'source_query_failed')
  base.metrics.printTrend14d = na('Order.payStatus=paid,paidAt+billablePages', '14d', 'source_query_failed')
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

/** 服务调用。contractReview.count = null：屏上必须写「少于 5」，不能画成 0。 */
export function usageSnapshot(range: string) {
  const safe = range === '7d' || range === '30d' ? range : 'today'
  const nowMs = Date.now()
  return {
    generatedAt: isoAgo(9),
    audience: 'admin',
    range: safe,
    window: {
      timezone: 'Asia/Shanghai',
      from: new Date(nowMs - 12 * 3600_000).toISOString(),
      to: new Date(nowMs).toISOString(),
    },
    status: 'ok',
    degraded: false,
    limits: { minAggregateSample: 5 },
    metrics: {
      channels: ok('Order.channel', safe, { paidOrders: 415, kiosk: 290, miniapp: 118, unlabeled: 7, memberOrders: 158 }),
      visits: na('KioskSession', safe, 'kiosk_session_unwritten'),
      services: ok('mixed', safe, [
        { key: 'jobs', lane: 'info', count: 1246, coverage: 'members_only' },
        { key: 'aiResume', lane: 'ai', count: 439, coverage: 'all_recorded' },
        { key: 'print', lane: 'print', count: 402, coverage: 'all_recorded' },
        { key: 'scan', lane: 'print', count: 84, coverage: 'all_recorded' },
      ]),
      outcomes: ok('mixed', safe, { sourceOpens: 532, favorites: 136, aiReports: 381, printed: 402 }),
      heat7d: ok('mixed', '7d', {
        days: [{ date: new Date(nowMs).toISOString().slice(0, 10), hours: [null, 12, 40, 8] }],
        peakHour: 2,
      }),
      pulse2h: ok('mixed', '2h', {
        bucketMinutes: 5,
        buckets: [{ start: new Date(nowMs).toISOString(), info: 22, ai: 19, print: null }],
      }),
      printSteps: ok('PrintTask/Order', safe, {
        uploaded: na('FileObject', safe, 'upload_counter_unwritten'),
        inspected: na('DocumentProcessTask', safe, 'inspection_counter_unwritten'),
        paid: 415,
        printed: 402,
      }),
      resumeSteps: ok('AiServiceLog/AuditLog', safe, {
        uploaded: na('FileObject', safe, 'upload_counter_unwritten'),
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
        ],
      }),
      jobs: ok('BrowseLog/Favorite/ExternalJumpLog', safe, { browse: 1246, favorites: 97, sourceOpens: 388, coverage: 'members_only' }),
      topSources30d: ok('ExternalJumpLog.sourceName', '30d', {
        copy: '打开来源平台入口',
        minSampleThreshold: 5,
        items: [{ sourceName: '广东公共就业', count: 412 }],
      }),
      content: ok('BrowseLog', safe, { policy: 412, fair: 328, company: 236, coverage: 'members_only' }),
    },
  }
}

export function terminalTwin(id: string) {
  const now = Date.now()
  const seg = (fromH: number, toH: number, state: string) => ({
    from: new Date(now - fromH * 3600_000).toISOString(),
    to: new Date(now - toH * 3600_000).toISOString(),
    state,
  })
  return {
    generatedAt: new Date(now).toISOString(),
    audience: 'admin',
    terminal: {
      id,
      code: 'GZ-TH-005',
      displayName: '天河人才市场一楼',
      areaLabel: '天河区',
      locationLabel: '天河人才市场 · 一楼大厅',
      geo: null,
    },
    status: {
      health: 'healthy',
      lastHeartbeatAt: new Date(now - 3000).toISOString(),
      onlineWindowSeconds: 180,
      agentVersion: '0.9.4',
      wiredNetwork: 'connected',
    },
    printer: ok('TerminalHeartbeat+TerminalCapability', 'current', { name: null, state: 'printing', errorLabel: null, colorEnabled: false, duplexEnabled: true }),
    scanner: ok('TerminalHeartbeat+ScanTask', 'current', { state: 'ready', label: null }),
    currentTask: ok('PrintTask.status', 'current', { pages: 12, colorMode: 'bw', startedAt: new Date(now - 40_000).toISOString() }),
    today: { printPages: 36, printTasks: 18, scans: 5, failed: 0, visits: na('KioskSession', 'current', 'kiosk_session_unwritten') },
    consumables: na('TerminalHeartbeat', 'current', 'no_consumable_or_geo_fields'),
    timeline24h: ok('TerminalHeartbeat+PrintTask', '24h', [seg(24, 17, 'offline'), seg(17, 0, 'idle')]),
  }
}
