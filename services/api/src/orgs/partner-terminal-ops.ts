// 机构端「终端数据」的纯聚合（GET /partner/terminal-operations）。
//
// 这里只做计算，不碰数据库；查询与机构隔离在 partner-stats.service.ts。
// 每条口径都写在对应函数上，门禁 verify:partner-stats-contract 逐条钉住。
//
// 响应只给终端编号、名称、摆放位置与机构级聚合，不带 orgId、终端内部 id、
// 任务 id、错误码或任何单据级字段。

import { suppressTerminalTodayCount } from '../console-screen/console-screen.twin'
import { isPrinterIssueStatus } from '../console-screen/console-screen.fleet'
import { isHealthyPrinterStatus } from '../terminals/printer-status'
import { TERMINAL_ONLINE_WINDOW_MS } from '../terminals/printer-availability'
import { SCREEN_MIN_AGGREGATE_SAMPLE, SCREEN_TIMEZONE } from '../console-screen/console-screen.types'
import type { StatsPeriod } from './partner-stats.service'

/** 最小样本：与数据大屏、/partner/stats 归因同一个 5。 */
export const TERMINAL_OPS_MIN_SAMPLE = SCREEN_MIN_AGGREGATE_SAMPLE

/** 相邻两条心跳间隔超过它就算离线；与在线判定、后台终端列表同一个 5 分钟窗口。 */
export const TERMINAL_OPS_OFFLINE_GAP_MS = TERMINAL_ONLINE_WINDOW_MS

export const AI_AVAILABILITY_UNAVAILABLE_REASON = 'ai_calls_not_attributed_to_terminal' as const

const MINUTE_MS = 60_000

export interface TerminalOpsHeartbeat {
  createdAt: Date
  printerStatus: string | null
}

/** 已结束打印任务按「终端 × 状态 × 核查结果 × 错误码」分组后的计数。 */
export interface SettledPrintGroup {
  status: string
  printOutcome: string | null
  errorCode: string | null
  count: number
}

export interface OutputRaw {
  printed: number
  settled: number
  unconfirmed: number
}

export interface FaultSegment {
  kind: 'offline' | 'printer'
  /** 已截到统计窗口内的起点 */
  start: number
  /** 恢复时间；未恢复时为 null（时长算到当前） */
  end: number | null
}

export interface FaultSummary {
  offlineCount: number
  offlineMinutes: number
  printerFaultCount: number
  printerFaultMinutes: number
  recoveredCount: number
  avgRecoveryMinutes: number | null
  longestMinutes: number | null
  unrecovered: boolean
  reportedInWindow: boolean
}

export interface TerminalOpsRaw {
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  lastHeartbeatAt: Date | null
  /** 服务人次：窗口内一体机会话数（KioskSession，机构快照为本机构）。 */
  visitCount: number
  serviceCount: number
  output: OutputRaw
  segments: FaultSegment[]
  reportedInWindow: boolean
}

/** 计数的小样本压制：0 保留，1–4 不给数字，≥5 原样。与数据大屏单台口径一致。 */
export function suppressCount(count: number): number | null {
  return suppressTerminalTodayCount(count)
}

/**
 * 出纸成功率。
 *   分母 = 统计窗口内结束（completedAt 在窗口）的 completed + failed；
 *   分子 = completed + 管理员现场核查为「已出纸」的 failed（printOutcome='printed'）；
 *   未确认 = failed 且 errorCode=PRINT_JOB_UNCONFIRMED 且还没核查（printOutcome 为 null）。
 * cancelled / abandoned / 未结束的任务不进入任何一项。一体机重试会把 failed 改回 pending
 * 并清空 completedAt，同一任务最终只按它最后一次结束计一次。
 */
export function summarizeOutput(groups: readonly SettledPrintGroup[]): OutputRaw {
  const out: OutputRaw = { printed: 0, settled: 0, unconfirmed: 0 }
  for (const group of groups) {
    if (group.status !== 'completed' && group.status !== 'failed') continue
    out.settled += group.count
    if (group.status === 'completed' || group.printOutcome === 'printed') out.printed += group.count
    if (group.status === 'failed' && group.errorCode === 'PRINT_JOB_UNCONFIRMED' && group.printOutcome === null) {
      out.unconfirmed += group.count
    }
  }
  return out
}

/** 分母不足最小样本时不给比率；比率按百分数保留一位小数。 */
export function successRate(output: OutputRaw): number | null {
  if (output.settled < TERMINAL_OPS_MIN_SAMPLE) return null
  return Math.round((output.printed / output.settled) * 1000) / 10
}

