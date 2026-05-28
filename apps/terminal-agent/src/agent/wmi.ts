/**
 * agent/wmi.ts — Phase 8.2B (async rewrite)
 *
 * Windows WMI queries via PowerShell for real hardware status.
 * All queries are async (spawn, not spawnSync) so they never block the
 * Node.js event loop. Heartbeat setInterval can overlap calls safely.
 *
 * printerName is passed via stdin to PowerShell to prevent injection —
 * characters like ", ', `, $, () in the name never touch the PS parser.
 *
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
 *   PrinterStatus=7 or DetectedErrorState=9       → 'offline'
 *   DetectedErrorState=4,6,7,8 (fatal errors)     → 'error'
 *   DetectedErrorState=3,5 (recoverable warnings)  → 'low_paper'
 *   DetectedErrorState=2 or 0 (normal)             → 'ready'
 *   anything else / query failure                  → 'unknown'
 */

import { spawn } from 'child_process'
import { warn } from '../logger'
import type { PrinterStatus } from './types'

// ── Async PowerShell runner ───────────────────────────────────────────────────

function runPowerShell(script: string, stdin?: string, timeoutMs = 8_000): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null)
      return
    }

    const child = spawn('powershell', ['-NonInteractive', '-NoProfile', '-Command', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
      warn(`wmi: PowerShell timed out after ${timeoutMs}ms`)
      resolve(null)
    }, timeoutMs)

    if (stdin !== undefined) {
      child.stdin.end(stdin, 'utf8')
    } else {
      child.stdin.end()
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return
      if (code !== 0) {
        warn(`wmi: PowerShell exited with code ${code ?? 'null'}`)
        resolve(null)
        return
      }
      const out = stdout.trim()
      resolve(out || null)
    })

    child.on('error', (e) => {
      clearTimeout(timer)
      if (timedOut) return
      warn(`wmi: PowerShell spawn error — ${e.message}`)
      resolve(null)
    })
  })
}

// ── Printer status ────────────────────────────────────────────────────────────

/**
 * Query Win32_Printer via WMI and map to PrinterStatus.
 * printerName is passed via stdin — safe against all PS special characters.
 * Returns 'unknown' on non-Windows or if the query fails / printer not found.
 */
export async function getPrinterStatus(printerName: string): Promise<PrinterStatus> {
  if (process.platform !== 'win32') return 'unknown'

  const script =
    `$name = [Console]::In.ReadLine(); ` +
    `$p = Get-CimInstance -ClassName Win32_Printer -Filter "Name='$($name.Replace(\"'\", \"''\"))'" -ErrorAction SilentlyContinue; ` +
    `if ($p) { "$($p.PrinterStatus),$($p.DetectedErrorState)" } else { "not_found" }`

  const output = await runPowerShell(script, printerName)
  if (!output || output === 'not_found') return 'unknown'

  const [statusStr, errorStr] = output.split(',')
  const printerStatusCode = parseInt(statusStr ?? '', 10)
  const detectedError = parseInt(errorStr ?? '', 10)

  if (isNaN(printerStatusCode) || isNaN(detectedError)) return 'unknown'

  if (printerStatusCode === 7 || detectedError === 9) return 'offline'
  if (detectedError === 4 || detectedError === 6 || detectedError === 7 || detectedError === 8) {
    return 'error'
  }
  if (detectedError === 3 || detectedError === 5) return 'low_paper'
  if (detectedError === 0 || detectedError === 2) return 'ready'

  return 'unknown'
}

// ── Disk free space ───────────────────────────────────────────────────────────

/**
 * Query free space on drive C: in GB (rounded to 2 decimal places).
 * Returns -1 on non-Windows or if the query fails.
 */
export async function getDiskFreeGB(): Promise<number> {
  if (process.platform !== 'win32') return -1

  const script =
    `try { [math]::Round((Get-PSDrive -Name C -ErrorAction Stop).Free / 1GB, 2) } catch { -1 }`

  const output = await runPowerShell(script)
  if (!output) return -1

  const val = parseFloat(output)
  return isNaN(val) ? -1 : val
}
