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
import axios from 'axios'
import type {
  AgentConfig,
  HeartbeatPayload,
  HeartbeatResponse,
  PrinterStatus,
  ScanInputRuntimeTelemetry,
} from './types'
import { createApiClient, axiosErrorMessage, isUnauthorizedHttpError } from './api-client'
import { isUnauthorized, markUnauthorized } from './auth-state'
import { writeStartupDiagnosticSafely } from './startup-diagnostics'
import { getPrinterStatus, getDiskFreeGB } from './wmi'
import { printerStatusForHeartbeat } from './print-dispatch-gate'
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
  /** Read on every send because heartbeat starts before the scan watcher. */
  getScanInputTelemetry?: () => ScanInputRuntimeTelemetry
  /** 心跳成功后处理服务端下发的远程指令。没有指令时不调用。 */
  onRemoteCommands?: (commands: unknown) => Promise<void>
}

/** 进程启动时取一次，之后不变。后端靠它判断重启是否已经完成。 */
const AGENT_STARTED_AT = new Date().toISOString()
/** 旧服务器 forbidNonWhitelisted 会因这个字段回 400。本进程内停发。 */
let sendAgentStartedAt = true

export function resetAgentStartedAtFallbackForTests(): void {
  sendAgentStartedAt = true
}

function validationText(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** 只看 400 的 error.message / error.details（以及顶层 message）。别的状态不算。 */
export function heartbeatRejectsAgentStartedAt(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 400) return false
  const data = error.response.data
  if (!data || typeof data !== 'object') return false
  const root = data as { message?: unknown; error?: unknown }
  const lines = validationText(root.message)
  const nested = root.error
  if (nested && typeof nested === 'object') {
    const errBody = nested as { message?: unknown; details?: unknown }
    lines.push(...validationText(errBody.message), ...validationText(errBody.details))
  }
  return lines.some((line) => line.includes('agentStartedAt'))
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
  return deliverHeartbeat(options, true)
}

async function deliverHeartbeat(options: HeartbeatOptions, allowStartedAtFallback: boolean): Promise<boolean> {
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

  const [queriedPrinterStatus, diskFreeGB, networkDiagnostics] = await Promise.all([
    getPrinterStatus(config.printerName),
    getDiskFreeGB(),
    collectNetworkDiagnostics(config.printerName),
  ])
  const printerStatus = printerStatusForHeartbeat(queriedPrinterStatus)

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
  const scanInputTelemetry = options.getScanInputTelemetry?.()
  if (scanInputTelemetry) {
    payload.scanInputHealth = scanInputTelemetry.health
    payload.scanInputAction = scanInputTelemetry.requiredAction
    payload.scanInputReason = scanInputTelemetry.reason
    payload.scanInputObservedAt = scanInputTelemetry.observedAt
  }
  if (sendAgentStartedAt) payload.agentStartedAt = AGENT_STARTED_AT

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

    if (options.onRemoteCommands && resp.data != null && Object.prototype.hasOwnProperty.call(resp.data, 'commands')) {
      try {
        await options.onRemoteCommands(resp.data.commands)
      } catch {
        warn('remote-command: processing failed')
      }
    }

    // Separate from the mutable `config` response: this only observes a plan
    // and reports the already-running version. It cannot change runtime state.
    void observeReleasePlan(config)

    return true
  } catch (e) {
    if (
      allowStartedAtFallback
      && sendAgentStartedAt
      && heartbeatRejectsAgentStartedAt(e)
    ) {
      sendAgentStartedAt = false
      log('heartbeat: server does not accept agentStartedAt, disabled')
      return deliverHeartbeat(options, false)
    }
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
