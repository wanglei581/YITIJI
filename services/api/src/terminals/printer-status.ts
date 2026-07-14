/**
 * Terminal Agent and legacy heartbeat values that mean the printer is usable.
 * Unknown values remain non-healthy so that new or malformed fault states are
 * still visible to operations rather than silently downgraded.
 */
const HEALTHY_PRINTER_STATUSES = new Set(['ok', 'ready', 'idle'])

export function isHealthyPrinterStatus(printerStatus: string | null | undefined): boolean {
  return printerStatus !== null && printerStatus !== undefined && HEALTHY_PRINTER_STATUSES.has(printerStatus)
}
