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
 *   - agentVersion, ipAddress, reportedAt
 *
 * On server response:
 *   - acknowledged: true → log OK
 *   - config overrides (heartbeatIntervalMs / claimIntervalMs) → invoke onConfigUpdate
 *
 * Failure handling:
 *   - Network / 5xx: log warn, continue (agent stays running)
 *   - 401: log error (no auto re-registration; operator must restart agent)
 *   - failureCounter: incremented per failure for caller to monitor
 */

import os from 'os'
import type { AgentConfig, HeartbeatPayload, HeartbeatResponse } from './types'
import { createApiClient, axiosErrorMessage } from './api-client'
import { getPrinterStatus, getDiskFreeGB } from './wmi'
import { log, warn, err } from '../logger'

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

// ── Public API ────────────────────────────────────────────────────────────────

export interface HeartbeatOptions {
  config: AgentConfig
  /** Called when server sends updated config in heartbeat response. */
  onConfigUpdate?: (patch: Partial<AgentConfig>) => void
  /** Mutable counter incremented on each consecutive failure; reset on success. */
  failureCounter?: { count: number }
}

/**
 * Send a single heartbeat.
 * Returns true on success, false on failure.
 * Never throws.
 */
export async function sendHeartbeat(options: HeartbeatOptions): Promise<boolean> {
  const { config, onConfigUpdate, failureCounter } = options

  if (!config.terminalId || !config.agentToken) {
    warn('heartbeat: skipping — not registered yet')
    return false
  }

  const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)

  const [printerStatus, diskFreeGB] = await Promise.all([
    getPrinterStatus(config.printerName),
    getDiskFreeGB(),
  ])

  const payload: HeartbeatPayload = {
    status: 'online',
    printerStatus,
    diskFreeGB,
    agentVersion: config.agentVersion,
    ipAddress: getIpAddress(),
    reportedAt: new Date().toISOString(),
  }

  try {
    const resp = await client.put<HeartbeatResponse>(
      `/terminals/${config.terminalId}/heartbeat`,
      payload,
    )
    log(`heartbeat: ✓ acknowledged`)

    if (failureCounter) failureCounter.count = 0

    // Apply server-pushed config overrides (e.g. updated poll intervals)
    if (resp.data.config && onConfigUpdate) {
      onConfigUpdate(resp.data.config as Partial<AgentConfig>)
    }

    return true
  } catch (e) {
    const msg = axiosErrorMessage(e)
    warn(`heartbeat: ✗ failed — ${msg}`)

    if (failureCounter) {
      failureCounter.count += 1
      if (failureCounter.count >= 3) {
        err(`heartbeat: ${failureCounter.count} consecutive failures — check backend connectivity`)
      }
    }

    return false
  }
}

/**
 * Start the heartbeat interval.
 * Sends the first heartbeat immediately, then every heartbeatIntervalMs.
 *
 * @returns NodeJS.Timeout — pass to clearInterval() to stop.
 */
export function startHeartbeat(options: HeartbeatOptions): NodeJS.Timeout {
  const interval = options.config.heartbeatIntervalMs ?? 30_000
  log(`heartbeat: starting — interval=${interval}ms`)

  // First heartbeat immediately
  sendHeartbeat(options).catch(() => undefined)

  return setInterval(() => {
    sendHeartbeat(options).catch(() => undefined)
  }, interval)
}
