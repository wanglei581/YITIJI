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
 * Win32_Printer.WorkOffline reference:
 *   True  = printer is set to "Use Printer Offline" in Windows (powered off / disconnected)
 *   False = normal (online)
 *   NOTE: When a printer is powered off, Windows sets WorkOffline=True but PrinterStatus
 *   stays 3 (Idle). WorkOffline must be checked explicitly to detect this state (N2 fix).
 *
 * Win32_Printer.DetectedErrorState reference:
 *   0 = Unknown  |  2 = No Error  |  3 = Low Paper  |  4 = No Paper
 *   5 = Low Toner  |  6 = No Toner  |  7 = Door Open  |  8 = Jammed  |  9 = Offline
 *   NOTE: Pantum CM2800ADN Series driver does NOT set DetectedErrorState=4 for paper-empty
 *   via WMI. PAPER_EMPTY cannot be detected by preflight on this driver (N3 known limit).
 *
 * Mapping to PrinterStatus:
 *   WorkOffline=True                              → 'offline'  (N2 fix)
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
    `if ($p) { "$($p.PrinterStatus),$($p.DetectedErrorState),$($p.WorkOffline)" } else { "not_found" }`

  const output = await runPowerShell(script, printerName)
  if (!output || output === 'not_found') return 'unknown'

  const [statusStr, errorStr, workOfflineStr] = output.split(',')
  const printerStatusCode = parseInt(statusStr ?? '', 10)
  const detectedError = parseInt(errorStr ?? '', 10)

  if (isNaN(printerStatusCode) || isNaN(detectedError)) return 'unknown'

  if (workOfflineStr === 'True') return 'offline'
  if (printerStatusCode === 7 || detectedError === 9) return 'offline'
  if (detectedError === 4 || detectedError === 6 || detectedError === 7 || detectedError === 8) {
    return 'error'
  }
  if (detectedError === 3 || detectedError === 5) return 'low_paper'
  if (detectedError === 0 || detectedError === 2) return 'ready'

  return 'unknown'
}

// ── Printer pre-flight (打印前预检) ─────────────────────────────────────────────

/**
 * 打印前打印机预检结果。比 getPrinterStatus 多区分 not_found / paper_empty，
 * 用于在打印前快速拦截明确的故障，给出精确 errorCode（而非等 5min 超时）。
 *
 *   'ok'          可打印（含 low_paper / low_toner 等非阻塞警告）
 *   'not_found'   WMI 查不到该名称的打印机 → PRINTER_NOT_FOUND
 *   'offline'     WorkOffline=True / PrinterStatus=7 / DetectedErrorState=9 → PRINTER_OFFLINE
 *   'paper_empty' DetectedErrorState=4（No Paper）→ PAPER_EMPTY
 *                 NOTE: Pantum CM2800ADN driver never sets this via WMI (N3 known limit).
 *   'error'       DetectedErrorState=6/7/8（缺粉/开盖/卡纸）→ PRINTER_ERROR
 *   'unknown'     非 Windows / 查询失败 / 无法识别 → 不阻塞，交由 print() 处理
 */
export type PrinterPreflight = 'ok' | 'not_found' | 'offline' | 'paper_empty' | 'error' | 'unknown'

/**
 * Query Win32_Printer for a pre-print health check.
 * Best-effort: returns 'unknown' on non-Windows or query failure (caller must NOT block on 'unknown').
 * Only definitive bad states (not_found/offline/paper_empty/error) should gate printing.
 */