/**
 * 边读心跳边折叠出故障段，不把整段心跳留在内存里。
 *
 * 离线：相邻两条心跳间隔 > 5 分钟记一次离线，开始 = 前一条 + 5 分钟，恢复 = 后一条；
 *       最后一条之后超过 5 分钟仍没有心跳，算到当前、记为未恢复。
 *       窗口开始前最后一条心跳（seed）参与判断，所以跨窗口起点的离线也算得到；
 *       从未上报过的终端不推断离线（没装机和坏了分不开）。
 * 打印机故障：从第一条「异常」心跳开始，到其后第一条「正常」心跳结束；
 *       null / unknown 既不开始也不结束一段故障。
 * 所有时长都截到统计窗口 [from, now] 内。
 */
export class HeartbeatFolder {
  private readonly from: number
  private readonly now: number
  private readonly offlineGapMs: number
  private lastAt: number | null
  private printerFaultSince: number | null = null
  private sawInWindow = false
  readonly segments: FaultSegment[] = []

  constructor(input: {
    from: Date
    now: Date
    /** 窗口开始前最后一条心跳的时间 */
    seedAt: Date | null
    /** 窗口开始前最后一条「状态可判定」（非 null、非 unknown）的打印机状态 */
    seedPrinterStatus: string | null
    offlineGapMs?: number
  }) {
    this.from = input.from.getTime()
    this.now = input.now.getTime()
    this.offlineGapMs = input.offlineGapMs ?? TERMINAL_OPS_OFFLINE_GAP_MS
    this.lastAt = input.seedAt ? input.seedAt.getTime() : null
    if (isPrinterIssueStatus(input.seedPrinterStatus)) this.printerFaultSince = this.from
  }

  get lastHeartbeatAt(): Date | null {
    return this.lastAt === null ? null : new Date(this.lastAt)
  }

  get reportedInWindow(): boolean {
    return this.sawInWindow
  }

  /** 必须按 createdAt 升序喂入。 */
  push(heartbeat: TerminalOpsHeartbeat): void {
    const at = heartbeat.createdAt.getTime()
    this.sawInWindow = true
    if (this.lastAt !== null && at - this.lastAt > this.offlineGapMs) {
      this.addSegment('offline', this.lastAt + this.offlineGapMs, at)
    }
    this.lastAt = at

    const status = heartbeat.printerStatus
    if (this.printerFaultSince === null && isPrinterIssueStatus(status)) {
      this.printerFaultSince = at
    } else if (this.printerFaultSince !== null && isHealthyPrinterStatus(status)) {
      this.addSegment('printer', this.printerFaultSince, at)
      this.printerFaultSince = null
    }
  }

  finish(): FaultSegment[] {
    if (this.lastAt !== null && this.now - this.lastAt > this.offlineGapMs) {
      this.addSegment('offline', this.lastAt + this.offlineGapMs, null)
    }
    if (this.printerFaultSince !== null) {
      this.addSegment('printer', this.printerFaultSince, null)
      this.printerFaultSince = null
    }
    return this.segments
  }

  private addSegment(kind: FaultSegment['kind'], start: number, end: number | null): void {
    const clippedStart = Math.max(start, this.from)
    const clippedEnd = end === null ? this.now : Math.min(end, this.now)
    if (clippedEnd <= clippedStart) return
    this.segments.push({ kind, start: clippedStart, end })
  }
}

function segmentMs(segment: FaultSegment, now: number): number {
  return Math.max(0, (segment.end ?? now) - segment.start)
}

function minutes(ms: number): number {
  return Math.round(ms / MINUTE_MS)
}

/** 故障与恢复不压制：它说的是机器，不指向任何一位使用者。 */
export function summarizeFaults(
  segments: readonly FaultSegment[],
  now: Date,
  reportedInWindow: boolean,
): FaultSummary {
  const nowMs = now.getTime()
  let offlineCount = 0
  let offlineMs = 0
  let printerFaultCount = 0
  let printerMs = 0
  let longestMs: number | null = null
  const recovered: number[] = []
  let unrecovered = false
  for (const segment of segments) {
    const ms = segmentMs(segment, nowMs)
    if (segment.kind === 'offline') {
      offlineCount += 1
      offlineMs += ms
    } else {
      printerFaultCount += 1
      printerMs += ms
    }
    longestMs = longestMs === null ? ms : Math.max(longestMs, ms)
    if (segment.end === null) unrecovered = true
    else recovered.push(ms)
  }
  const avgMs = recovered.length > 0 ? recovered.reduce((sum, ms) => sum + ms, 0) / recovered.length : null
  return {
    offlineCount,
    offlineMinutes: minutes(offlineMs),
    printerFaultCount,
    printerFaultMinutes: minutes(printerMs),
    recoveredCount: recovered.length,
    avgRecoveryMinutes: avgMs === null ? null : Math.round((avgMs / MINUTE_MS) * 10) / 10,
    longestMinutes: longestMs === null ? null : minutes(longestMs),
    unrecovered,
    reportedInWindow,
  }
}

