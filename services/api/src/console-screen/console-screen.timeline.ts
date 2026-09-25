import {
  SCREEN_ONLINE_WINDOW_SECONDS,
  SCREEN_UNAVAILABLE_REASON,
  type ScreenTimelineState,
} from './console-screen.types'
import { isHealthyPrinterStatus } from '../terminals/printer-status'

export const TIMELINE_HEARTBEAT_ROW_CAP = 2_000
export const TIMELINE_PRINT_ROW_CAP = 500
/** 合并后的段数上限。超过则整段时间轴不可用，不返回被截断的半截。 */
export const TIMELINE_SEGMENT_CAP = 4_000

const HOUR_MS = 60 * 60 * 1000
const RANK: Record<ScreenTimelineState, number> = {
  unknown: 0,
  offline: 1,
  idle: 2,
  alert: 3,
  printing: 4,
}

export interface TimelineHeartbeat {
  at: Date
  printerStatus: string | null
}

export interface TimelinePrintInterval {
  from: Date
  to: Date
}

export interface TimelineSegment {
  from: string
  to: string
  state: ScreenTimelineState
}

export type TimelineDeriveResult =
  | { ok: true; segments: TimelineSegment[] }
  | { ok: false; reason: typeof SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded }

interface Seg {
  from: number
  to: number
  state: ScreenTimelineState
}

function printerIssue(status: string | null): boolean {
  return Boolean(status) && status !== 'unknown' && !isHealthyPrinterStatus(status)
}

function overlay(segments: Seg[], from: number, to: number, state: ScreenTimelineState): Seg[] {
  if (to <= from) return segments
  const rank = RANK[state]
  const next: Seg[] = []
  for (const seg of segments) {
    if (seg.to <= from || seg.from >= to) {
      next.push(seg)
      continue
    }
    if (seg.from < from) next.push({ from: seg.from, to: from, state: seg.state })
    const midFrom = Math.max(seg.from, from)
    const midTo = Math.min(seg.to, to)
    next.push({ from: midFrom, to: midTo, state: RANK[seg.state] > rank ? seg.state : state })
    if (seg.to > to) next.push({ from: to, to: seg.to, state: seg.state })
  }
  return next
}

function mergeAdjacent(segments: Seg[]): Seg[] {
  const sorted = segments.filter((seg) => seg.to > seg.from).sort((a, b) => a.from - b.from || a.to - b.to)
  const out: Seg[] = []
  for (const seg of sorted) {
    const last = out[out.length - 1]
    if (last && last.state === seg.state && last.to === seg.from) last.to = seg.to
    else out.push({ from: seg.from, to: seg.to, state: seg.state })
  }
  return out
}

/**
 * 近 24 小时时间轴。
 * 心跳覆盖 [at, at+在线窗口]；窗口之间的缺口是 offline（从未有心跳则整段 unknown）。
 * 打印机异常心跳标 alert。printing 区间盖在最上面。相邻同状态合并。
 */
export function deriveTerminalTimeline(input: {
  now: Date
  heartbeats: readonly TimelineHeartbeat[]
  prints: readonly TimelinePrintInterval[]
  heartbeatRowCapExceeded?: boolean
  printRowCapExceeded?: boolean
  segmentCap?: number
  onlineWindowMs?: number
}): TimelineDeriveResult {
  if (input.heartbeatRowCapExceeded || input.printRowCapExceeded) {
    return { ok: false, reason: SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded }
  }
  const nowMs = input.now.getTime()
  const windowStart = nowMs - 24 * HOUR_MS
  const onlineWindowMs = input.onlineWindowMs ?? SCREEN_ONLINE_WINDOW_SECONDS * 1000
  const segmentCap = input.segmentCap ?? TIMELINE_SEGMENT_CAP
  const heartbeats = input.heartbeats
    .filter((row) => row.at instanceof Date && Number.isFinite(row.at.getTime()) && row.at.getTime() <= nowMs)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  let segments: Seg[] = [{
    from: windowStart,
    to: nowMs,
    state: heartbeats.length > 0 ? 'offline' : 'unknown',
  }]
  for (const heartbeat of heartbeats) {
    const at = heartbeat.at.getTime()
    const from = Math.max(at, windowStart)
    const to = Math.min(at + onlineWindowMs, nowMs)
    const state: ScreenTimelineState = printerIssue(heartbeat.printerStatus) ? 'alert' : 'idle'
    segments = overlay(segments, from, to, state)
  }
  for (const print of input.prints) {
    if (!(print.from instanceof Date) || !(print.to instanceof Date)) continue
    const from = Math.max(print.from.getTime(), windowStart)
    const to = Math.min(print.to.getTime(), nowMs)
    segments = overlay(segments, from, to, 'printing')
  }
  const merged = mergeAdjacent(segments)
  if (merged.length > segmentCap) {
    return { ok: false, reason: SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded }
  }
  return {
    ok: true,
    segments: merged.map((seg) => ({
      from: new Date(seg.from).toISOString(),
      to: new Date(seg.to).toISOString(),
      state: seg.state,
    })),
  }
}
