/**
 * 打印送出之后的队列监控。
 * 从 task-runner.ts 拆出：该文件加上空闲暂停后超过 1000 行。
 * 行为与原先相同，task-runner 再导出，现有门禁的 import 不用改。
 */

import { getPrintJobStatus, hasPrintServiceCompletionEvent, type PrintJobMonitorStatus } from './wmi'

export interface MonitorOutcome {
  failed: boolean
  errorCode: string
  errorMessage?: string
  rawStatus?: string
  warn?: string
}

interface MonitorDependencies {
  platform?: NodeJS.Platform
  queryStatus?: (
    printerName: string,
    taskId: string,
  ) => Promise<{ status: PrintJobMonitorStatus; rawStatus?: string }>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  dispatchedAtMs?: number
  queryCompletionEvent?: (
    printerName: string,
    taskId: string,
    dispatchedAtMs: number,
  ) => Promise<boolean>
}

/**
 * Poll Get-PrintJob until the job completes, errors, or the timeout expires.
 *
 * Design invariants:
 *   - PaperOut must appear on 2 consecutive polls before returning 'paper_empty'
 *     (guards against transient driver state flicker).
 *   - Only an explicit spooler completion, or an observed active job followed by
 *     queue removal, confirms completed. This confirms the Windows spooler
 *     lifecycle only; it does not prove that paper physically reached the user.
 *   - If the job never appears (taskId not in DocumentName), the query remains
 *     unknown, or monitoring times out, return failed+PRINT_JOB_UNCONFIRMED.
 *   - Non-Windows cannot provide spooler evidence and therefore fails closed.
 *
 * @param printerName     Windows printer name (from config)
 * @param taskId          Task ID — matched against DocumentName via "*taskId*"
 * @param timeoutMs       Maximum monitoring wall time (default 30 000 ms)
 * @param pollIntervalMs  Time between polls (default 1 500 ms)
 */
