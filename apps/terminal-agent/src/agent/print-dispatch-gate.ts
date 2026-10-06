/**
 * 打印领取闸门。
 *
 * 开机暂停队列或清残留作业失败，派发前清残留失败，派发前恢复失败，
 * 以及任务终态后暂停重试仍失败，都关上这道闸。关上之后心跳里的 printerStatus 报两个专门的值：
 * queue_cleanup_failed（开机或派发前清理残留失败）、queue_pause_failed（暂停或派发前恢复失败）。
 * 清理失败优先于暂停失败：残留作业还在队列里，恢复时必须先删再暂停。
 * 领取循环不向服务端领打印任务。心跳、本机接口、扫描不受影响。
 *
 * 每个领取周期按原因重试一次：开机失败重试「暂停（若开启空闲暂停）+ 清理」；
 * 只暂停失败时只重试暂停，不删作业；只清理失败时只重试清理；
 * 两者都失败时先清理再暂停。成功后打开闸门并记一条日志，当轮即可领取。
 *
 * W-85 临时文件清理失败仍让进程退出，不走这道闸。
 */

import type { PrinterStatus } from './types'
import { err, log } from '../logger'

export type DispatchPrinterStatus = 'queue_cleanup_failed' | 'queue_pause_failed'

type BlockKind = 'startup' | 'pause' | 'cleanup' | 'cleanup-then-pause'

interface DispatchBlock {
  kind: BlockKind
  heartbeat: DispatchPrinterStatus
}

/** 终态后再暂停：第一次失败后等 1 秒、2 秒、4 秒，连第一次一共 4 次。 */
export const PAUSE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

let block: DispatchBlock | null = null

/**
 * 远程指令处理期间临时挡住领取。和上面的失败闸分开：
 * 失败闸会在下一轮尝试恢复，这个不会，直到处理结束显式放开。
 * 不改心跳里的 printerStatus。
 */
let remoteClaimHold: 'restart_agent' | 'clear_print_queue' | null = null

export function isPrintDispatchBlocked(): boolean {
  return block !== null
}

export function holdPrintClaims(reason: 'restart_agent' | 'clear_print_queue'): void {
  remoteClaimHold = reason
}

export function releasePrintClaims(): void {
  remoteClaimHold = null
}

export function remoteClaimHoldReason(): 'restart_agent' | 'clear_print_queue' | null {
  return remoteClaimHold
}

export function noteStartupPrintQueueFailure(part: 'pause' | 'cleanup'): void {
  const heartbeat: DispatchPrinterStatus = part === 'cleanup' ? 'queue_cleanup_failed' : 'queue_pause_failed'
  if (block?.heartbeat === 'queue_cleanup_failed') return
  block = { kind: 'startup', heartbeat }
}

function noteResidualCleanupFailure(): void {
  if (block?.kind === 'pause' || block?.kind === 'cleanup-then-pause') {
    block = { kind: 'cleanup-then-pause', heartbeat: 'queue_cleanup_failed' }
    return
  }
  if (block?.heartbeat === 'queue_cleanup_failed') return
  block = { kind: 'cleanup', heartbeat: 'queue_cleanup_failed' }
}

function notePauseAfterTerminalFailure(): void {
  if (block?.heartbeat === 'queue_cleanup_failed') {
    block = { kind: 'cleanup-then-pause', heartbeat: 'queue_cleanup_failed' }
    return
  }
  block = { kind: 'pause', heartbeat: 'queue_pause_failed' }
}

/** 闸门关上时盖过 WMI 读数。清理失败不让暂停失败把它盖掉。 */
export function printerStatusForHeartbeat(queried: PrinterStatus): PrinterStatus {
  return block?.heartbeat ?? queried
}

export function __resetPrintDispatchGateForTests(): void {
  block = null
  remoteClaimHold = null
}

export interface PrintDispatchRecovery {
  holdEnabled: boolean
  pause: () => Promise<void>
  cleanup: () => Promise<void>
}

