import { Injectable, Logger } from '@nestjs/common'
import {
  SCREEN_CACHE_TTL_SECONDS,
  SCREEN_UNAVAILABLE_REASON,
  type AdminScreenProfile,
  type ScreenAlertsValue,
  type ScreenSnapshot,
} from './console-screen.types'
import { AdminOpsService } from '../admin-ops/admin-ops.service'
import { DeviceFleetService } from '../device-fleet/device-fleet.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  assembleAdminMetrics,
  assemblePartnerMetrics,
  metricKeysFor,
  pickMetrics,
  type Loaded,
} from './console-screen.assemble'
import { ScreenSnapshotCache } from './console-screen.cache'
import { ALERT_LIST_LIMIT, screenLimits, screenWindowMeta, snapshotLoadStatus } from './console-screen.metric'
import {
  loadAiSlice,
  loadContentSlice,
  loadFairSlice,
  loadJumpRows,
  loadPartnerFleet,
  loadPrintCumulativeSlice,
  loadPrintLiveSlice,
  loadSyncSlice,
} from './console-screen.queries'

@Injectable()
export class ConsoleScreenService {
  private readonly logger = new Logger(ConsoleScreenService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly fleet: DeviceFleetService,
    private readonly ops: AdminOpsService,
    private readonly cache: ScreenSnapshotCache,
  ) {}

  async getAdminSnapshot(profile: AdminScreenProfile): Promise<ScreenSnapshot> {
    const now = new Date()
    const [realtime, counts, cumulative] = await Promise.all([
      this.cache.getOrLoad('admin:realtime', SCREEN_CACHE_TTL_SECONDS.realtime, () => this.loadAdminRealtime(now)),
      this.cache.getOrLoad('admin:counts', SCREEN_CACHE_TTL_SECONDS.counts, () => this.loadAdminCounts(now)),
      this.cache.getOrLoad('admin:cumulative', SCREEN_CACHE_TTL_SECONDS.cumulative, () => this.settle('printCumulative', () => loadPrintCumulativeSlice(this.prisma, now))),
    ])
    const all = assembleAdminMetrics({
      fleet: realtime.value.fleet,
      content: counts.value.content,
      printLive: realtime.value.printLive,
      printCumulative: cumulative.value,
      ai: counts.value.ai,
      sync: counts.value.sync,
      jumps: counts.value.jumps,
      fairs: counts.value.fairs,
      alerts: realtime.value.alerts,
    })
    const loadFlags = [
      realtime.value.fleet.ok,
      realtime.value.alerts.ok,
      realtime.value.printLive.ok,
      counts.value.content.ok,
      counts.value.ai.ok,
      counts.value.sync.ok,
      counts.value.jumps.ok,
      counts.value.fairs.ok,
      cumulative.value.ok,
    ]
    const okCount = loadFlags.filter(Boolean).length
    const status = snapshotLoadStatus(okCount, loadFlags.length)
    return {
      generatedAt: new Date(Math.min(realtime.storedAt, counts.storedAt, cumulative.storedAt)).toISOString(),
      audience: 'admin',
      profile,
      status,
      degraded: status !== 'ok',
      window: screenWindowMeta(),
      limits: screenLimits(),
      freshness: {
        realtime: realtime.hit ? 'hit' : 'miss',
        counts: counts.hit ? 'hit' : 'miss',
        cumulative: cumulative.hit ? 'hit' : 'miss',
      },
      metrics: pickMetrics(metricKeysFor('admin', profile), all),
    }
  }

  async getPartnerSnapshot(orgId: string): Promise<ScreenSnapshot> {
    const now = new Date()
    const [realtime, counts] = await Promise.all([
      this.cache.getOrLoad(
        `partner:${orgId}:realtime`,
        SCREEN_CACHE_TTL_SECONDS.realtime,
        () => this.settle('partnerFleet', () => loadPartnerFleet(this.prisma, now, orgId)),
      ),
      this.cache.getOrLoad(`partner:${orgId}:counts`, SCREEN_CACHE_TTL_SECONDS.counts, async () => {
        const [content, sync, fairs] = await Promise.all([
          this.settle('partnerContent', () => loadContentSlice(this.prisma, now, orgId)),
          this.settle('partnerSync', () => loadSyncSlice(this.prisma, now, orgId)),
          this.settle('partnerFairs', () => loadFairSlice(this.prisma, now, orgId)),
        ])
        return { content, sync, fairs }
      }),
    ])
    const all = assemblePartnerMetrics({
      fleet: realtime.value,
      content: counts.value.content,
      sync: counts.value.sync,
      fairs: counts.value.fairs,
    })
    const loadFlags = [
      realtime.value.ok,
      counts.value.content.ok,
      counts.value.sync.ok,
      counts.value.fairs.ok,
    ]
    const okCount = loadFlags.filter(Boolean).length
    const status = snapshotLoadStatus(okCount, loadFlags.length)
    return {
      generatedAt: new Date(Math.min(realtime.storedAt, counts.storedAt)).toISOString(),
      audience: 'partner',
      profile: 'partner',
      status,
      degraded: status !== 'ok',
      window: screenWindowMeta(),
      limits: screenLimits(),
      freshness: {
        realtime: realtime.hit ? 'hit' : 'miss',
        counts: counts.hit ? 'hit' : 'miss',
      },
      metrics: pickMetrics(metricKeysFor('partner'), all),
    }
  }

  private async settle<T>(slice: string, load: () => Promise<T>): Promise<Loaded<T>> {
    try {
      return { ok: true, value: await load() }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError'
      this.logger.warn(
        `console_screen_slice_failed slice=${slice} reason=${SCREEN_UNAVAILABLE_REASON.sourceQueryFailed} errorName=${errorName}`,
      )
      return { ok: false, reason: SCREEN_UNAVAILABLE_REASON.sourceQueryFailed }
    }
  }

  private async loadAdminRealtime(now: Date) {
    const [fleet, alertsResult, printLive] = await Promise.all([
      this.settle('adminFleet', () => this.fleet.getOverview()),
      this.settle('adminAlerts', () => this.ops.listDerivedAlerts('open', ALERT_LIST_LIMIT)),
      this.settle('adminPrintLive', () => loadPrintLiveSlice(this.prisma, now)),
    ])
    const alerts: Loaded<ScreenAlertsValue> = alertsResult.ok
      ? {
          ok: true,
          value: {
            firingCount: alertsResult.value.firingCount,
            listedCount: alertsResult.value.listedCount,
            truncated: alertsResult.value.truncated,
            items: alertsResult.value.data.map((item) => ({
              type: item.type,
              severity: item.severity,
              title: item.title,
              occurredAt: item.occurredAt,
              terminalCode: item.terminalCode,
            })),
          },
        }
      : { ok: false, reason: alertsResult.reason }
    return { fleet, alerts, printLive }
  }

  private async loadAdminCounts(now: Date) {
    const [content, ai, sync, jumps, fairs] = await Promise.all([
      this.settle('adminContent', () => loadContentSlice(this.prisma, now)),
      this.settle('adminAi', () => loadAiSlice(this.prisma, now)),
      this.settle('adminSync', () => loadSyncSlice(this.prisma, now)),
      this.settle('adminJumps', () => loadJumpRows(this.prisma, now)),
      this.settle('adminFairs', () => loadFairSlice(this.prisma, now)),
    ])
    return { content, ai, sync, jumps, fairs }
  }
}
