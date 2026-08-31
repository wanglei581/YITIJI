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
 *   'completed'   - JobStatus explicitly contains Complete/Completed/Printed
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
 * The submitted PDF filename always contains taskId: downloaded PDFs use
 * "task_<taskId>.pdf", while converted images use
 * "print_<taskId>_<uuid>.pdf".
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
  return parsePrintJobStatus(output)
}

/**
 * Build the Windows PrintService completion query used by the runtime and by
 * the Windows fixture verifier.
 *
 * Event 307's formatted Message is localized. Most drivers preserve the
 * submitted document name in raw XML, so the taskId remains the preferred
 * correlation key. Some Pantum drivers replace it with a generic localized
 * value such as "打印文档". For that verified field behaviour, the fallback is
 * deliberately narrow: Param2 must equal the field-verified generic value
 * "打印文档", the event must be for the exact configured queue, be owned by
 * LocalSystem (the Agent service identity), and occur after this dispatch began.
 * Claim cycles are serialized, so the Agent cannot dispatch a second task to
 * the same queue while the current task is being monitored.
 */
export function buildPrintServiceCompletionEventScript(): string {
  return (
    `$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json; ` +
    `$tId = [string]$payload.taskId; ` +
    `$pName = [string]$payload.printerName; ` +
    `if ([string]::IsNullOrWhiteSpace($tId) -or [string]::IsNullOrWhiteSpace($pName)) { 'false'; exit }; ` +
    `$since = [DateTimeOffset]::FromUnixTimeMilliseconds([Int64]$payload.dispatchedAtMs).LocalDateTime; ` +
    `$event = Get-WinEvent -FilterHashtable @{ LogName='Microsoft-Windows-PrintService/Operational'; Id=307; StartTime=$since } -ErrorAction SilentlyContinue | ` +
    `Where-Object { try { ` +
    `$raw = $_.ToXml(); ` +
    `if ($raw -like "*$tId*") { $true } else { ` +
    `[xml]$xml = $raw; ` +
    `$documentNode = $xml.SelectSingleNode("/*[local-name()='Event']/*[local-name()='UserData']/*[local-name()='DocumentPrinted']/*[local-name()='Param2']"); ` +
    `$printerNode = $xml.SelectSingleNode("/*[local-name()='Event']/*[local-name()='UserData']/*[local-name()='DocumentPrinted']/*[local-name()='Param5']"); ` +
    `$securityNode = $xml.SelectSingleNode("/*[local-name()='Event']/*[local-name()='System']/*[local-name()='Security']/@UserID"); ` +
    `$isKnownGenericName = $null -ne $documentNode -and [string]::Equals($documentNode.InnerText, '打印文档', [StringComparison]::Ordinal); ` +
    `$printerMatches = $null -ne $printerNode -and [string]::Equals($printerNode.InnerText, $pName, [StringComparison]::OrdinalIgnoreCase); ` +
    `$isLocalSystem = $null -ne $securityNode -and [string]::Equals($securityNode.Value, 'S-1-5-18', [StringComparison]::OrdinalIgnoreCase); ` +
    `$isKnownGenericName -and $printerMatches -and $isLocalSystem ` +
    `} } catch { $false } } | ` +
    `Select-Object -First 1; ` +
    `if ($event) { 'true' } else { 'false' }`
  )
}

/**
 * Confirm that Windows PrintService recorded Event ID 307 for this exact task.
 *
 * Pantum's "keep printed documents" mode can leave Get-PrintJob reporting
 * `Printing, Retained` even after the spooler emitted its completion event. We
 * accept a successful 307 after this dispatch began when either:
 *   1. raw XML contains the exact sanitized task correlation id; or
 *   2. a driver replaced the document name with the field-verified generic
 *      value "打印文档", and the exact queue and LocalSystem identity match.
 * This remains Windows spooler completion evidence; it does not prove that
 * paper physically exited.
 */
export async function hasPrintServiceCompletionEvent(
  printerName: string,
  taskId: string,
  dispatchedAtMs: number,
): Promise<boolean> {
  if (process.platform !== 'win32') return false

  const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '')
  if (
    safeTaskId.length === 0 ||
    safeTaskId !== taskId ||
    printerName.trim().length === 0 ||
    !Number.isFinite(dispatchedAtMs)
  ) {
    return false
  }
  const safeSince = Math.max(0, Math.floor(dispatchedAtMs))

  const output = await runPowerShell(
    buildPrintServiceCompletionEventScript(),
    JSON.stringify({ taskId: safeTaskId, printerName, dispatchedAtMs: safeSince }),
  )
  return output?.trim().toLowerCase() === 'true'
}

/** Pure JobStatus parser, exported for deterministic fault-injection verification. */
export function parsePrintJobStatus(
  output: string | null,
): { status: PrintJobMonitorStatus; rawStatus?: string } {
  if (!output || output === 'bad_input') return { status: 'unknown' }
  if (output === 'not_found') return { status: 'not_found' }

  const raw = output.trim()

  // JobStatus can be a comma-separated list of flags (e.g. "Printing, PaperOut")
  const flags = raw.toLowerCase()

  // Explicit failure flags are checked first. This priority prevents a combined
  // state such as "Retained, Deleted" or "Printed, PaperOut" from being treated
  // as completion.
  if (flags.includes('paperout')) return { status: 'paper_empty', rawStatus: raw }
  if (
    flags.includes('jammed') ||
    flags.includes('error') ||
    flags.includes('userintervention') ||
    flags.includes('deleting') ||
    flags.includes('deleted') ||
    flags.includes('cancelled') ||
    flags.includes('canceled')
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

  // Windows may report Complete/Completed or Printed before queue removal.
  // This is spooler lifecycle evidence only; it does not prove physical delivery.
  if (
    flags.includes('completed') ||
    flags.includes('complete') ||
    flags.includes('printed')
  ) {
    return { status: 'completed', rawStatus: raw }
  }

  // Normal / Spooling / Printing without Retained → job still rendering/spooling
  return { status: 'printing', rawStatus: raw }
}