async function recoverPrintDispatchBeforeClaim(recovery: PrintDispatchRecovery): Promise<boolean> {
  if (!isPrintDispatchBlocked() || !block) return true
  const kind = block.kind
  try {
    if (kind === 'startup') {
      if (recovery.holdEnabled) await recovery.pause()
      await recovery.cleanup()
    } else if (kind === 'cleanup') {
      await recovery.cleanup()
    } else if (kind === 'cleanup-then-pause') {
      await recovery.cleanup()
      await recovery.pause()
    } else {
      await recovery.pause()
    }
  } catch {
    return false // print-dispatch-gate: keep claims blocked
  }
  block = null
  log(
    kind === 'startup'
      ? 'print-queue-hold: startup queue recovery succeeded; print claims resumed'
      : kind === 'pause'
        ? 'print-queue-hold: queue paused again; print claims resumed'
        : kind === 'cleanup'
          ? 'print-queue-hold: leftover jobs removed; print claims resumed'
          : 'print-queue-hold: leftover jobs removed and queue paused; print claims resumed',
  )
  return true
}

/** 领取循环的唯一入口。闸门没打开时不调用 claim。 */
export async function claimPrintTasksIfGateOpen(
  recovery: PrintDispatchRecovery,
  claim: () => Promise<void>,
): Promise<void> {
  if (remoteClaimHold !== null) return // remote-command: claims held
  const mayClaim = await recoverPrintDispatchBeforeClaim(recovery)
  if (!mayClaim) return
  await claim()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 任务到终态后暂停。失败则隔 1 秒、2 秒、4 秒再试，连第一次一共 4 次。
 * 仍失败就关上领取闸门，下一轮先暂停成功才放行。这一支不删作业。
 */
export async function pauseQueueAfterTerminalState(
  pause: () => Promise<void>,
  sleep: (ms: number) => Promise<void> = delay,
): Promise<void> {
  const maxAttempts = PAUSE_RETRY_DELAYS_MS.length + 1
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await sleep(PAUSE_RETRY_DELAYS_MS[attempt - 1] ?? 1_000)
    try {
      await pause()
      return
    } catch {
      // 下一轮再试。四次都失败才关闸。
    }
  }
  notePauseAfterTerminalFailure()
  err('print-queue-hold: queue could not be paused after terminal state; print claims blocked')
}

export type DispatchPreparation = 'ready' | 'cleanup-failed' | 'resume-failed'

/**
 * 每次派发前，恢复队列之前，删掉本进程 SID 留在配置打印机上的作业。
 * 不开空闲暂停也要删：防的是加纸续打和同一份打两份，不依赖暂停。
 * 上一单以未确认超时结束、作业仍在队列里时，这里会删掉它。
 * 上一单的结论保持未确认，不再续打。这是有意的，避免它和下一位的纸一起出来。
 * 上一单还在监控、未到终态时，领取循环不会进入这里。
 */
export async function preparePrinterForDispatch(options: {
  holdEnabled: boolean
  removeOwnJobs: () => Promise<void>
  resume: () => Promise<void>
}): Promise<DispatchPreparation> {
  try {
    await options.removeOwnJobs() // prepare-before-dispatch
  } catch {
    noteResidualCleanupFailure() // prepare-cleanup-failed
    err('print-queue-hold: leftover jobs could not be removed before dispatch; print claims blocked')
    return 'cleanup-failed'
  }
  if (!options.holdEnabled) return 'ready'
  try {
    await options.resume()
    return 'ready'
  } catch {
    // 恢复失败与终态暂停失败同一道闸。本单仍按失败返回，下一轮不再领。
    notePauseAfterTerminalFailure() // prepare-resume-failed
    err('print-queue-hold: queue could not be resumed before dispatch; print claims blocked')
    return 'resume-failed'
  }
}

