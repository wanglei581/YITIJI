import { NotFoundException } from '@nestjs/common'
import { buildDeviceFleetOverview } from '../device-fleet/device-fleet.projection'
import type { PrismaService } from '../prisma/prisma.service'
import { isHealthyPrinterStatus } from '../terminals/printer-status'
import {
  SCREEN_MIN_AGGREGATE_SAMPLE,
  SCREEN_ONLINE_WINDOW_SECONDS,
  SCREEN_UNAVAILABLE_REASON,
  type ScreenAudience,
  type ScreenTerminalTwin,
} from './console-screen.types'
import { isPrinterIssueStatus, printerFaultTitle, screenGeo } from './console-screen.fleet'
import { availableMetric, hoursAgo, shanghaiDayStart, unavailableMetric } from './console-screen.metric'
import {
  TIMELINE_HEARTBEAT_ROW_CAP,
  TIMELINE_PRINT_ROW_CAP,
  deriveTerminalTimeline,
  type TimelinePrintInterval,
} from './console-screen.timeline'

const ONLINE_WINDOW_MS = SCREEN_ONLINE_WINDOW_SECONDS * 1000
const PRINT_BUSY = ['claimed', 'printing'] as const
const SCAN_BUSY = ['waiting', 'matched'] as const
const WIRED = new Set(['connected', 'disconnected', 'unknown'])
const PRINT_END = new Set(['completed', 'failed', 'cancelled'])

/** 0 不指向任何人；1–4 能对上这一台机器上的单，不给数字。 */
export function suppressTerminalTodayCount(count: number): number | null {
  if (count <= 0) return 0
  if (count < SCREEN_MIN_AGGREGATE_SAMPLE) return null
  return count
}

export function terminalTwinNotFound(): NotFoundException {
  return new NotFoundException({
    error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' },
  })
}

function readPageCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100_000) return null
  return value
}

function readColorMode(value: unknown): 'bw' | 'color' | null {
  if (value === 'color') return 'color'
  if (value === 'black_white' || value === 'bw') return 'bw'
  return null
}

/** 只取出页数和色彩。其余键（文件名、用户、订单号）不进入返回值。 */
export function readCurrentTaskParams(paramsJson: string): {
  billablePages: number | null
  pages: number | null
  colorMode: 'bw' | 'color' | null
} {
  let raw: unknown
  try {
    raw = JSON.parse(paramsJson)
  } catch {
    return { billablePages: null, pages: null, colorMode: null }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { billablePages: null, pages: null, colorMode: null }
  }
  const record = raw as Record<string, unknown>
  return {
    billablePages: readPageCount(record['billablePages']),
    pages: readPageCount(record['pages']),
    colorMode: readColorMode(record['colorMode']),
  }
}

export function currentTaskPages(orderPages: number | null | undefined, paramsJson: string): number {
  if (typeof orderPages === 'number' && Number.isInteger(orderPages) && orderPages >= 0) return orderPages
  const parsed = readCurrentTaskParams(paramsJson)
  return parsed.billablePages ?? parsed.pages ?? 0
}

function printerState(input: {
  heartbeat: { createdAt: Date; printerStatus: string | null } | null
  now: Date
  printing: boolean
}): { state: 'ready' | 'printing' | 'error' | 'offline' | 'unknown'; errorLabel: string | null } {
  if (!input.heartbeat) return { state: 'unknown', errorLabel: null }
  const ageMs = input.now.getTime() - input.heartbeat.createdAt.getTime()
  if (ageMs > ONLINE_WINDOW_MS) return { state: 'offline', errorLabel: null }
  const status = input.heartbeat.printerStatus
  if (status === 'offline') return { state: 'offline', errorLabel: null }
  if (isPrinterIssueStatus(status)) {
    return { state: 'error', errorLabel: printerFaultTitle(status as string) }
  }
  if (input.printing) return { state: 'printing', errorLabel: null }
  if (isHealthyPrinterStatus(status)) return { state: 'ready', errorLabel: null }
  return { state: 'unknown', errorLabel: null }
}

function scannerState(scanning: boolean, scanInputHealth: string | null | undefined): {
  state: 'ready' | 'busy' | 'error' | 'unknown'
  label: string | null
} {
  if (scanning) return { state: 'busy', label: null }
  if (scanInputHealth === 'locked_out') return { state: 'error', label: '扫描暂不可用' }
  if (scanInputHealth === 'healthy') return { state: 'ready', label: null }
  return { state: 'unknown', label: null }
}

/**
 * 已结束任务的开区间不能画到 now。优先用 completedAt；没有就用最后一条日志。
 * 两者都不晚于开区间起点时不画这段，避免把截断的重试日志补成「打印到现在」。
 */
