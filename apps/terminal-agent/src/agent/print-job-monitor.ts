/**
 * 打印送出之后的队列监控。
 * 从 task-runner.ts 拆出：该文件加上空闲暂停后超过 1000 行。
 * 行为与原先相同，task-runner 再导出，现有门禁的 import 不用改。
 */

import {
  getPrintJobStatus,
  getPrintServiceCompletionLogState,
  readPrintServiceCompletionEvent,
  type CompletionEventRead,
  type PrintCompletionLogState,
  type PrintJobMonitorStatus,
} from './wmi'
import { printSpoolStem } from './print-correlation'

/** Why a completion was inferred instead of confirmed by event 307 or a Printed status. */
export type InferredCompletionReason =
  | 'completion_log_disabled'    // the Operational log is off on this machine
  | 'completion_log_unknown'     // its configuration could not be read
  | 'completion_log_unverified'  // the log is on, but no matching 307 has been read for this queue since the process started
  | 'completion_log_unreadable'  // 记录开着、以前读到过，但这张单的几次读取都失败了

export interface MonitorOutcome {
  failed: boolean
  errorCode: string
  errorMessage?: string
  rawStatus?: string
  warn?: string
  /** Set only when completion was inferred from "seen in the queue, then gone" without a 307 or a Printed status. Says why a completion event was not required, or that the required reads failed. */
  inferred?: InferredCompletionReason
}

/** Process-local record that a matching 307 has been read for a printer queue. */
export interface CompletionEvidenceChannel {
  isProven(printerName: string): boolean
  markProven(printerName: string): void
}

export function createCompletionEvidenceChannel(): CompletionEvidenceChannel {
  const proven = new Set<string>()
  return {
    isProven: (printerName) => proven.has(printerName),
    markProven: (printerName) => {
      proven.add(printerName)
    },
  }
}

/** Production singleton. Tests inject their own channel. */
export const sharedCompletionEvidenceChannel = createCompletionEvidenceChannel()

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
  ) => Promise<boolean | CompletionEventRead>
  /** Defaults to getPrintServiceCompletionLogState. One call per monitor. */
  queryCompletionLogState?: () => Promise<PrintCompletionLogState>
  /** Defaults to sharedCompletionEvidenceChannel. */
  evidenceChannel?: CompletionEvidenceChannel
}

