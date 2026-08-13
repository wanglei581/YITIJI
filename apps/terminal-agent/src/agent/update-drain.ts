import type { AgentDatabase } from './db'
import { getUnresolvedPatchCount, isDatabaseAvailable } from './db'
import type { TaskRunnerControl } from './task-runner-control'

const UPDATE_DRAIN_LEASE_MS = 10 * 60_000
const UPDATE_MAINTENANCE_RECHECK_MS = 5_000
const UPDATE_DRAIN_IDLE_RECHECK_MS = 100

export interface UpdateDrainSnapshot {
  acceptingClaims: boolean
  activeTask: boolean
  activeScanDeliveries: number
  pendingStatusReceipts: number
  ready: boolean
  reason: 'ready' | 'task_active' | 'scan_active' | 'status_receipts_pending' | 'database_unavailable'
}

export interface UpdateDrainController {
  status: () => UpdateDrainSnapshot
  begin: (timeoutMs: number) => Promise<UpdateDrainSnapshot>
  cancel: () => UpdateDrainSnapshot
  complete: () => UpdateDrainSnapshot
}

export interface UpdateDrainControllerOptions {
  /** Prevent a stale drain lease from resuming claims while an updater marker is active. */
  isMaintenanceRequested?: () => boolean
  clearMaintenanceRequest?: () => boolean
  getActiveScanDeliveryCount?: () => number
  pauseScanWatcher?: () => void
  resumeScanWatcher?: () => void
  /** Test-only timing overrides; production callers use the bounded defaults above. */
  leaseMs?: number
  maintenanceRecheckMs?: number
  idleRecheckMs?: number
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function snapshot(
  runner: TaskRunnerControl,
  db: AgentDatabase,
  options: UpdateDrainControllerOptions,
): UpdateDrainSnapshot {
  const runnerStatus = runner.getStatus()
  const activeScanDeliveries = Math.max(0, options.getActiveScanDeliveryCount?.() ?? 0)
  if (!isDatabaseAvailable(db)) {
    return {
      acceptingClaims: runnerStatus.accepting,
      activeTask: runnerStatus.inFlight,
      activeScanDeliveries,
      pendingStatusReceipts: 0,
      ready: false,
      reason: 'database_unavailable',
    }
  }

  const pendingStatusReceipts = getUnresolvedPatchCount(db)
  const reason = runnerStatus.inFlight
    ? 'task_active'
    : activeScanDeliveries > 0
      ? 'scan_active'
    : pendingStatusReceipts > 0
      ? 'status_receipts_pending'
      : 'ready'
  return {
    acceptingClaims: runnerStatus.accepting,
    activeTask: runnerStatus.inFlight,
    activeScanDeliveries,
    pendingStatusReceipts,
    ready: reason === 'ready' && !runnerStatus.accepting,
    reason,
  }
}

/**
 * Pauses new claims and waits for the currently claimed task to finish.
 * Scan delivery and durable status receipts must also be idle before an installer may stop the service.
 */
export function createUpdateDrainController(
  runner: TaskRunnerControl,
  db: AgentDatabase,
  options: UpdateDrainControllerOptions = {},
): UpdateDrainController {
  let leaseTimer: NodeJS.Timeout | undefined
  const leaseMs = options.leaseMs ?? UPDATE_DRAIN_LEASE_MS
  const maintenanceRecheckMs = options.maintenanceRecheckMs ?? UPDATE_MAINTENANCE_RECHECK_MS
  const idleRecheckMs = options.idleRecheckMs ?? UPDATE_DRAIN_IDLE_RECHECK_MS
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('update drain lease must be positive')
  if (!Number.isFinite(maintenanceRecheckMs) || maintenanceRecheckMs <= 0) {
    throw new Error('update maintenance recheck interval must be positive')
  }
  if (!Number.isFinite(idleRecheckMs) || idleRecheckMs <= 0) {
    throw new Error('update drain idle recheck interval must be positive')
  }
  const clearLease = (): void => {
    if (leaseTimer) clearTimeout(leaseTimer)
    leaseTimer = undefined
  }
  const maintenanceRequested = (): boolean => {
    try {
      return options.isMaintenanceRequested?.() ?? false
    } catch {
      // An unreadable updater state is not evidence that printing may resume.
      return true
    }
  }
  const scheduleLeaseRelease = (delayMs: number): void => {
    leaseTimer = setTimeout(() => {
      leaseTimer = undefined
      if (maintenanceRequested()) {
        scheduleLeaseRelease(maintenanceRecheckMs)
        return
      }
      options.resumeScanWatcher?.()
      runner.resume()
    }, delayMs)
    leaseTimer.unref()
  }

  return {
    status: () => snapshot(runner, db, options),
    begin: async (timeoutMs: number) => {
      clearLease()
      options.pauseScanWatcher?.()
      const startedAt = Date.now()
      const idle = await runner.drain(timeoutMs)
      let current = snapshot(runner, db, options)
      while (
        idle
        && !current.activeTask
        && current.activeScanDeliveries > 0
        && Date.now() - startedAt < timeoutMs
      ) {
        await delay(Math.min(idleRecheckMs, Math.max(1, timeoutMs - (Date.now() - startedAt))))
        current = snapshot(runner, db, options)
      }
      if (!idle || !current.ready) {
        // A failed/abandoned update request must never leave normal claims paused.
        options.resumeScanWatcher?.()
        runner.resume()
        return snapshot(runner, db, options)
      }
      scheduleLeaseRelease(leaseMs)
      return current
    },
    cancel: () => {
      clearLease()
      if (maintenanceRequested()) return snapshot(runner, db, options)
      options.resumeScanWatcher?.()
      runner.resume()
      return snapshot(runner, db, options)
    },
    complete: () => {
      const current = snapshot(runner, db, options)
      // The first successful response may be lost while the marker has already
      // been removed and intake resumed. Treat that observable state as the
      // same successful completion so the updater can retry safely.
      if (current.acceptingClaims && !maintenanceRequested()) return current
      if (!current.ready) return current
      if (!options.clearMaintenanceRequest) return current
      if (!options.clearMaintenanceRequest()) return snapshot(runner, db, options)
      clearLease()
      options.resumeScanWatcher?.()
      runner.resume()
      return snapshot(runner, db, options)
    },
  }
}
