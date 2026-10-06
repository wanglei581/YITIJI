import {
  SCREEN_UNAVAILABLE_REASON,
  type ScreenContentInventoryValue,
  type ScreenFairStructureValue,
  type ScreenFleetWallValue,
  type ScreenPendingReviewValue,
  type ScreenPrintPagesValue,
  type ScreenPrintTrendValue,
  type ScreenRateValue,
  type ScreenTaskFlowValue,
  type ScreenTerminalsOnlineValue,
} from './console-screen.types'
import { DEVICE_FLEET_ONLINE_WINDOW_SECONDS, buildDeviceFleetOverview } from '../device-fleet/device-fleet.projection'
import type { DeviceFleetOverview } from '../device-fleet/device-fleet.types'
import { buildPublishedJobWhere } from '../jobs/jobs-shared'
import type { PrismaService } from '../prisma/prisma.service'
import {
  FLEET_SAMPLE_TAKE,
  JUMP_LOOKBACK_DAYS,
  JUMP_SOURCE_GROUP_TAKE,
  daysAgoStart,
  hoursAgo,
  rateFromCounts,
  shanghaiDayStart,
  unavailableMetric,
} from './console-screen.metric'
import { attachFleetCells } from './console-screen.fleet'
import { loadPrintedPagesTotal, loadPrintedPagesTrend } from './console-screen.printed-pages'
import {
  type PartnerOrgId,
  partnerOrgIdWhere,
  partnerSourceOrgWhere,
  requirePartnerOrgId,
} from './console-screen.org'

const PENDING = { in: ['pending', 'reviewing'] }
const PUBLISHED = { reviewStatus: 'approved', publishStatus: 'published' }
const ACTIVE_PRINT = ['pending', 'claimed', 'printing']

const FLEET_TERMINAL_SELECT = {
  id: true,
  terminalCode: true,
  displayName: true,
  locationLabel: true,
  areaLabel: true,
  geoLat: true,
  geoLng: true,
  enabled: true,
  org: { select: { name: true } },
  heartbeats: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { status: true, agentVersion: true, printerStatus: true, createdAt: true },
  },
}

export interface ContentSlice {
  inventory: ScreenContentInventoryValue
  jobsPublished: number
  sourceOrgCount: number
  pending: ScreenPendingReviewValue
}

export interface PrintLiveSlice {
  inProgress: { queued: number; printing: number; total: number }
  failedToday: number
  taskFlow: ScreenTaskFlowValue
}

export interface PrintCumulativeSlice {
  /** 'capped'：出纸任务行超过上限，本次不给累计数。 */
  pages: ScreenPrintPagesValue | 'capped'
  trend: ScreenPrintTrendValue | 'capped'
}

export interface AiSlice {
  totalCalls: number
  windowCalls: number
  windowSuccess: number
  windowFailed: number
  byOperation: Record<string, number>
  estimatedCostCny: number
  measuredCalls: number
  unmeasuredCalls: number
  avgLatencyMs: number | null
}

export interface SyncSlice {
  rate: ScreenRateValue
}

export interface JumpRow {
  sourceName: string | null
  count: number
}

function countMap(rows: Array<{ status: string; _count: { _all: number } }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) out[row.status] = row._count._all
  return out
}

function sourceOrgFilter(orgId: PartnerOrgId | undefined): { sourceOrgId: string } | Record<string, never> {
  if (orgId === undefined) return {}
  return partnerSourceOrgWhere(orgId)
}

export function mapFleetOverview(
  overview: DeviceFleetOverview,
  cells: ScreenFleetWallValue['cells'],
  listing?: { matchedCount: number; truncated: boolean; sampleCap: number },
): {
  online: ScreenTerminalsOnlineValue
  wall: ScreenFleetWallValue
} {
  const neverReported = overview.terminals.filter((item) => item.healthReason === 'never_reported').length
  const sampledCount = overview.summary.total
  const matchedCount = listing?.matchedCount ?? sampledCount
  const truncated = listing?.truncated ?? false
  const sampleCap = listing?.sampleCap ?? sampledCount
  const online: ScreenTerminalsOnlineValue = {
    healthy: overview.summary.healthy,
    total: sampledCount,
    degraded: overview.summary.degraded,
    offline: overview.summary.offline,
    unknown: overview.summary.unknown,
    neverReported,
    onlineWindowSeconds: DEVICE_FLEET_ONLINE_WINDOW_SECONDS,
    sampledCount,
    matchedCount,
    truncated,
    sampleCap,
  }
  return {
    online,
    wall: {
      ...online,
      cells,
    },
  }
}

export interface FleetSlice {
  overview: DeviceFleetOverview
  cells: ScreenFleetWallValue['cells']
  matchedCount: number
  truncated: boolean
}

export type PartnerFleetSlice = FleetSlice

