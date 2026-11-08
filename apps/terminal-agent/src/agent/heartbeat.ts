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
import { getDiskFreeGB, getPrinterStatusAndRaw } from './wmi'
import { printerStatusForHeartbeat } from './print-dispatch-gate'
import { collectNetworkDiagnostics, type NetworkDiagnostics } from './network-diagnostics'
import {
  collectPrinterQueueDiagnostics,
  type PrinterQueueDiagnostics,
} from './printer-queue-diagnostics'
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
  /** 屏上扫描开关打开时由 index 传入。没有回调就不带扫描仪字段。 */
  getScanDeviceHealth?: () => { health: HeartbeatPayload['scanDeviceHealth']; observedAt: string }
  /** 门禁注入。生产不传，走真实探针。 */
  readPrinterStatusAndRaw?: typeof getPrinterStatusAndRaw
  readDiskFreeGB?: () => Promise<number>
  readNetworkDiagnostics?: (printerName: string) => Promise<NetworkDiagnostics>
  readPrinterQueueDiagnostics?: (printerName: string) => Promise<PrinterQueueDiagnostics>
  /** 门禁注入时钟。缺省用 Date.now。 */
  now?: () => number
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

const PRINTER_QUEUE_FIELD_KEYS = [
  'printerQueueName',
  'printerQueuePortKind',
  'printerQueuePortName',
  'printerQueueRawStatus',
  'printerQueueSpooler',
] as const

const PRINTER_QUEUE_SUPPRESS_MS = 60 * 60 * 1000
let printerQueueSuppressedUntil = 0
let printerQueueUnrecognizedWarnAt = Number.NEGATIVE_INFINITY

/** 门禁在用例之间清掉「一小时内不再带」的记忆。 */
export function __resetPrinterQueueFieldRetryForTests(): void {
  printerQueueSuppressedUntil = 0
  printerQueueUnrecognizedWarnAt = Number.NEGATIVE_INFINITY
}

/** 门禁读取「一小时内不带」的截止时间。 */
export function __printerQueueFieldRetrySuppressedUntilForTests(): number {
  return printerQueueSuppressedUntil
}

function heartbeatNow(options: HeartbeatOptions): number {
  return options.now?.() ?? Date.now()
}

function isBadRequestHttpError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 400
}

function hasPrinterQueueFields(payload: HeartbeatPayload): boolean {
  return PRINTER_QUEUE_FIELD_KEYS.some((key) => payload[key] !== undefined)
}

function omitPrinterQueueFields(payload: HeartbeatPayload): HeartbeatPayload {
  const next: HeartbeatPayload = { ...payload }
  for (const key of PRINTER_QUEUE_FIELD_KEYS) delete next[key]
  return next
}

/**
 * 队列名按配置原样上报。长度 1–128（按 `name.length`，UTF-16 码元），
 * 不含 U+0000–U+001F、U+007F–U+009F。
 * 像地址的不带 `printerQueueName`（契约不上传打印机地址）：以 `\\` 开头的 UNC、
 * 含 `://`、或含 IPv4 形四段数字。其余四个队列字段照带。
 * 和后端 `services/api/src/terminals/heartbeat-printer-queue.ts` 同一规则，改一边要改两边。
 */
const PRINTER_QUEUE_NAME_IPV4 = /(^|[^0-9])\d{1,3}(\.\d{1,3}){3}([^0-9]|$)/

function printerQueueNameForHeartbeat(name: string): string | undefined {
  if (name.length < 1 || name.length > 128) return undefined
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return undefined
  }
  if (name.startsWith('\\\\')) return undefined
  if (name.includes('://')) return undefined
  if (PRINTER_QUEUE_NAME_IPV4.test(name)) return undefined
  return name
}

function rememberSuccessfulQueueFieldFallback(options: HeartbeatOptions): void {
  // 截止和警告节流都在重发成功这一刻现取，不用探针开始前的时间。
  // 两次心跳重叠时取较晚的截止，避免晚返回的那次把时间写回更早。
  const nowMs = heartbeatNow(options)
  printerQueueSuppressedUntil = Math.max(
    printerQueueSuppressedUntil,
    nowMs + PRINTER_QUEUE_SUPPRESS_MS,
  )
  if (nowMs - printerQueueUnrecognizedWarnAt >= PRINTER_QUEUE_SUPPRESS_MS) {
    warn('heartbeat: 带打印队列字段的心跳被拒（400），去掉这些字段后重发成功；1 小时内不带')
    printerQueueUnrecognizedWarnAt = nowMs
  }
}

