/**
 * 后台下发的远程指令：重启本进程，或清空配置打印机上的全部作业。
 * 回执只带结果和剩余作业数，不带文档名、账号、作业标题。
 */

import { performance } from 'node:perf_hooks'
import { requestServiceRestart } from './service-restart'
import { createRemoteCommandStore, type RemoteCommandStore, type StoredCommandResult } from './remote-command-store'
import type { AgentConfig } from './types'
import { createApiClient, NO_RETRY_CONFIG } from './api-client'
import { log } from '../logger'
import { holdPrintClaims, pauseQueueOnProcessStop, releasePrintClaims } from './print-dispatch-gate'
import { clearAllJobsOnConfiguredPrinter, pauseConfiguredPrinterQueue } from './print-queue-hold'
import { hasInFlightPrintWork } from './task-runner'
import { isScanDeliveryInFlight } from './scan-watcher'

const RESTART = 'restart_agent'
const CLEAR = 'clear_print_queue'
const REMOTE_RESTART_EXIT_CODE = 1

export type RemoteCommandResult = 'accepted' | 'rejected_busy' | 'expired' | 'done' | 'failed'

export interface RemoteCommandAckBody {
  result: RemoteCommandResult
  remainingJobs?: number
}

export interface RemoteCommandDeps {
  now?: () => Date
  isBusy: () => boolean | Promise<boolean>
  ack: (commandId: string, body: RemoteCommandAckBody) => Promise<RemoteCommandResult | null>
  monotonicNow?: () => number
  sleep?: (ms: number) => Promise<void>
  store?: RemoteCommandStore
  requestServiceRestart?: () => Promise<boolean>
  restartFallbackMs?: number
  scheduleFallback?: (callback: () => void, ms: number) => void
  exit: (code: number) => void
  holdPrinterQueueWhenIdle: boolean
  pauseQueue: () => Promise<void>
  clearPrintQueue: (printerName: string) => Promise<{ result: 'done' | 'failed'; remainingJobs: number }>
  holdClaims: (reason: 'restart_agent' | 'clear_print_queue') => void
  releaseClaims: () => void
  printerName: string
}

interface ParsedCommand {
  id: string
  type: typeof RESTART | typeof CLEAR
  expiresAt: number
  issuedAt: number
  receivedAt: number
}

function idPrefix(id: string): string {
  return id.slice(0, 8)
}

function commandLog(id: string, type: string, result: string, remaining?: number): void {
  const count = remaining === undefined ? '' : ` remaining=${remaining}`
  log(`remote-command: id=${idPrefix(id)} type=${type} result=${result}${count}`)
}

function previewId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return '-'
  return value.slice(0, 8)
}

function previewType(value: unknown): string {
  if (value === RESTART || value === CLEAR) return value
  if (typeof value === 'string' && value.length <= 32 && /^[a-z0-9_]+$/.test(value)) return value
  return 'invalid'
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function parseCommand(value: unknown, receivedAt: number): ParsedCommand | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row['id'] !== 'string' || row['id'].length < 1 || row['id'].length > 64) return null
  if (row['type'] !== RESTART && row['type'] !== CLEAR) return null
  const issuedAt = parseTime(row['issuedAt'])
  const expiresAt = parseTime(row['expiresAt'])
  if (issuedAt === null || expiresAt === null) return null
  return { id: row['id'], type: row['type'], expiresAt, issuedAt, receivedAt }
}

function nonNegativeInt(value: number): number {
  if (!Number.isInteger(value) || value < 0) return 0
  return value
}

function ackBodyForClear(outcome: { result: 'done' | 'failed'; remainingJobs: number }): RemoteCommandAckBody {
  const remaining = nonNegativeInt(outcome.remainingJobs)
  if (outcome.result === 'done' && remaining === 0) return { result: 'done' }
  return { result: 'failed', remainingJobs: remaining }
}

