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
