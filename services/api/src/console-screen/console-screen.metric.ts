import {
  SCREEN_CACHE_TTL_SECONDS,
  SCREEN_MIN_AGGREGATE_SAMPLE,
  SCREEN_ONLINE_WINDOW_SECONDS,
  SCREEN_TIMEZONE,
  SCREEN_UNAVAILABLE_REASON,
  type ScreenMetric,
  type ScreenSnapshotLimits,
  type ScreenSnapshotStatus,
  type ScreenSnapshotWindow,
  type ScreenSourceEntryOpenItem,
} from './console-screen.types'

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000
export const PRINT_TREND_DAY_COUNT = 14
export const PRINT_TREND_ROW_CAP = 20_000
export const PARTNER_FLEET_TAKE = 200
export const JUMP_SOURCE_GROUP_TAKE = 32
export const JUMP_LOOKBACK_DAYS = 30
export const ALERT_LIST_LIMIT = 20
const HOUR_MS = 60 * 60 * 1000

export function screenWindowMeta(): ScreenSnapshotWindow {
  return {
    timezone: SCREEN_TIMEZONE,
    onlineWindowSeconds: SCREEN_ONLINE_WINDOW_SECONDS,
    realtimeTtlSeconds: SCREEN_CACHE_TTL_SECONDS.realtime,
    countsTtlSeconds: SCREEN_CACHE_TTL_SECONDS.counts,
    cumulativeTtlSeconds: SCREEN_CACHE_TTL_SECONDS.cumulative,
  }
}

export function screenLimits(): ScreenSnapshotLimits {
  return {
    minAggregateSample: SCREEN_MIN_AGGREGATE_SAMPLE,
    displayToken: 'not_issued',
    displayTokenReason: SCREEN_UNAVAILABLE_REASON.displayTokenNotIssued,
    access: 'authenticated_console',
  }
}

export function snapshotLoadStatus(okCount: number, total: number): ScreenSnapshotStatus {
  if (total <= 0 || okCount === total) return 'ok'
  if (okCount <= 0) return 'unavailable'
  return 'degraded'
}

export function availableMetric<T>(
  source: string,
  window: string,
  value: T,
): ScreenMetric<T> {
  return { available: true, source, window, value }
}

export function unavailableMetric<T = never>(
  source: string,
  window: string,
  reason: string,
): ScreenMetric<T> {
  return { available: false, source, window, reason }
}

export function shanghaiDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MS)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - TZ_OFFSET_MS)
}

export function shanghaiDayKey(date: Date): string {
  return new Date(date.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

export function hoursAgo(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * HOUR_MS)
}

export function daysAgoStart(now: Date, days: number): Date {
  return new Date(shanghaiDayStart(now).getTime() - (days - 1) * 24 * HOUR_MS)
}

export function rateFromCounts(success: number, failed: number): number | null {
  const total = success + failed
  if (total <= 0) return null
  return Math.round((success / total) * 1000) / 10
}

export function filterSourceEntryOpens(
  rows: Array<{ sourceName: string | null; count: number }>,
): { belowThreshold: boolean; items: ScreenSourceEntryOpenItem[] } {
  const qualified = rows
    .filter((row) => typeof row.sourceName === 'string' && row.sourceName.length > 0)
    .filter((row) => row.count >= SCREEN_MIN_AGGREGATE_SAMPLE)
    .map((row) => ({ sourceName: row.sourceName as string, count: row.count }))
    .sort((a, b) => b.count - a.count || a.sourceName.localeCompare(b.sourceName))
    .slice(0, 5)
  const hadRows = rows.some((row) => (row.sourceName ?? '').length > 0 && row.count > 0)
  return {
    belowThreshold: hadRows && qualified.length === 0,
    items: qualified,
  }
}