export function createRemoteCommandProcessor(
  deps: RemoteCommandDeps,
): (commands: unknown, context?: { agentStartedAtSent: boolean }) => Promise<void> {
  const seen = new Set<string>()
  const memoryResults = new Map<string, StoredCommandResult>()
  const firstReceipt = new Map<string, number>()
  const monotonicNow = deps.monotonicNow ?? (() => performance.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const store = deps.store ?? createRemoteCommandStore()
  let storeWarningLogged = false
  const storage = <T>(action: () => T): T | undefined => {
    try { return action() } catch {
      if (!storeWarningLogged) {
        log('remote-command: local result database unavailable; using memory')
        storeWarningLogged = true
      }
      return undefined
    }
  }
  const remember = (row: StoredCommandResult): void => {
    memoryResults.set(row.commandId, row)
    storage(() => store.put(row))
  }
  const acknowledge = async (id: string, body: RemoteCommandAckBody): Promise<RemoteCommandResult | null> => {
    try { return await deps.ack(id, body) } catch { return null }
  }
  const clearAck = async (row: StoredCommandResult): Promise<boolean> => {
    const body: RemoteCommandAckBody = row.result === 'done' && row.remainingJobs === 0
      ? { result: row.result } : { result: row.result, remainingJobs: row.remainingJobs }
    const result = await acknowledge(row.commandId, body)
    if (result !== null) remember({ ...row, result })
    commandLog(row.commandId, row.type, result ?? 'ack_failed', row.remainingJobs)
    return result !== null
  }
  const ackWithoutAction = async (command: ParsedCommand, body: RemoteCommandAckBody): Promise<boolean> => {
    const result = await acknowledge(command.id, body)
    if (command.type === CLEAR && result !== null) {
      remember({ commandId: command.id, type: CLEAR, result, remainingJobs: 0,
        finishedAt: (deps.now?.() ?? new Date()).toISOString() })
    }
    commandLog(command.id, command.type, result ?? 'ack_failed')
    return result !== null
  }
  const queued = new Set<string>()
  const pending: ParsedCommand[] = []
  let restarting = false
  let draining = false
  let inFlightId: string | null = null

  const enqueue = (commands: unknown, context?: { agentStartedAtSent: boolean }): void => {
    if (restarting) return
    if (!Array.isArray(commands)) {
      commandLog('-', 'invalid', 'skipped')
      return
    }
    for (const entry of commands) {
      const parsed = parseCommand(entry, monotonicNow())
      if (!parsed) {
        const row = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        commandLog(previewId(row['id']) === '-' ? '-' : String(row['id']), previewType(row['type']), 'skipped')
        continue
      }
      if (parsed.type === RESTART && context?.agentStartedAtSent === false) {
        log('restart deferred: heartbeat sent without agentStartedAt')
        continue
      }
      if (seen.has(parsed.id) || queued.has(parsed.id) || inFlightId === parsed.id) continue
      if (!firstReceipt.has(parsed.id)) firstReceipt.set(parsed.id, parsed.receivedAt)
      parsed.receivedAt = firstReceipt.get(parsed.id)!
      queued.add(parsed.id)
      pending.push(parsed)
    }
  }

  const handle = async (command: ParsedCommand): Promise<boolean> => {
    if (command.type === CLEAR) {
      const now = deps.now?.() ?? new Date()
      storage(() => store.prune(now))
      for (const [id, row] of memoryResults) {
        if (now.getTime() - Date.parse(row.finishedAt) > 86_400_000) memoryResults.delete(id)
      }
      const saved = storage(() => store.get(command.id)) ?? memoryResults.get(command.id)
      if (saved) return clearAck(saved)
      if (monotonicNow() - command.receivedAt > command.expiresAt - command.issuedAt) {
        return ackWithoutAction(command, { result: 'expired' })
      }
    }
    // 先挡住领取，再查忙。顺序反过来时，领取循环可能在两步之间开始一单。
    deps.holdClaims(command.type)
    if (await deps.isBusy()) {
      deps.releaseClaims()
      return ackWithoutAction(command, { result: 'rejected_busy' })
    }
    if (command.type === RESTART) return acceptRestart(command)
    return clearQueue(command)
  }

  const acceptRestart = async (command: ParsedCommand): Promise<boolean> => {
    deps.holdClaims(RESTART)
    const body: RemoteCommandAckBody = { result: 'accepted' }
    let result = await acknowledge(command.id, body)
    for (const wait of [2_000, 5_000, 10_000]) {
      if (result !== null) break
      await sleep(wait)
      result = await acknowledge(command.id, body)
    }
    commandLog(command.id, command.type, result ?? 'ack_failed')
    if (result !== 'accepted') {
      deps.releaseClaims()
      return result !== null
    }
    restarting = true
    await pauseQueueOnProcessStop({
      enabled: deps.holdPrinterQueueWhenIdle,
      pause: () => deps.pauseQueue(),
    })
    let requested = false
    try { requested = await (deps.requestServiceRestart ?? requestServiceRestart)() } catch { /* fallback */ }
    const fallback = (): void => {
      log('remote-command: restart fallback exit; service failure recovery')
      deps.exit(REMOTE_RESTART_EXIT_CODE)
    }
    if (requested) {
      log('remote-command: restart task requested; waiting for normal service stop')
      const schedule = deps.scheduleFallback ?? ((callback: () => void, ms: number) => {
        setTimeout(callback, ms).unref()
      })
      schedule(() => {
        log('remote-command: restart task stop timeout')
        fallback()
      }, deps.restartFallbackMs ?? 90_000)
    } else {
      log('remote-command: restart task unavailable; using fallback')
      fallback()
    }
    return true
  }

  const clearQueue = async (command: ParsedCommand): Promise<boolean> => {
    deps.holdClaims(CLEAR)
    try {
      if (monotonicNow() - command.receivedAt > command.expiresAt - command.issuedAt) {
        return ackWithoutAction(command, { result: 'expired' })
      }
      let outcome: { result: 'done' | 'failed'; remainingJobs: number }
      try {
        outcome = await deps.clearPrintQueue(deps.printerName)
      } catch {
        log('remote-command: clear failed before a count; remaining reported as 0')
        outcome = { result: 'failed', remainingJobs: 0 }
      }
      const body = ackBodyForClear(outcome)
      const row: StoredCommandResult = {
        commandId: command.id, type: CLEAR, result: body.result,
        remainingJobs: body.remainingJobs ?? 0,
        finishedAt: (deps.now?.() ?? new Date()).toISOString(),
      }
      remember(row) // persist BEFORE acknowledgement, including when it fails
      return await clearAck(row)
    } finally {
      deps.releaseClaims()
    }
  }

  return async (commands: unknown, context?: { agentStartedAtSent: boolean }): Promise<void> => {
    enqueue(commands, context)
    if (draining) return
    draining = true
    try {
      while (pending.length > 0) {
        const command = pending.shift()
        if (!command) break
        queued.delete(command.id)
        if (seen.has(command.id)) continue
        inFlightId = command.id
        try {
          const done = await handle(command)
          if (done) { seen.add(command.id); firstReceipt.delete(command.id) }
          if (restarting) { pending.length = 0; queued.clear(); break }
        } finally {
          if (inFlightId === command.id) inFlightId = null
        }
      }
    } finally {
      draining = false
    }
  }
}

export async function postTerminalCommandAck(
  config: AgentConfig,
  commandId: string,
  body: RemoteCommandAckBody,
  timeoutMs = 30_000,
): Promise<RemoteCommandResult | null> {
  if (!config.terminalId || !config.agentToken) return null
  const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)
  try {
    const response = await client.post<{ success: boolean; data?: { result?: unknown } }>(
      `/terminals/${config.terminalId}/commands/${encodeURIComponent(commandId)}/ack`,
      body,
      { timeout: timeoutMs, ...NO_RETRY_CONFIG },
    )
    const result = response.data?.data?.result
    return response.data?.success === true && isRemoteCommandResult(result) ? result : null
  } catch {
    return null
  }
}

