/**
 * agent/heartbeat.ts — Phase 8.2B
 *
 * Sends a heartbeat to the backend every N seconds:
 *   PUT /terminals/:terminalId/heartbeat
 *
 * The heartbeat payload includes:
 *   - status: always 'online' (if we can reach the server, we're online)
 *   - printerStatus: real Win32_Printer WMI query (Phase 8.2B); 'unknown' on macOS
 *   - diskFreeGB: real Get-PSDrive C: query (Phase 8.2B); -1 on macOS
 *   - agentVersion, ipAddress, macAddress, reportedAt
 *
 * On server response:
 *   - acknowledged: true → log OK
 *   - config overrides (heartbeatIntervalMs / claimIntervalMs) → invoke onConfigUpdate
 *
 * Failure handling:
 *   - Network / 5xx: log warn, continue (agent stays running)
 *   - 401: latch unauthorized locally (cannot report cloud status), stop claiming
 *   - failureCounter: incremented per failure for caller to monitor
 */

import os from 'os'
import type { AgentConfig, HeartbeatPayload, HeartbeatResponse, PrinterStatus } from './types'
import { createApiClient, axiosErrorMessage, isUnauthorizedHttpError } from './api-client'
import { isUnauthorized, markUnauthorized } from './auth-state'
import { writeStartupDiagnosticSafely } from './startup-diagnostics'
import { getPrinterStatus, getDiskFreeGB } from './wmi'
import { collectNetworkDiagnostics } from './network-diagnostics'
import { observeReleasePlan } from './release-observation'
import { log, warn, err } from '../logger'
import { AGENT_RUNTIME_VERSION } from '../runtime-version'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Return the first non-internal IPv4 address, or '127.0.0.1' as fallback. */
function getIpAddress(): string {
  const interfaces = os.networkInterfaces()
  for (const ifaces of Object.values(interfaces)) {
    if (!ifaces) continue
    for (const addr of ifaces) {
      if (!addr.internal && addr.family === 'IPv4') {
        return addr.address
      }
    }
  }
  return '127.0.0.1'
}

/**
 * Return the first non-internal MAC address, or undefined if none found.
 * Reported on every heartbeat (not just registration) so 终端设备档案 backfills
 * for terminals registered before macAddress reporting existed; backend
 * treats the reporting terminal's own already-bound MAC as a no-op, not a
 * conflict (see terminals.service.ts assertMacAvailable ownerRef check).
 */
function getMacAddress(): string | undefined {
  const interfaces = os.networkInterfaces()
  for (const ifaces of Object.values(interfaces)) {
    if (!ifaces) continue
    for (const addr of ifaces) {
      if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
        return addr.mac
      }
    }
  }
  return undefined
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface HeartbeatOptions {
  config: AgentConfig
  /** Called when server sends updated config in heartbeat response. */
  onConfigUpdate?: (patch: Partial<AgentConfig>) => void
  /** Mutable counter incremented on each consecutive failure; reset on success. */
  failureCounter?: { count: number }
  /** False when local SQLite task DB is unavailable; printing must be disabled. */
  localTaskDatabaseAvailable?: boolean
  /** Receives a PII-safe connectivity snapshot for the loopback status panel. */
  onObservation?: (observation: HeartbeatObservation) => void
}

export interface HeartbeatObservation {
  connected: boolean
  observedAt: string
  printerStatus: PrinterStatus
}

function notifyObservation(
  callback: HeartbeatOptions['onObservation'],
  observation: HeartbeatObservation,
): void {
  try {
    callback?.(observation)
  } catch {
    warn('heartbeat: local status observer failed')
  }
}

/**
 * Send a single heartbeat.
 * Returns true on success, false on failure.
 * Never throws.
 */
export async function sendHeartbeat(options: HeartbeatOptions): Promise<boolean> {
  const { config, onConfigUpdate, failureCounter, onObservation } = options
  const localTaskDatabaseAvailable = options.localTaskDatabaseAvailable ?? true

  if (!config.terminalId || !config.agentToken) {
    warn('heartbeat: skipping — not registered yet')
    notifyObservation(onObservation, {
      connected: false,
      observedAt: new Date().toISOString(),
      printerStatus: 'unknown',
    })
    return false
  }

  if (isUnauthorized()) {
    warn('heartbeat: skipping — credential unauthorized (re-bind required)')
    notifyObservation(onObservation, {
      connected: false,
      observedAt: new Date().toISOString(),
      printerStatus: 'unknown',
    })
    return false
  }

  const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)

  const [printerStatus, diskFreeGB, networkDiagnostics] = await Promise.all([
    getPrinterStatus(config.printerName),
    getDiskFreeGB(),
    collectNetworkDiagnostics(config.printerName),
  ])

  const payload: HeartbeatPayload = {
    status: localTaskDatabaseAvailable ? 'online' : 'agent_degraded',
    printerStatus,
    diskFreeGB,
    agentVersion: AGENT_RUNTIME_VERSION,
    ipAddress: getIpAddress(),
    macAddress: getMacAddress(),
    reportedAt: new Date().toISOString(),
    localTaskDatabaseAvailable,
    ...networkDiagnostics,
  }

  try {
    const resp = await client.put<HeartbeatResponse>(
      `/terminals/${config.terminalId}/heartbeat`,
      payload,
    )
    log(`heartbeat: ✓ acknowledged`)
    notifyObservation(onObservation, {
      connected: true,
      observedAt: payload.reportedAt,
      printerStatus,
    })

    if (failureCounter) failureCounter.count = 0

    // Apply server-pushed config overrides (e.g. updated poll intervals)
    if (resp.data.config && onConfigUpdate) {
      onConfigUpdate(resp.data.config as Partial<AgentConfig>)
    }

    // Separate from the mutable `config` response: this only observes a plan
    // and reports the already-running version. It cannot change runtime state.
    void observeReleasePlan(config)

    return true
  } catch (e) {
    if (isUnauthorizedHttpError(e)) {
      markUnauthorized()
      writeStartupDiagnosticSafely('AGENT_UNAUTHORIZED')
      err('heartbeat: ✗ unauthorized — credential revoked/invalid; claim/print stopped (re-bind required)')
      if (failureCounter) failureCounter.count += 1
      notifyObservation(onObservation, {
        connected: false,
        observedAt: payload.reportedAt,
        printerStatus,
      })
      return false
    }

    const msg = axiosErrorMessage(e)
    warn(`heartbeat: ✗ failed — ${msg}`)

    if (failureCounter) {
      failureCounter.count += 1
      if (failureCounter.count >= 3) {
        err(`heartbeat: ${failureCounter.count} consecutive failures — check backend connectivity`)
      }
    }

    notifyObservation(onObservation, {
      connected: false,
      observedAt: payload.reportedAt,
      printerStatus,
    })

    return false
  }
}

/**
 * Start the heartbeat interval.
 * Sends the first heartbeat immediately, then every heartbeatIntervalMs.
 *
 * @returns NodeJS.Timeout — pass to clearInterval() to stop.
 */
export function startHeartbeat(options: HeartbeatOptions, sendImmediately = true): NodeJS.Timeout {
  const interval = options.config.heartbeatIntervalMs ?? 30_000
  log(`heartbeat: starting — interval=${interval}ms`)

  if (sendImmediately) sendHeartbeat(options).catch(() => undefined)

  return setInterval(() => {
    sendHeartbeat(options).catch(() => undefined)
  }, interval)
}
