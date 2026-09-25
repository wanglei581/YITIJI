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

const SITES: Array<[string, string, string[]]> = [
  ['中大南校区', 'ZD', ['ok', 'ok', 'pr', 'wa:打印机缺纸:3']],
  ['海珠会展中心', 'HZ', ['ok', 'ok', 'wa:打印机卡纸:1']],
  ['人才服务大厅', 'HL', ['off:离线 21 分钟:2', 'ok', 'ok']],
  ['社区就业站', 'SQ', ['off:离线 46 分钟:1', 'un']],
]

function partnerCells() {
  const out: Array<Record<string, unknown>> = []
  for (const [site, code, list] of SITES) {
    let n = 1
    const used = new Set<number>()
    for (const item of list) {
      const [st, title, fixed] = item.split(':')
      let no = fixed ? Number(fixed) : n
      while (used.has(no)) no += 1
      used.add(no)
      if (!fixed) n = no + 1
      const terminalCode = `HZ-${code}-${String(no).padStart(2, '0')}`
      const base = {
        terminalId: `t-${terminalCode.toLowerCase()}`,
        terminalCode,
        displayName: null,
        areaLabel: '海珠区',
        locationLabel: site,
        geo: null,
      }
      if (st === 'off') out.push({ ...base, health: 'offline', activity: null, alert: { kind: 'offline', title, since: isoAgo(title.includes('46') ? 2760 : 1260) } })
      else if (st === 'wa') out.push({ ...base, health: 'degraded', activity: 'idle', alert: { kind: 'printer_issue', title, since: isoAgo(480) } })
      else if (st === 'un') out.push({ ...base, health: 'unknown', activity: null, alert: { kind: 'never_reported', title: '从未上报', since: null } })
      else if (st === 'pr') out.push({ ...base, health: 'healthy', activity: 'printing', alert: null })
      else out.push({ ...base, health: 'healthy', activity: 'idle', alert: null })
    }
  }
  return out
}

function fleetFrom(cells: Array<Record<string, unknown>>, matched: number, cap: number) {
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

function base(fleetValue: ReturnType<typeof fleetFrom>) {
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
  const cells = partnerCells()
  return base(fleetFrom(cells, cells.length, 200))
}

/** 机队被上限截断：分类计数是样本内的，绝不能当成全量。格子仍用真实点位，计数改成样本口径。 */
export function partnerTruncated() {
  const snapshot = partnerFull()
  for (const key of ['terminalsOnline', 'fleetWall'] as const) {
    const metric = snapshot.metrics[key]
    if (!metric || metric.available !== true) continue
    metric.value = { ...metric.value, sampledCount: 200, matchedCount: 640, total: 200, truncated: true, sampleCap: 200 }
  }
  return snapshot
}

export function partnerDegraded() {
  const snapshot = partnerFull()
  snapshot.status = 'degraded'
  snapshot.degraded = true
  snapshot.metrics.syncSuccessRate24h = na('SyncLog.result', '24h', 'source_query_failed')
  return snapshot
}

/** 企业资料的收藏是 null：必须显示「少于 5」，不能画成 0。 */
export function partnerUsage(range: string) {
  const safe = range === '7d' || range === '30d' ? range : 'today'
  const nowMs = Date.now()
  const day = new Date(nowMs).toISOString().slice(0, 10)
  return {
    generatedAt: isoAgo(7),
    audience: 'partner',
    range: safe,
    window: {
      timezone: 'Asia/Shanghai',
      from: new Date(nowMs - 86_400_000).toISOString(),
      to: new Date(nowMs).toISOString(),
    },
    status: 'ok',
    degraded: false,
    limits: { minAggregateSample: 5 },
    metrics: {
      partnerContent: ok('BrowseLog/Favorite/ExternalJumpLog join sourceOrgId', safe, {
        coverage: 'members_only',
        basis: 'current_content_join',
        byType: [
          { type: 'job', browse: 38, favorites: 6, sourceOpens: 11 },
          { type: 'job_fair', browse: 9, favorites: null, sourceOpens: null },
          { type: 'policy', browse: 21, favorites: null, sourceOpens: null },
          { type: 'company_profile', browse: 7, favorites: null, sourceOpens: null },
        ],
      }),
      partnerDaily: ok('BrowseLog/ExternalJumpLog.createdAt', safe, {
        days: [{ date: day, browse: 38, sourceOpens: 11 }, { date: day, browse: null, sourceOpens: null }],
      }),
      partnerTop: ok('BrowseLog join content title', safe, {
        items: [{ type: 'job', title: '行政专员（海珠区，五险一金）', browse: 14 }],
      }),
      visits: na('KioskSession', safe, 'kiosk_session_unwritten'),
    },
  }
}

export function partnerTwin(id: string) {
  const now = Date.now()
  return {
    generatedAt: new Date(now).toISOString(),
    audience: 'partner',
    terminal: {
      id,
      code: 'HZ-ZD-03',
      displayName: '中大南校区 · 图书馆一楼',
      areaLabel: '海珠区',
      locationLabel: '中大南校区',
      geo: null,
    },
    status: {
      health: 'healthy',
      lastHeartbeatAt: new Date(now - 3000).toISOString(),
      onlineWindowSeconds: 180,
      agentVersion: '0.9.4',
      wiredNetwork: 'connected',
    },
    printer: ok('TerminalHeartbeat', 'current', { name: null, state: 'ready', errorLabel: null, colorEnabled: false, duplexEnabled: true }),
    scanner: ok('ScanTask', 'current', { state: 'ready', label: null }),
    currentTask: na('PrintTask', 'current', 'missing_org_id_on_ai_and_orders'),
    today: { printPages: null, printTasks: null, scans: null, failed: null, visits: na('KioskSession', 'current', 'kiosk_session_unwritten') },
    consumables: na('TerminalHeartbeat', 'current', 'no_consumable_or_geo_fields'),
    timeline24h: ok('TerminalHeartbeat', '24h', []),
  }
}
