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
  unavailableMetric,
} from './console-screen.metric'
import type { AiSlice, ContentSlice, JumpRow, PrintCumulativeSlice, PrintLiveSlice, SyncSlice } from './console-screen.queries'
import { mapFleetOverview } from './console-screen.queries'
import type { DeviceFleetOverview } from '../device-fleet/device-fleet.types'

const MISSING_ORG = SCREEN_UNAVAILABLE_REASON.missingOrgIdOnAiAndOrders

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
  fleet: DeviceFleetOverview
  content: ContentSlice
  printLive: PrintLiveSlice
  printCumulative: PrintCumulativeSlice
  ai: AiSlice
  sync: SyncSlice
  jumps: JumpRow[]
  fairs: ScreenFairStructureValue
  alerts: ScreenAlertsValue
}): ScreenSnapshotMetrics {
  const fleet = mapFleetOverview(input.fleet)
  const jump = filterSourceEntryOpens(input.jumps)
  const sourceOpensValue: ScreenSourceEntryOpensValue = {
    copy: SCREEN_JUMP_COPY,
    minSampleThreshold: SCREEN_MIN_AGGREGATE_SAMPLE,
    items: jump.items,
  }
  const sourceOpens = jump.belowThreshold
    ? unavailableMetric<ScreenSourceEntryOpensValue>(
        'ExternalJumpLog.sourceName',
        '30d',
        SCREEN_UNAVAILABLE_REASON.sampleBelowThreshold,
      )
    : availableMetric('ExternalJumpLog.sourceName', '30d', sourceOpensValue)
  return {
    terminalsOnline: availableMetric('Terminal+TerminalHeartbeat / device-fleet', '180s', fleet.online),
    fleetWall: availableMetric('Terminal+TerminalHeartbeat / device-fleet', '180s', fleet.wall),
    printPagesCumulative: availableMetric('Order.billablePages', 'cumulative', input.printCumulative.pages),
    aiCallsCumulative: availableMetric('AiServiceLog.count', 'cumulative', {
      totalCalls: input.ai.totalCalls,
    }),
    jobsOnShelf: availableMetric('Job approved+published+validThrough', 'current', {
      published: input.content.jobsPublished,
      sourceOrgCount: input.content.sourceOrgCount,
    }),
    contentInventory: availableMetric('Job/JobFair/PolicyPost/CompanyProfile counts', 'current', input.content.inventory),
    aiBreakdown24h: availableMetric('AiServiceLog.groupBy(operation,status)', '24h', {
      byOperation: input.ai.byOperation,
      failedCalls: input.ai.windowFailed,
      totalCalls: input.ai.windowCalls,
    }),
    printTrend14d: input.printCumulative.trend === 'capped'
      ? unavailableMetric('Order.createdAt+billablePages', '14d', SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded)
      : availableMetric('Order.createdAt+billablePages', '14d', input.printCumulative.trend),
    visitCount: unavailableMetric('KioskSession', 'current', SCREEN_UNAVAILABLE_REASON.kioskSessionUnwritten),
    suppliesAndMap: unavailableMetric('TerminalHeartbeat', 'current', SCREEN_UNAVAILABLE_REASON.noConsumableOrGeo),
    printInProgress: availableMetric('PrintTask.status', 'current', input.printLive.inProgress),
    printFailedToday: availableMetric('PrintTask.status=failed', 'shanghai-day', {
      failed: input.printLive.failedToday,
    }),
    pendingReview: availableMetric('reviewStatus pending+reviewing', 'current', input.content.pending),
    aiSuccessRate24h: availableMetric('AiServiceLog.status', '24h', {
      total: input.ai.windowCalls,
      success: input.ai.windowSuccess,
      failed: input.ai.windowFailed,
      successRate: input.ai.windowCalls > 0
        ? Math.round((input.ai.windowSuccess / input.ai.windowCalls) * 1000) / 10
        : null,
    }),
    syncSuccessRate24h: availableMetric('SyncLog.result', '24h', input.sync.rate),
    alertsRealtime: availableMetric('derived-alerts', 'current', input.alerts),
    taskFlow24h: availableMetric('PrintTask/ScanTask.groupBy(status)', '24h', input.printLive.taskFlow),
    sourceEntryOpensTop: sourceOpens,
    fairStructure: availableMetric('FairCompany/FairZone/FairMaterial', 'ongoing', input.fairs),
    aiCost24h: availableMetric('AiServiceLog.estimatedCostCny', '24h', {
      estimatedCostCny: input.ai.estimatedCostCny,
      measuredCalls: input.ai.measuredCalls,
      unmeasuredCalls: input.ai.unmeasuredCalls,
      avgLatencyMs: input.ai.avgLatencyMs,
      tokenTotals: unavailableMetric('AiServiceLog.tokenUsageJson', '24h', SCREEN_UNAVAILABLE_REASON.tokenUsageNotNumeric),
      p95LatencyMs: unavailableMetric('AiServiceLog.latencyMs', '24h', SCREEN_UNAVAILABLE_REASON.percentileNotAggregated),
    }),
    reviewSlaAndOrgDimension: unavailableMetric(
      'ReviewDecision / Order.orgId / AiServiceLog.orgId',
      'current',
      SCREEN_UNAVAILABLE_REASON.reviewDecisionUnwritten,
    ),
  }
}

export function assemblePartnerMetrics(input: {
  fleet: DeviceFleetOverview
  content: ContentSlice
  sync: SyncSlice
  fairs: ScreenFairStructureValue
}): ScreenSnapshotMetrics {
  const fleet = mapFleetOverview(input.fleet)
  const blocked = (source: string, reason: string) => unavailableMetric(source, 'current', reason)
  return {
    terminalsOnline: availableMetric('Terminal+TerminalHeartbeat / device-fleet', '180s', fleet.online),
    fleetWall: availableMetric('Terminal+TerminalHeartbeat / device-fleet', '180s', fleet.wall),
    jobsOnShelf: availableMetric('Job approved+published+validThrough', 'current', {
      published: input.content.jobsPublished,
      sourceOrgCount: input.content.sourceOrgCount,
    }),
    contentInventory: availableMetric('Job/JobFair/PolicyPost/CompanyProfile counts', 'current', input.content.inventory),
    pendingReview: availableMetric('reviewStatus pending+reviewing', 'current', input.content.pending),
    syncSuccessRate24h: availableMetric('SyncLog.result', '24h', input.sync.rate),
    fairStructure: availableMetric('FairCompany/FairZone/FairMaterial', 'ongoing', input.fairs),
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
