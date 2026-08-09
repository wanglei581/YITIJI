/**
 * agent/db.ts — Phase 8.1C
 *
 * SQLite-backed task state persistence using better-sqlite3 (synchronous API).
 *
 * Tables:
 *   print_tasks     — records completed/failed tasks to prevent re-execution on restart
 *   pending_patches — offline PATCH queue retried by offline-queue.ts
 *   scan_deletion_audit — durable, PII-safe audit of expired _unclaimed deletion
 *
 * Fail-closed behavior: if better-sqlite3 native module fails to load (e.g. first
 * run before npm rebuild on a new Windows machine), printing is disabled instead
 * of running without restart-idempotency and offline status retry.
 *
 * DB paths:
 *   Windows: %ProgramData%\AIJobPrintAgent\agent.db
 *   macOS:   $TMPDIR/AIJobPrintAgent/agent.db
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomBytes } from 'crypto'
import { log, warn } from '../logger'
import type { PatchStatusPayload } from './types'

// ── Structural interface ──────────────────────────────────────────────────────
// Avoids complex @types/better-sqlite3 import gymnastics with the native module.
// Only the methods we actually call are listed here.

interface SqliteStatement {
  run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number }
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
}

interface SqliteDb {
  exec(sql: string): this
  prepare(sql: string): SqliteStatement
  close(): void
}

/** Live better-sqlite3 Database instance, or null if the native module is unavailable. */
export type AgentDatabase = SqliteDb | null

// ── Public record types ───────────────────────────────────────────────────────

export interface PendingPatch {
  id: number
  taskId: string
  status: string
  errorCode: string | null
  errorMessage: string | null
  attempts: number
  nextRetryAt: string
  createdAt: string
  deadLetterAt: string | null
  deadLetterReason: string | null
}

export type ScanDeletionResult = 'pending_delete' | 'deleted' | 'delete_failed'

export interface ScanDeletionAudit {
  eventId: string
  reasonCode: string
  identifierHash: string
  createdAt: string
  deletedAt: string | null
  result: ScanDeletionResult
  attempts: number
  lastAttemptAt: string
  lastErrorCode: string | null
  pendingReport: boolean
}

// ── DB path ───────────────────────────────────────────────────────────────────

function getDbPath(): string {
  const base = process.env['PROGRAMDATA']
    ? path.join(process.env['PROGRAMDATA'], 'AIJobPrintAgent')
    : path.join(os.tmpdir(), 'AIJobPrintAgent')
  return path.join(base, 'agent.db')
}

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS print_tasks (
  taskId      TEXT    PRIMARY KEY,
  status      TEXT    NOT NULL,
  completedAt TEXT,
  createdAt   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_patches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  taskId       TEXT    NOT NULL,
  status       TEXT    NOT NULL,
  errorCode    TEXT,
  errorMessage TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  nextRetryAt  TEXT    NOT NULL,
  createdAt    TEXT    NOT NULL,
  deadLetterAt TEXT,
  deadLetterReason TEXT
);

CREATE TABLE IF NOT EXISTS scan_deletion_audit (
  eventId        TEXT PRIMARY KEY,
  reasonCode     TEXT NOT NULL,
  identifierHash TEXT NOT NULL,
  createdAt      TEXT NOT NULL,
  deletedAt      TEXT,
  result         TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  lastAttemptAt  TEXT NOT NULL,
  lastErrorCode  TEXT,
  pendingReport  INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_scan_deletion_audit_pending
  ON scan_deletion_audit (pendingReport, createdAt);

CREATE TABLE IF NOT EXISTS agent_metadata (
  metadataKey   TEXT PRIMARY KEY,
  metadataValue TEXT NOT NULL,
  createdAt     TEXT NOT NULL
);
`

function ensureColumn(db: SqliteDb, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  if (columns.some((row) => row['name'] === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

// ── Open ──────────────────────────────────────────────────────────────────────

let activeDatabase: AgentDatabase = null

/**
 * Open (and initialise schema for) the agent SQLite database.
 * Returns null if better-sqlite3 native module cannot be loaded.
 */
export function openDatabase(): AgentDatabase {
  try {
    // Dynamic require — native module may not be available in all environments.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const DatabaseCtor = require('better-sqlite3') as new (
      filename: string,
      options?: { verbose?: (msg?: unknown) => void },
    ) => SqliteDb
    const dbPath = getDbPath()
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const db = new DatabaseCtor(dbPath)
    db.exec(SCHEMA_SQL)
    ensureColumn(db, 'pending_patches', 'deadLetterAt', 'TEXT')
    ensureColumn(db, 'pending_patches', 'deadLetterReason', 'TEXT')
    activeDatabase = db
    log(`db: opened ${dbPath}`)
    return db
  } catch (e) {
    activeDatabase = null
    warn(
      `db: local task database unavailable; printing disabled — ` +
        `better-sqlite3 加载失败，任务状态持久化不可用 — ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}

