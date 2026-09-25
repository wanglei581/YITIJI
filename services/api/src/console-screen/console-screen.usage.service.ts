import { Injectable, Logger } from '@nestjs/common'
import { SCREEN_CACHE_TTL_SECONDS } from './console-screen.types'
import type {
  ScreenAudience,
  ScreenMetric,
  ScreenSnapshotStatus,
  ScreenSourceEntryOpensValue,
  ScreenUsageAiValue,
  ScreenUsageHeatValue,
  ScreenUsageMetrics,
  ScreenUsagePulseValue,
  ScreenUsageRange,
  ScreenUsageSnapshot,
} from './console-screen.types'
import {
  SCREEN_JUMP_COPY,
  SCREEN_MIN_AGGREGATE_SAMPLE,
  SCREEN_TIMEZONE,
  SCREEN_UNAVAILABLE_REASON,
} from './console-screen.types'
import { PrismaService } from '../prisma/prisma.service'
import { ScreenSnapshotCache } from './console-screen.cache'
import {
  availableMetric,
  filterSourceEntryOpens,
  shanghaiDayKey,
  snapshotLoadStatus,
  unavailableMetric,
} from './console-screen.metric'
import { loadJumpRows } from './console-screen.queries'
import { requirePartnerOrgId, type PartnerOrgId } from './console-screen.org'
import {
  USAGE_AI_REPORT_OPERATIONS,
  USAGE_EVENT_ROW_CAP,
  USAGE_HEAT_DAYS,
  USAGE_PULSE_BUCKET_MINUTES,
  USAGE_PULSE_BUCKETS,
  USAGE_SERVICE_NODES,
  loadAdminUsageFacts,
  loadPartnerUsageFacts,
  loadUsageTimeline,
  pulseWindowStart,
  shanghaiHour,
  suppressSmallCount,
  usageDayKeys,
  usageProviderLabel,
  usageWindow,
  type AdminUsageFacts,
  type PartnerUsageFacts,
  type UsageTimeline,
} from './console-screen.usage.queries'

/** 管理员没有机构。键的形状与机构端相同，避免和某个真实 orgId 撞车。 */
export const USAGE_ADMIN_CACHE_ORG = 'platform'

export function usageCacheKey(audience: ScreenAudience, orgId: string, range: ScreenUsageRange): string {
  return `usage:${audience}:${orgId}:${range}`
}

const TIMELINE_SOURCE = 'AiServiceLog+PrintTask+ScanTask+BrowseLog+ExternalJumpLog+Favorite.createdAt'
const PULSE_BUCKET_MS = USAGE_PULSE_BUCKET_MINUTES * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

type Loaded<T> = { ok: true; value: T } | { ok: false; reason: string }

interface CachedUsage {
  failed: boolean
  snapshot: Omit<ScreenUsageSnapshot, 'generatedAt'>
}

@Injectable()
export class ConsoleScreenUsageService {
  private readonly logger = new Logger(ConsoleScreenUsageService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ScreenSnapshotCache,
  ) {}

  async getAdminUsage(
    range: ScreenUsageRange,
    now = new Date(),
    rowCap = USAGE_EVENT_ROW_CAP,
  ): Promise<ScreenUsageSnapshot> {
    const loaded = await this.cache.getOrLoad(
      usageCacheKey('admin', USAGE_ADMIN_CACHE_ORG, range),
      SCREEN_CACHE_TTL_SECONDS.counts,
      () => this.loadAdmin(range, now, rowCap),
      (payload) => !payload.failed,
    )
    return { ...loaded.value.snapshot, generatedAt: new Date(loaded.storedAt).toISOString() }
  }