export function isRemoteCommandResult(value: unknown): value is RemoteCommandResult {
  return ['accepted', 'rejected_busy', 'expired', 'done', 'failed'].includes(value as string)
}

/**
 * 生产接线。忙碌 = 正在领取或正在打，或正在投递扫描件。
 * 崩溃后留在本地库里的 dispatching / spooled 不单独算忙。
 */
export function createProductionRemoteCommandHandler(
  config: AgentConfig,
  exit: (code: number) => void = (code) => {
    process.exit(code)
  },
): (commands: unknown, context?: { agentStartedAtSent: boolean }) => Promise<void> {
  const store = createRemoteCommandStore()
  // Remove expired results even when no further clear commands arrive.
  const prune = (): void => {
    try { store.prune(new Date()) } catch { /* processor logs memory fallback once */ }
  }
  prune()
  setInterval(prune, 60_000).unref()
  return createRemoteCommandProcessor({
    store,
    isBusy: () => hasInFlightPrintWork() || isScanDeliveryInFlight(),
    ack: (commandId, body) => postTerminalCommandAck(config, commandId, body),
    exit,
    holdPrinterQueueWhenIdle: config.holdPrinterQueueWhenIdle === true,
    pauseQueue: async () => {
      await pauseConfiguredPrinterQueue(config.printerName)
    },
    clearPrintQueue: (printerName) => clearAllJobsOnConfiguredPrinter(printerName, {
      holdWhenIdle: config.holdPrinterQueueWhenIdle === true,
    }),
    holdClaims: holdPrintClaims,
    releaseClaims: releasePrintClaims,
    printerName: config.printerName,
  })
}
