/**
 * agent/scan-device/scan-device-housekeeping.ts — 玻璃台空闲收场，以及删不干净时的重试
 *
 * 空闲截止从进入 page_ready 起算，不跟着租约请求或等锁顺延。
 * 清理重试绑在场次上：场次变了，或调用方先撤销，就不再删那个目录。
 * 没有 PID 又没确认进程退出时，不把目录删掉。
 */

import type { FetchDeviceLeaseResult } from './scan-device-backend'
import type { ScanDeviceClock } from './scan-device-health'
import type { ScanDeviceDeletionReason, ScanTempPurgeResult } from './scan-temp-dir'

/** 与后端 page_ready 续期窗口一致。 */
export const SCAN_DEVICE_PAGE_READY_IDLE_MS = 10 * 60 * 1000
/** 空闲等待期间向云端核对租约的间隔。 */
export const SCAN_DEVICE_PAGE_READY_CHECK_MS = 60 * 1000
/** 清理没完成时的重试间隔。可从日志里的 attempt 对上是哪一次。 */
export const SCAN_DEVICE_CLEANUP_RETRY_MS = 15_000

export interface HousekeepingSession {
  generation: number
  phase: string
  taskId: string
  stopCode?: string
}

export interface CleanupMeta {
  epoch: number
  pid?: number
  stopUnconfirmed?: boolean
}

interface CleanupJob {
  taskId: string
  reason: ScanDeviceDeletionReason
  attempts: number
  epoch: number
  pid?: number
  stopUnconfirmed: boolean
}

export interface ScanDeviceHousekeeping {
  armIdle(generation: number): void
  disarmIdle(): void
  /** 这一场的空闲截止已经到了。计时器还没跑到时，开下一页前也要看。 */
  idleDue(): boolean
  scheduleCleanup(taskId: string, reason: ScanDeviceDeletionReason, meta?: CleanupMeta): void
  /** 新一场开始前撤销这一任务还挂着的清理。撤销后的任务不会再删目录。 */
  revoke(taskId: string): void
  pending(): number
  stop(): void
}

/**
 * 这一下能不能删。场次已经不是这一笔，或进程还没确认退出，都不能删。
 * 定时器只通过这里决定，避免两处口径。
 */
export function cleanupJobMayDelete(
  job: { epoch: number; stopUnconfirmed: boolean; pid?: number },
  activeEpoch: number | undefined,
  blocked: boolean,
): boolean {
  if (activeEpoch !== undefined && activeEpoch !== job.epoch) return false
  if (blocked) return false
  return true
}