async function loadFleetSlice(
  prisma: PrismaService,
  now: Date,
  where: { orgId: string } | Record<string, never>,
): Promise<FleetSlice> {
  const matchedCount = await prisma.terminal.count({ where })
  const terminals = await prisma.terminal.findMany({
    where,
    orderBy: { terminalCode: 'asc' },
    take: FLEET_SAMPLE_TAKE,
    select: FLEET_TERMINAL_SELECT,
  })
  const overview = buildDeviceFleetOverview(
    { terminals, screensaverConfigs: [], smartCampusConfigs: [], toolboxConfigs: [] },
    now,
  )
  return {
    overview,
    cells: await attachFleetCells(prisma, terminals, overview, now),
    matchedCount,
    truncated: matchedCount > FLEET_SAMPLE_TAKE,
  }
}

export async function loadAdminFleet(prisma: PrismaService, now: Date): Promise<FleetSlice> {
  return loadFleetSlice(prisma, now, {})
}

export async function loadPartnerFleet(
  prisma: PrismaService,
  now: Date,
  orgId: string,
): Promise<FleetSlice> {
  return loadFleetSlice(prisma, now, partnerOrgIdWhere(requirePartnerOrgId(orgId)))
}

export async function loadContentSlice(
  prisma: PrismaService,
  now: Date,
  orgId?: PartnerOrgId,
): Promise<ContentSlice> {
  const scoped = sourceOrgFilter(orgId)
  const jobPublishedWhere = orgId === undefined
    ? buildPublishedJobWhere(undefined, now)
    : buildPublishedJobWhere(partnerSourceOrgWhere(orgId), now)
  const fairPublishedWhere = {
    ...PUBLISHED,
    ...scoped,
    endAt: { gte: now },
  }
  const [
    jobsPublished,
    sourceOrgs,
    jobsPending,
    fairsPublished,
    fairsPending,
    policiesPublished,
    policiesPending,
    companiesPublished,
    companiesPending,
  ] = await Promise.all([
    prisma.job.count({ where: jobPublishedWhere }),
    prisma.job.groupBy({ by: ['sourceOrgId'], where: jobPublishedWhere }),
    prisma.job.count({ where: { ...scoped, reviewStatus: PENDING } }),
    prisma.jobFair.count({ where: fairPublishedWhere }),
    prisma.jobFair.count({ where: { ...scoped, reviewStatus: PENDING } }),
    prisma.policyPost.count({ where: { ...scoped, ...PUBLISHED } }),
    prisma.policyPost.count({ where: { ...scoped, reviewStatus: PENDING } }),
    prisma.companyProfile.count({ where: { ...scoped, ...PUBLISHED } }),
    prisma.companyProfile.count({ where: { ...scoped, reviewStatus: PENDING } }),
  ])
  const pendingTotal = jobsPending + fairsPending + policiesPending + companiesPending
  return {
    jobsPublished,
    sourceOrgCount: sourceOrgs.length,
    inventory: {
      jobsPublished,
      jobsPending,
      fairsPublished,
      fairsPending,
      policiesPublished,
      policiesPending,
      companiesPublished,
      companiesPending,
    },
    pending: {
      total: pendingTotal,
      jobs: jobsPending,
      fairs: fairsPending,
      policies: policiesPending,
      companies: companiesPending,
    },
  }
}

export async function loadPrintLiveSlice(prisma: PrismaService, now: Date): Promise<PrintLiveSlice> {
  const since24h = hoursAgo(now, 24)
  const dayStart = shanghaiDayStart(now)
  const [activeRows, failedToday, print24h, scan24h] = await Promise.all([
    prisma.printTask.groupBy({
      by: ['status'],
      where: { status: { in: [...ACTIVE_PRINT] } },
      _count: { _all: true },
    }),
    prisma.printTaskStatusLog.count({
      // 按失败事件发生日计，不用 PrintTask.updatedAt，避免历史失败被改行复活。
      where: { toStatus: 'failed', createdAt: { gte: dayStart } },
    }),
    prisma.printTask.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since24h } },
      _count: { _all: true },
    }),
    prisma.scanTask.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since24h } },
      _count: { _all: true },
    }),
  ])
  const active = countMap(activeRows)
  const queued = (active['pending'] ?? 0) + (active['claimed'] ?? 0)
  const printing = active['printing'] ?? 0
  return {
    inProgress: { queued, printing, total: queued + printing },
    failedToday,
    taskFlow: { printByStatus: countMap(print24h), scanByStatus: countMap(scan24h) },
  }
}

/** 累计与 14 天趋势的页数都在 console-screen.printed-pages.ts，这里只并行取回。 */
export async function loadPrintCumulativeSlice(
  prisma: PrismaService,
  now: Date,
  options?: { trendRowCap?: number; printedRowCap?: number },
): Promise<PrintCumulativeSlice> {
  const [printedPages, trend] = await Promise.all([
    loadPrintedPagesTotal(prisma, { rowCap: options?.printedRowCap }),
    loadPrintedPagesTrend(prisma, now, { rowCap: options?.trendRowCap }),
  ])
  return {
    pages: printedPages === 'capped'
      ? 'capped'
      : {
          totalPages: printedPages,
          byColor: unavailableMetric(
            'Order.itemsJson',
            'cumulative',
            SCREEN_UNAVAILABLE_REASON.colorSplitNotIndexed,
          ),
        },
    trend,
  }
}