/**
 * Poll Get-PrintJob until the job completes, errors, or the timeout expires.
 *
 * Design invariants:
 *   - PaperOut must appear on 2 consecutive polls before returning 'paper_empty'
 *     (guards against transient driver state flicker).
 *   - A matching PrintService 307, or a queue status that already says Printed,
 *     confirms completed and is not marked inferred. When the Operational log is
 *     enabled and this process has already read a matching 307 for this queue,
 *     "seen in the queue, then gone" waits COMPLETION_EVIDENCE_GRACE_POLLS.
 *     A previous read does not mean this read succeeds. A not_found read counts
 *     toward PRINT_JOB_UNCONFIRMED. An unreadable read does not: that many failed
 *     reads complete as inferred 'completion_log_unreadable'. When that log is
 *     off, its configuration could not be read, or this queue has not been
 *     matched yet, the same disappearance still counts as completed and is
 *     marked inferred. A failed read on those paths is treated like a missing
 *     event. This is the Windows spooler lifecycle only; it does not prove that
 *     paper physically reached the user.
 *   - A job seen while Windows is removing it (Deleting/Deleted) is neither a device
 *     fault nor completion. It is the visible half of "queue removal": the outcome is
 *     decided by the same evidence as a job that simply disappears — a matching 307,
 *     or the log-state rule above. A job only ever seen while being removed, a job
 *     seen only as Retained before its removal (Retained may mean "waiting for paper",
 *     and a retained job is not removed by a normal finish), or one still in removal
 *     at the timeout, is PRINT_JOB_UNCONFIRMED.
 *   - If the job never appears (taskId not in DocumentName), the query remains
 *     unknown, or monitoring times out, return failed+PRINT_JOB_UNCONFIRMED.
 *     A timeout after the job has already left the queue with a confirmed absence
 *     (goneWithoutEventPolls > 0) is PRINT_JOB_UNCONFIRMED, ahead of the Retained /
 *     still-printing diagnoses. A timeout after it left with only failed reads
 *     (unreadableEventReads > 0 and goneWithoutEventPolls === 0) is inferred
 *     'completion_log_unreadable'.
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
  const queryCompletionEvent = dependencies.queryCompletionEvent ?? readPrintServiceCompletionEvent
  const queryCompletionLogState =
    dependencies.queryCompletionLogState ?? getPrintServiceCompletionLogState
  const evidenceChannel = dependencies.evidenceChannel ?? sharedCompletionEvidenceChannel
  const spoolKey = printSpoolStem(taskId, dependencies.attempt ?? 0)

  if (platform !== 'win32') {
    return unconfirmedOutcome(
      'non-Windows: print queue monitoring unavailable; completion cannot be confirmed',
    )
  }

  // Started before the poll loop so a disabled log does not delay the result.
  // A rejection here is "could not read", never an unhandled rejection.
  const completionLogState = Promise.resolve()
    .then(() => queryCompletionLogState())
    .catch((): PrintCompletionLogState => 'unknown')

  // How many consecutive 'not_found' polls (without ever seeing the job) before
  // we fail closed. A fast job may leave the queue before the first poll, but that
  // is indistinguishable from DocumentName mismatch or query/driver failure.
  const NOT_FOUND_LIMIT = 5
  // After a seen job leaves a queue whose completion log is enabled and for which
  // this process has already read a matching 307, wait this many further polls.
  // not_found and unreadable are counted apart. A previous read does not mean this read succeeds.
  const COMPLETION_EVIDENCE_GRACE_POLLS = 4

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
  let removalSeen = false
  let removalRawStatus: string | undefined
  let printingSeenOnce = false  // seen in the queue without Retained
  let lastStatus: PrintJobMonitorStatus | undefined
  let goneWithoutEventPolls = 0
  let unreadableEventReads = 0

  const readCompletionEvent = async (): Promise<CompletionEventRead> => {
    const read = await queryCompletionEvent(printerName, spoolKey, dispatchedAtMs)
    let normalized: CompletionEventRead = 'not_found'
    if (read === true || read === 'found') normalized = 'found'
    else if (read === 'unreadable') normalized = 'unreadable'
    // A task is dispatched only to this configured printer. An event that
    // carries this task id is this job's event, so reading it shows that this
    // queue's completion record can be read and matched.
    if (normalized === 'found') evidenceChannel.markProven(printerName)
    return normalized
  }

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
        unreadableEventReads = 0
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
        // Covers Jammed / Error / UserIntervention — explicit driver error flags.
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
        goneWithoutEventPolls = 0
        unreadableEventReads = 0
        if (!paperEmptySeen && (await readCompletionEvent()) === 'found') {
          return { failed: false, errorCode: '' }
        }
        break

      case 'removing':
        // Windows is taking the job out of the queue. Not a device fault (F-18) and not
        // completion by itself. Keep polling: the next sample is normally 'not_found',
        // where the usual evidence rules apply. activeJobSeenOnce is deliberately left
        // untouched — a job first seen while being removed was never seen printing.
        removalSeen = true
        removalRawStatus = rawStatus
        notFoundCount = 0
        paperEmptyCount = 0
        goneWithoutEventPolls = 0
        unreadableEventReads = 0
        if (!paperEmptySeen && (await readCompletionEvent()) === 'found') {
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
        printingSeenOnce = true
        paperEmptyCount = 0
        notFoundCount = 0
        goneWithoutEventPolls = 0
        unreadableEventReads = 0
        break

      case 'not_found': {
        // A small job can finish and leave a non-retained queue before the
        // first Get-PrintJob sample. Event 307 is stronger evidence than queue
        // visibility when it carries this exact taskId after dispatch.
        if (paperEmptySeen) {
          return unconfirmedOutcome(
            'the job disappeared after a paper-empty signal; completion cannot be confirmed',
          )
        }
        // One read for this poll. The evidence branch below reuses it.
        const completionRead = await readCompletionEvent()
        if (completionRead === 'found') {
          return { failed: false, errorCode: '' }
        }
        if (removalSeen && !printingSeenOnce && activeJobSeenOnce) {
          // Only ever Retained, then removed. A finished retained job stays in the queue,
          // so this removal came from elsewhere and Retained itself may have meant
          // "waiting for paper". Not completion evidence.
          return unconfirmedOutcome(
            'a retained job was removed from the queue without a completion event; completion cannot be confirmed',
            removalRawStatus,
          )
        }
        if (activeJobSeenOnce) {
          // 完成记录开着、并且本进程已经对这台队列读到过 307（读到过不等于这一次读得到）：
          // 沿用本轮开头那一次读取。not_found 计入 goneWithoutEventPolls，满 COMPLETION_EVIDENCE_GRACE_POLLS 记结果未确认。
          // unreadable 不加那一格，另计 unreadableEventReads，满同一个次数则按推断记完成，原因 completion_log_unreadable。
          // 记录没开、配置读不到，或开着但还没对上过这台队列：仍按见过在打、后来没了记完成，并标成推断。读取失败在这些路径上仍等于没查到。
          // 这只说明 Windows 假脱机不再留着这份作业，不证明纸已经出来。
          const state = await completionLogState
          if (state === 'enabled' && evidenceChannel.isProven(printerName)) {
            if (completionRead === 'not_found') {
              goneWithoutEventPolls += 1
              if (goneWithoutEventPolls >= COMPLETION_EVIDENCE_GRACE_POLLS) {
                return unconfirmedOutcome(
                  'the job left the queue; the completion record on this machine is enabled and readable; no completion event within the grace period',
                  removalSeen ? removalRawStatus : undefined,
                )
              }
            } else if (completionRead === 'unreadable') {
              unreadableEventReads += 1
              if (unreadableEventReads >= COMPLETION_EVIDENCE_GRACE_POLLS) {
                return {
                  failed: false,
                  errorCode: '',
                  inferred: 'completion_log_unreadable',
                }
              }
            }
            break
          }
          return {
            failed: false,
            errorCode: '',
            inferred: inferredCompletionReason(state),
          }
        }
        notFoundCount++
        paperEmptyCount = 0
        if (notFoundCount >= NOT_FOUND_LIMIT) {
          if (removalSeen) {
            return unconfirmedOutcome(
              'the job was only ever seen while Windows was removing it and no completion ' +
                'event followed; completion cannot be confirmed',
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
      }

      case 'unknown':
        // Get-PrintJob can fail independently of the Operational event log.
        // Preserve fail-closed behaviour but accept an exact post-dispatch 307.
        // A failed 307 read here is still treated as no event.
        if (!paperEmptySeen && (await readCompletionEvent()) === 'found') {
          return { failed: false, errorCode: '' }
        }
        paperEmptyCount = 0
        break
    }
  }

  // Hard timeout reached. Every remaining state is indeterminate, so fail closed.
  // A job that already left the queue must not be described as still Retained or still printing.
  if (goneWithoutEventPolls > 0) {
    return unconfirmedOutcome(
      `monitoring window ended after ${timeoutMs}ms: the job had left the queue and no completion event was observed`,
      removalSeen ? removalRawStatus : undefined,
    )
  }

  // Left the queue, and every completion read in that stretch failed. No confirmed absence.
  if (unreadableEventReads > 0 && goneWithoutEventPolls === 0) {
    return {
      failed: false,
      errorCode: '',
      inferred: 'completion_log_unreadable',
    }
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

  if (lastStatus === 'removing') {
    return unconfirmedOutcome(
      `print queue monitoring timed out after ${timeoutMs}ms ` +
        '(the job was still being removed from the queue; completion cannot be confirmed)',
      removalRawStatus,
    )
  }

  const warnMsg = activeJobSeenOnce
    ? `print queue monitoring timed out after ${timeoutMs}ms ` +
      `(matching job remained active; completion cannot be confirmed)`
    : `print queue monitoring timed out after ${timeoutMs}ms ` +
      `(matching job was never observed or spooler queries were unavailable; completion cannot be confirmed)`
  return unconfirmedOutcome(warnMsg)
}

function inferredCompletionReason(state: PrintCompletionLogState): InferredCompletionReason {
  if (state === 'disabled') return 'completion_log_disabled'
  if (state === 'unknown') return 'completion_log_unknown'
  return 'completion_log_unverified'
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
