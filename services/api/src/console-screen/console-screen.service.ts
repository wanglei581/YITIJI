import { Injectable } from '@nestjs/common'
import {
  SCREEN_CACHE_TTL_SECONDS,
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
} from './console-screen.assemble'
import { ScreenSnapshotCache } from './console-screen.cache'
import { ALERT_LIST_LIMIT, screenLimits, screenWindowMeta } from './console-screen.metric'
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
      this.cache.getOrLoad('admin:cumulative', SCREEN_CACHE_TTL_SECONDS.cumulative, () => loadPrintCumulativeSlice(this.prisma, now)),
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
    return {
      generatedAt: new Date(Math.min(realtime.storedAt, counts.storedAt, cumulative.storedAt)).toISOString(),
      audience: 'admin',
      profile,
      window: screenWindowMeta(),
      limits: screenLimits(),
      metrics: pickMetrics(metricKeysFor('admin', profile), all),
    }
  }

  async getPartnerSnapshot(orgId: string): Promise<ScreenSnapshot> {
    const now = new Date()
    const [realtime, counts] = await Promise.all([
      this.cache.getOrLoad(
        `partner:${orgId}:realtime`,
        SCREEN_CACHE_TTL_SECONDS.realtime,
        () => loadPartnerFleet(this.prisma, now, orgId),
      ),
      this.cache.getOrLoad(`partner:${orgId}:counts`, SCREEN_CACHE_TTL_SECONDS.counts, async () => {
        const [content, sync, fairs] = await Promise.all([
          loadContentSlice(this.prisma, now, orgId),
          loadSyncSlice(this.prisma, now, orgId),
          loadFairSlice(this.prisma, now, orgId),
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
    return {
      generatedAt: new Date(Math.min(realtime.storedAt, counts.storedAt)).toISOString(),
      audience: 'partner',
      profile: 'partner',
      window: screenWindowMeta(),
      limits: screenLimits(),
      metrics: pickMetrics(metricKeysFor('partner'), all),
    }
  }

  private async loadAdminRealtime(now: Date) {
    const [fleet, alertsResult, printLive] = await Promise.all([
      this.fleet.getOverview(),
      this.ops.listDerivedAlerts('open', ALERT_LIST_LIMIT),
      loadPrintLiveSlice(this.prisma, now),
    ])
    const alerts: ScreenAlertsValue = {
      firingCount: alertsResult.firingCount,
      listedCount: alertsResult.listedCount,
      truncated: alertsResult.truncated,
      items: alertsResult.data.map((item) => ({
        type: item.type,
        severity: item.severity,
        title: item.title,
        occurredAt: item.occurredAt,
        terminalCode: item.terminalCode,
      })),
    }
    return { fleet, alerts, printLive }
  }

  private async loadAdminCounts(now: Date) {
    const [content, ai, sync, jumps, fairs] = await Promise.all([
      loadContentSlice(this.prisma, now),
      loadAiSlice(this.prisma, now),
      loadSyncSlice(this.prisma, now),
      loadJumpRows(this.prisma, now),
      loadFairSlice(this.prisma, now),
    ])
    return { content, ai, sync, jumps, fairs }
  }
}
