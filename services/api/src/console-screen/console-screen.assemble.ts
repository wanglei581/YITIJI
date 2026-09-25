import {
  ADMIN_GOV_METRIC_KEYS,
  ADMIN_OPS_METRIC_KEYS,
  PARTNER_METRIC_KEYS,
  SCREEN_JUMP_COPY,
  SCREEN_MIN_AGGREGATE_SAMPLE,
  SCREEN_UNAVAILABLE_REASON,
  type ScreenSourceEntryOpensValue,
  type AdminScreenProfile,
  type ScreenAlertsValue,
  type ScreenFairStructureValue,
  type ScreenMetricKey,
  type ScreenSnapshotMetrics,
} from './console-screen.types'
import {
  availableMetric,
  filterSourceEntryOpens,
  FLEET_SAMPLE_TAKE,
  unavailableMetric,
} from './console-screen.metric'
import type {
  AiSlice,
  ContentSlice,
  FleetSlice,
  JumpRow,
  PrintCumulativeSlice,
  PrintLiveSlice,
  SyncSlice,
} from './console-screen.queries'
import { mapFleetOverview } from './console-screen.queries'
import type { ScreenMetric } from './console-screen.types'

const MISSING_ORG = SCREEN_UNAVAILABLE_REASON.missingOrgIdOnAiAndOrders

export type SliceFailReason = typeof SCREEN_UNAVAILABLE_REASON.sourceQueryFailed
export type Loaded<T> =
  | { ok: true; value: T }
  | { ok: false; reason: SliceFailReason }

function fromLoaded<T, U>(
  loaded: Loaded<T>,
  source: string,
  window: string,
  project: (value: T) => U,
): ScreenMetric<U> {
  if (!loaded.ok) {
    return unavailableMetric(source, window, loaded.reason)
  }
  return availableMetric(source, window, project(loaded.value))
}

export function metricKeysFor(
  audience: 'admin' | 'partner',
  profile?: AdminScreenProfile,
): readonly ScreenMetricKey[] {
  if (audience === 'partner') return PARTNER_METRIC_KEYS
  return profile === 'ops' ? ADMIN_OPS_METRIC_KEYS : ADMIN_GOV_METRIC_KEYS
}

export function pickMetrics(
  keys: readonly ScreenMetricKey[],
  all: ScreenSnapshotMetrics,
): ScreenSnapshotMetrics {
  const out: ScreenSnapshotMetrics = {}
  for (const key of keys) {
    const metric = all[key]
    if (metric) Object.assign(out, { [key]: metric })
  }
  return out
}

