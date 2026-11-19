/**
 * Terminal Agent and legacy heartbeat values that mean the printer is usable.
 * Unknown values remain non-healthy so that new or malformed fault states are
 * still visible to operations rather than silently downgraded.
 */
export const HEALTHY_PRINTER_STATUS_VALUES = ['ok', 'ready', 'idle'] as const
const HEALTHY_PRINTER_STATUSES = new Set<string>(HEALTHY_PRINTER_STATUS_VALUES)

export function isHealthyPrinterStatus(printerStatus: string | null | undefined): boolean {
  return printerStatus !== null && printerStatus !== undefined && HEALTHY_PRINTER_STATUSES.has(printerStatus)
}

/** 纸量偏低但仍可打印。这是预警，不是故障。 */
export function isLowPaperWarning(printerStatus: string | null | undefined): boolean {
  return printerStatus === 'low_paper'
}

/**
 * 计入故障次数和时长的打印机状态。
 * 纸张不足仍可打印，不算在这里；空值 / unknown 无法判断，也不算故障开始。
 */
export function isPrinterFaultStatus(printerStatus: string | null | undefined): boolean {
  return Boolean(printerStatus)
    && printerStatus !== 'unknown'
    && !isHealthyPrinterStatus(printerStatus)
    && !isLowPaperWarning(printerStatus)
}

/** 对外（公开只读的 printer-status）只给扫描输入是否可用这一档，不带原因码、恢复动作和路径。 */
export type PublicScanInputHealth = 'healthy' | 'locked_out' | 'unknown'

/**
 * Agent 心跳里的扫描输入状态 → 一体机公开接口里的那一档。
 * 老版本 Agent 不上报（null）原样给 null，让一体机写「读不到」；库里出现不认识的值一律当 unknown，不冒充 healthy。
 */
export function publicScanInputHealth(value: string | null | undefined): PublicScanInputHealth | null {
  if (value === null || value === undefined) return null
  return value === 'healthy' || value === 'locked_out' ? value : 'unknown'
}

/**
 * 屏上扫描：终端程序最近一次探测扫描仪的结果。心跳 DTO 与公开接口共用这一份取值。
 *   ready 能连上且空闲 / busy 正在被占用（如打印中）/ not_found 没找到扫描仪 / error 连接出错 / unknown 没探测成功。
 */
export const SCAN_DEVICE_HEALTHS = ['ready', 'busy', 'not_found', 'error', 'unknown'] as const
export type PublicScanDeviceHealth = (typeof SCAN_DEVICE_HEALTHS)[number]

/**
 * Agent 心跳里的扫描仪探测结果 → 一体机公开接口里的那一档（写法同 publicScanInputHealth）。
 * 老版本 Agent 不上报（null）原样给 null，让一体机写「读不到」；库里出现不认识的值一律当 unknown，
 * 不冒充 ready —— 一体机据此决定是否显示「在这块屏上开始扫描」，宁可灰掉也不能误开。
 */
export function publicScanDeviceHealth(value: string | null | undefined): PublicScanDeviceHealth | null {
  if (value === null || value === undefined) return null
  return (SCAN_DEVICE_HEALTHS as readonly string[]).includes(value) ? (value as PublicScanDeviceHealth) : 'unknown'
}

/** Win32 PrinterState 的卡纸位。与终端程序 printer-status-map 的 PAPER_JAM_BIT 同一位。 */
const WIN32_PAPER_JAM_BIT = 0x8

/**
 * 公开打印机状态要读的心跳列。
 * 列名留在本文件。管理服务只展开，队列列名不散进管理服务。
 */
export const KIOSK_PUBLIC_PRINTER_STATUS_SELECT = {
  printerStatus: true,
  printerQueueRawStatus: true,
} as const

/**
 * 公开 printer-status 给一体机用。
 * 心跳落库的 printerStatus 把卡纸并进 error（终端程序不改）。
 * 只有落库值已经是 error，且原始五列看得出卡纸（DetectedErrorState 为 8，或 PrinterState 带卡纸位），
 * 才把公开值改成 paper_jam。缺纸、离线、开盖、缺粉保持原值。原始串不放进公开响应。
 * 落库心跳不动，队列闸门仍按 error 处理。
 */
export function publicPrinterStatusForKiosk(
  printerStatus: string | null | undefined,
  rawStatus: string | null | undefined,
): string | null {
  if (printerStatus == null) return null
  if (printerStatus !== 'error') return printerStatus
  if (typeof rawStatus !== 'string') return printerStatus
  const raw = rawStatus.trim()
  if (!raw || raw === 'not_found' || raw === 'query_failed') return printerStatus
  const parts = raw.split(',')
  if (parts.length < 3) return printerStatus
  const detected = Number.parseInt(parts[1] ?? '', 10)
  if (detected === 8) return 'paper_jam'
  if (parts.length < 4) return printerStatus
  const stateText = parts[3] ?? ''
  if (stateText === '') return printerStatus
  const state = Number.parseInt(stateText, 10)
  if (!Number.isFinite(state)) return printerStatus
  if ((state & WIN32_PAPER_JAM_BIT) !== 0) return 'paper_jam'
  return printerStatus
}

/** 从一条心跳读出一体机公开状态。原始串只在这里用，不进响应。 */
export function publicPrinterStatusFromHeartbeat(
  heartbeat: {
    printerStatus?: string | null
    printerQueueRawStatus?: string | null
  } | null | undefined,
): string | null {
  return publicPrinterStatusForKiosk(heartbeat?.printerStatus, heartbeat?.printerQueueRawStatus)
}