  async getPartnerUsage(
    orgId: string,
    range: ScreenUsageRange,
    now = new Date(),
    rowCap = USAGE_EVENT_ROW_CAP,
  ): Promise<ScreenUsageSnapshot> {
    const scoped = requirePartnerOrgId(orgId)
    const loaded = await this.cache.getOrLoad(
      usageCacheKey('partner', scoped, range),
      SCREEN_CACHE_TTL_SECONDS.counts,
      () => this.loadPartner(scoped, range, now, rowCap),
      (payload) => !payload.failed,
    )
    return { ...loaded.value.snapshot, generatedAt: new Date(loaded.storedAt).toISOString() }
  }

  private async loadAdmin(range: ScreenUsageRange, now: Date, rowCap: number): Promise<CachedUsage> {
    const span = usageWindow(range, now)
    const heatFrom = usageWindow('7d', now).from
    const pulseFrom = pulseWindowStart(now)
    const [facts, heat, pulse, jumps] = await Promise.all([
      this.settle('usageFacts', () => loadAdminUsageFacts(this.prisma, span.from, span.to)),
      this.settle('usageHeat', () => loadUsageTimeline(this.prisma, heatFrom, now, rowCap)),
      this.settle('usagePulse', () => loadUsageTimeline(this.prisma, pulseFrom, now, rowCap)),
      this.settle('usageJumps', () => loadJumpRows(this.prisma, now)),
    ])
    const status = snapshotLoadStatus([facts, heat, pulse, jumps].filter((part) => part.ok).length, 4)
    const metrics: ScreenUsageMetrics = {
      channels: this.fromFacts(facts, 'Order.payStatus=paid,paidAt', range, (value) => ({
        paidOrders: value.channels.paidOrders,
        kiosk: suppressSmallCount(value.channels.kiosk),
        miniapp: suppressSmallCount(value.channels.miniapp),
        unlabeled: suppressSmallCount(value.channels.unlabeled),
        memberOrders: suppressSmallCount(value.channels.memberOrders),
      })),
      visits: visitsMetric(),
      services: this.fromFacts(facts, 'BrowseLog/AiServiceLog/PrintTask/ScanTask', range, (value) => (
        USAGE_SERVICE_NODES.map((node) => ({
          key: node.key,
          lane: node.lane,
          coverage: node.coverage,
          count: suppressSmallCount(nodeCount(node, value)),
        }))
      )),
      outcomes: this.fromFacts(facts, 'ExternalJumpLog/Favorite/AiServiceLog/PrintTask', range, (value) => ({
        // ExternalJumpLog 只统计打开来源平台入口，不是投递或预约结果。
        sourceOpens: suppressSmallCount(value.jumpTotal),
        favorites: suppressSmallCount(value.favoriteTotal),
        aiReports: suppressSmallCount(reportCount(value)),
        printed: suppressSmallCount(value.printed),
      })),
      heat7d: timelineMetric(heat, '7d', (lanes) => buildUsageHeat(
        [...lanes.info, ...lanes.ai, ...lanes.print],
        now,
      )),
      pulse2h: timelineMetric(pulse, '2h', (lanes) => buildUsagePulse(lanes, now)),
      printSteps: this.fromFacts(facts, 'PrintTask/Order', range, (value) => ({
        uploaded: unwrittenUpload(range),
        inspected: unwrittenInspection(range),
        paid: value.channels.paidOrders,
        printed: value.printed,
      })),
      resumeSteps: this.fromFacts(facts, 'AiServiceLog/AuditLog', range, (value) => ({
        uploaded: unwrittenUpload(range),
        analyzed: successCount(value, 'parseResume'),
        optimized: successCount(value, 'optimizeResume'),
        exported: value.resumeExported,
      })),
      ai: this.fromFacts(facts, 'AiServiceLog', range, buildAiValue),
      jobs: this.fromFacts(facts, 'BrowseLog/Favorite/ExternalJumpLog', range, (value) => ({
        browse: suppressSmallCount(value.browseByType['job'] ?? 0),
        favorites: suppressSmallCount(value.favoriteByType['job'] ?? 0),
        sourceOpens: suppressSmallCount(value.jumpByType['job'] ?? 0),
        coverage: 'members_only' as const,
      })),
      topSources30d: topSourcesMetric(jumps),
      content: this.fromFacts(facts, 'BrowseLog', range, (value) => ({
        policy: suppressSmallCount(value.browseByType['policy'] ?? 0),
        fair: suppressSmallCount((value.browseByType['job_fair'] ?? 0) + (value.browseByType['fair_company'] ?? 0)),
        company: suppressSmallCount(value.browseByType['company_profile'] ?? 0),
        coverage: 'members_only' as const,
      })),
    }
    return {
      failed: [facts, heat, pulse, jumps].some((part) => !part.ok),
      snapshot: this.envelope('admin', range, span, status, metrics),
    }
  }

