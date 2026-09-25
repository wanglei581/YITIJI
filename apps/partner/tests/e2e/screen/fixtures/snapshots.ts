import type {
  ScreenFleetCell,
  ScreenFleetWallValue,
  ScreenMetric,
  ScreenPartnerContentUsageValue,
  ScreenSnapshot,
  ScreenSnapshotLimits,
  ScreenSnapshotWindow,
  ScreenTerminalTwin,
  ScreenUsageRange,
  ScreenUsageSnapshot,
} from '@ai-job-print/shared'

/**
 * 机构大屏夹具。只存在于 tests/，由 page.route 在网络层供数；类型取自契约，
 * 契约改了字段这里先编译不过。机构端的响应一律是裸对象，不套信封。
 * 时间按运行时刻相对计算，不写死日期。
 */

export function isoAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString()
}

/** 上海自然日 YYYY-MM-DD（offsetDays 天前）。 */
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

const MISSING_ORG = 'missing_org_id_on_ai_and_orders'

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

/* ── 机队：一个机构四个服务点位十二台终端（照设计稿「机构版」的分布） ── */

/** 每项写法：状态[:告警标题[:固定编号]]。 */
const SITES: ReadonlyArray<[string, string, string[]]> = [
  ['中大南校区', 'ZD', ['ok', 'ok', 'pr', 'wa:打印机缺纸:3']],
  ['海珠会展中心', 'HZ', ['ok', 'ok', 'wa:打印机卡纸:1']],
  ['人才服务大厅', 'HL', ['off:离线 21 分钟:2', 'ok', 'ok']],
  ['社区就业站', 'SQ', ['off:离线 46 分钟:1', 'un']],
]

/** 各点位与台数，按夹具算出，断言点位牌时用。 */
export const PLACES: ReadonlyArray<{ place: string; count: number }> = SITES.map(([place, , list]) => ({ place, count: list.length }))

export function partnerCells(): ScreenFleetCell[] {
  const out: ScreenFleetCell[] = []
  for (const [site, code, list] of SITES) {
    const used = new Set(list.map((item) => item.split(':')[2]).filter(Boolean).map(Number))
    let next = 1
    for (const item of list) {
      const [state, title, fixed] = item.split(':')
      let no = fixed ? Number(fixed) : 0
      if (!fixed) {
        while (used.has(next)) next += 1
        no = next
        used.add(no)
      }
      const terminalCode = `HZ-${code}-${String(no).padStart(2, '0')}`
      const base = {
        terminalId: `t-${terminalCode.toLowerCase()}`,
        terminalCode,
        displayName: null,
        areaLabel: '海珠区',
        locationLabel: site,
        geo: null,
      }
      if (state === 'off') out.push({ ...base, health: 'offline', activity: null, alert: { kind: 'offline', title, since: isoAgo(title.includes('46') ? 2760 : 1260) } })
      else if (state === 'wa') out.push({ ...base, health: 'degraded', activity: 'idle', alert: { kind: 'printer_issue', title, since: isoAgo(title.includes('缺纸') ? 360 : 1500) } })
      else if (state === 'un') out.push({ ...base, health: 'unknown', activity: null, alert: { kind: 'never_reported', title: '从未上报', since: null } })
      else if (state === 'pr') out.push({ ...base, health: 'healthy', activity: 'printing', alert: null })
      else out.push({ ...base, health: 'healthy', activity: 'idle', alert: null })
    }
  }
  return out
}

