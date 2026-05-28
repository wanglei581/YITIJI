/**
 * agent/wmi.ts — Phase 8.2B
 *
 * Windows WMI queries via PowerShell for real hardware status.
 * Returns safe fallback values on non-Windows (macOS dev environment).
 *
 * Win32_Printer.PrinterStatus reference:
 *   3 = Idle (normal)  |  7 = Offline
 *
 * Win32_Printer.DetectedErrorState reference:
 *   0 = Unknown  |  2 = No Error  |  3 = Low Paper  |  4 = No Paper
 *   5 = Low Toner  |  6 = No Toner  |  7 = Door Open  |  8 = Jammed  |  9 = Offline
 *
 * Mapping to PrinterStatus:
 *   PrinterStatus=7 or DetectedErrorState=9      → 'offline'
 *   DetectedErrorState=4,6,7,8 (fatal errors)    → 'error'
 *   DetectedErrorState=3,5 (recoverable warnings) → 'low_paper'
 *   DetectedErrorState=2 or 0 (normal)            → 'ready'
 *   anything else / query failure                 → 'unknown'
 */

import { spawnSync } from 'child_process'
import { warn } from '../logger'
import type { PrinterStatus } from './types'

// ── PowerShell runner ─────────────────────────────────────────────────────────

function runPowerShell(script: string, timeoutMs = 8_000): string | null {
  if (process.platform !== 'win32') return null

  const result = spawnSync('powershell', ['-NonInteractive', '-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: timeoutMs,
  })

  if (result.error || result.status !== 0) {
    warn(`wmi: PowerShell error — ${result.error?.message ?? (result.stderr as string).trim()}`)
    return null
  }

  const out = (result.stdout as string).trim()
  return out || null
}

// ── Printer status ────────────────────────────────────────────────────────────

/**
 * Query Win32_Printer via WMI and map to PrinterStatus.
 * Escapes single quotes in the printer name to prevent PowerShell injection.
 * Returns 'unknown' on non-Windows or if the query fails / printer not found.
 */
export function getPrinterStatus(printerName: string): PrinterStatus {
  if (process.platform !== 'win32') return 'unknown'

  // Escape single quotes for PowerShell string literal
  const safeName = printerName.replace(/'/g, "''")
  const script =
    `$p = Get-CimInstance -ClassName Win32_Printer -Filter "Name='${safeName}'" -ErrorAction SilentlyContinue; ` +
    `if ($p) { "$($p.PrinterStatus),$($p.DetectedErrorState)" } else { "not_found" }`

  const output = runPowerShell(script)
  if (!output || output === 'not_found') return 'unknown'

  const [statusStr, errorStr] = output.split(',')
  const printerStatusCode = parseInt(statusStr ?? '', 10)
  const detectedError = parseInt(errorStr ?? '', 10)

  if (isNaN(printerStatusCode) || isNaN(detectedError)) return 'unknown'

  // Offline
  if (printerStatusCode === 7 || detectedError === 9) return 'offline'
  // Fatal hardware errors (no paper, no toner, door open, jammed)
  if (detectedError === 4 || detectedError === 6 || detectedError === 7 || detectedError === 8) {
    return 'error'
  }
  // Recoverable warnings (low paper, low toner)
  if (detectedError === 3 || detectedError === 5) return 'low_paper'
  // Normal (no error or unknown error = 0/2 = assume ok)
  if (detectedError === 0 || detectedError === 2) return 'ready'

  return 'unknown'
}

// ── Disk free space ───────────────────────────────────────────────────────────

/**
 * Query free space on drive C: in GB (rounded to 2 decimal places).
 * Returns -1 on non-Windows or if the query fails.
 */
export function getDiskFreeGB(): number {
  if (process.platform !== 'win32') return -1

  const script =
    `try { [math]::Round((Get-PSDrive -Name C -ErrorAction Stop).Free / 1GB, 2) } catch { -1 }`

  const output = runPowerShell(script)
  if (!output) return -1

  const val = parseFloat(output)
  return isNaN(val) ? -1 : val
}
