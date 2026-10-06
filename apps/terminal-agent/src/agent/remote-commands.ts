/**
 * 后台下发的远程指令：重启本进程，或清空配置打印机上的全部作业。
 * 回执只带结果和剩余作业数，不带文档名、账号、作业标题。
 */

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
  ack: (commandId: string, body: RemoteCommandAckBody) => Promise<boolean>
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

function parseCommand(value: unknown): ParsedCommand | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row['id'] !== 'string' || row['id'].length < 1 || row['id'].length > 64) return null
  if (row['type'] !== RESTART && row['type'] !== CLEAR) return null
  const issuedAt = parseTime(row['issuedAt'])
  const expiresAt = parseTime(row['expiresAt'])
  if (issuedAt === null || expiresAt === null) return null
  return { id: row['id'], type: row['type'], expiresAt }
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
): (commands: unknown) => Promise<void> {
  const seen = new Set<string>()
  const queued = new Set<string>()
  const pending: ParsedCommand[] = []
  let draining = false
  let inFlightId: string | null = null

  const enqueue = (commands: unknown): void => {
    if (!Array.isArray(commands)) {
      commandLog('-', 'invalid', 'skipped')
      return
    }
    for (const entry of commands) {
      const parsed = parseCommand(entry)
      if (!parsed) {
        const row = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        commandLog(previewId(row['id']) === '-' ? '-' : String(row['id']), previewType(row['type']), 'skipped')
        continue
      }
      if (seen.has(parsed.id) || queued.has(parsed.id) || inFlightId === parsed.id) continue
      queued.add(parsed.id)
      pending.push(parsed)
    }
  }

  const handle = async (command: ParsedCommand): Promise<boolean> => {
    const now = deps.now ? deps.now() : new Date()
    if (now.getTime() > command.expiresAt) {
      const ok = await deps.ack(command.id, { result: 'expired' })
      commandLog(command.id, command.type, ok ? 'expired' : 'ack_failed')
      return ok
    }
    // 先挡住领取，再查忙。顺序反过来时，领取循环可能在两步之间开始一单。
    deps.holdClaims(command.type)
    if (await deps.isBusy()) {
      deps.releaseClaims()
      const ok = await deps.ack(command.id, { result: 'rejected_busy' })
      commandLog(command.id, command.type, ok ? 'rejected_busy' : 'ack_failed')
      return ok
    }
    if (command.type === RESTART) return acceptRestart(command)
    return clearQueue(command)
  }

  const acceptRestart = async (command: ParsedCommand): Promise<boolean> => {
    deps.holdClaims(RESTART)
    const ok = await deps.ack(command.id, { result: 'accepted' })
    commandLog(command.id, command.type, ok ? 'accepted' : 'ack_failed')
    if (!ok) {
      deps.releaseClaims()
      return false
    }
    try {
      await pauseQueueOnProcessStop({
        enabled: deps.holdPrinterQueueWhenIdle,
        pause: () => deps.pauseQueue(),
      })
    } finally {
      deps.exit(REMOTE_RESTART_EXIT_CODE)
    }
    return true
  }

  const clearQueue = async (command: ParsedCommand): Promise<boolean> => {
    deps.holdClaims(CLEAR)
    try {
      let outcome: { result: 'done' | 'failed'; remainingJobs: number }
      try {
        outcome = await deps.clearPrintQueue(deps.printerName)
      } catch {
        log('remote-command: clear failed before a count; remaining reported as 0')
        outcome = { result: 'failed', remainingJobs: 0 }
      }
      const body = ackBodyForClear(outcome)
      const ok = await deps.ack(command.id, body)
      commandLog(command.id, command.type, ok ? body.result : 'ack_failed', body.remainingJobs)
      return ok
    } finally {
      deps.releaseClaims()
    }
  }

  return async (commands: unknown): Promise<void> => {
    enqueue(commands)
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
          if (done) seen.add(command.id)
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
): Promise<boolean> {
  if (!config.terminalId || !config.agentToken) return false
  const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)
  try {
    await client.post(
      `/terminals/${config.terminalId}/commands/${encodeURIComponent(commandId)}/ack`,
      body,
      { timeout: 30_000, ...NO_RETRY_CONFIG },
    )
    return true
  } catch {
    return false
  }
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
): (commands: unknown) => Promise<void> {
  return createRemoteCommandProcessor({
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