export function createScanDeviceHousekeeping(input: {
  clock: ScanDeviceClock
  purge(taskId: string, reason: ScanDeviceDeletionReason): ScanTempPurgeResult
  isProcessAlive(pid: number): boolean
  /** 没有 PID 的未确认退出还押着时，清理不能往下删。 */
  unidentifiedStop(): boolean
  /** 这个任务当前活着的场次。没有活会话就 undefined，旧场次的重试可以删。 */
  activeEpoch(taskId: string): number | undefined
  fetchLease(now: number): Promise<FetchDeviceLeaseResult>
  session(): HousekeepingSession | undefined
  onIdleTimeout(generation: number): Promise<void>
  onLeaseLost(generation: number, code: string): void
  log(message: string): void
}): ScanDeviceHousekeeping {
  let idleToken = 0
  let idleTimer: unknown
  let checkTimer: unknown
  let deadlineAt: number | undefined
  let cleanupTimer: unknown
  const jobs = new Map<string, CleanupJob>()

  const blocked = (job: CleanupJob): boolean => {
    if (job.stopUnconfirmed && job.pid === undefined) return input.unidentifiedStop()
    if (job.pid !== undefined) return input.isProcessAlive(job.pid)
    return false
  }

  const armCleanupTimer = (): void => {
    if (cleanupTimer !== undefined || jobs.size === 0) return
    cleanupTimer = input.clock.setTimeout(() => {
      cleanupTimer = undefined
      for (const [taskId, job] of jobs) {
        const active = input.activeEpoch(taskId)
        if (!cleanupJobMayDelete(job, active, blocked(job))) {
          if (active !== undefined && active !== job.epoch) {
            jobs.delete(taskId)
            input.log(`scan-device: cleanup dropped task=${taskId} epoch=${job.epoch} active=${active}`)
            continue
          }
          job.attempts += 1
          input.log(`scan-device: cleanup retry waiting task=${taskId} attempt=${job.attempts}`)
          continue
        }
        const result = input.purge(taskId, job.reason)
        job.attempts += 1
        input.log(`scan-device: cleanup retry task=${taskId} attempt=${job.attempts} status=${result.status}`)
        if (result.status !== 'failed') jobs.delete(taskId)
      }
      armCleanupTimer()
    }, SCAN_DEVICE_CLEANUP_RETRY_MS)
  }

  const scheduleCleanup = (taskId: string, reason: ScanDeviceDeletionReason, meta?: CleanupMeta): void => {
    const existing = jobs.get(taskId)
    const epoch = meta?.epoch ?? existing?.epoch ?? 0
    const stopUnconfirmed = meta?.stopUnconfirmed === true || (meta === undefined && existing?.stopUnconfirmed === true)
    const pid = meta?.pid ?? (meta === undefined ? existing?.pid : undefined)
    jobs.set(taskId, {
      taskId,
      reason,
      attempts: existing?.attempts ?? 0,
      epoch,
      stopUnconfirmed,
      ...(pid !== undefined ? { pid } : {}),
    })
    input.log(`scan-device: cleanup pending task=${taskId} reason=${reason} epoch=${epoch}`)
    armCleanupTimer()
  }

  const leaseCode = (fetched: FetchDeviceLeaseResult, taskId: string): string | undefined => {
    if (fetched.kind === 'unavailable' || fetched.kind === 'rejected') return undefined
    if (fetched.kind === 'unauthorized') return 'SCAN_DEVICE_SESSION_CLEARED'
    if (fetched.kind === 'none') return fetched.stopCode ?? 'SCAN_DEVICE_SESSION_CLEARED'
    if (fetched.lease.scanTaskId !== taskId) return 'SCAN_DEVICE_SESSION_CLEARED'
    return undefined
  }

  const withTimeout = (work: Promise<FetchDeviceLeaseResult>): Promise<FetchDeviceLeaseResult | undefined> => new Promise((resolve) => {
    let settled = false
    const timer = input.clock.setTimeout(() => {
      if (settled) return
      settled = true
      resolve(undefined)
    }, SCAN_DEVICE_PAGE_READY_CHECK_MS)
    work.then((value) => {
      if (settled) return
      settled = true
      input.clock.clearTimeout(timer)
      resolve(value)
    }, () => {
      if (settled) return
      settled = true
      input.clock.clearTimeout(timer)
      resolve(undefined)
    })
  })

  const clearIdleTimers = (): void => {
    if (idleTimer !== undefined) input.clock.clearTimeout(idleTimer)
    if (checkTimer !== undefined) input.clock.clearTimeout(checkTimer)
    idleTimer = undefined
    checkTimer = undefined
    deadlineAt = undefined
  }

  const armIdle = (generation: number): void => {
    idleToken += 1
    const token = idleToken
    clearIdleTimers()
    const started = input.clock.now()
    deadlineAt = started + SCAN_DEVICE_PAGE_READY_IDLE_MS
    const still = (): HousekeepingSession | undefined => {
      if (token !== idleToken) return undefined
      const current = input.session()
      if (!current || current.generation !== generation || current.phase !== 'page_ready') return undefined
      return current
    }
    idleTimer = input.clock.setTimeout(() => {
      idleTimer = undefined
      if (!still()) return
      void input.onIdleTimeout(generation)
    }, SCAN_DEVICE_PAGE_READY_IDLE_MS)
    const scheduleCheck = (delay: number): void => {
      checkTimer = input.clock.setTimeout(() => {
        checkTimer = undefined
        const current = still()
        if (!current || deadlineAt === undefined) return
        const remain = deadlineAt - input.clock.now()
        if (remain <= 0) {
          void input.onIdleTimeout(generation)
          return
        }
        void withTimeout(input.fetchLease(input.clock.now())).then((fetched) => {
          const latest = still()
          if (!latest || !fetched) return
          const code = leaseCode(fetched, latest.taskId)
          if (code) input.onLeaseLost(generation, code)
        })
        scheduleCheck(Math.min(SCAN_DEVICE_PAGE_READY_CHECK_MS, remain))
      }, delay)
    }
    scheduleCheck(Math.min(SCAN_DEVICE_PAGE_READY_CHECK_MS, SCAN_DEVICE_PAGE_READY_IDLE_MS))
  }

  const disarmIdle = (): void => {
    idleToken += 1
    clearIdleTimers()
  }

  return {
    armIdle,
    disarmIdle,
    idleDue: () => deadlineAt !== undefined && input.clock.now() >= deadlineAt,
    scheduleCleanup,
    revoke(taskId: string) {
      jobs.delete(taskId)
    },
    pending: () => jobs.size,
    stop() {
      disarmIdle()
      if (cleanupTimer !== undefined) input.clock.clearTimeout(cleanupTimer)
      cleanupTimer = undefined
      jobs.clear()
    },
  }
}