  private async loadPartner(
    orgId: PartnerOrgId,
    range: ScreenUsageRange,
    now: Date,
    rowCap: number,
  ): Promise<CachedUsage> {
    const span = usageWindow(range, now)
    const facts = await this.settle('partnerUsage', () => (
      loadPartnerUsageFacts(this.prisma, orgId, span.from, span.to, rowCap)
    ))
    const metrics: ScreenUsageMetrics = {
      partnerContent: this.fromFacts(facts, 'BrowseLog/Favorite/ExternalJumpLog join sourceOrgId', range, (value) => ({
        byType: value.byType.map((row) => ({
          type: row.type,
          browse: suppressSmallCount(row.browse),
          favorites: suppressSmallCount(row.favorites),
          sourceOpens: suppressSmallCount(row.sourceOpens),
        })),
        coverage: 'members_only' as const,
        basis: 'current_content_join' as const,
      })),
      partnerDaily: partnerDailyMetric(facts, range, span.from, span.to),
      partnerTop: this.fromFacts(facts, 'BrowseLog join content title', range, (value) => ({
        items: value.top
          .filter((item) => item.browse >= SCREEN_MIN_AGGREGATE_SAMPLE)
          .slice(0, 5),
      })),
      visits: visitsMetric(),
    }
    const status = snapshotLoadStatus(facts.ok ? 1 : 0, 1)
    return {
      failed: !facts.ok,
      snapshot: this.envelope('partner', range, span, status, metrics),
    }
  }

  private envelope(
    audience: ScreenAudience,
    range: ScreenUsageRange,
    span: { from: Date; to: Date },
    status: ScreenSnapshotStatus,
    metrics: ScreenUsageMetrics,
  ): Omit<ScreenUsageSnapshot, 'generatedAt'> {
    return {
      audience,
      range,
      window: { timezone: SCREEN_TIMEZONE, from: span.from.toISOString(), to: span.to.toISOString() },
      status,
      degraded: status !== 'ok',
      limits: { minAggregateSample: SCREEN_MIN_AGGREGATE_SAMPLE },
      metrics,
    }
  }

  private fromFacts<T, U>(
    loaded: Loaded<T>,
    source: string,
    window: string,
    present: (value: T) => U,
  ): ScreenMetric<U> {
    if (!loaded.ok) return unavailableMetric(source, window, loaded.reason)
    return availableMetric(source, window, present(loaded.value))
  }

  private async settle<T>(slice: string, load: () => Promise<T>): Promise<Loaded<T>> {
    try {
      return { ok: true, value: await load() }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError'
      this.logger.warn(
        `console_screen_usage_slice_failed slice=${slice} reason=${SCREEN_UNAVAILABLE_REASON.sourceQueryFailed} errorName=${errorName}`,
      )
      return { ok: false, reason: SCREEN_UNAVAILABLE_REASON.sourceQueryFailed }
    }
  }
}

function visitsMetric(): ScreenMetric<never> {
  return unavailableMetric('KioskSession', 'current', SCREEN_UNAVAILABLE_REASON.kioskSessionUnwritten)
}

function unwrittenUpload(window: string): ScreenMetric<number> {
  return unavailableMetric('upload counter', window, SCREEN_UNAVAILABLE_REASON.uploadCounterUnwritten)
}

