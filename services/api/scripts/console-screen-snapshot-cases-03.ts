import { assert, readSrc, assertSourceContractSetup } from './console-screen-snapshot-cases-01'
import { assertSourceContractPhase1 } from './console-screen-snapshot-cases-02'
import { carryContext, TimelineSample } from './console-screen-snapshot-cases-18'
import { SCREEN_ONLINE_WINDOW_SECONDS, SCREEN_UNAVAILABLE_REASON, type ScreenTimelineState } from '../src/console-screen/console-screen.types'
import { TIMELINE_SEGMENT_CAP, type TimelineDeriveResult, deriveTerminalTimeline } from '../src/console-screen/console-screen.timeline'
import { isHealthyPrinterStatus } from '../src/terminals/printer-status'



export function assertSourceContractPhase2(context: ReturnType<typeof assertSourceContractPhase1>) {
const { adminController, partnerController, service, queries, printedPages, sqliteSchema, pgSchema, sqliteIndexMigration, pgIndexMigration, sqliteGeoMigration, pgGeoMigration } = context
assert(
    '1n. SQLite/PG schema 与双迁移都声明 toStatus+createdAt、createdAt+sourceName 索引',
    /@@index\(\[toStatus, createdAt\]\)/.test(sqliteSchema)
      && /@@index\(\[toStatus, createdAt\]\)/.test(pgSchema)
      && /@@index\(\[createdAt, sourceName\]\)/.test(sqliteSchema)
      && /@@index\(\[createdAt, sourceName\]\)/.test(pgSchema)
      && sqliteIndexMigration.includes('PrintTaskStatusLog_toStatus_createdAt_idx')
      && sqliteIndexMigration.includes('ExternalJumpLog_createdAt_sourceName_idx')
      && pgIndexMigration.includes('PrintTaskStatusLog_toStatus_createdAt_idx')
      && pgIndexMigration.includes('ExternalJumpLog_createdAt_sourceName_idx')
      && sqliteIndexMigration.includes('CREATE INDEX')
      && pgIndexMigration.includes('CREATE INDEX')
      && !/DROP INDEX/.test(sqliteIndexMigration)
      && !/DROP INDEX/.test(pgIndexMigration),
  )
assert(
    '1o. 趋势与累计按出纸完成时间计页×份数，今日失败按状态日志 createdAt',
    /loadPrintedPagesTrend\(/.test(queries)
      && /loadPrintedPagesTotal\(/.test(queries)
      && /printTaskStatusLog\.count/.test(queries)
      && /toStatus:\s*'failed'/.test(queries)
      && !/status:\s*'failed',\s*updatedAt/.test(queries)
      && !/select:\s*\{\s*paidAt:\s*true,\s*billablePages:\s*true/.test(queries)
      && !/select:\s*\{\s*createdAt:\s*true,\s*billablePages:\s*true/.test(queries)
      && /completedAt:\s*\{\s*gte:\s*from,\s*lt:\s*to\s*\}/.test(printedPages)
      && /taskCopies\(/.test(printedPages)
      && /PRINTED_TASK_WHERE/.test(printedPages)
      && /PartnerOrgRequiredError/.test(service),
  )
assert(
    '1q. gov 与 ops 共用 admin:alerts 实时档，不按 profile 分叉',
    /getOrLoad\(\s*'admin:alerts'\s*,\s*SCREEN_CACHE_TTL_SECONDS\.realtime\s*,\s*\(\)\s*=>\s*this\.loadAdminAlerts\(\)\s*\)/.test(service)
      && /listDerivedAlerts/.test(service)
      && !/includeAlerts/.test(service)
      && !/profile === 'ops'/.test(service),
  )
const cacheSrc = readSrc('src/console-screen/console-screen.cache.ts')
const moduleSrc = readSrc('src/console-screen/console-screen.module.ts')
assert(
    '1p. ScreenSnapshotCache 无 constructor 注入；ConsoleScreenModule 用 class provider 登记',
    !/constructor\s*\([^)]*clock/.test(cacheSrc)
      && /static forTest\(/.test(cacheSrc)
      && /providers:\s*\[\s*ConsoleScreenService,\s*ScreenSnapshotCache\s*\]/.test(moduleSrc)
      && !/useValue|useFactory/.test(moduleSrc),
  )
assert(
    '1r. 单台孪生沿用 admin/screen 与 partner/screen，机构 id 只来自当前用户，缓存键含机构',
    /@Get\('admin\/screen\/terminals\/:terminalId'\)/.test(adminController)
      && /@Get\('partner\/screen\/terminals\/:terminalId'\)/.test(partnerController)
      && /getPartnerTerminalTwin\(requirePartnerOrgId\(user\.orgId\)/.test(partnerController)
      && /admin:twin:/.test(service)
      && /partner:\$\{scopedOrgId\}:twin:/.test(service)
      && !/query\.orgId/.test(partnerController),
  )
assert(
    '1s. Terminal 所在区与经纬度写入两份 schema，SQLite REAL / PostgreSQL DOUBLE PRECISION',
    /areaLabel\s+String\?/.test(sqliteSchema)
      && /geoLat\s+Float\?/.test(sqliteSchema)
      && /geoLng\s+Float\?/.test(sqliteSchema)
      && /areaLabel\s+String\?/.test(pgSchema)
      && /geoLat\s+Float\?/.test(pgSchema)
      && /geoLng\s+Float\?/.test(pgSchema)
      && sqliteGeoMigration.includes('"areaLabel" TEXT')
      && sqliteGeoMigration.includes('"geoLat" REAL')
      && sqliteGeoMigration.includes('"geoLng" REAL')
      && pgGeoMigration.includes('"geoLat" DOUBLE PRECISION')
      && pgGeoMigration.includes('"geoLng" DOUBLE PRECISION')
      && !/DROP COLUMN/.test(sqliteGeoMigration)
      && !/DROP COLUMN/.test(pgGeoMigration),
  )
return carryContext(context, { cacheSrc, moduleSrc })
}


export function assertSourceContract(): void {
const context = assertSourceContractSetup()
const phase1 = assertSourceContractPhase1(context)
assertSourceContractPhase2(phase1)

}


export function deriveTerminalTimelineQuadratic(input: TimelineSample): TimelineDeriveResult {
  if (input.heartbeatRowCapExceeded) {
    return { ok: false, reason: SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded }
  }
  const nowMs = input.now.getTime()
  const windowStart = nowMs - 24 * 60 * 60 * 1000
  const onlineWindowMs = input.onlineWindowMs ?? SCREEN_ONLINE_WINDOW_SECONDS * 1000
  const segmentCap = input.segmentCap ?? TIMELINE_SEGMENT_CAP
  const rank: Record<ScreenTimelineState, number> = { unknown: 0, offline: 1, idle: 2, alert: 3 }
  const heartbeats = input.heartbeats
    .filter((row) => row.at instanceof Date && Number.isFinite(row.at.getTime()) && row.at.getTime() <= nowMs)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  type Seg = { from: number; to: number; state: ScreenTimelineState }
  const overlay = (segments: Seg[], from: number, to: number, state: ScreenTimelineState): Seg[] => {
    if (to <= from) return segments
    const next: Seg[] = []
    for (const seg of segments) {
      if (seg.to <= from || seg.from >= to) {
        next.push(seg)
        continue
      }
      if (seg.from < from) next.push({ from: seg.from, to: from, state: seg.state })
      next.push({
        from: Math.max(seg.from, from),
        to: Math.min(seg.to, to),
        state: rank[seg.state] > rank[state] ? seg.state : state,
      })
      if (seg.to > to) next.push({ from: to, to: seg.to, state: seg.state })
    }
    return next
  }
  let segments: Seg[] = [{
    from: windowStart,
    to: nowMs,
    state: heartbeats.length > 0 ? 'offline' : 'unknown',
  }]
  for (const heartbeat of heartbeats) {
    const at = heartbeat.at.getTime()
    const from = Math.max(at, windowStart)
    const to = Math.min(at + onlineWindowMs, nowMs)
    const status = heartbeat.printerStatus
    // 与 deriveTerminalTimeline 的 printerIssue 同口径：纸张不足仍可打印，不算故障段。
    const alert = Boolean(status) && status !== 'unknown' && status !== 'low_paper' && !isHealthyPrinterStatus(status)
    segments = overlay(segments, from, to, alert ? 'alert' : 'idle')
  }
  segments = segments.map((seg) => ({ ...seg, from: Math.floor(seg.from / 60000) * 60000, to: Math.floor(seg.to / 60000) * 60000 }))
  const sorted = segments.filter((seg) => seg.to > seg.from).sort((a, b) => a.from - b.from || a.to - b.to)
  const merged: Seg[] = []
  for (const seg of sorted) {
    const last = merged[merged.length - 1]
    if (last && last.state === seg.state && last.to === seg.from) last.to = seg.to
    else merged.push({ ...seg })
  }
  if (merged.length > segmentCap) return { ok: false, reason: SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded }
  return {
    ok: true,
    segments: merged.map((seg) => ({
      from: new Date(seg.from).toISOString().slice(0, 16) + 'Z',
      to: new Date(seg.to).toISOString().slice(0, 16) + 'Z',
      state: seg.state,
    })),
  }
}


export function timelineSampleDiff(label: string, sample: TimelineSample): string | null {
  const next = deriveTerminalTimeline(sample)
  const previous = deriveTerminalTimelineQuadratic(sample)
  if (JSON.stringify(next) === JSON.stringify(previous)) return null
  return `${label}: new=${JSON.stringify(next).slice(0, 320)} old=${JSON.stringify(previous).slice(0, 320)}`
}


export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
