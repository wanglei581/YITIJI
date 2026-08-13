import fs from 'node:fs'
import path from 'node:path'
import { warn } from '../logger'
import type { TaskRunnerControl } from './task-runner-control'

const MAX_MAINTENANCE_LEASE_MS = 30 * 60_000

export function resolveUpdateMaintenanceMarker(programDataDir = process.env['PROGRAMDATA']): string {
  const stateRoot = programDataDir
    ? path.join(programDataDir, 'AIJobPrintAgent')
    : path.resolve(__dirname, '../../config')
  return path.join(stateRoot, 'updates', 'update-maintenance.json')
}

/**
 * A protected, short-lived marker keeps a newly installed Agent from claiming
 * work before the updater has completed local and cloud health checks.
 */
export function isUpdateMaintenanceRequested(options?: {
  markerPath?: string
  nowMs?: number
}): boolean {
  const markerPath = options?.markerPath ?? resolveUpdateMaintenanceMarker()
  if (!fs.existsSync(markerPath)) return false

  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as { expiresAt?: unknown }
    const expiresAt = typeof parsed.expiresAt === 'string' ? Date.parse(parsed.expiresAt) : Number.NaN
    const now = options?.nowMs ?? Date.now()
    if (!Number.isFinite(expiresAt)) {
      warn('update: maintenance marker is invalid; removing it to avoid a permanent claim outage')
      fs.rmSync(markerPath, { force: true })
      return false
    }
    if (expiresAt <= now) {
      fs.rmSync(markerPath, { force: true })
      return false
    }
    if (expiresAt - now > MAX_MAINTENANCE_LEASE_MS) {
      warn('update: maintenance marker lease exceeds the allowed window; removing it')
      fs.rmSync(markerPath, { force: true })
      return false
    }
    return true
  } catch {
    warn('update: maintenance marker cannot be read; removing it to avoid a permanent claim outage')
    try { fs.rmSync(markerPath, { force: true }) } catch {}
    return false
  }
}

/** Clear the protected marker before a successful updater resumes claims. */
export function clearUpdateMaintenanceMarker(markerPath = resolveUpdateMaintenanceMarker()): boolean {
  try {
    fs.rmSync(markerPath, { force: true })
    return !fs.existsSync(markerPath)
  } catch {
    warn('update: maintenance marker could not be cleared; claims remain paused')
    return false
  }
}

/** Pause claims for the marker lease and recover automatically if the updater dies. */
export function startUpdateMaintenanceLease(
  runner: TaskRunnerControl,
  options?: {
    markerPath?: string
    nowMs?: number
    pauseAdditionalIntake?: () => void
    resumeAdditionalIntake?: () => void
    recheckMs?: number
  },
): NodeJS.Timeout | null {
  const markerPath = options?.markerPath ?? resolveUpdateMaintenanceMarker()
  const now = options?.nowMs ?? Date.now()
  if (!isUpdateMaintenanceRequested({ markerPath, nowMs: now })) return null

  runner.pause()
  options?.pauseAdditionalIntake?.()
  const recheckMs = options?.recheckMs ?? 5_000
  if (!Number.isFinite(recheckMs) || recheckMs <= 0) {
    throw new Error('update maintenance recheck interval must be positive')
  }

  const timer = setInterval(() => {
    if (isUpdateMaintenanceRequested({ markerPath })) return
    clearInterval(timer)
    options?.resumeAdditionalIntake?.()
    runner.resume()
  }, recheckMs)
  timer.unref()
  return timer
}