export function assembleAdminMetrics(input: {
  fleet: Loaded<FleetSlice>
  content: Loaded<ContentSlice>
  printLive: Loaded<PrintLiveSlice>
  printCumulative: Loaded<PrintCumulativeSlice>
  ai: Loaded<AiSlice>
  sync: Loaded<SyncSlice>
  jumps: Loaded<JumpRow[]>
  fairs: Loaded<ScreenFairStructureValue>
  alerts?: Loaded<ScreenAlertsValue>
}): ScreenSnapshotMetrics {
  const fleet = input.fleet.ok
    ? mapFleetOverview(input.fleet.value.overview, input.fleet.value.cells, {
        matchedCount: input.fleet.value.matchedCount,
        truncated: input.fleet.value.truncated,
        sampleCap: FLEET_SAMPLE_TAKE,
      })
    : null
  const sourceOpens = input.jumps.ok
    ? (() => {
        const jump = filterSourceEntryOpens(input.jumps.value)
        const sourceOpensValue: ScreenSourceEntryOpensValue = {
          copy: SCREEN_JUMP_COPY,
          minSampleThreshold: SCREEN_MIN_AGGREGATE_SAMPLE,
          items: jump.items,
        }
        return jump.belowThreshold
          ? unavailableMetric<ScreenSourceEntryOpensValue>(
              'ExternalJumpLog.sourceName',
              '30d',
              SCREEN_UNAVAILABLE_REASON.sampleBelowThreshold,
            )
          : availableMetric('ExternalJumpLog.sourceName', '30d', sourceOpensValue)
      })()
    : unavailableMetric<ScreenSourceEntryOpensValue>(
        'ExternalJumpLog.sourceName',
        '30d',
        SCREEN_UNAVAILABLE_REASON.sourceQueryFailed,
      )
  return {
    terminalsOnline: fleet
      ? availableMetric('Terminal+TerminalHeartbeat / device-fleet', '180s', fleet.online)
      : unavailableMetric('Terminal+TerminalHeartbeat / device-fleet', '180s', SCREEN_UNAVAILABLE_REASON.sourceQueryFailed),
    fleetWall: fleet
      ? availableMetric('Terminal+TerminalHeartbeat / device-fleet', '180s', fleet.wall)
      : unavailableMetric('Terminal+TerminalHeartbeat / device-fleet', '180s', SCREEN_UNAVAILABLE_REASON.sourceQueryFailed),
    printPagesCumulative: fromLoaded(input.printCumulative, 'Order.payStatus=paid,billablePages', 'cumulative', (slice) => slice.pages),
    aiCallsCumulative: fromLoaded(input.ai, 'AiServiceLog.count', 'cumulative', (slice) => ({
      totalCalls: slice.totalCalls,
    })),
    jobsOnShelf: fromLoaded(input.content, 'Job approved+published+validThrough', 'current', (slice) => ({
      published: slice.jobsPublished,
      sourceOrgCount: slice.sourceOrgCount,
    })),
    contentInventory: fromLoaded(input.content, 'Job/JobFair/PolicyPost/CompanyProfile counts', 'current', (slice) => slice.inventory),
    aiBreakdown24h: fromLoaded(input.ai, 'AiServiceLog.groupBy(operation,status)', '24h', (slice) => ({
      byOperation: slice.byOperation,
      failedCalls: slice.windowFailed,
      totalCalls: slice.windowCalls,
    })),
    printTrend14d: !input.printCumulative.ok
      ? unavailableMetric('Order.payStatus=paid,paidAt+billablePages', '14d', SCREEN_UNAVAILABLE_REASON.sourceQueryFailed)
      : input.printCumulative.value.trend === 'capped'
        ? unavailableMetric('Order.payStatus=paid,paidAt+billablePages', '14d', SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded)
        : availableMetric('Order.payStatus=paid,paidAt+billablePages', '14d', input.printCumulative.value.trend),
    visitCount: unavailableMetric('KioskSession', 'current', SCREEN_UNAVAILABLE_REASON.kioskSessionUnwritten),
    suppliesAndMap: unavailableMetric('TerminalHeartbeat', 'current', SCREEN_UNAVAILABLE_REASON.noConsumableOrGeo),
    printInProgress: fromLoaded(input.printLive, 'PrintTask.status', 'current', (slice) => slice.inProgress),
    printFailedToday: fromLoaded(input.printLive, 'PrintTaskStatusLog.toStatus=failed', 'shanghai-day', (slice) => ({
      failed: slice.failedToday,
    })),
    pendingReview: fromLoaded(input.content, 'reviewStatus pending+reviewing', 'current', (slice) => slice.pending),
    aiSuccessRate24h: fromLoaded(input.ai, 'AiServiceLog.status', '24h', (slice) => ({
      total: slice.windowCalls,
      success: slice.windowSuccess,
      failed: slice.windowFailed,
      successRate: slice.windowCalls > 0
        ? Math.round((slice.windowSuccess / slice.windowCalls) * 1000) / 10
        : null,
    })),
    syncSuccessRate24h: fromLoaded(input.sync, 'SyncLog.result', '24h', (slice) => slice.rate),
    ...(input.alerts
      ? { alertsRealtime: fromLoaded(input.alerts, 'derived-alerts', 'current', (slice) => slice) }
      : {}),
    taskFlow24h: fromLoaded(input.printLive, 'PrintTask/ScanTask.groupBy(status)', '24h', (slice) => slice.taskFlow),
    sourceEntryOpensTop: sourceOpens,
    fairStructure: fromLoaded(input.fairs, 'FairCompany/FairZone/FairMaterial', 'ongoing', (slice) => slice),
    aiCost24h: fromLoaded(input.ai, 'AiServiceLog.estimatedCostCny', '24h', (slice) => ({
      estimatedCostCny: slice.estimatedCostCny,
      measuredCalls: slice.measuredCalls,
      unmeasuredCalls: slice.unmeasuredCalls,
      avgLatencyMs: slice.avgLatencyMs,
      tokenTotals: unavailableMetric('AiServiceLog.tokenUsageJson', '24h', SCREEN_UNAVAILABLE_REASON.tokenUsageNotNumeric),
      p95LatencyMs: unavailableMetric('AiServiceLog.latencyMs', '24h', SCREEN_UNAVAILABLE_REASON.percentileNotAggregated),
    })),
    reviewSlaAndOrgDimension: unavailableMetric(
      'ReviewDecision / Order.orgId / AiServiceLog.orgId',
      'current',
      SCREEN_UNAVAILABLE_REASON.reviewDecisionUnwritten,
    ),
  }
}