export async function loadAiSlice(prisma: PrismaService, now: Date): Promise<AiSlice> {
  const since24h = hoursAgo(now, 24)
  const [
    totalCalls,
    statusRows,
    operationRows,
    measured,
    unmeasuredCalls,
    latency,
  ] = await Promise.all([
    prisma.aiServiceLog.count(),
    prisma.aiServiceLog.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since24h } },
      _count: { _all: true },
    }),
    prisma.aiServiceLog.groupBy({
      by: ['operation'],
      where: { createdAt: { gte: since24h } },
      _count: { _all: true },
    }),
    prisma.aiServiceLog.aggregate({
      where: { createdAt: { gte: since24h }, estimatedCostCny: { not: null } },
      _sum: { estimatedCostCny: true },
      _count: true,
    }),
    prisma.aiServiceLog.count({
      where: { createdAt: { gte: since24h }, estimatedCostCny: null },
    }),
    prisma.aiServiceLog.aggregate({
      where: { createdAt: { gte: since24h }, status: 'success' },
      _avg: { latencyMs: true },
    }),
  ])
  const status = countMap(statusRows.map((row) => ({ status: row.status, _count: row._count })))
  const byOperation: Record<string, number> = {}
  for (const row of operationRows) byOperation[row.operation] = row._count._all
  const windowSuccess = status['success'] ?? 0
  const windowFailed = status['failed'] ?? 0
  return {
    totalCalls,
    windowCalls: windowSuccess + windowFailed,
    windowSuccess,
    windowFailed,
    byOperation,
    estimatedCostCny: measured._sum.estimatedCostCny ?? 0,
    measuredCalls: measured._count,
    unmeasuredCalls,
    avgLatencyMs: latency._avg.latencyMs === null ? null : Math.round(latency._avg.latencyMs),
  }
}

export async function loadSyncSlice(
  prisma: PrismaService,
  now: Date,
  orgId?: PartnerOrgId,
): Promise<SyncSlice> {
  const rows = await prisma.syncLog.groupBy({
    by: ['result'],
    where: {
      createdAt: { gte: hoursAgo(now, 24) },
      ...(orgId === undefined ? {} : partnerOrgIdWhere(orgId)),
    },
    _count: { _all: true },
  })
  const success = rows.filter((row) => row.result === 'success').reduce((sum, row) => sum + row._count._all, 0)
  const failed = rows.filter((row) => row.result === 'failed').reduce((sum, row) => sum + row._count._all, 0)
  const partial = rows.filter((row) => row.result === 'partial').reduce((sum, row) => sum + row._count._all, 0)
  const total = success + failed + partial
  return {
    rate: {
      total,
      success,
      failed: failed + partial,
      successRate: rateFromCounts(success, failed + partial),
    },
  }
}

export async function loadJumpRows(
  prisma: PrismaService, now: Date, closedWindow?: { from: Date; to: Date },
): Promise<JumpRow[]> {
  const rows = await prisma.externalJumpLog.groupBy({
    by: ['sourceName'],
    where: { createdAt: closedWindow ? { gte: closedWindow.from, lt: closedWindow.to } : { gte: daysAgoStart(now, JUMP_LOOKBACK_DAYS) } },
    _count: { _all: true },
    orderBy: { _count: { sourceName: 'desc' } },
    take: JUMP_SOURCE_GROUP_TAKE,
  })
  return rows.map((row) => ({ sourceName: row.sourceName, count: row._count._all }))
}

export async function loadFairSlice(
  prisma: PrismaService,
  now: Date,
  orgId?: PartnerOrgId,
): Promise<ScreenFairStructureValue> {
  const fairWhere = {
    ...PUBLISHED,
    ...sourceOrgFilter(orgId),
    startAt: { lte: now },
    endAt: { gte: now },
  }
  const [ongoingFairs, companies, zones, publishedMaterials] = await Promise.all([
    prisma.jobFair.count({ where: fairWhere }),
    prisma.fairCompany.count({ where: { jobFair: fairWhere } }),
    prisma.fairZone.count({ where: { jobFair: fairWhere } }),
    prisma.fairMaterial.count({
      where: { jobFair: fairWhere, deletedAt: null, publishStatus: 'published' },
    }),
  ])
  return {
    ongoingFairs,
    companies,
    zones,
    publishedMaterials,
    materialPrintCount: unavailableMetric(
      'FairMaterial.printCount',
      'cumulative',
      SCREEN_UNAVAILABLE_REASON.printCountNeverIncremented,
    ),
  }
}
