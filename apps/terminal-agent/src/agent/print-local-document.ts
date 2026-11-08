/** 本机文档的薄封装：与 task-runner 共用准备闸门、SID 队列隔离、驱动、监控及超时。调用方持设备锁。 */
import { print } from '../printer/print'
import type { PrintJobParams } from '../printer/types'
import { getPrinterPreflight } from './wmi'
import { monitorPrintJob } from './print-job-monitor'
import { computeMonitorTimeoutMs } from './print-monitor-timeout'
import { preparePrinterForDispatch, settlePrinterAfterTerminal, isPrintDispatchBlocked, retainPrintDispatch } from './print-dispatch-gate'
import { cleanupStaleOwnPrintJobs, pauseConfiguredPrinterQueue, resumeConfiguredPrinterQueue } from './print-queue-hold'
import type { CopyPrintState } from './copy-device/copy-types'

export interface LocalPrintDependencies {
  print?: typeof print
  monitor?: Parameters<typeof monitorPrintJob>[4]
  preflight?: typeof getPrinterPreflight
  removeOwnJobs?: () => Promise<void>
  resume?: () => Promise<void>
  pause?: () => Promise<void>
  executorGone?: (correlationId: string) => Promise<boolean>
}
export async function printLocalDocument(input: {
  file: string; printerName: string; correlationId: string; pageCount: number
  params: Partial<PrintJobParams>; holdEnabled: boolean
  beforeDispatch(): void; spooled(): void; readerPending(pending: boolean): void; queueSettled(): void
}, deps: LocalPrintDependencies = {}): Promise<{ state: CopyPrintState; errorCode?: string }> {
  const removeOwnJobs = deps.removeOwnJobs ?? (async () => { await cleanupStaleOwnPrintJobs({ printerName: input.printerName }) })
  const resume = deps.resume ?? (async () => { await resumeConfiguredPrinterQueue(input.printerName) })
  const pause = deps.pause ?? (async () => { await pauseConfiguredPrinterQueue(input.printerName) })
  let dispatched = false
  let prepared = false
  let handed = false
  let terminal = false
  let readerPending = false
  let cleanupAgain = false
  let recover: (() => Promise<boolean>) | undefined
  const retain = (): void => {
    recover ??= retainPrintDispatch(async () => {
      if (!terminal || readerPending) return false
      if (cleanupAgain) await removeOwnJobs()
      try {
        input.queueSettled() // 先耐久解除待清理责任，再放派发。
      } catch (error) {
        cleanupAgain = true // 写失败后下一轮必须重查执行器、重清队列，不能只重写磁盘。
        throw error
      }
      return true
    })
  }
  try {
    if (!input.printerName) return { state: 'failed', errorCode: 'COPY_DEVICE_UNAVAILABLE' }
    if (isPrintDispatchBlocked()) return { state: 'failed', errorCode: 'COPY_DEVICE_UNAVAILABLE' }
    const preflight = await (deps.preflight ?? getPrinterPreflight)(input.printerName)
    if (preflight !== 'ok' && preflight !== 'unknown') return { state: 'failed', errorCode: 'COPY_DEVICE_UNAVAILABLE' }
    const preparation = await preparePrinterForDispatch({ holdEnabled: input.holdEnabled, removeOwnJobs, resume })
    if (preparation !== 'ready') return { state: 'failed', errorCode: 'COPY_QUEUE_PREPARE_FAILED' }
    prepared = true
    // 最后一次检查短许可/撤权，并在驱动调用前落盘意图。此后绝不自动重试驱动。
    input.beforeDispatch()
    retain()
    dispatched = true
    const result = await (deps.print ?? print)(input.file, input.printerName, input.params, {
      correlationId: input.correlationId,
      onDispatchStart: () => { readerPending = true; input.readerPending(true) },
      onDispatchSettled: () => {
        readerPending = false
        input.readerPending(false)
        if (terminal) void recover?.()
      },
    })
    if (!result.success && result.errorCode !== 'PRINT_TIMEOUT') {
      // 只有驱动入口在派发前明确拒绝的错误，才能断言没有送进队列。
      const noPaper = result.errorCode === 'FILE_NOT_FOUND' || result.errorCode === 'UNSUPPORTED_FILE_TYPE'
      return { state: noPaper ? 'failed' : 'unconfirmed', errorCode: result.errorCode ?? 'PRINT_JOB_UNCONFIRMED' }
    }
    input.spooled()
    const outcome = await monitorPrintJob(input.printerName, input.correlationId,
      computeMonitorTimeoutMs(input.pageCount, input.params.copies, input.params), 1500,
      { ...deps.monitor, dispatchedAtMs: Date.parse(result.startedAt), attempt: 0 })
    handed = !outcome.failed
    return handed ? { state: 'handed' } : { state: 'unconfirmed', errorCode: outcome.errorCode || 'PRINT_JOB_UNCONFIRMED' }
  } catch {
    return { state: dispatched ? 'unconfirmed' : 'failed', errorCode: dispatched ? 'PRINT_JOB_UNCONFIRMED' : 'COPY_DISPATCH_BLOCKED' }
  } finally {
    const executorWasPending = readerPending
    const cleaned = !prepared || await settlePrinterAfterTerminal({ outcome: handed ? 'completed' : 'failed',
      pauseAgain: input.holdEnabled, removeOwnJobs, pause })
    cleanupAgain = executorWasPending || readerPending || !cleaned
    terminal = true
    retain()
    await recover!()
  }
}