export function isOnlineAt(lastHeartbeatAt: Date | null, now: Date): boolean {
  return lastHeartbeatAt !== null && now.getTime() - lastHeartbeatAt.getTime() < TERMINAL_ONLINE_WINDOW_MS
}

function projectOutput(raw: OutputRaw) {
  return {
    printed: suppressCount(raw.printed),
    settled: suppressCount(raw.settled),
    successRate: successRate(raw),
    unconfirmed: suppressCount(raw.unconfirmed),
  }
}

export function projectTerminalRow(raw: TerminalOpsRaw, now: Date) {
  return {
    terminalCode: raw.terminalCode,
    displayName: raw.displayName,
    locationLabel: raw.locationLabel,
    online: isOnlineAt(raw.lastHeartbeatAt, now),
    lastHeartbeatAt: raw.lastHeartbeatAt ? raw.lastHeartbeatAt.toISOString() : null,
    visitCount: suppressCount(raw.visitCount),
    serviceCount: suppressCount(raw.serviceCount),
    output: projectOutput(raw.output),
    faults: summarizeFaults(raw.segments, now, raw.reportedInWindow),
  }
}

/** 合计先把原始计数求和、再压制与算比率；不拿各台压制后的数相加。 */
export function projectTotals(rows: readonly TerminalOpsRaw[], now: Date) {
  const output: OutputRaw = { printed: 0, settled: 0, unconfirmed: 0 }
  let serviceCount = 0
  let visitCount = 0
  const segments: FaultSegment[] = []
  let online = 0
  let unrecoveredTerminals = 0
  let silentTerminals = 0
  for (const row of rows) {
    serviceCount += row.serviceCount
    visitCount += row.visitCount
    output.printed += row.output.printed
    output.settled += row.output.settled
    output.unconfirmed += row.output.unconfirmed
    segments.push(...row.segments)
    if (isOnlineAt(row.lastHeartbeatAt, now)) online += 1
    if (row.segments.some((segment) => segment.end === null)) unrecoveredTerminals += 1
    if (!row.reportedInWindow) silentTerminals += 1
  }
  const faults = summarizeFaults(segments, now, rows.some((row) => row.reportedInWindow))
  return {
    terminalCount: rows.length,
    onlineTerminals: online,
    unrecoveredTerminals,
    silentTerminals,
    visitCount: suppressCount(visitCount),
    serviceCount: suppressCount(serviceCount),
    output: projectOutput(output),
    faults: {
      offlineCount: faults.offlineCount,
      offlineMinutes: faults.offlineMinutes,
      printerFaultCount: faults.printerFaultCount,
      printerFaultMinutes: faults.printerFaultMinutes,
      recoveredCount: faults.recoveredCount,
      avgRecoveryMinutes: faults.avgRecoveryMinutes,
      longestMinutes: faults.longestMinutes,
    },
  }
}

export type PartnerTerminalOpsRow = ReturnType<typeof projectTerminalRow>
export type PartnerTerminalOpsTotals = ReturnType<typeof projectTotals>

export interface PartnerTerminalOperations {
  period: StatsPeriod
  timezone: typeof SCREEN_TIMEZONE
  window: { from: string; to: string }
  generatedAt: string
  minSample: typeof TERMINAL_OPS_MIN_SAMPLE
  terminals: PartnerTerminalOpsRow[]
  totals: PartnerTerminalOpsTotals
  /**
   * 服务人次（一体机会话真写入起开始有数，此前的窗口会偏少）。
   * recordingStarted=false：本机构终端还没有任何会话记录（一体机上报尚未开始），
   * 页面显示「暂无」而不是 0。逐台与合计的数字在 terminals[].visitCount / totals.visitCount。
   */
  visitCount: { available: true; recordingStarted: boolean }
  aiAvailability: { available: false; reason: typeof AI_AVAILABILITY_UNAVAILABLE_REASON }
}

export function assembleTerminalOperations(input: {
  period: StatsPeriod
  from: Date
  now: Date
  rows: readonly TerminalOpsRaw[]
  visitRecordingStarted: boolean
}): PartnerTerminalOperations {
  return {
    period: input.period,
    timezone: SCREEN_TIMEZONE,
    window: { from: input.from.toISOString(), to: input.now.toISOString() },
    generatedAt: input.now.toISOString(),
    minSample: TERMINAL_OPS_MIN_SAMPLE,
    terminals: input.rows.map((row) => projectTerminalRow(row, input.now)),
    totals: projectTotals(input.rows, input.now),
    visitCount: { available: true, recordingStarted: input.visitRecordingStarted },
    aiAvailability: { available: false, reason: AI_AVAILABILITY_UNAVAILABLE_REASON },
  }
}
