import type { PrismaService } from '../prisma/prisma.service'
import { TERMINAL_ONLINE_WINDOW_MS } from '../terminals/printer-availability'
import { buildSubjectKey, scanDeviceIssueEpisodeToken } from './derived-alert-identity'

export const SCAN_DEVICE_ISSUE = 'scan_device_issue' as const

/** 只有这两种要告警。ready / busy / unknown / null 都不算故障。 */
const SCAN_DEVICE_FAULT_HEALTH = ['not_found', 'error'] as const
type ScanDeviceFaultHealth = (typeof SCAN_DEVICE_FAULT_HEALTH)[number]

export interface ScanDeviceAlert {
  id: string
  subjectKey: string
  subjectId: string
  episodeToken: string
  type: typeof SCAN_DEVICE_ISSUE
  severity: 'error'
  title: string
  detail: string
  terminalCode: string | null
  occurredAt: string
}

function isFaultHealth(value: string | null | undefined): value is ScanDeviceFaultHealth {
  return value === 'not_found' || value === 'error'
}

function faultTitle(terminalCode: string, health: ScanDeviceFaultHealth): string {
  return health === 'not_found'
    ? `终端 ${terminalCode} 扫描仪找不到`
    : `终端 ${terminalCode} 扫描仪出错`
}

function faultDetail(health: ScanDeviceFaultHealth): string {
  return health === 'not_found'
    ? '终端在线，已开通屏上扫描，最近一次心跳报扫描仪找不到。屏上扫描暂时不可用。'
    : '终端在线，已开通屏上扫描，最近一次心跳报扫描仪出错。屏上扫描暂时不可用。'
}

/**
 * 扫描仪告警。和打印机异常同一条心跳通道：不写 Alert 行，每次列表现算。
 * 终端范围与离线、打印机告警一致：只算 enabled 且 lifecycleStatus 为 active 的终端。
 * 停用、计划中、调试中、维护中、已暂停、已退役的机器不算。
 * 其余三个条件照旧：scan_device 已开通（available）、最近一条心跳仍在在线窗口内、
 * scanDeviceHealth 为 not_found 或 error。恢复后下一次收集就没有这条，去重键是 type:终端 id。
 * 可以和打印机异常同时存在（subjectKey 不同）。
 * 不放进 terminalSubjectKeysInScope：推送「已恢复」仍只有离线和打印机。
 */
export async function collectScanDeviceAlerts(prisma: PrismaService, now: Date): Promise<ScanDeviceAlert[]> {
  const caps = await prisma.terminalCapability.findMany({
    where: { capabilityKey: 'scan_device', status: 'available' },
    select: { terminalId: true },
  })
  if (caps.length === 0) return []

  const terminals = await prisma.terminal.findMany({
    where: {
      id: { in: caps.map((cap) => cap.terminalId) },
      enabled: true,
      lifecycleStatus: 'active',
    },
    select: {
      id: true,
      terminalCode: true,
      registeredAt: true,
      heartbeats: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true, scanDeviceHealth: true },
      },
    },
  })

  const nowMs = now.getTime()
  const faults: Array<{ id: string; terminalCode: string; registeredAt: Date; health: ScanDeviceFaultHealth; seenAt: Date }> = []
  for (const terminal of terminals) {
    const heartbeat = terminal.heartbeats[0]
    if (!heartbeat || !isFaultHealth(heartbeat.scanDeviceHealth)) continue
    if (nowMs - heartbeat.createdAt.getTime() >= TERMINAL_ONLINE_WINDOW_MS) continue
    faults.push({
      id: terminal.id,
      terminalCode: terminal.terminalCode,
      registeredAt: terminal.registeredAt,
      health: heartbeat.scanDeviceHealth,
      seenAt: heartbeat.createdAt,
    })
  }
  if (faults.length === 0) return []

  const grouped = await prisma.terminalHeartbeat.groupBy({
    by: ['terminalId'],
    where: {
      terminalId: { in: faults.map((fault) => fault.id) },
      OR: [
        { scanDeviceHealth: null },
        { scanDeviceHealth: { notIn: [...SCAN_DEVICE_FAULT_HEALTH] } },
      ],
    },
    _max: { createdAt: true },
  })
  const lastClearAt = new Map<string, Date>()
  for (const row of grouped) {
    if (row._max.createdAt) lastClearAt.set(row.terminalId, row._max.createdAt)
  }

  return faults.map((fault) => {
    const subjectKey = buildSubjectKey(SCAN_DEVICE_ISSUE, fault.id)
    const clearAt = lastClearAt.get(fault.id) ?? fault.registeredAt
    return {
      id: subjectKey,
      subjectKey,
      subjectId: fault.id,
      episodeToken: scanDeviceIssueEpisodeToken(fault.health, clearAt),
      type: SCAN_DEVICE_ISSUE,
      severity: 'error' as const,
      title: faultTitle(fault.terminalCode, fault.health),
      detail: faultDetail(fault.health),
      terminalCode: fault.terminalCode,
      occurredAt: fault.seenAt.toISOString(),
    }
  })
}

/** 正向查证走同一条收集，因此同样只认运营中的终端。 */
export async function resolveScanDeviceAlert(
  prisma: PrismaService,
  subjectId: string,
  now: Date,
): Promise<ScanDeviceAlert | null> {
  const alerts = await collectScanDeviceAlerts(prisma, now)
  return alerts.find((alert) => alert.subjectId === subjectId) ?? null
}