export function fleetFrom(cells: ScreenFleetCell[], matched: number, cap: number): ScreenFleetWallValue {
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

function snapshotWith(fleet: ScreenFleetWallValue): ScreenSnapshot {
  return {
    generatedAt: isoAgo(20),
    audience: 'partner',
    profile: 'partner',
    status: 'ok',
    degraded: false,
    window: WINDOW,
    limits: { ...LIMITS },
    freshness: { realtime: 'miss', counts: 'hit' },
    metrics: {
      terminalsOnline: ok('Terminal+TerminalHeartbeat / device-fleet', '180s', fleet),
      fleetWall: ok('Terminal+TerminalHeartbeat / device-fleet', '180s', fleet),
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
      pendingReview: ok('reviewStatus pending+reviewing', 'current', { total: 7, jobs: 4, fairs: 1, policies: 0, companies: 2 }),
      syncSuccessRate24h: ok('SyncLog.result', '24h', { total: 17, success: 16, failed: 1, successRate: 94.1 }),
      fairStructure: ok('FairCompany/FairZone/FairMaterial', 'ongoing', {
        ongoingFairs: 2,
        companies: 58,
        zones: 6,
        publishedMaterials: 21,
        materialPrintCount: na<number>('FairMaterial.printCount', 'cumulative', 'print_count_never_incremented'),
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

export function partnerFull(): ScreenSnapshot {
  const cells = partnerCells()
  return snapshotWith(fleetFrom(cells, cells.length, 200))
}

/**
 * 机队被 200 台上限截断：分类计数是样本内的，绝不能当成全量。
 * 样本 200 台 = 十二台真实终端（告警都在它们身上）+ 188 台在线空闲的同点位终端，
 * 计数跟格子一致，matchedCount 是全量 640。
 */
export function partnerTruncated(): ScreenSnapshot {
  const cells = partnerCells()
  const sites = SITES.map(([site, code]) => ({ site, code }))
  for (let i = 0; cells.length < 200; i += 1) {
    const { site, code } = sites[i % sites.length]
    const terminalCode = `HZ-${code}-${String(100 + Math.floor(i / sites.length)).padStart(3, '0')}`
    cells.push({
      terminalId: `t-${terminalCode.toLowerCase()}`,
      terminalCode,
      displayName: null,
      areaLabel: '海珠区',
      locationLabel: site,
      geo: null,
      health: 'healthy',
      activity: 'idle',
      alert: null,
    })
  }
  return snapshotWith(fleetFrom(cells, 640, 200))
}

export function partnerDegraded(): ScreenSnapshot {
  const snapshot = partnerFull()
  snapshot.status = 'degraded'
  snapshot.degraded = true
  snapshot.metrics.syncSuccessRate24h = na('SyncLog.result', '24h', 'source_query_failed')
  return snapshot
}

/**
 * 招聘内容托管关闭（托管 a，我们云上的默认部署），照服务端写（console-screen.assemble.ts）：
 *   - closeRecruitmentMetrics 把 jobsOnShelf、fairStructure、sourceEntryOpensTop 换成 recruitment_hosting_disabled
 *     （机构侧的 sourceEntryOpensTop 原本就是未接入，托管关闭时原因被换成托管关闭）；
 *   - contentInventory 与 pendingReview 原样返回，含岗位类存量；政策由本机构自审，这里有 3 条待审；
 *   - 同步：数据源不再写 SyncLog，近 24 小时 0 批 → { total: 0, success: 0, failed: 0, successRate: null }。
 */
export function partnerHostingOff(): ScreenSnapshot {
  const snapshot = partnerFull()
  snapshot.limits = { ...LIMITS, recruitmentHosting: 'disabled' }
  snapshot.metrics.jobsOnShelf = na('Job approved+published+validThrough', 'current', 'recruitment_hosting_disabled')
  snapshot.metrics.fairStructure = na('FairCompany/FairZone/FairMaterial', 'ongoing', 'recruitment_hosting_disabled')
  snapshot.metrics.sourceEntryOpensTop = na('ExternalJumpLog', 'current', 'recruitment_hosting_disabled')
  snapshot.metrics.syncSuccessRate24h = ok('SyncLog.result', '24h', { total: 0, success: 0, failed: 0, successRate: null })
  snapshot.metrics.contentInventory = ok('Job/JobFair/PolicyPost/CompanyProfile counts', 'current', {
    jobsPublished: 328,
    jobsPending: 4,
    fairsPublished: 12,
    fairsPending: 1,
    policiesPublished: 9,
    policiesPending: 3,
    companiesPublished: 26,
    companiesPending: 2,
  })
  snapshot.metrics.pendingReview = ok('reviewStatus pending+reviewing', 'current', { total: 10, jobs: 4, fairs: 1, policies: 3, companies: 2 })
  return snapshot
}

/* ── 信息使用 ─────────────────────────────────────────────────────────── */

const RANGES: readonly ScreenUsageRange[] = ['today', '7d', '30d']

export function isUsageRange(raw: string | null): raw is ScreenUsageRange {
  return raw !== null && (RANGES as readonly string[]).includes(raw)
}

/** 服务端对 1–4 置空（少于 5 不给数）；0 仍给 0。 */
const small = (value: number): number | null => (value > 0 && value < 5 ? null : value)

/**
 * 信息使用快照。今日档里：企业资料的浏览 4 次 → null；招聘会、政策、企业的收藏都少于 5 → null。
 * 屏上这些格子必须写「少于 5」，合计写「至少」，绝不能画成 0。
 */
export function partnerUsage(range: string): ScreenUsageSnapshot {
  const safe: ScreenUsageRange = isUsageRange(range) ? range : 'today'
  const nowMs = Date.now()
  const n = safe === '30d' ? 30 : safe === '7d' ? 7 : 1
  const k = n === 1 ? 1 : n === 7 ? 6 : 24
  const browse = [38, 44, 29, 52, 61, 3, 47, 58, 66, 41, 35, 72, 80, 64, 59, 0, 48, 55, 62, 70, 76, 68, 49, 57, 83, 91, 74, 66, 88, 79]
  const opens = [9, 12, 6, 14, 17, 2, 11, 15, 18, 10, 8, 19, 22, 16, 13, 0, 12, 14, 16, 18, 21, 17, 12, 14, 23, 26, 20, 17, 24, 21]
  const days: Array<{ date: string; browse: number | null; sourceOpens: number | null }> = []
  for (let i = n - 1; i >= 0; i -= 1) {
    const j = (n - 1 - i) % browse.length
    days.push({ date: shanghaiDate(i), browse: small(browse[j]), sourceOpens: small(opens[j]) })
  }
  const content: ScreenPartnerContentUsageValue = {
    coverage: 'members_only',
    basis: 'current_content_join',
    byType: [
      { type: 'job', browse: small(38 * k), favorites: small(6 * k), sourceOpens: small(11 * k) },
      { type: 'job_fair', browse: small(9 * k), favorites: small(1 * k), sourceOpens: small(3 * k) },
      { type: 'policy', browse: small(21 * k), favorites: small(3 * k), sourceOpens: small(2 * k) },
      { type: 'company_profile', browse: small(4 * k), favorites: small(2 * k), sourceOpens: small(2 * k) },
    ],
  }
  return {
    generatedAt: isoAgo(7),
    audience: 'partner',
    range: safe,
    window: { timezone: 'Asia/Shanghai', from: new Date(nowMs - n * 86_400_000).toISOString(), to: new Date(nowMs).toISOString() },
    status: 'ok',
    degraded: false,
    limits: { minAggregateSample: 5, recruitmentHosting: 'enabled' },
    metrics: {
      partnerContent: ok('BrowseLog/Favorite/ExternalJumpLog join sourceOrgId', safe, content),
      partnerDaily: ok('BrowseLog/ExternalJumpLog.createdAt', safe, { days }),
      partnerTop: ok('BrowseLog join content title', safe, {
        items: [
          { type: 'job', title: '行政专员（海珠区，五险一金）', browse: 14 * k },
          { type: 'policy', title: '2026 年高校毕业生就业见习补贴申领指南', browse: 11 * k },
          { type: 'job', title: '仓储物流主管', browse: 9 * k },
          { type: 'job_fair', title: '海珠区秋季综合招聘会', browse: 7 * k },
          { type: 'company_profile', title: '广州某医疗器械有限公司', browse: 5 * k },
        ],
      }),
      visits: na('KioskSession', safe, 'kiosk_session_unwritten'),
    },
  }
}

/** 访问人次本次取数失败：与默认的结构性「未接入」对照，屏上要写「暂时取不到」。 */
export function partnerUsageVisitsFailed(range: string): ScreenUsageSnapshot {
  const base = partnerUsage(range)
  base.status = 'degraded'
  base.degraded = true
  base.metrics.visits = na('KioskSession', base.range, 'source_query_failed')
  return base
}

/**
 * 托管关闭的信息使用，照 console-screen.usage.service.ts / usage.queries.ts 写：
 *   - partnerContent 只下发政策一类（byType 过滤到 policy）；
 *   - partnerDaily 只数政策的浏览与打开来源入口（countsTowardPartnerDaily），少于 5（含 0）→ null；
 *   - partnerTop 只从政策里挑，浏览达到 5 次才列。
 */
const POLICY_DAILY = [
  [21, 8], [16, 6], [9, 3], [18, 7], [24, 9], [2, 0], [15, 5], [19, 6], [22, 8], [13, 4], [11, 5], [25, 10], [27, 11], [20, 7], [17, 6],
  [0, 0], [14, 5], [18, 6], [21, 8], [23, 9], [26, 10], [22, 8], [15, 5], [19, 7], [28, 11], [31, 12], [24, 9], [21, 8], [29, 11], [26, 10],
] as const
const suppressed = (value: number): number | null => (value >= 5 ? value : null)

export function partnerUsageHostingOff(range: string): ScreenUsageSnapshot {
  const base = partnerUsage(range)
  base.limits = { minAggregateSample: 5, recruitmentHosting: 'disabled' }
  const n = base.range === '30d' ? 30 : base.range === '7d' ? 7 : 1
  const days: Array<{ date: string; browse: number | null; sourceOpens: number | null }> = []
  for (let i = n - 1; i >= 0; i -= 1) {
    const [browse, opens] = POLICY_DAILY[i % POLICY_DAILY.length]
    days.push({ date: shanghaiDate(i), browse: suppressed(browse), sourceOpens: suppressed(opens) })
  }
  const today = POLICY_DAILY[0]
  const k = n === 1 ? 1 : n === 7 ? 6 : 24
  base.metrics.partnerContent = ok('BrowseLog/Favorite/ExternalJumpLog join sourceOrgId', base.range, {
    coverage: 'members_only',
    basis: 'current_content_join',
    byType: [{ type: 'policy', browse: suppressed(n === 1 ? today[0] : 21 * k), favorites: suppressed(n === 1 ? 3 : 3 * k), sourceOpens: suppressed(n === 1 ? today[1] : 8 * k) }],
  })
  base.metrics.partnerDaily = ok('BrowseLog/ExternalJumpLog.createdAt', base.range, { days })
  base.metrics.partnerTop = ok('BrowseLog join content title', base.range, {
    items: [
      { type: 'policy', title: '2026 年高校毕业生就业见习补贴申领指南', browse: 11 * k },
      { type: 'policy', title: '海珠区灵活就业人员社保补贴申领办法', browse: 7 * k },
      { type: 'policy', title: '创业担保贷款贴息政策问答', browse: 5 * k },
    ],
  })
  return base
}

/* ── 单台终端孪生 ─────────────────────────────────────────────────────── */

/**
 * 按请求的 id 回本机构夹具里真实存在的终端（页面只认 id 对得上的响应）；不在本机构的一律 404。
 * 今日计数里打印任务与扫描为 null（服务端对 1–4 置空）：屏上必须写「少于 5」。
 */
export function partnerTwin(id: string): ScreenTerminalTwin | null {
  const cell = partnerCells().find((c) => c.terminalId === id)
  if (!cell) return null
  const now = Date.now()
  const printing = cell.activity === 'printing'
  const printerState = cell.health === 'offline' ? 'offline' : cell.health === 'unknown' ? 'unknown' : cell.health === 'degraded' ? 'error' : printing ? 'printing' : 'ready'
  const seg = (fromH: number, toH: number, state: 'idle' | 'printing' | 'alert' | 'offline' | 'unknown') => ({
    from: new Date(now - fromH * 3600_000).toISOString(),
    to: new Date(now - toH * 3600_000).toISOString(),
    state,
  })
  return {
    generatedAt: new Date(now).toISOString(),
    audience: 'partner',
    terminal: { id, code: cell.terminalCode, displayName: `${cell.locationLabel} · 一楼`, areaLabel: cell.areaLabel, locationLabel: cell.locationLabel, geo: null },
    status: {
      health: cell.health,
      lastHeartbeatAt: cell.health === 'unknown' ? null : new Date(now - (cell.health === 'offline' ? 1_260_000 : 3000)).toISOString(),
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
    currentTask: ok('PrintTask.status', 'current', printing ? { pages: 6, colorMode: 'bw', startedAt: new Date(now - 30_000).toISOString() } : null),
    today: { printPages: 22, printTasks: null, scans: null, failed: 0, visits: na('KioskSession', 'current', 'kiosk_session_unwritten') },
    consumables: na('TerminalHeartbeat', 'current', 'no_consumable_or_geo_fields'),
    timeline24h: ok('TerminalHeartbeat+PrintTask', '24h', [
      seg(24, 15, 'offline'),
      seg(15, 8, 'idle'),
      seg(8, 7.6, 'printing'),
      seg(7.6, 2, 'idle'),
      seg(2, 1.8, 'alert'),
      seg(1.8, 0, printing ? 'printing' : 'idle'),
    ]),
  }
}