/** Returns the process-wide DB opened during Agent startup, without opening a second connection. */
export function getActiveDatabase(): AgentDatabase {
  return activeDatabase
}

/**
 * Per-install 256-bit HMAC key for scan audit identifiers. The key stays in local
 * metadata and is never copied into the deletion audit ledger or logs.
 */
export function getOrCreateScanAuditHmacKey(db: AgentDatabase): string {
  if (!db) throw new Error('SCAN_AUDIT_DB_UNAVAILABLE')
  const metadataKey = 'scan_deletion_audit_hmac_key_v1'
  const existing = db
    .prepare('SELECT metadataValue FROM agent_metadata WHERE metadataKey = ?')
    .get(metadataKey)
  if (existing) {
    const value = String(existing['metadataValue'])
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('SCAN_AUDIT_HMAC_KEY_INVALID')
    return value
  }

  const generated = randomBytes(32).toString('hex')
  db.prepare(
    `INSERT OR IGNORE INTO agent_metadata (metadataKey, metadataValue, createdAt)
     VALUES (?, ?, ?)`,
  ).run(metadataKey, generated, new Date().toISOString())
  const stored = db
    .prepare('SELECT metadataValue FROM agent_metadata WHERE metadataKey = ?')
    .get(metadataKey)
  const value = String(stored?.['metadataValue'] ?? '')
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('SCAN_AUDIT_HMAC_KEY_PERSIST_FAILED')
  return value
}

export function isDatabaseAvailable(db: AgentDatabase): db is SqliteDb {
  return db !== null
}

// ── Task idempotency ──────────────────────────────────────────────────────────

/**
 * Returns true if the task has already been marked done (completed or failed).
 * Always false when db is null.
 */
export function isTaskDone(db: AgentDatabase, taskId: string): boolean {
  if (!db) return false
  const row = db.prepare('SELECT status FROM print_tasks WHERE taskId = ?').get(taskId)
  return row !== undefined
}

/**
 * Returns the locally-recorded status for a task, or undefined if not found.
 * Used by task-runner to distinguish 'spooled' (crash during monitoring) from
 * 'completed'/'failed' (fully processed).
 */
export function getTaskLocalStatus(db: AgentDatabase, taskId: string): string | undefined {
  if (!db) return undefined
  const row = db.prepare('SELECT status FROM print_tasks WHERE taskId = ?').get(taskId)
  return row ? (row['status'] as string) : undefined
}

/**
 * Record a task's terminal status to prevent re-execution after restart.
 * No-op when db is null.
 */
export function markTaskDone(db: AgentDatabase, taskId: string, status: string): void {
  if (!db) return
  const now = new Date().toISOString()
  db
    .prepare(
      'INSERT OR REPLACE INTO print_tasks (taskId, status, completedAt, createdAt) VALUES (?, ?, ?, ?)',
    )
    .run(taskId, status, now, now)
}

// ── Expired scan deletion audit ───────────────────────────────────────────────

/**
 * Durably record delete intent before touching an expired high-sensitivity scan.
 * eventId and identifierHash are caller-generated hashes; no path, filename,
 * file content, or other plaintext PII is accepted by this schema/API.
 */
export function beginScanDeletionAudit(
  db: AgentDatabase,
  event: Pick<ScanDeletionAudit, 'eventId' | 'reasonCode' | 'identifierHash'>,
  attemptedAt: string,
): void {
  if (!db) return
  db.prepare(
    `INSERT INTO scan_deletion_audit
       (eventId, reasonCode, identifierHash, createdAt, deletedAt, result,
        attempts, lastAttemptAt, lastErrorCode, pendingReport)
     VALUES (?, ?, ?, ?, NULL, 'pending_delete', 1, ?, NULL, 1)
     ON CONFLICT(eventId) DO UPDATE SET
       result = 'pending_delete',
       deletedAt = NULL,
       attempts = scan_deletion_audit.attempts + 1,
       lastAttemptAt = excluded.lastAttemptAt,
       lastErrorCode = NULL,
       pendingReport = 1`,
  ).run(
    event.eventId,
    event.reasonCode,
    event.identifierHash,
    attemptedAt,
    attemptedAt,
  )
}

export function finishScanDeletionAudit(
  db: AgentDatabase,
  eventId: string,
  outcome: { result: 'deleted'; deletedAt: string } | { result: 'delete_failed'; errorCode: string },
): void {
  if (!db) return
  if (outcome.result === 'deleted') {
    db.prepare(
      `UPDATE scan_deletion_audit
       SET result = 'deleted', deletedAt = ?, lastErrorCode = NULL, pendingReport = 1
       WHERE eventId = ?`,
    ).run(outcome.deletedAt, eventId)
    return
  }
  db.prepare(
    `UPDATE scan_deletion_audit
     SET result = 'delete_failed', deletedAt = NULL, lastErrorCode = ?, pendingReport = 1
     WHERE eventId = ?`,
  ).run(outcome.errorCode, eventId)
}