function unwrittenInspection(window: string): ScreenMetric<number> {
  return unavailableMetric('inspection counter', window, SCREEN_UNAVAILABLE_REASON.inspectionCounterUnwritten)
}

function nodeCount(node: (typeof USAGE_SERVICE_NODES)[number], facts: AdminUsageFacts): number {
  if (node.kind === 'browse') {
    return node.targetTypes.reduce((sum, type) => sum + (facts.browseByType[type] ?? 0), 0)
  }
  if (node.kind === 'ai_success') {
    const operations: readonly string[] = node.operations
    return facts.ai.reduce((sum, row) => (
      row.status === 'success' && operations.includes(row.operation) ? sum + row.count : sum
    ), 0)
  }
  if (node.kind === 'print_created') return facts.printCreated
  return facts.scanCreated
}

function successCount(facts: AdminUsageFacts, operation: string): number {
  return facts.ai.reduce((sum, row) => (
    row.status === 'success' && row.operation === operation ? sum + row.count : sum
  ), 0)
}

function reportCount(facts: AdminUsageFacts): number {
  return USAGE_AI_REPORT_OPERATIONS.reduce((sum, operation) => sum + successCount(facts, operation), 0)
}

function buildAiValue(facts: AdminUsageFacts): ScreenUsageAiValue {
  let total = 0
  let success = 0
  let failed = 0
  const byOp = new Map<string, number>()
  for (const row of facts.ai) {
    total += row.count
    if (row.status === 'success') success += row.count
    if (row.status === 'failed') failed += row.count
    byOp.set(row.operation, (byOp.get(row.operation) ?? 0) + row.count)
  }
  return {
    total,
    success,
    failed,
    successRate: total > 0 ? Math.round((success / total) * 1000) / 10 : null,
    avgLatencyMs: facts.avgLatencyMs,
    estimatedCostCny: facts.estimatedCostCny,
    costMeasuredCalls: facts.costMeasuredCalls,
    fallbackCalls: facts.fallbackCalls,
    byOperation: [...byOp.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([operation, count]) => ({ operation, count: suppressSmallCount(count) })),
    providers: facts.providers
      .map((row) => ({ provider: row.provider ?? '', count: row.count }))
      .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider))
      .map((row) => ({
        provider: row.provider,
        label: usageProviderLabel(row.provider),
        count: suppressSmallCount(row.count),
      })),
  }
}

function topSourcesMetric(jumps: Loaded<Array<{ sourceName: string | null; count: number }>>): ScreenMetric<ScreenSourceEntryOpensValue> {
  if (!jumps.ok) {
    return unavailableMetric('ExternalJumpLog.sourceName', '30d', jumps.reason)
  }
  const filtered = filterSourceEntryOpens(jumps.value)
  if (filtered.belowThreshold) {
    return unavailableMetric('ExternalJumpLog.sourceName', '30d', SCREEN_UNAVAILABLE_REASON.sampleBelowThreshold)
  }
  return availableMetric('ExternalJumpLog.sourceName', '30d', {
    copy: SCREEN_JUMP_COPY,
    minSampleThreshold: SCREEN_MIN_AGGREGATE_SAMPLE,
    items: filtered.items,
  })
}

function timelineMetric<T>(
  loaded: Loaded<UsageTimeline>,
  window: string,
  build: (lanes: UsageTimeline['lanes']) => T,
): ScreenMetric<T> {
  if (!loaded.ok) return unavailableMetric(TIMELINE_SOURCE, window, loaded.reason)
  if (loaded.value.capped) {
    return unavailableMetric(TIMELINE_SOURCE, window, SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded)
  }
  return availableMetric(TIMELINE_SOURCE, window, build(loaded.value.lanes))
}