export async function getPrinterPreflight(printerName: string): Promise<PrinterPreflight> {
  if (process.platform !== 'win32') return 'unknown'

  const script =
    `$name = [Console]::In.ReadLine(); ` +
    `$p = Get-CimInstance -ClassName Win32_Printer -Filter "Name='$($name.Replace(\"'\", \"''\"))'" -ErrorAction SilentlyContinue; ` +
    `if ($p) { "$($p.PrinterStatus),$($p.DetectedErrorState),$($p.WorkOffline)" } else { "not_found" }`

  const output = await runPowerShell(script, printerName)
  if (!output) return 'unknown'
  if (output === 'not_found') return 'not_found'

  const [statusStr, errorStr, workOfflineStr] = output.split(',')
  const printerStatusCode = parseInt(statusStr ?? '', 10)
  const detectedError = parseInt(errorStr ?? '', 10)
  if (isNaN(printerStatusCode) || isNaN(detectedError)) return 'unknown'

  // WorkOffline=True: printer powered off / set offline in Windows — catches N2 case
  // where PrinterStatus stays 3 (Idle) despite printer being off.
  if (workOfflineStr === 'True') return 'offline'
  if (printerStatusCode === 7 || detectedError === 9) return 'offline'
  if (detectedError === 4) return 'paper_empty'
  if (detectedError === 6 || detectedError === 7 || detectedError === 8) return 'error'
  // 0/2 normal, 3 low paper, 5 low toner, others → 可打印（非阻塞）
  return 'ok'
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

// ── Print job queue monitoring (post-spooling N3 detection) ───────────────────

/**
 * Status returned by a single Get-PrintJob poll.
 *
 *   'printing'    - job exists, Normal/Spooling/Printing (no Retained flag) — keep waiting
 *   'retained'    - JobStatus contains "Retained": job was submitted to the printer hardware
 *                   and the spooler kept a copy. INDETERMINATE for Pantum CM2800ADN — the driver
 *                   uses this flag for BOTH normal completion AND waiting-for-paper. Callers must
 *                   NOT map this to 'completed' or 'paper_empty'; treat as unconfirmed.
 *   'completed'   - job no longer in queue (non-Pantum normal completion via queue removal)
 *   'paper_empty' - JobStatus contains "PaperOut" (explicit driver report — NOT Pantum CM2800ADN)
 *   'error'       - Jammed / Error / UserIntervention / Deleting (explicit driver error flags)
 *   'not_found'   - printer exists but no job matching taskId
 *   'unknown'     - non-Windows, query failure, or printer not found
 */
export type PrintJobMonitorStatus =
  | 'printing'
  | 'retained'
  | 'completed'
  | 'paper_empty'
  | 'error'
  | 'not_found'
  | 'unknown'

/**
 * Single poll of Get-PrintJob for a specific taskId.
 *
 * printerName and taskId are passed via a single stdin line ("printer|taskId")
 * so neither value can inject into the PowerShell parser.
 *
 * Matching: DocumentName -like "*<taskId>*"
 * The temp file is named "task_<taskId>.pdf" so DocumentName will contain the taskId.
 *
 * PaperOut confirmation: callers must require 2 consecutive 'paper_empty' results
 * before acting, to guard against transient driver state flicker.
 *
 * Returns 'unknown' on non-Windows or if the query itself fails.
 * Returns 'not_found' only when the printer is reachable but no matching job exists.
 */
export async function getPrintJobStatus(
  printerName: string,
  taskId: string,
): Promise<{ status: PrintJobMonitorStatus; rawStatus?: string }> {
  if (process.platform !== 'win32') return { status: 'unknown' }

  // Both values come from internal config/DB — sanitise taskId to alphanumeric+_ for safety.
  const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '')

  // Script reads one stdin line: "printerName|taskId"
  const script =
    `$line = [Console]::In.ReadLine(); ` +
    `$sep = $line.IndexOf('|'); ` +
    `if ($sep -lt 0) { 'bad_input'; exit }; ` +
    `$pName = $line.Substring(0, $sep); ` +
    `$tId   = $line.Substring($sep + 1); ` +
    `$jobs  = Get-PrintJob -PrinterName $pName -ErrorAction SilentlyContinue; ` +
    `if ($null -eq $jobs) { 'not_found'; exit }; ` +
    `$job = @($jobs) | Where-Object { $_.DocumentName -like "*$tId*" } | Select-Object -First 1; ` +
    `if ($null -eq $job) { 'not_found'; exit }; ` +
    `$job.JobStatus`

  const output = await runPowerShell(script, `${printerName}|${safeTaskId}`)

  if (!output || output === 'bad_input') return { status: 'unknown' }
  if (output === 'not_found') return { status: 'not_found' }

  const raw = output.trim()

  // JobStatus can be a comma-separated list of flags (e.g. "Printing, PaperOut")
  const flags = raw.toLowerCase()

  // Explicit error flags are checked first — they take priority over 'Retained'.
  if (flags.includes('paperout')) return { status: 'paper_empty', rawStatus: raw }
  if (
    flags.includes('jammed') ||
    flags.includes('error') ||
    flags.includes('userintervention') ||
    flags.includes('deleting')
  ) {
    return { status: 'error', rawStatus: raw }
  }

  // 'Retained' — the Windows spooler kept a copy of the job after submitting it to the
  // printer hardware (Pantum driver default: "keep printed documents").
  // IMPORTANT: Pantum CM2800ADN reports 'Printing, Retained' for BOTH:
  //   (a) jobs that printed successfully and were retained by the spooler, AND
  //   (b) jobs that are waiting for paper (no-paper state) with no explicit PaperOut flag.
  // It is IMPOSSIBLE to distinguish these two cases via Get-PrintJob alone.
  // Return 'retained' so callers can track this indeterminate state and decide how to handle it.
  // Do NOT map to 'completed' or 'paper_empty' here.
  if (flags.includes('retained')) return { status: 'retained', rawStatus: raw }

  // Normal / Spooling / Printing without Retained → job still rendering/spooling
  return { status: 'printing', rawStatus: raw }
}