function finishedPrintEnd(
  task: { status: string; completedAt: Date | null },
  logs: ReadonlyArray<{ createdAt: Date }>,
  open: Date,
): Date | null {
  if (!PRINT_END.has(task.status)) return null
  if (task.completedAt instanceof Date && task.completedAt.getTime() > open.getTime()) return task.completedAt
  const last = logs[logs.length - 1]
  if (last && last.createdAt.getTime() > open.getTime()) return last.createdAt
  return null
}

function printingIntervals(
  tasks: Array<{
    status: string
    claimedAt: Date | null
    completedAt: Date | null
    createdAt: Date
    statusLogs: Array<{ toStatus: string; createdAt: Date }>
  }>,
  now: Date,
): TimelinePrintInterval[] {
  const intervals: TimelinePrintInterval[] = []
  for (const task of tasks) {
    const logs = [...task.statusLogs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    let open: Date | null = null
    let closed = false
    for (const log of logs) {
      if (log.toStatus === 'printing') {
        if (!open) open = log.createdAt
        continue
      }
      if (open && PRINT_END.has(log.toStatus)) {
        intervals.push({ from: open, to: log.createdAt })
        open = null
        closed = true
      }
    }
    if (open) {
      const end = finishedPrintEnd(task, logs, open)
      if (end) intervals.push({ from: open, to: end })
      else if (!PRINT_END.has(task.status)) intervals.push({ from: open, to: now })
    } else if (!closed && task.status === 'printing') {
      intervals.push({ from: task.claimedAt ?? task.createdAt, to: now })
    }
  }
  return intervals
}

export async function loadTerminalTwin(
  prisma: PrismaService,
  terminalId: string,
  audience: ScreenAudience,
  expectedOrgId: string | null,
  now: Date,
): Promise<ScreenTerminalTwin> {
  const terminal = await prisma.terminal.findUnique({
    where: { id: terminalId },
    select: {
      id: true,
      terminalCode: true,
      displayName: true,
      areaLabel: true,
      locationLabel: true,
      geoLat: true,
      geoLng: true,
      enabled: true,
      orgId: true,
    },
  })
  if (!terminal || (expectedOrgId !== null && terminal.orgId !== expectedOrgId)) {
    throw terminalTwinNotFound()
  }

  const since = hoursAgo(now, 24)
  const dayStart = shanghaiDayStart(now)
  const [
    heartbeat,
    capabilities,
    scanningCount,
    current,
    heartbeatRows,
    heartbeatBefore,
    printTasks,
    printPages,
    printTaskCount,
    scanCount,
    failedCount,
  ] = await Promise.all([
    prisma.terminalHeartbeat.findFirst({
      where: { terminalId },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        status: true,
        agentVersion: true,
        printerStatus: true,
        wiredNetworkStatus: true,
        scanInputHealth: true,
      },
    }),
    prisma.terminalCapability.findMany({
      where: { terminalId, capabilityKey: { in: ['color_print', 'duplex_print'] } },
      select: { capabilityKey: true, status: true },
    }),
    prisma.scanTask.count({ where: { terminalId, status: { in: [...SCAN_BUSY] } } }),
    prisma.printTask.findFirst({
      where: { terminalId, status: { in: [...PRINT_BUSY] } },
      orderBy: [{ status: 'desc' }, { claimedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        status: true,
        paramsJson: true,
        claimedAt: true,
        createdAt: true,
        order: { select: { billablePages: true } },
        statusLogs: {
          where: { toStatus: 'printing' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    prisma.terminalHeartbeat.findMany({
      where: { terminalId, createdAt: { gte: since, lte: now } },
      orderBy: { createdAt: 'asc' },
      take: TIMELINE_HEARTBEAT_ROW_CAP + 1,
      select: { createdAt: true, printerStatus: true },
    }),
    prisma.terminalHeartbeat.findFirst({
      where: { terminalId, createdAt: { lt: since } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, printerStatus: true },
    }),
    prisma.printTask.findMany({
      where: {
        terminalId,
        OR: [
          { status: 'printing' },
          { statusLogs: { some: { createdAt: { gte: since }, toStatus: { in: ['printing', 'completed', 'failed', 'cancelled'] } } } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: TIMELINE_PRINT_ROW_CAP + 1,
      select: {
        status: true,
        claimedAt: true,
        completedAt: true,
        createdAt: true,
        // 倒序取最近 20 条，重试风暴才不会把结尾的 completed/failed/cancelled 截掉。
        // 任务行已是终态时，printingIntervals 还会用 completedAt 收口，不用 now。
        statusLogs: {
          where: { toStatus: { in: ['printing', 'completed', 'failed', 'cancelled'] } },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { toStatus: true, createdAt: true },
        },
      },
    }),
    prisma.order.aggregate({
      where: { terminalId, payStatus: 'paid', billablePages: { not: null }, paidAt: { gte: dayStart } },
      _sum: { billablePages: true },
    }),
    prisma.printTask.count({ where: { terminalId, createdAt: { gte: dayStart } } }),
    prisma.scanTask.count({ where: { terminalId, createdAt: { gte: dayStart } } }),
    prisma.printTaskStatusLog.count({
      where: { toStatus: 'failed', createdAt: { gte: dayStart }, task: { terminalId } },
    }),
  ])

  const overview = buildDeviceFleetOverview(
    {
      terminals: [{
        id: terminal.id,
        terminalCode: terminal.terminalCode,
        displayName: terminal.displayName,
        locationLabel: terminal.locationLabel,
        enabled: terminal.enabled,
        org: null,
        heartbeats: heartbeat
          ? [{ status: heartbeat.status, agentVersion: heartbeat.agentVersion, createdAt: heartbeat.createdAt }]
          : [],
      }],
      screensaverConfigs: [],
      smartCampusConfigs: [],
      toolboxConfigs: [],
    },
    now,
  )
  const health = overview.terminals[0]?.health ?? 'unknown'
  const colorEnabled = capabilities.some((row) => row.capabilityKey === 'color_print' && row.status === 'available')
  const duplexEnabled = capabilities.some((row) => row.capabilityKey === 'duplex_print' && row.status === 'available')
  const device = printerState({ heartbeat, now, printing: current?.status === 'printing' })
  const wired = heartbeat?.wiredNetworkStatus
  const heartbeatCapped = heartbeatRows.length > TIMELINE_HEARTBEAT_ROW_CAP
  const printCapped = printTasks.length > TIMELINE_PRINT_ROW_CAP
  const timeline = deriveTerminalTimeline({
    now,
    heartbeats: [
      ...(heartbeatBefore ? [{ at: heartbeatBefore.createdAt, printerStatus: heartbeatBefore.printerStatus }] : []),
      ...heartbeatRows.slice(0, TIMELINE_HEARTBEAT_ROW_CAP).map((row) => ({
        at: row.createdAt,
        printerStatus: row.printerStatus,
      })),
    ],
    prints: printingIntervals(printTasks.slice(0, TIMELINE_PRINT_ROW_CAP), now),
    heartbeatRowCapExceeded: heartbeatCapped,
    printRowCapExceeded: printCapped,
  })
  const startedAt = current
    ? (current.statusLogs[0]?.createdAt ?? current.claimedAt ?? (current.status === 'printing' ? current.createdAt : null))
    : null
  const currentMetric = current
    ? availableMetric('PrintTask.status', 'current', {
        pages: currentTaskPages(current.order?.billablePages, current.paramsJson),
        colorMode: readCurrentTaskParams(current.paramsJson).colorMode,
        startedAt: startedAt ? startedAt.toISOString() : null,
      })
    : availableMetric('PrintTask.status', 'current', null)

  return {
    generatedAt: now.toISOString(),
    audience,
    terminal: {
      id: terminal.id,
      code: terminal.terminalCode,
      displayName: terminal.displayName,
      areaLabel: terminal.areaLabel,
      locationLabel: terminal.locationLabel,
      geo: screenGeo(terminal.geoLat, terminal.geoLng),
    },
    status: {
      health,
      lastHeartbeatAt: heartbeat ? heartbeat.createdAt.toISOString() : null,
      onlineWindowSeconds: SCREEN_ONLINE_WINDOW_SECONDS,
      agentVersion: heartbeat?.agentVersion ?? null,
      wiredNetwork: wired && WIRED.has(wired) ? wired : null,
    },
    printer: availableMetric('TerminalHeartbeat+TerminalCapability', 'current', {
      name: null,
      state: device.state,
      errorLabel: device.errorLabel,
      colorEnabled,
      duplexEnabled,
    }),
    scanner: availableMetric('TerminalHeartbeat+ScanTask', 'current', scannerState(scanningCount > 0, heartbeat?.scanInputHealth)),
    currentTask: currentMetric,
    today: {
      printPages: suppressTerminalTodayCount(printPages._sum.billablePages ?? 0),
      printTasks: suppressTerminalTodayCount(printTaskCount),
      scans: suppressTerminalTodayCount(scanCount),
      failed: suppressTerminalTodayCount(failedCount),
      visits: unavailableMetric('KioskSession', 'current', SCREEN_UNAVAILABLE_REASON.kioskSessionUnwritten),
    },
    consumables: unavailableMetric('TerminalHeartbeat', 'current', SCREEN_UNAVAILABLE_REASON.noConsumableOrGeo),
    timeline24h: timeline.ok
      ? availableMetric('TerminalHeartbeat+PrintTask', '24h', timeline.segments)
      : unavailableMetric('TerminalHeartbeat+PrintTask', '24h', timeline.reason),
  }
}
