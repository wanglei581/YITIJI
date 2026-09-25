import { SCREEN_ONLINE_WINDOW_SECONDS, type ScreenFleetAlert, type ScreenFleetCell, type ScreenTerminalActivity } from './console-screen.types'
import type { DeviceFleetOverview } from '../device-fleet/device-fleet.types'
import type { PrismaService } from '../prisma/prisma.service'
import { isHealthyPrinterStatus } from '../terminals/printer-status'

const ONLINE_WINDOW_MS = SCREEN_ONLINE_WINDOW_SECONDS * 1000
const PRINT_BUSY = ['claimed', 'printing'] as const
const SCAN_BUSY = ['waiting', 'matched'] as const

const PRINTER_FAULT_TITLES: Record<string, string> = {
  paper_empty: '打印机缺纸',
  paper_jam: '打印机卡纸',
  jam: '打印机卡纸',
  offline: '打印机离线',
  error: '打印机故障',
  not_found: '未检测到打印机',
  toner_empty: '打印机缺墨',
  toner_low: '打印机墨粉不足',
}

export interface FleetTerminalRow {
  id: string
  terminalCode: string
  displayName: string | null
  areaLabel: string | null
  geoLat: number | null
  geoLng: number | null
  heartbeats: Array<{ createdAt: Date; printerStatus: string | null }>
}

export function screenGeo(lat: number | null | undefined, lng: number | null | undefined): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

export function isPrinterIssueStatus(status: string | null | undefined): boolean {
  return Boolean(status) && status !== 'unknown' && !isHealthyPrinterStatus(status)
}

export function printerFaultTitle(status: string): string {
  return PRINTER_FAULT_TITLES[status] ?? '打印机状态异常'
}

export function offlineAlertTitle(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 60) return `离线 ${Math.max(minutes, 1)} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `离线 ${hours} 小时`
  return `离线 ${Math.floor(hours / 24)} 天`
}

/** 无心跳 → 从未上报；超过 180 秒 → 离线；窗口内打印机异常 → 打印机问题。三者只留最重的一条。 */
export function fleetAlertForHeartbeat(
  heartbeat: { createdAt: Date; printerStatus: string | null } | undefined,
  now: Date,
): ScreenFleetAlert | null {
  if (!heartbeat) return { kind: 'never_reported', title: '从未上报', since: null }
  const ageMs = now.getTime() - heartbeat.createdAt.getTime()
  if (ageMs > ONLINE_WINDOW_MS) {
    return { kind: 'offline', title: offlineAlertTitle(ageMs), since: heartbeat.createdAt.toISOString() }
  }
  if (isPrinterIssueStatus(heartbeat.printerStatus)) {
    return {
      kind: 'printer_issue',
      title: printerFaultTitle(heartbeat.printerStatus as string),
      since: heartbeat.createdAt.toISOString(),
    }
  }
  return null
}

/**
 * 有进行中打印（含已领取未出纸）优先于扫描。
 * 180 秒内有心跳且没有任务 → idle（观察到空闲）。
 * 没有新鲜心跳、也没有进行中任务 → null（无当前活动观测）。
 */
export function fleetActivity(input: { fresh: boolean; printing: boolean; scanning: boolean }): ScreenTerminalActivity | null {
  if (input.printing) return 'printing'
  if (input.scanning) return 'scanning'
  if (input.fresh) return 'idle'
  return null
}

export async function loadFleetActivity(
  prisma: PrismaService,
  terminalIds: readonly string[],
): Promise<{ printing: Set<string>; scanning: Set<string> }> {
  if (terminalIds.length === 0) return { printing: new Set(), scanning: new Set() }
  const [printingRows, scanningRows] = await Promise.all([
    prisma.printTask.groupBy({
      by: ['terminalId'],
      where: { terminalId: { in: [...terminalIds] }, status: { in: [...PRINT_BUSY] } },
    }),
    prisma.scanTask.groupBy({
      by: ['terminalId'],
      where: { terminalId: { in: [...terminalIds] }, status: { in: [...SCAN_BUSY] } },
    }),
  ])
  return {
    printing: new Set(printingRows.flatMap((row) => (row.terminalId ? [row.terminalId] : []))),
    scanning: new Set(scanningRows.map((row) => row.terminalId)),
  }
}

export async function attachFleetCells(
  prisma: PrismaService,
  terminals: readonly FleetTerminalRow[],
  overview: DeviceFleetOverview,
  now: Date,
): Promise<ScreenFleetCell[]> {
  const activity = await loadFleetActivity(prisma, terminals.map((row) => row.id))
  const byCode = new Map(terminals.map((row) => [row.terminalCode, row]))
  const cells: ScreenFleetCell[] = []
  for (const item of overview.terminals) {
    const row = byCode.get(item.terminalCode)
    if (!row) continue
    const heartbeat = row.heartbeats[0]
    const fresh = Boolean(heartbeat) && now.getTime() - heartbeat.createdAt.getTime() <= ONLINE_WINDOW_MS
    cells.push({
      health: item.health,
      terminalId: row.id,
      terminalCode: row.terminalCode,
      displayName: row.displayName,
      areaLabel: row.areaLabel,
      geo: screenGeo(row.geoLat, row.geoLng),
      activity: fleetActivity({
        fresh,
        printing: activity.printing.has(row.id),
        scanning: activity.scanning.has(row.id),
      }),
      alert: fleetAlertForHeartbeat(heartbeat, now),
    })
  }
  return cells
}