export async function monitorPrintJob(
  printerName: string,
  taskId: string,
  timeoutMs = 30_000,
  pollIntervalMs = 1_500,
  dependencies: MonitorDependencies = {},
): Promise<MonitorOutcome> {
  const platform = dependencies.platform ?? process.platform
  const queryStatus = dependencies.queryStatus ?? getPrintJobStatus
  const wait = dependencies.sleep ?? sleep
  const now = dependencies.now ?? Date.now
  const queryCompletionEvent = dependencies.queryCompletionEvent ?? hasPrintServiceCompletionEvent

  if (platform !== 'win32') {
    return unconfirmedOutcome(
      'non-Windows: print queue monitoring unavailable; completion cannot be confirmed',
    )
  }

  // How many consecutive 'not_found' polls (without ever seeing the job) before
  // we fail closed. A fast job may leave the queue before the first poll, but that
  // is indistinguishable from DocumentName mismatch or query/driver failure.
  const NOT_FOUND_LIMIT = 5

  const dispatchedAtMs = Number.isFinite(dependencies.dispatchedAtMs)
    ? Math.max(0, dependencies.dispatchedAtMs as number)
    : now()
  // `dispatchedAtMs` scopes PrintService evidence to this task dispatch. The
  // monitor timeout starts only after the print command has returned, otherwise
  // slow rendering/spooling can consume the entire observation window before
  // the first queue poll.
  const deadline = now() + timeoutMs
  let paperEmptyCount = 0
  let paperEmptySeen = false
  let notFoundCount = 0
  let activeJobSeenOnce = false
  let seenRetainedOnce = false  // Pantum 'Printing, Retained' indeterminate flag

  while (now() < deadline) {
    await wait(pollIntervalMs)

    const { status, rawStatus } = await queryStatus(printerName, taskId)

    switch (status) {
      case 'paper_empty':
        paperEmptySeen = true
        paperEmptyCount++
        notFoundCount = 0
        // Require 2 consecutive PaperOut confirmations before declaring failure.
        if (paperEmptyCount >= 2) {
          return {
            failed: true,
            errorCode: 'PAPER_EMPTY',
            errorMessage: '打印机缺纸，当前无法打印，请联系工作人员补纸后重试',
            rawStatus,
          }
        }
        break

      case 'error': {
        // Covers Jammed / Error / UserIntervention / Deleting — explicit driver error flags.
        const isJammed = rawStatus?.toLowerCase().includes('jammed') ?? false
        return {
          failed: true,
          errorCode: 'PRINTER_ERROR',
          errorMessage: isJammed
            ? `打印机可能卡纸或发生设备故障，当前暂时无法继续使用，请联系工作人员处理（队列状态: ${rawStatus ?? '?'}）`
            : `打印机发生设备异常，当前暂时无法继续使用，请联系工作人员处理（队列状态: ${rawStatus ?? '?'}）`,
          rawStatus,
        }
      }

      case 'retained':
        // Pantum CM2800ADN: job submitted to printer + spooler retained copy.
        // Indeterminate: cannot distinguish "printed and kept" from "waiting for paper".
        // Keep polling — in case the driver eventually reports an explicit PaperOut or Error.
        activeJobSeenOnce = true
        seenRetainedOnce = true
        notFoundCount = 0
        paperEmptyCount = 0
        if (!paperEmptySeen && await queryCompletionEvent(printerName, taskId, dispatchedAtMs)) {
          return { failed: false, errorCode: '' }
        }
        break

      case 'completed':
        // Explicit Complete/Printed spooler state. This confirms the Windows
        // spooler lifecycle, not physical delivery of paper to the user.
        return { failed: false, errorCode: '' }

      case 'printing':
        // Job still spooling/rendering (no Retained flag yet).
        activeJobSeenOnce = true
        paperEmptyCount = 0
        notFoundCount = 0
        break

      case 'not_found':
        // A small job can finish and leave a non-retained queue before the
        // first Get-PrintJob sample. Event 307 is stronger evidence than queue
        // visibility when it carries this exact taskId after dispatch.
        if (paperEmptySeen) {
          return unconfirmedOutcome(
            'the job disappeared after a paper-empty signal; completion cannot be confirmed',
          )
        }
        if (await queryCompletionEvent(printerName, taskId, dispatchedAtMs)) {
          return { failed: false, errorCode: '' }
        }
        if (activeJobSeenOnce) {
          // 已知边界，保持既有语义：作业曾经出现在队列里，随后查不到，并且没有完成事件，就判为完成。
          // 这只说明 Windows 假脱机不再留着这份作业，不证明纸已经出来。
          // 打印过程中被人从队列删掉，或 Spooler 把作业弄丢，也会走到这里，被误判为完成。
          return { failed: false, errorCode: '' }
        }
        notFoundCount++
        paperEmptyCount = 0
        if (notFoundCount >= NOT_FOUND_LIMIT) {
          return unconfirmedOutcome(
            `job not found in queue after ${NOT_FOUND_LIMIT} polls ` +
              `(${(NOT_FOUND_LIMIT * pollIntervalMs / 1000).toFixed(1)}s); ` +
              'the task was never observed and completion cannot be confirmed',
          )
        }
        break

      case 'unknown':
        // Get-PrintJob can fail independently of the Operational event log.
        // Preserve fail-closed behaviour but accept an exact post-dispatch 307.
        if (!paperEmptySeen && await queryCompletionEvent(printerName, taskId, dispatchedAtMs)) {
          return { failed: false, errorCode: '' }
        }
        paperEmptyCount = 0
        break
    }
  }

  // Hard timeout reached. Every remaining state is indeterminate, so fail closed.
  if (seenRetainedOnce) {
    // Pantum driver limitation: job was visible as 'Printing, Retained' throughout
    // the monitoring window. Cannot distinguish normal completion from waiting-for-paper.
    // Report as failed+PRINT_JOB_UNCONFIRMED — never assert false completed.
    // Operator must check the device physically.
    const retainedMsg = `print queue monitoring timed out after ${timeoutMs}ms: ` +
      `job remained in 'Printing, Retained' state (Pantum CM2800ADN driver limitation — ` +
      `cannot distinguish completed vs paper-empty via Get-PrintJob); ` +
      `reporting PRINT_JOB_UNCONFIRMED — operator must check device`
    return unconfirmedOutcome(retainedMsg, 'Printing, Retained (timeout)')
  }

  const warnMsg = activeJobSeenOnce
    ? `print queue monitoring timed out after ${timeoutMs}ms ` +
      `(matching job remained active; completion cannot be confirmed)`
    : `print queue monitoring timed out after ${timeoutMs}ms ` +
      `(matching job was never observed or spooler queries were unavailable; completion cannot be confirmed)`
  return unconfirmedOutcome(warnMsg)
}

function unconfirmedOutcome(warnMessage: string, rawStatus?: string): MonitorOutcome {
  return {
    failed: true,
    errorCode: 'PRINT_JOB_UNCONFIRMED',
    errorMessage: '打印作业已提交，但未确认打印队列完成，请工作人员现场检查纸张、卡纸和出纸状态；系统不会自动重印',
    ...(rawStatus ? { rawStatus } : {}),
    warn: warnMessage,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
