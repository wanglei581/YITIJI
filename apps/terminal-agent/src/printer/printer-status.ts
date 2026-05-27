import { execSync } from 'child_process'
import { PrinterInfo } from './types'
import { warn } from '../logger'

/**
 * Uses PowerShell Get-Printer to enumerate all installed printers.
 * Returns [] if PowerShell fails (non-Windows or no printers).
 */
export function listPrinters(): PrinterInfo[] {
  const ps =
    'Get-Printer | Select-Object Name, PrinterStatus | ConvertTo-Json -Compress'
  try {
    const raw = execSync(`powershell -NonInteractive -Command "${ps}"`, {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim()

    if (!raw) return []

    // Get-Printer returns an object (not array) when only one printer exists
    const parsed: unknown = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : [parsed]

    return list
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .map((p) => ({
        name: String(p['Name'] ?? ''),
        status: String(p['PrinterStatus'] ?? 'Unknown'),
      }))
      .filter((p) => p.name.length > 0)
  } catch (e) {
    warn(`listPrinters failed: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

/**
 * Case-insensitive check whether a printer name is installed.
 */
export function checkPrinterExists(printerName: string): boolean {
  const printers = listPrinters()
  const target = printerName.toLowerCase()
  return printers.some((p) => p.name.toLowerCase() === target)
}
