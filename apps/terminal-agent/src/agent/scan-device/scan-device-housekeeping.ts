/**
 * agent/scan-device/scan-device-housekeeping.ts — 玻璃台空闲收场，以及删不干净时的重试
 *
 * 玻璃台 page_ready 后 10 分钟没有下一页或完成，就删页并回报 aborted。
 * 这 10 分钟里每分钟向云端对一次租约，会话没了就立刻删。
 * 目录没删掉，或强杀后进程还可能在写页时，不宣称已经删完，过一会儿再试。
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

interface CleanupJob {
  taskId: string
  reason: ScanDeviceDeletionReason
  attempts: number
  pid?: number
}

export interface ScanDeviceHousekeeping {
  armIdle(generation: number): void
  disarmIdle(): void
  scheduleCleanup(taskId: string, reason: ScanDeviceDeletionReason, pid?: number): void
  pending(): number
  stop(): void
}

export function createScanDeviceHousekeeping(input: {
  clock: ScanDeviceClock
  purge(taskId: string, reason: ScanDeviceDeletionReason): ScanTempPurgeResult
  isProcessAlive(pid: number): boolean
  fetchLease(now: number): Promise<FetchDeviceLeaseResult>
  session(): HousekeepingSession | undefined
  onIdleTimeout(generation: number): Promise<void>
  onLeaseLost(generation: number, code: string): void
  log(message: string): void
}): ScanDeviceHousekeeping {
  let idleToken = 0
  let idleTimer: unknown
  let cleanupTimer: unknown
  const jobs = new Map<string, CleanupJob>()

  const armCleanupTimer = (): void => {
    if (cleanupTimer !== undefined || jobs.size === 0) return
    cleanupTimer = input.clock.setTimeout(() => {
      cleanupTimer = undefined
      for (const [taskId, job] of jobs) {
        if (job.pid !== undefined && input.isProcessAlive(job.pid)) {
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

  const scheduleCleanup = (taskId: string, reason: ScanDeviceDeletionReason, pid?: number): void => {
    const existing = jobs.get(taskId)
    jobs.set(taskId, {
      taskId,
      reason,
      attempts: existing?.attempts ?? 0,
      ...(pid !== undefined ? { pid } : existing?.pid !== undefined ? { pid: existing.pid } : {}),
    })
    input.log(`scan-device: cleanup pending task=${taskId} reason=${reason}`)
    armCleanupTimer()
  }

  const leaseCode = (fetched: FetchDeviceLeaseResult, taskId: string): string | undefined => {
    if (fetched.kind === 'unavailable' || fetched.kind === 'rejected') return undefined
    if (fetched.kind === 'unauthorized') return 'SCAN_DEVICE_SESSION_CLEARED'
    if (fetched.kind === 'none') return fetched.stopCode ?? 'SCAN_DEVICE_SESSION_CLEARED'
    if (fetched.lease.scanTaskId !== taskId) return 'SCAN_DEVICE_SESSION_CLEARED'
    return undefined
  }

  const armIdle = (generation: number): void => {
    idleToken += 1
    const token = idleToken
    if (idleTimer !== undefined) input.clock.clearTimeout(idleTimer)
    const started = input.clock.now()
    const tick = (): void => {
      idleTimer = undefined
      if (token !== idleToken) return
      const current = input.session()
      if (!current || current.generation !== generation || current.phase !== 'page_ready') return
      const elapsed = input.clock.now() - started
      if (elapsed >= SCAN_DEVICE_PAGE_READY_IDLE_MS) {
        void input.onIdleTimeout(generation)
        return
      }
      void input.fetchLease(input.clock.now()).then((fetched) => {
        if (token !== idleToken) return
        const latest = input.session()
        if (!latest || latest.generation !== generation || latest.phase !== 'page_ready') return
        const code = leaseCode(fetched, latest.taskId)
        if (code) {
          input.onLeaseLost(generation, code)
          return
        }
        const remain = SCAN_DEVICE_PAGE_READY_IDLE_MS - (input.clock.now() - started)
        if (remain <= 0) {
          void input.onIdleTimeout(generation)
          return
        }
        idleTimer = input.clock.setTimeout(tick, Math.min(SCAN_DEVICE_PAGE_READY_CHECK_MS, remain))
      })
    }
    idleTimer = input.clock.setTimeout(tick, Math.min(SCAN_DEVICE_PAGE_READY_CHECK_MS, SCAN_DEVICE_PAGE_READY_IDLE_MS))
  }

  const disarmIdle = (): void => {
    idleToken += 1
    if (idleTimer !== undefined) input.clock.clearTimeout(idleTimer)
    idleTimer = undefined
  }

  return {
    armIdle,
    disarmIdle,
    scheduleCleanup,
    pending: () => jobs.size,
    stop() {
      disarmIdle()
      if (cleanupTimer !== undefined) input.clock.clearTimeout(cleanupTimer)
      cleanupTimer = undefined
    },
  }
}
