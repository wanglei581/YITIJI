/**
 * 打印送出之后的队列监控。
 * 成功只来自明确的 Printed/Completed，或本次派发之后符合队列关联规则的 307（含已验证的通用文档名回退）。
 * 见过随后消失、Retained、Deleting/Deleted，没有 307 都是未确认。
 * 派发后的缺纸、卡纸、取消也报未确认，并保留故障人话。
 */

import { getPrintJobStatus, hasPrintServiceCompletionEvent, type PrintJobMonitorStatus } from './wmi'
import { printSpoolStem } from './print-correlation'

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
  /** 缺省按 0。大于 0 时队列查询键带 _a<attempt>，只认这一轮的作业。 */
  attempt?: number
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
 *   - PaperOut must appear on 2 consecutive polls before the fault is reported.
 *   - Success is only an explicit Printed/Completed status, or a boolean 307
 *     matching the queue after this dispatch, including the verified generic-name
 *     fallback. This is limited correlation, not unique task identity. Queue removal is not success.
 *   - A job seen active or removing may wait COMPLETION_GRACE_POLLS for that 307.
 *   - Retained or Deleting/Deleted without that 307 is PRINT_JOB_UNCONFIRMED.
 *   - Post-dispatch paper, jam, error, and cancel keep their fault text and
 *     use PRINT_JOB_UNCONFIRMED, because some pages may already have emerged.
 *   - Non-Windows cannot provide spooler evidence and therefore fails closed.
 *
 * @param printerName     Windows printer name (from config)
 * @param taskId          Task ID。attempt 为 0 时按 "*taskId*" 匹配；更大的 attempt 用 taskId_aN 作边界匹配
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
  const spoolKey = printSpoolStem(taskId, dependencies.attempt ?? 0)

  if (platform !== 'win32') {
    return unconfirmedOutcome(
      'non-Windows: print queue monitoring unavailable; completion cannot be confirmed',
    )
  }

  // How many consecutive 'not_found' polls (without ever seeing the job) before
  // we fail closed. A fast job may leave the queue before the first poll, but that
  // is indistinguishable from DocumentName mismatch or query/driver failure.
  const NOT_FOUND_LIMIT = 5
  // Bounded wait for one boolean 307 after a seen printing job leaves the queue.
  const COMPLETION_GRACE_POLLS = 4

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
  let seenRetainedOnce = false
  let removalSeen = false
  let removalRawStatus: string | undefined
  let goneWithoutEventPolls = 0
  let lastStatus: PrintJobMonitorStatus | undefined

  while (now() < deadline) {
    await wait(pollIntervalMs)

    const { status, rawStatus } = await queryStatus(printerName, spoolKey)
    lastStatus = status

    switch (status) {
      case 'paper_empty':
        paperEmptySeen = true
        paperEmptyCount++
        notFoundCount = 0
        goneWithoutEventPolls = 0
        // Require 2 consecutive PaperOut confirmations before declaring the fault.
        if (paperEmptyCount >= 2) {
          return postDispatchFault(
            '打印机缺纸。作业已经送去打印，可能已出一部分纸，系统不会自动重印，出纸结果需要核查，请勿再次提交打印',
            rawStatus,
          )
        }
        break

      case 'error': {
        // Jammed / Error / UserIntervention / Cancelled. Not a retryable device code:
        // the command was already dispatched, so some pages may have emerged.
        const flags = rawStatus?.toLowerCase() ?? ''
        const isJammed = flags.includes('jammed')
        const isCancelled = flags.includes('cancel')
        const detail = rawStatus ?? '?'
        const reason = isJammed
          ? `打印机可能卡纸或发生设备故障（队列状态: ${detail}）`
          : isCancelled
            ? `打印队列报告作业已取消（队列状态: ${detail}）`
            : `打印机发生设备异常（队列状态: ${detail}）`
        return postDispatchFault(
          `${reason}。作业已经送去打印，可能已出一部分纸，系统不会自动重印，出纸结果需要核查，请勿再次提交打印`,
          rawStatus,
        )
      }

      case 'retained':
        // Pantum CM2800ADN: job submitted to printer + spooler retained copy.
        // Indeterminate until an explicit 307. Absence of the job later is not success.
        activeJobSeenOnce = true
        seenRetainedOnce = true
        notFoundCount = 0
        paperEmptyCount = 0
        goneWithoutEventPolls = 0
        if (!paperEmptySeen && await queryCompletionEvent(printerName, spoolKey, dispatchedAtMs)) {
          return { failed: false, errorCode: '' }
        }
        break

      case 'removing':
        // Deleting/Deleted without a fault flag and without an explicit Printed status.
        // Neutral queue clearance. A 307 can still confirm; disappearance cannot.
        removalSeen = true
        removalRawStatus = rawStatus
        notFoundCount = 0
        paperEmptyCount = 0
        goneWithoutEventPolls = 0
        if (!paperEmptySeen && await queryCompletionEvent(printerName, spoolKey, dispatchedAtMs)) {
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
        goneWithoutEventPolls = 0
        break

      case 'not_found':
        // A small job can finish and leave a non-retained queue before the
        // first Get-PrintJob sample. Event 307 is the completion evidence.
        if (paperEmptySeen) {
          return unconfirmedOutcome(
            'the job disappeared after a paper-empty signal; completion cannot be confirmed',
          )
        }
        if (await queryCompletionEvent(printerName, spoolKey, dispatchedAtMs)) {
          return { failed: false, errorCode: '' }
        }
        if (activeJobSeenOnce || removalSeen) {
          goneWithoutEventPolls += 1
          if (goneWithoutEventPolls >= COMPLETION_GRACE_POLLS) {
            return unconfirmedOutcome(
              'the job left the queue without a matching PrintService 307 during the bounded grace period',
              removalSeen ? removalRawStatus : undefined,
            )
          }
          break
        }
        notFoundCount++
        paperEmptyCount = 0
        if (notFoundCount >= NOT_FOUND_LIMIT) {
          if (removalSeen) {
            return unconfirmedOutcome(
              'the job was only ever seen while Windows was removing it and no completion event followed',
              removalRawStatus,
            )
          }
          return unconfirmedOutcome(
            `job not found in queue after ${NOT_FOUND_LIMIT} polls ` +
              `(${(NOT_FOUND_LIMIT * pollIntervalMs / 1000).toFixed(1)}s); ` +
              'the task was never observed and completion cannot be confirmed',
          )
        }
        break

      case 'unknown':
        // Get-PrintJob can fail independently of the Operational event log.
        // Preserve fail-closed behaviour but accept a post-dispatch 307 satisfying the same bounded queue correlation.
        if (!paperEmptySeen && await queryCompletionEvent(printerName, spoolKey, dispatchedAtMs)) {
          return { failed: false, errorCode: '' }
        }
        paperEmptyCount = 0
        break
    }
  }

  // Hard timeout reached. Every remaining state is indeterminate, so fail closed.
  if (goneWithoutEventPolls > 0) {
    return unconfirmedOutcome(
      `monitoring window ended after ${timeoutMs}ms: the job had left the queue and no completion event was observed`,
      removalSeen ? removalRawStatus : undefined,
    )
  }

  if (lastStatus === 'removing') {
    return unconfirmedOutcome(
      `print queue monitoring timed out after ${timeoutMs}ms ` +
        '(the job was still being removed from the queue; completion cannot be confirmed)',
      removalRawStatus,
    )
  }

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

function postDispatchFault(errorMessage: string, rawStatus?: string): MonitorOutcome {
  return {
    failed: true,
    errorCode: 'PRINT_JOB_UNCONFIRMED',
    errorMessage,
    ...(rawStatus ? { rawStatus } : {}),
    warn: `post-dispatch queue fault kept as PRINT_JOB_UNCONFIRMED (${rawStatus ?? 'n/a'})`,
  }
}

function unconfirmedOutcome(warnMessage: string, rawStatus?: string): MonitorOutcome {
  return {
    failed: true,
    errorCode: 'PRINT_JOB_UNCONFIRMED',
    errorMessage: '打印作业已提交，但未确认打印队列完成，出纸结果需要核查，请勿再次提交打印；系统不会自动重印',
    ...(rawStatus ? { rawStatus } : {}),
    warn: warnMessage,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
