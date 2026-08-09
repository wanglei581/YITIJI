/**
 * Local operator workflow for terminal-status PATCH dead letters.
 *
 * The safe read model intentionally excludes taskId, errorMessage and all
 * credential material. Manual replay is a two-step, PATCH-only operation and
 * never reaches the printer or task execution path.
 */

import axios from 'axios'
import type { Command } from 'commander'
import { err } from '../logger'
import { createApiClient, NO_RETRY_CONFIG } from './api-client'
import { isUnauthorized, markUnauthorized } from './auth-state'
import { openDatabase, type AgentDatabase, type PendingPatch } from './db'
import { isAgentStartupError, loadConfig } from './config-manager'
import { assertAgentProfileAllowsApiBaseUrl } from './profile-guard'
import { writeStartupDiagnosticSafely } from './startup-diagnostics'
import type { AgentConfig, PatchStatusResponse } from './types'

const SAFE_MACHINE_CODE = /^[A-Z0-9_:-]{1,80}$/
const TERMINAL_STATUSES = new Set(['completed', 'failed'])

export const DEAD_LETTER_ABANDON_REASONS = [
  'invalid_task',
  'server_rejected',
  'superseded',
  'operator_policy',
] as const

export type DeadLetterAbandonReason = (typeof DEAD_LETTER_ABANDON_REASONS)[number]

export interface SafeDeadLetterView {
  id: number
  status: string
  attempts: number
  createdAt: string | null
  deadLetterAt: string | null
  deadLetterReason: string | null
  confirmedAt: string | null
  manualReplayAttempts: number
  lastManualReplayAt: string | null
  manualReplayErrorCode: string | null
  resolvedAt: string | null
  resolution: 'replayed' | 'abandoned' | null
}

export interface DeadLetterReplayResult {
  outcome: 'archived' | 'retained'
  errorCode: string | null
}

export interface SafeDeadLetterAuditEntry {
  auditId: number
  action: string
  outcome: string
  reasonCode: string | null
  createdAt: string | null
}

const SAFE_AUDIT_ACTIONS = new Set([
  'confirm',
  'abandon',
  'replay_blocked',
  'replay_attempt',
  'replay_succeeded',
  'replay_failed',
])
const SAFE_AUDIT_OUTCOMES = new Set(['succeeded', 'blocked', 'started', 'archived', 'retained'])

export class DeadLetterOperatorError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'DeadLetterOperatorError'
  }
}

export function parseExactDeadLetterId(raw: string): number {
  if (!/^[1-9][0-9]*$/.test(raw)) throw new DeadLetterOperatorError('DEAD_LETTER_ID_INVALID')
  const id = Number(raw)
  if (!Number.isSafeInteger(id)) throw new DeadLetterOperatorError('DEAD_LETTER_ID_INVALID')
  return id
}

function requireDatabase(db: AgentDatabase): Exclude<AgentDatabase, null> {
  if (!db) throw new DeadLetterOperatorError('DEAD_LETTER_DATABASE_UNAVAILABLE')
  return db
}

function safeTimestamp(value: string | null): string | null {
  if (value === null) return null
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return null
  return value
}

function safeMachineCode(value: string | null): string | null {
  if (value === null) return null
  return SAFE_MACHINE_CODE.test(value) ? value : 'REDACTED_UNSAFE_CODE'
}

function safeStatus(value: string): string {
  return ['printing', 'completed', 'failed'].includes(value) ? value : 'unknown'
}

function safeResolution(value: string | null): SafeDeadLetterView['resolution'] {
  return value === 'replayed' || value === 'abandoned' ? value : null
}

function toSafeView(row: PendingPatch): SafeDeadLetterView {
  return {
    id: row.id,
    status: safeStatus(row.status),
    attempts: Number.isSafeInteger(row.attempts) && row.attempts >= 0 ? row.attempts : 0,
    createdAt: safeTimestamp(row.createdAt),
    deadLetterAt: safeTimestamp(row.deadLetterAt),
    deadLetterReason: safeMachineCode(row.deadLetterReason),
    confirmedAt: safeTimestamp(row.operatorConfirmedAt),
    manualReplayAttempts:
      Number.isSafeInteger(row.manualReplayAttempts) && row.manualReplayAttempts >= 0
        ? row.manualReplayAttempts
        : 0,
    lastManualReplayAt: safeTimestamp(row.lastManualReplayAt),
    manualReplayErrorCode: safeMachineCode(row.manualReplayErrorCode),
    resolvedAt: safeTimestamp(row.resolvedAt),
    resolution: safeResolution(row.resolution),
  }
}