export function assemblePartnerMetrics(input: {
  fleet: Loaded<FleetSlice>
  content: Loaded<ContentSlice>
  sync: Loaded<SyncSlice>
  fairs: Loaded<ScreenFairStructureValue>
}): ScreenSnapshotMetrics {
  const fleet = input.fleet.ok
    ? mapFleetOverview(input.fleet.value.overview, input.fleet.value.cells, {
        matchedCount: input.fleet.value.matchedCount,
        truncated: input.fleet.value.truncated,
        sampleCap: FLEET_SAMPLE_TAKE,
      })
    : null
  const blocked = (source: string, reason: string) => unavailableMetric(source, 'current', reason)
  return {
    terminalsOnline: fleet
      ? availableMetric('Terminal+TerminalHeartbeat / device-fleet', '180s', fleet.online)
      : unavailableMetric('Terminal+TerminalHeartbeat / device-fleet', '180s', SCREEN_UNAVAILABLE_REASON.sourceQueryFailed),
    fleetWall: fleet
      ? availableMetric('Terminal+TerminalHeartbeat / device-fleet', '180s', fleet.wall)
      : unavailableMetric('Terminal+TerminalHeartbeat / device-fleet', '180s', SCREEN_UNAVAILABLE_REASON.sourceQueryFailed),
    jobsOnShelf: fromLoaded(input.content, 'Job approved+published+validThrough', 'current', (slice) => ({
      published: slice.jobsPublished,
      sourceOrgCount: slice.sourceOrgCount,
    })),
    contentInventory: fromLoaded(input.content, 'Job/JobFair/PolicyPost/CompanyProfile counts', 'current', (slice) => slice.inventory),
    pendingReview: fromLoaded(input.content, 'reviewStatus pending+reviewing', 'current', (slice) => slice.pending),
    syncSuccessRate24h: fromLoaded(input.sync, 'SyncLog.result', '24h', (slice) => slice.rate),
    fairStructure: fromLoaded(input.fairs, 'FairCompany/FairZone/FairMaterial', 'ongoing', (slice) => slice),
    printInProgress: blocked('PrintTask', MISSING_ORG),
    printFailedToday: blocked('PrintTask', MISSING_ORG),
    printPagesCumulative: blocked('Order', MISSING_ORG),
    printTrend14d: blocked('Order', MISSING_ORG),
    taskFlow24h: blocked('PrintTask/ScanTask', MISSING_ORG),
    aiCallsCumulative: blocked('AiServiceLog', MISSING_ORG),
    aiBreakdown24h: blocked('AiServiceLog', MISSING_ORG),
    aiSuccessRate24h: blocked('AiServiceLog', MISSING_ORG),
    aiCost24h: blocked('AiServiceLog', MISSING_ORG),
    alertsRealtime: blocked('derived-alerts', SCREEN_UNAVAILABLE_REASON.partnerAlertsUnscoped),
    sourceEntryOpensTop: blocked('ExternalJumpLog', SCREEN_UNAVAILABLE_REASON.missingImmutableSourceOrg),
    visitCount: blocked('KioskSession', SCREEN_UNAVAILABLE_REASON.kioskSessionUnwritten),
    suppliesAndMap: blocked('TerminalHeartbeat', SCREEN_UNAVAILABLE_REASON.noConsumableOrGeo),
    reviewSlaAndOrgDimension: blocked(
      'ReviewDecision / Order.orgId / AiServiceLog.orgId',
      SCREEN_UNAVAILABLE_REASON.reviewDecisionUnwritten,
    ),
  }
}
