/**
 * 打印领取闸门。
 *
 * 开机暂停队列或清残留作业失败，以及任务终态后暂停重试仍失败，都关上这道闸。
 * 关上之后心跳里的 printerStatus 报 error，领取循环不向服务端领打印任务。
 * 心跳、本机接口、扫描不受影响。
 *
 * 每个领取周期按原因重试一次：开机失败重试「暂停（若开启空闲暂停）+ 清理」；
 * 终态暂停失败只重试暂停。成功后打开闸门并记一条日志，当轮即可领取。
 *
 * W-85 临时文件清理失败仍让进程退出，不走这道闸。
 */

import type { PrinterStatus } from './types'
import { err, log } from '../logger'

export type PrintDispatchBlock = 'startup-queue' | 'pause-after-terminal'

const PAUSE_RETRY_DELAYS_MS = [200, 400]

let block: PrintDispatchBlock | null = null

export function blockPrintDispatch(reason: PrintDispatchBlock): void {
  block = reason
}

export function isPrintDispatchBlocked(): boolean {
  return block !== null
}

export function noteStartupPrintQueueFailure(): void {
  blockPrintDispatch('startup-queue')
}

/** 闸门关上时盖过 WMI 读数，让一体机、拒单和告警都走到打印机故障。 */
export function printerStatusForHeartbeat(queried: PrinterStatus): PrinterStatus {
  if (isPrintDispatchBlocked()) return 'error'
  return queried
}

export function __resetPrintDispatchGateForTests(): void {
  block = null
}

export interface PrintDispatchRecovery {
  holdEnabled: boolean
  pause: () => Promise<void>
  cleanup: () => Promise<void>
}

async function recoverPrintDispatchBeforeClaim(recovery: PrintDispatchRecovery): Promise<boolean> {
  if (!block) return true
  try {
    if (block === 'startup-queue') {
      if (recovery.holdEnabled) await recovery.pause()
      await recovery.cleanup()
    } else {
      await recovery.pause()
    }
  } catch {
    return false // print-dispatch-gate: keep claims blocked
  }
  const reason = block
  block = null
  log(
    reason === 'startup-queue'
      ? 'print-queue-hold: startup queue recovery succeeded; print claims resumed'
      : 'print-queue-hold: queue paused again; print claims resumed',
  )
  return true
}

/** 领取循环的唯一入口。闸门没打开时不调用 claim。 */
export async function claimPrintTasksIfGateOpen(
  recovery: PrintDispatchRecovery,
  claim: () => Promise<void>,
): Promise<void> {
  const mayClaim = await recoverPrintDispatchBeforeClaim(recovery)
  if (!mayClaim) return
  await claim()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 任务到终态后暂停。失败则短间隔再试，一共 3 次。
 * 仍失败就关上领取闸门，下一轮先暂停成功才放行。
 */
export async function pauseQueueAfterTerminalState(
  pause: () => Promise<void>,
  sleep: (ms: number) => Promise<void> = delay,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await sleep(PAUSE_RETRY_DELAYS_MS[attempt - 1] ?? 200)
    try {
      await pause()
      return
    } catch {
      // 下一轮再试。三次都失败才关闸。
    }
  }
  blockPrintDispatch('pause-after-terminal')
  err('print-queue-hold: queue could not be paused after terminal state; print claims blocked')
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