function selectDeadLetter(db: Exclude<AgentDatabase, null>, id: number): PendingPatch | undefined {
  return db
    .prepare(
      `SELECT id, taskId, status, errorCode, errorMessage, attempts, nextRetryAt, createdAt,
            deadLetterAt, deadLetterReason, operatorConfirmedAt, resolvedAt, resolution,
            manualReplayAttempts, lastManualReplayAt, manualReplayErrorCode
     FROM pending_patches WHERE id = ? AND deadLetterAt IS NOT NULL`
    )
    .get(id) as unknown as PendingPatch | undefined
}

function requireActiveDeadLetter(db: Exclude<AgentDatabase, null>, id: number): PendingPatch {
  const row = selectDeadLetter(db, id)
  if (!row) throw new DeadLetterOperatorError('DEAD_LETTER_NOT_FOUND')
  if (row.resolvedAt !== null) throw new DeadLetterOperatorError('DEAD_LETTER_ALREADY_RESOLVED')
  return row
}

function transaction<T>(db: Exclude<AgentDatabase, null>, action: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function recordAction(
  db: Exclude<AgentDatabase, null>,
  patchId: number,
  action: string,
  outcome: string,
  reasonCode: string | null,
  createdAt: string
): void {
  db.prepare(
    `INSERT INTO dead_letter_operator_audit
       (patchId, action, outcome, reasonCode, createdAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run(patchId, action, outcome, reasonCode, createdAt)
}

function recordBlockedReplay(
  db: Exclude<AgentDatabase, null>,
  id: number,
  code: string,
  clearConfirmation: boolean
): never {
  const now = new Date().toISOString()
  transaction(db, () => {
    requireActiveDeadLetter(db, id)
    if (clearConfirmation) {
      db.prepare(
        `UPDATE pending_patches SET operatorConfirmedAt = NULL,
                manualReplayErrorCode = ? WHERE id = ?`
      ).run(code, id)
    }
    recordAction(db, id, 'replay_blocked', 'blocked', code, now)
  })
  throw new DeadLetterOperatorError(code)
}

export function listDeadLetters(db: AgentDatabase): SafeDeadLetterView[] {
  const live = requireDatabase(db)
  const rows = live
    .prepare(
      `SELECT id, taskId, status, errorCode, errorMessage, attempts, nextRetryAt, createdAt,
            deadLetterAt, deadLetterReason, operatorConfirmedAt, resolvedAt, resolution,
            manualReplayAttempts, lastManualReplayAt, manualReplayErrorCode
     FROM pending_patches
     WHERE deadLetterAt IS NOT NULL AND resolvedAt IS NULL
     ORDER BY deadLetterAt ASC`
    )
    .all() as unknown as PendingPatch[]
  return rows.map(toSafeView)
}

export function showDeadLetter(db: AgentDatabase, id: number): SafeDeadLetterView {
  const live = requireDatabase(db)
  const row = selectDeadLetter(live, id)
  if (!row) throw new DeadLetterOperatorError('DEAD_LETTER_NOT_FOUND')
  return toSafeView(row)
}

/** Exact-id-only durable action history; no task or error-message columns are selected. */
export function auditDeadLetter(db: AgentDatabase, id: number): SafeDeadLetterAuditEntry[] {
  const live = requireDatabase(db)
  const exists = live
    .prepare('SELECT id FROM pending_patches WHERE id = ? AND deadLetterAt IS NOT NULL')
    .get(id)
  if (!exists) throw new DeadLetterOperatorError('DEAD_LETTER_NOT_FOUND')
  const rows = live
    .prepare(
      `SELECT id, action, outcome, reasonCode, createdAt
       FROM dead_letter_operator_audit WHERE patchId = ? ORDER BY id ASC`
    )
    .all(id)
  return rows.map((row) => {
    const action = String(row['action'])
    const outcome = String(row['outcome'])
    const rawReason = row['reasonCode'] === null ? null : String(row['reasonCode'])
    const fixedReason =
      rawReason !== null && (DEAD_LETTER_ABANDON_REASONS as readonly string[]).includes(rawReason)
    return {
      auditId: Number.isSafeInteger(Number(row['id'])) ? Number(row['id']) : 0,
      action: SAFE_AUDIT_ACTIONS.has(action) ? action : 'unknown',
      outcome: SAFE_AUDIT_OUTCOMES.has(outcome) ? outcome : 'unknown',
      reasonCode: fixedReason ? rawReason : safeMachineCode(rawReason),
      createdAt: safeTimestamp(String(row['createdAt'])),
    }
  })
}

export function confirmDeadLetter(db: AgentDatabase, id: number): SafeDeadLetterView {
  const live = requireDatabase(db)
  return transaction(live, () => {
    requireActiveDeadLetter(live, id)
    const now = new Date().toISOString()
    live
      .prepare(
        `UPDATE pending_patches
       SET operatorConfirmedAt = ?, manualReplayErrorCode = NULL
       WHERE id = ? AND resolvedAt IS NULL`
      )
      .run(now, id)
    recordAction(live, id, 'confirm', 'succeeded', null, now)
    return toSafeView(requireActiveDeadLetter(live, id))
  })
}

export function abandonDeadLetter(
  db: AgentDatabase,
  id: number,
  reason: DeadLetterAbandonReason
): SafeDeadLetterView {
  if (!DEAD_LETTER_ABANDON_REASONS.includes(reason)) {
    throw new DeadLetterOperatorError('DEAD_LETTER_ABANDON_REASON_INVALID')
  }
  const live = requireDatabase(db)
  return transaction(live, () => {
    requireActiveDeadLetter(live, id)
    const now = new Date().toISOString()
    live
      .prepare(
        `UPDATE pending_patches
       SET operatorConfirmedAt = NULL, resolvedAt = ?, resolution = 'abandoned',
           manualReplayErrorCode = NULL
       WHERE id = ? AND resolvedAt IS NULL`
      )
      .run(now, id)
    recordAction(live, id, 'abandon', 'succeeded', reason, now)
    const resolved = selectDeadLetter(live, id)
    if (!resolved) throw new DeadLetterOperatorError('DEAD_LETTER_NOT_FOUND')
    return toSafeView(resolved)
  })
}

export async function replayDeadLetter(
  db: AgentDatabase,
  id: number,
  config: AgentConfig
): Promise<DeadLetterReplayResult> {
  const live = requireDatabase(db)
  let row = requireActiveDeadLetter(live, id)
  if (!row.operatorConfirmedAt) {
    return recordBlockedReplay(live, id, 'DEAD_LETTER_CONFIRMATION_REQUIRED', false)
  }
  if (!TERMINAL_STATUSES.has(row.status)) {
    return recordBlockedReplay(live, id, 'DEAD_LETTER_STATUS_NOT_TERMINAL', true)
  }
  if (!config.terminalId || !config.agentToken) {
    return recordBlockedReplay(live, id, 'DEAD_LETTER_CREDENTIALS_UNAVAILABLE', false)
  }
  if (isUnauthorized()) {
    return recordBlockedReplay(live, id, 'DEAD_LETTER_AGENT_UNAUTHORIZED', false)
  }

  const attemptAt = new Date().toISOString()
  transaction(live, () => {
    row = requireActiveDeadLetter(live, id)
    if (!row.operatorConfirmedAt) {
      throw new DeadLetterOperatorError('DEAD_LETTER_CONFIRMATION_REQUIRED')
    }
    live
      .prepare(
        `UPDATE pending_patches
       SET manualReplayAttempts = manualReplayAttempts + 1,
           lastManualReplayAt = ?, manualReplayErrorCode = NULL
       WHERE id = ? AND resolvedAt IS NULL`
      )
      .run(attemptAt, id)
    recordAction(live, id, 'replay_attempt', 'started', null, attemptAt)
  })

  const payload: Record<string, string> = { status: row.status }
  if (row.status === 'failed' && row.errorCode && SAFE_MACHINE_CODE.test(row.errorCode)) {
    payload['errorCode'] = row.errorCode
  }

  try {
    const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)
    const response = await client.patch<PatchStatusResponse>(
      `/print-tasks/${encodeURIComponent(row.taskId)}/status`,
      payload,
      { timeout: 30_000, ...NO_RETRY_CONFIG }
    )
    if (response.data.acknowledged !== true) {
      return retainAfterReplay(live, id, 'INVALID_ACK', false)
    }

    const completedAt = new Date().toISOString()
    transaction(live, () => {
      requireActiveDeadLetter(live, id)
      live
        .prepare(
          `UPDATE pending_patches
         SET operatorConfirmedAt = NULL, resolvedAt = ?, resolution = 'replayed',
             manualReplayErrorCode = NULL
         WHERE id = ? AND resolvedAt IS NULL`
        )
        .run(completedAt, id)
      recordAction(live, id, 'replay_succeeded', 'archived', null, completedAt)
    })
    return { outcome: 'archived', errorCode: null }
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined
    const errorCode = status === undefined ? 'NETWORK_ERROR' : `HTTP_${status}`
    const clearConfirmation = status !== undefined && status >= 400 && status < 500
    const result = retainAfterReplay(live, id, errorCode, clearConfirmation)
    if (status === 401) {
      markUnauthorized()
      writeStartupDiagnosticSafely('AGENT_UNAUTHORIZED')
    }
    return result
  }
}

function retainAfterReplay(
  db: Exclude<AgentDatabase, null>,
  id: number,
  errorCode: string,
  clearConfirmation: boolean
): DeadLetterReplayResult {
  const failedAt = new Date().toISOString()
  transaction(db, () => {
    requireActiveDeadLetter(db, id)
    db.prepare(
      `UPDATE pending_patches
       SET manualReplayErrorCode = ?,
           operatorConfirmedAt = CASE WHEN ? = 1 THEN NULL ELSE operatorConfirmedAt END
       WHERE id = ? AND resolvedAt IS NULL`
    ).run(errorCode, clearConfirmation ? 1 : 0, id)
    recordAction(db, id, 'replay_failed', 'retained', errorCode, failedAt)
  })
  return { outcome: 'retained', errorCode }
}

function useDeadLetterDatabase<T>(action: (db: Exclude<AgentDatabase, null>) => T): T {
  const db = openDatabase()
  if (!db) throw new DeadLetterOperatorError('DEAD_LETTER_DATABASE_UNAVAILABLE')
  try {
    return action(db)
  } finally {
    db.close()
  }
}

async function useDeadLetterDatabaseAsync<T>(
  action: (db: Exclude<AgentDatabase, null>) => Promise<T>
): Promise<T> {
  const db = openDatabase()
  if (!db) throw new DeadLetterOperatorError('DEAD_LETTER_DATABASE_UNAVAILABLE')
  try {
    return await action(db)
  } finally {
    db.close()
  }
}

function writeDeadLetterResult(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function handleDeadLetterCommandFailure(error: unknown): never {
  const code =
    error instanceof DeadLetterOperatorError
      ? error.code
      : isAgentStartupError(error)
        ? error.code
        : 'DEAD_LETTER_OPERATION_FAILED'
  err(code)
  process.exit(2)
}

export function registerDeadLetterCommands(program: Command): void {
  const deadLetterCommand = program
    .command('dead-letter')
    .description('Inspect and resolve local terminal-status PATCH dead letters')

  deadLetterCommand
    .command('list')
    .description('List unresolved dead letters using PII-safe local metadata')
    .action(() => {
      try {
        writeDeadLetterResult(useDeadLetterDatabase((db) => listDeadLetters(db)))
      } catch (error) {
        handleDeadLetterCommandFailure(error)
      }
    })

  deadLetterCommand
    .command('show')
    .description('Show one dead letter by exact local numeric id')
    .requiredOption('--id <id>', 'Exact local dead-letter id')
    .action((options: { id: string }) => {
      try {
        const id = parseExactDeadLetterId(options.id)
        writeDeadLetterResult(useDeadLetterDatabase((db) => showDeadLetter(db, id)))
      } catch (error) {
        handleDeadLetterCommandFailure(error)
      }
    })

  deadLetterCommand
    .command('audit')
    .description('Show PII-safe durable action history for one exact dead-letter id')
    .requiredOption('--id <id>', 'Exact local dead-letter id')
    .action((options: { id: string }) => {
      try {
        const id = parseExactDeadLetterId(options.id)
        writeDeadLetterResult(useDeadLetterDatabase((db) => auditDeadLetter(db, id)))
      } catch (error) {
        handleDeadLetterCommandFailure(error)
      }
    })

  deadLetterCommand
    .command('confirm')
    .description('Durably confirm one dead letter before a controlled replay')
    .requiredOption('--id <id>', 'Exact local dead-letter id')
    .action((options: { id: string }) => {
      try {
        const id = parseExactDeadLetterId(options.id)
        writeDeadLetterResult(useDeadLetterDatabase((db) => confirmDeadLetter(db, id)))
      } catch (error) {
        handleDeadLetterCommandFailure(error)
      }
    })

  deadLetterCommand
    .command('abandon')
    .description('Archive one dead letter without replaying it')
    .requiredOption('--id <id>', 'Exact local dead-letter id')
    .requiredOption(
      '--reason <reason>',
      'One of: invalid_task, server_rejected, superseded, operator_policy'
    )
    .action((options: { id: string; reason: string }) => {
      try {
        const id = parseExactDeadLetterId(options.id)
        writeDeadLetterResult(
          useDeadLetterDatabase((db) =>
            abandonDeadLetter(db, id, options.reason as DeadLetterAbandonReason)
          )
        )
      } catch (error) {
        handleDeadLetterCommandFailure(error)
      }
    })

  deadLetterCommand
    .command('replay')
    .description('Replay one confirmed completed/failed status PATCH exactly once')
    .requiredOption('--id <id>', 'Exact local dead-letter id')
    .action(async (options: { id: string }) => {
      try {
        const id = parseExactDeadLetterId(options.id)
        const config = loadConfig()
        try {
          assertAgentProfileAllowsApiBaseUrl(config)
        } catch {
          throw new DeadLetterOperatorError('AGENT_PROFILE_REJECTED')
        }
        const result = await useDeadLetterDatabaseAsync((db) => replayDeadLetter(db, id, config))
        writeDeadLetterResult(result)
        if (result.outcome !== 'archived') process.exitCode = 2
      } catch (error) {
        handleDeadLetterCommandFailure(error)
      }
    })
}