function partnerDailyMetric(
  facts: Loaded<PartnerUsageFacts>,
  window: string,
  from: Date,
  to: Date,
): ScreenMetric<{ days: Array<{ date: string; browse: number | null; sourceOpens: number | null }> }> {
  if (!facts.ok) {
    return unavailableMetric('BrowseLog/ExternalJumpLog.createdAt', window, facts.reason)
  }
  if (facts.value.dailyCapped) {
    return unavailableMetric('BrowseLog/ExternalJumpLog.createdAt', window, SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded)
  }
  const keys = usageDayKeys(from, to)
  const browseCounts = new Map(keys.map((key) => [key, 0]))
  const jumpCounts = new Map(keys.map((key) => [key, 0]))
  for (const event of facts.value.browseTimes) addDay(browseCounts, event)
  for (const event of facts.value.jumpTimes) addDay(jumpCounts, event)
  return availableMetric('BrowseLog/ExternalJumpLog.createdAt', window, {
    days: keys.map((date) => ({
      date,
      browse: suppressSmallCount(browseCounts.get(date) ?? 0),
      sourceOpens: suppressSmallCount(jumpCounts.get(date) ?? 0),
    })),
  })
}

function addDay(counts: Map<string, number>, event: Date): void {
  const key = shanghaiDayKey(event)
  if (!counts.has(key)) return
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function buildUsageHeat(events: Date[], now: Date): ScreenUsageHeatValue {
  const start = usageWindow('7d', now).from
  const counts = new Map<string, number[]>()
  const days: string[] = []
  for (let i = 0; i < USAGE_HEAT_DAYS; i += 1) {
    const date = shanghaiDayKey(new Date(start.getTime() + i * DAY_MS))
    days.push(date)
    counts.set(date, Array.from({ length: 24 }, () => 0))
  }
  for (const event of events) {
    const hours = counts.get(shanghaiDayKey(event))
    if (!hours) continue
    const hour = shanghaiHour(event)
    hours[hour] = (hours[hour] ?? 0) + 1
  }
  const today = shanghaiDayKey(now)
  const nowHour = shanghaiHour(now)
  let anyVisible = false
  const dayRows = days.map((date) => ({
    date,
    hours: (counts.get(date) ?? []).map((count, hour) => {
      if (date === today && hour > nowHour) return null
      const shown = suppressSmallCount(count)
      if (shown !== null) anyVisible = true
      return shown
    }),
  }))
  return { days: dayRows, peakHour: anyVisible ? peakHourOf(counts, days) : null }
}

function peakHourOf(counts: Map<string, number[]>, days: string[]): number | null {
  const sums = Array.from({ length: 24 }, () => 0)
  for (const date of days) {
    const hours = counts.get(date) ?? []
    hours.forEach((count, hour) => {
      sums[hour] = (sums[hour] ?? 0) + count
    })
  }
  let best = 0
  let bestHour: number | null = null
  sums.forEach((sum, hour) => {
    if (sum > best) {
      best = sum
      bestHour = hour
    }
  })
  return bestHour
}

function buildUsagePulse(
  lanes: UsageTimeline['lanes'],
  now: Date,
): ScreenUsagePulseValue {
  const start = pulseWindowStart(now).getTime()
  const totals = Array.from({ length: USAGE_PULSE_BUCKETS }, () => ({ info: 0, ai: 0, print: 0 }))
  const place = (events: Date[], lane: 'info' | 'ai' | 'print') => {
    for (const event of events) {
      const index = Math.floor((event.getTime() - start) / PULSE_BUCKET_MS)
      const bucket = totals[index]
      if (!bucket) continue
      bucket[lane] += 1
    }
  }
  place(lanes.info, 'info')
  place(lanes.ai, 'ai')
  place(lanes.print, 'print')
  return {
    bucketMinutes: 5,
    buckets: totals.map((bucket, index) => ({
      start: new Date(start + index * PULSE_BUCKET_MS).toISOString(),
      info: suppressSmallCount(bucket.info),
      ai: suppressSmallCount(bucket.ai),
      print: suppressSmallCount(bucket.print),
    })),
  }
}