/**
 * 任务到失败终态时，在再暂停队列之前，删除配置打印机上属于本进程 SID 的作业。
 * Agent 串行执行，每轮最多一单，监控期间不会并发下一单，所以正常路径里这些作业只可能是这一单的残余。
 * 同 SID 的已完成残留、人工提交或驱动保留记录仍会被一起删掉。这是串行假设剩下的风险，PR 描述里写过，这里不改删除范围。
 * 删掉它，一体机「不会在加纸后自动续打」的承诺才成立。
 * 未确认（UNCONFIRMED）的单删掉作业后结论仍是未确认，不改服务端语义。
 * 完成的单不删。监控尚未结束的单也不删。
 * 删除失败仍会按原计划再暂停（队列若已恢复）。不开空闲暂停时也删，只是不再暂停。
 */
export async function settlePrinterAfterTerminal(options: {
  outcome: 'failed' | 'completed' | 'open'
  pauseAgain: boolean
  removeOwnJobs: () => Promise<void>
  pause: () => Promise<void>
}): Promise<void> {
  if (options.outcome === 'failed') {
    try {
      await options.removeOwnJobs() // settle-failed-terminal
    } catch {
      noteResidualCleanupFailure()
      err('print-queue-hold: leftover jobs could not be removed after a failed print; print claims blocked')
    }
  }
  if (options.pauseAgain) {
    await pauseQueueAfterTerminalState(options.pause)
  }
}

/**
 * 进程正常停止时尽力暂停一次。暂停卡住或抛错都不挡住退出，等待不超过 timeoutMs。
 */
export async function pauseQueueOnProcessStop(options: {
  enabled: boolean
  pause: () => Promise<unknown>
  timeoutMs?: number
}): Promise<void> {
  if (!options.enabled) return
  const timeoutMs = options.timeoutMs ?? 5_000
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    options.pause().then(finish, finish)
  })
}

type FatalListener = (value: unknown) => void

/**
 * 未捕获异常退出前尽力暂停一次。总等待不超过 3 秒。
 * 暂停抛错、卡住或同步抛错都不阻止退出。
 * 开机清理前的先暂停仍是兜底，这里只补崩溃到下次启动之间的空档。
 */
export async function pauseBeforeFatalExit(options: {
  enabled: boolean
  pause: () => Promise<unknown>
  timeoutMs?: number
}): Promise<void> {
  if (!options.enabled) return
  const timeoutMs = options.timeoutMs ?? 3_000
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve()
        .then(() => options.pause())
        .then(() => undefined, () => undefined), // fatal-exit-swallow
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function installFatalPrintQueuePause(options: {
  enabled: boolean
  pause: () => Promise<unknown>
  logError: (detail: string) => void
  exit?: (code: number) => void
  on?: (event: 'uncaughtException' | 'unhandledRejection', handler: FatalListener) => void
}): void {
  const exit = options.exit ?? ((code: number) => {
    process.exit(code)
  })
  const listen = (event: 'uncaughtException' | 'unhandledRejection', handler: FatalListener) => {
    if (options.on) {
      options.on(event, handler)
      return
    }
    if (event === 'uncaughtException') {
      process.on('uncaughtException', (error) => handler(error))
      return
    }
    process.on('unhandledRejection', (reason) => handler(reason))
  }
  let started = false
  const fatalExit = (detail: string) => {
    options.logError(detail)
    if (started) return
    started = true
    const timer = setTimeout(() => exit(1), 3_000)
    if (typeof timer.unref === 'function') timer.unref()
    void pauseBeforeFatalExit({ // fatal-exit-pause
      enabled: options.enabled,
      pause: options.pause,
      timeoutMs: 3_000,
    }).finally(() => exit(1))
  }
  listen('uncaughtException', (value) => {
    const error = value instanceof Error ? value : new Error(String(value))
    fatalExit(`uncaughtException: ${error.message}\n${error.stack ?? ''}`)
  })
  listen('unhandledRejection', (reason) => {
    fatalExit(`unhandledRejection: ${String(reason)}`)
  })
}