function attachPrinterQueueFields(
  payload: HeartbeatPayload,
  printerName: string,
  queue: PrinterQueueDiagnostics,
  rawStatus: string | undefined,
): void {
  const name = printerQueueNameForHeartbeat(printerName)
  if (name) payload.printerQueueName = name
  payload.printerQueuePortKind = queue.portKind
  payload.printerQueueSpooler = queue.spooler
  if (queue.portName) payload.printerQueuePortName = queue.portName
  if (rawStatus) payload.printerQueueRawStatus = rawStatus
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
  const nowMs = heartbeatNow(options)
  const includePrinterQueue = nowMs >= printerQueueSuppressedUntil
  const readPrinter = options.readPrinterStatusAndRaw ?? getPrinterStatusAndRaw
  const readDisk = options.readDiskFreeGB ?? getDiskFreeGB
  const readNetwork = options.readNetworkDiagnostics ?? collectNetworkDiagnostics
  const readQueue = options.readPrinterQueueDiagnostics ?? collectPrinterQueueDiagnostics

  // 不带队列字段的这一小时里不跑队列探针，省一次 PowerShell。打印机状态照常查。
  // 要查的时候，队列探针仍和另外三路同一次 Promise.all，超时 5 秒，不另加等待。
  const [printerReading, diskFreeGB, networkDiagnostics, printerQueue] = await Promise.all([
    readPrinter(config.printerName),
    readDisk(),
    readNetwork(config.printerName),
    includePrinterQueue ? readQueue(config.printerName) : Promise.resolve(undefined),
  ])
  const queriedPrinterStatus = printerReading.status
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
  if (includePrinterQueue && printerQueue) {
    attachPrinterQueueFields(payload, config.printerName, printerQueue, printerReading.rawStatus)
  }
  const scanInputTelemetry = options.getScanInputTelemetry?.()
  if (scanInputTelemetry) {
    payload.scanInputHealth = scanInputTelemetry.health
    payload.scanInputAction = scanInputTelemetry.requiredAction
    payload.scanInputReason = scanInputTelemetry.reason
    payload.scanInputObservedAt = scanInputTelemetry.observedAt
  }
  const scanDeviceHealth = options.getScanDeviceHealth?.()
  if (scanDeviceHealth) {
    payload.scanDeviceHealth = scanDeviceHealth.health ?? undefined
    payload.scanDeviceObservedAt = scanDeviceHealth.observedAt
  }

  const finishFailure = (body: HeartbeatPayload, error: unknown): boolean => {
    if (isUnauthorizedHttpError(error)) {
      markUnauthorized()
      writeStartupDiagnosticSafely('AGENT_UNAUTHORIZED')
      err('heartbeat: ✗ unauthorized — credential revoked/invalid; claim/print stopped (re-bind required)')
      if (failureCounter) failureCounter.count += 1
      notifyObservation(onObservation, {
        connected: false,
        observedAt: body.reportedAt,
        printerStatus,
      })
      return false
    }

    const msg = axiosErrorMessage(error)
    warn(`heartbeat: ✗ failed — ${msg}`)

    if (failureCounter) {
      failureCounter.count += 1
      if (failureCounter.count >= 3) {
        err(`heartbeat: ${failureCounter.count} consecutive failures — check backend connectivity`)
      }
    }

    notifyObservation(onObservation, {
      connected: false,
      observedAt: body.reportedAt,
      printerStatus,
    })
    return false
  }

  const putOnce = async (body: HeartbeatPayload, allowQueueRetry: boolean): Promise<boolean> => {
    try {
      const resp = await client.put<HeartbeatResponse>(
        `/terminals/${config.terminalId}/heartbeat`,
        body,
      )
      // allowQueueRetry 为 false 只出现在「去掉队列字段之后的那一次重发」。
      // 只有这次成功才进入一小时不带。
      if (!allowQueueRetry) rememberSuccessfulQueueFieldFallback(options)
      log(`heartbeat: ✓ acknowledged`)
      notifyObservation(onObservation, {
        connected: true,
        observedAt: body.reportedAt,
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
    } catch (error) {
      // 400 且这次带了打印队列字段：去掉五个字段立刻重发一次。
      // 重发仍是 400、401 或网络错误：不进入不带、不打那句警告，走原来的失败路径。
      if (allowQueueRetry && isBadRequestHttpError(error) && hasPrinterQueueFields(body)) {
        return putOnce(omitPrinterQueueFields(body), false)
      }
      return finishFailure(body, error)
    }
  }

  return putOnce(payload, true)
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
