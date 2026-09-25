import {
  SCREEN_ONLINE_WINDOW_SECONDS,
  SCREEN_UNAVAILABLE_REASON,
  type ScreenTimelineState,
} from './console-screen.types'
import { isHealthyPrinterStatus } from '../terminals/printer-status'

/**
 * 24 小时内心跳行上限。超过则整段时间轴不可用，不返回被截断的半截。
 *
 * Agent 默认 30 秒一次（heartbeatIntervalMs ?? 30_000，服务端不下发覆盖），
 * 全天约 2,880 条。服务端仍可能下发更短间隔；按最短 10 秒计，全天 8,640 条。
 * 12,000 盖住这条下限，并给窗口起点前补入的 1 条、时钟抖动和短暂重连留约 40% 余量。
 * 2,000 会把最常见的「全天在线」直接判成不可用。查询只取 createdAt、printerStatus。
 */
export const TIMELINE_HEARTBEAT_ROW_CAP = 12_000
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
 * 把一条心跳窗口贴进已经按时间排好的分段。
 * 与上一窗口相交就延长；状态不同按 RANK 切开（高的盖住重叠部分）。
 * 窗口之间的缺口记为 gapState。只向前扫，心跳阶段不做全量 overlay。
 */
function applyHeartbeatWindow(
  segments: Seg[],
  windowStart: number,
  from: number,
  to: number,
  state: ScreenTimelineState,
  gapState: ScreenTimelineState,
): void {
  const lastEnd = segments.length === 0 ? windowStart : segments[segments.length - 1]!.to
  if (segments.length === 0 || lastEnd < from) {
    if (from > lastEnd) segments.push({ from: lastEnd, to: from, state: gapState })
    segments.push({ from, to, state })
    return
  }

  const rank = RANK[state]
  while (segments.length > 0) {
    const last = segments[segments.length - 1]!
    if (last.to <= from) break
    const lastRank = RANK[last.state]
    if (lastRank > rank) {
      if (to > last.to) segments.push({ from: last.to, to, state })
      return
    }
    if (last.from < from) {
      if (lastRank === rank) last.to = Math.max(last.to, to)
      else {
        last.to = from
        segments.push({ from, to, state })
      }
      return
    }
    segments.pop()
  }

  const prev = segments[segments.length - 1]
  if (prev && prev.state === state && prev.to >= from) prev.to = Math.max(prev.to, to)
  else segments.push({ from, to, state })
}

/**
 * 近 24 小时时间轴。
 * 心跳覆盖 [at, at+在线窗口]；窗口之间的缺口是 offline（从未有心跳则整段 unknown）。
 * 打印机异常心跳标 alert。printing 区间盖在最上面。相邻同状态合并。
 * 心跳按时间单遍扫描；打印区间数量少，最后逐段 overlay。
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
  const gapState: ScreenTimelineState = heartbeats.length > 0 ? 'offline' : 'unknown'
  const segments: Seg[] = []
  for (const heartbeat of heartbeats) {
    const at = heartbeat.at.getTime()
    const from = Math.max(at, windowStart)
    const to = Math.min(at + onlineWindowMs, nowMs)
    if (to <= from) continue
    const state: ScreenTimelineState = printerIssue(heartbeat.printerStatus) ? 'alert' : 'idle'
    applyHeartbeatWindow(segments, windowStart, from, to, state, gapState)
  }
  if (segments.length === 0) {
    segments.push({ from: windowStart, to: nowMs, state: gapState })
  } else {
    const tail = segments[segments.length - 1]!
    if (tail.to < nowMs) segments.push({ from: tail.to, to: nowMs, state: gapState })
  }
  let painted = segments
  for (const print of input.prints) {
    if (!(print.from instanceof Date) || !(print.to instanceof Date)) continue
    const from = Math.max(print.from.getTime(), windowStart)
    const to = Math.min(print.to.getTime(), nowMs)
    painted = overlay(painted, from, to, 'printing')
  }
  const merged = mergeAdjacent(painted)
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
