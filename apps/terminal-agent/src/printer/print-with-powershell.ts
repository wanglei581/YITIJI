import path from 'path'
import { spawnSync } from 'child_process'
import { PrintResult, PrintErrorCode } from './types'
import { PRINT_TIMEOUT_MS } from '../config'

/**
 * Method A — PowerShell Start-Process -Verb PrintTo
 *
 * Invokes the file's registered "PrintTo" shell verb, which routes the job
 * to the named printer via whatever default application handles that file
 * type (e.g. Windows PDF viewer for .pdf, Windows Photo Viewer for images).
 *
 * Limitations (document when running the spike):
 *  - Requires the file's app to have "PrintTo" registered in the Windows
 *    registry. Adobe Acrobat / Reader and Windows built-in apps do; some
 *    lightweight PDF viewers do not.
 *  - -Wait waits for the *host process* to exit, not for the print job to
 *    complete on the spooler. The spooler queue may still be processing.
 *  - If no PDF reader is installed, .pdf PrintTo falls back on Edge PDF
 *    viewer (Windows 10/11), which does support PrintTo.
 */
export function printWithPowerShell(filePath: string, printerName: string): PrintResult {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const method = 'powershell' as const

  const ext = path.extname(filePath).toLowerCase()

  // Escape both paths for PowerShell single-quoted strings
  const escapedFile = filePath.replace(/'/g, "''")
  const escapedPrinter = printerName.replace(/'/g, "''")

  // PrintTo verb passes printer name as the argument to the handler app.
  // -Wait blocks until the host application exits (not until spooler is done).
  const psCommand = [
    `$proc = Start-Process`,
    `-FilePath '${escapedFile}'`,
    `-Verb PrintTo`,
    `-ArgumentList '${escapedPrinter}'`,
    `-Wait`,
    `-PassThru`,
    `-ErrorAction Stop;`,
    `exit $proc.ExitCode`,
  ].join(' ')

  const result = spawnSync(
    'powershell',
    ['-NonInteractive', '-NoProfile', '-Command', psCommand],
    {
      encoding: 'utf-8',
      timeout: PRINT_TIMEOUT_MS,
      windowsHide: true,
    },
  )

  const finishedAt = new Date().toISOString()
  const durationMs = Date.now() - t0

  // spawnSync sets .error on OS-level failure (e.g. timeout, ENOENT)
  if (result.error) {
    const isTimeout = result.error.message.includes('ETIMEDOUT') ||
      result.error.message.includes('spawnSync') && durationMs >= PRINT_TIMEOUT_MS

    const errorCode: PrintErrorCode = isTimeout ? 'PRINT_TIMEOUT' : 'PRINT_COMMAND_FAILED'
    return {
      success: false, method, printer: printerName, file: filePath,
      startedAt, finishedAt, durationMs,
      errorCode,
      errorMessage: result.error.message,
    }
  }

  const stderr = (result.stderr ?? '').trim()
  const stdout = (result.stdout ?? '').trim()

  // PowerShell exits 0 on success; non-zero usually means Start-Process threw
  if (result.status !== 0) {
    // Detect common failure reasons from stderr
    let errorCode: PrintErrorCode = 'PRINT_COMMAND_FAILED'
    if (stderr.toLowerCase().includes('no application') ||
        stderr.toLowerCase().includes('no program')) {
      errorCode = 'UNSUPPORTED_FILE_TYPE'
    }
    return {
      success: false, method, printer: printerName, file: filePath,
      startedAt, finishedAt, durationMs,
      errorCode,
      errorMessage: stderr || `PowerShell exit code ${result.status ?? 'null'}`,
      rawOutput: stdout,
    }
  }

  // PowerShell -Verb PrintTo for images has a quirk: the Photo app sometimes
  // exits 0 even when the printer is unreachable. We treat exit 0 as "job
  // submitted to spooler" not "job completed on printer".
  return {
    success: true, method, printer: printerName, file: filePath,
    startedAt, finishedAt, durationMs,
    rawOutput: stdout || undefined,
  }
}
