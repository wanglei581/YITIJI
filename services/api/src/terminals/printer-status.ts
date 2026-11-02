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
