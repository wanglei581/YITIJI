/** 重启后执行器可能仍在：确认没有该文档的 Sumatra，再清 SID 残留，最后解除耐久责任。 */
import { execFileSync } from 'child_process'
import { retainPrintDispatch } from '../print-dispatch-gate'
import { cleanupStaleOwnPrintJobs, pauseConfiguredPrinterQueue } from '../print-queue-hold'
import type { CopyDeps } from './copy-types'
import type { CopyPrintRecord } from './copy-print-ledger'

export function copyPrintExecutorGone(correlationId: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(true)
  try {
    const stdout = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'SumatraPDF*.exe' } | Select-Object CommandLine | ConvertTo-Json -Compress"],
    { timeout: 5000, windowsHide: true, encoding: 'utf8' }).trim()
    if (!stdout) return Promise.resolve(true)
    const parsed: unknown = JSON.parse(stdout)
    const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
    return Promise.resolve(rows.every((row) => {
      const line = (row as { CommandLine?: unknown } | null)?.CommandLine
      return typeof line === 'string' && !!line && !line.includes(`task_${correlationId}.pdf`)
    }))
  } catch { return Promise.resolve(false) } // 列不出来也不解除隔离。
}

export function retainRecoveredCopyPrint(deps: CopyDeps, record: CopyPrintRecord, correlationId: string,
  queueSettled: () => void): () => Promise<boolean> {
  const printerName = record.printerName ?? deps.config.printerName
  return retainPrintDispatch(async () => {
    if (!await (deps.printDependencies?.executorGone ?? copyPrintExecutorGone)(correlationId)) return false
    if (!printerName) return false
    const cleanup = deps.printDependencies?.removeOwnJobs ??
      (async () => { await cleanupStaleOwnPrintJobs({ printerName }) })
    await cleanup()
    if (deps.config.holdPrinterQueueWhenIdle === true) {
      await (deps.printDependencies?.pause ?? (async () => { await pauseConfiguredPrinterQueue(printerName) }))()
    }
    queueSettled()
    return true
  })
}