/** Local operator/diagnostic read model. No external reporting contract exists yet. */
export function getScanDeletionAudits(db: AgentDatabase): ScanDeletionAudit[] {
  if (!db) return []
  const rows = db.prepare(
    `SELECT eventId, reasonCode, identifierHash, createdAt, deletedAt, result,
            attempts, lastAttemptAt, lastErrorCode, pendingReport
     FROM scan_deletion_audit ORDER BY createdAt ASC`,
  ).all()
  return rows.map((row) => ({
    eventId: String(row['eventId']),
    reasonCode: String(row['reasonCode']),
    identifierHash: String(row['identifierHash']),
    createdAt: String(row['createdAt']),
    deletedAt: row['deletedAt'] === null ? null : String(row['deletedAt']),
    result: row['result'] as ScanDeletionResult,
    attempts: Number(row['attempts']),
    lastAttemptAt: String(row['lastAttemptAt']),
    lastErrorCode: row['lastErrorCode'] === null ? null : String(row['lastErrorCode']),
    pendingReport: Number(row['pendingReport']) === 1,
  }))
}

// ── Offline PATCH queue ───────────────────────────────────────────────────────

/**
 * Enqueue a failed PATCH for offline retry.
 * No-op when db is null.
 */
export function enqueuePatch(
  db: AgentDatabase,
  taskId: string,
  payload: PatchStatusPayload,
): void {
  if (!db) return
  const existing = db
    .prepare(
      `SELECT id, deadLetterAt FROM pending_patches
       WHERE taskId = ? AND status = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(taskId, payload.status)
  if (existing) {
    const disposition = existing['deadLetterAt'] ? 'dead-lettered; operator action required' : 'already queued'
    warn(`db: PATCH status=${payload.status} for task ${taskId} not duplicated — ${disposition}`)
    return
  }
  const now = new Date().toISOString()
  // First retry after 30s
  const nextRetryAt = new Date(Date.now() + 30_000).toISOString()
  db
    .prepare(
      `INSERT INTO pending_patches
       (taskId, status, errorCode, errorMessage, attempts, nextRetryAt, createdAt)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      taskId,
      payload.status,
      payload.errorCode ?? null,
      payload.errorMessage ?? null,
      nextRetryAt,
      now,
    )
  warn(`db: PATCH status=${payload.status} for task ${taskId} enqueued for offline retry`)
}

/**
 * Fetch all patches whose nextRetryAt timestamp has passed.
 * Returns [] when db is null.
 */
export function getPendingPatches(db: AgentDatabase): PendingPatch[] {
  if (!db) return []
  const now = new Date().toISOString()
  return db
    .prepare(
      `SELECT id, taskId, status, errorCode, errorMessage, attempts, nextRetryAt, createdAt,
              deadLetterAt, deadLetterReason
       FROM pending_patches WHERE deadLetterAt IS NULL AND nextRetryAt <= ?`,
    )
    .all(now) as unknown as PendingPatch[]
}

/** Return durable, operator-actionable terminal status failures. */
export function getDeadLetterPatches(db: AgentDatabase): PendingPatch[] {
  if (!db) return []
  return db
    .prepare(
      `SELECT id, taskId, status, errorCode, errorMessage, attempts, nextRetryAt, createdAt,
              deadLetterAt, deadLetterReason
       FROM pending_patches WHERE deadLetterAt IS NOT NULL ORDER BY deadLetterAt ASC`,
    )
    .all() as unknown as PendingPatch[]
}

export function getDeadLetterPatchCount(db: AgentDatabase): number {
  if (!db) return 0
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM pending_patches WHERE deadLetterAt IS NOT NULL')
    .get()
  return Number(row?.['count'] ?? 0)
}

/** Move a patch to durable dead-letter state without deleting its evidence. */
export function deadLetterPatch(
  db: AgentDatabase,
  id: number,
  reason: string,
  incrementAttempt = false,
): void {
  if (!db) return
  const now = new Date().toISOString()
  db
    .prepare(
      `UPDATE pending_patches
       SET deadLetterAt = ?, deadLetterReason = ?, nextRetryAt = ?,
           attempts = attempts + ?
       WHERE id = ? AND deadLetterAt IS NULL`,
    )
    .run(now, reason, now, incrementAttempt ? 1 : 0, id)
}

/**
 * Record the outcome of a retry attempt.
 *
 * @param success    true  → delete the record (done)
 * @param nextRetryAt ISO string for the next retry (only used when success=false)
 */
export function markPatchAttempt(
  db: AgentDatabase,
  id: number,
  success: boolean,
  nextRetryAt?: string,
): void {
  if (!db) return
  if (success) {
    db.prepare('DELETE FROM pending_patches WHERE id = ?').run(id)
  } else {
    db
      .prepare(
        'UPDATE pending_patches SET attempts = attempts + 1, nextRetryAt = ? WHERE id = ?',
      )
      .run(nextRetryAt ?? new Date(Date.now() + 30_000).toISOString(), id)
  }
}
