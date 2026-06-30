/**
 * agent/db.ts — Phase 8.1C
 *
 * SQLite-backed task state persistence using better-sqlite3 (synchronous API).
 *
 * Tables:
 *   print_tasks     — records completed/failed tasks to prevent re-execution on restart
 *   pending_patches — offline PATCH queue retried by offline-queue.ts
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
  createdAt    TEXT    NOT NULL
);
`

// ── Open ──────────────────────────────────────────────────────────────────────

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
    log(`db: opened ${dbPath}`)
    return db
  } catch (e) {
    warn(
      `db: local task database unavailable; printing disabled — ` +
        `better-sqlite3 加载失败，任务状态持久化不可用 — ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
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
      `SELECT id, taskId, status, errorCode, errorMessage, attempts, nextRetryAt, createdAt
       FROM pending_patches WHERE nextRetryAt <= ?`,
    )
    .all(now) as unknown as PendingPatch[]
}

/**
 * Record the outcome of a retry attempt.
 *
 * @param success    true  → delete the record (done)
 * @param nextRetryAt ISO string for the next retry (only used when success=false, abandon=false)
 * @param abandon    true  → delete the record without retrying (4xx or max attempts reached)
 */
export function markPatchAttempt(
  db: AgentDatabase,
  id: number,
  success: boolean,
  nextRetryAt?: string,
  abandon?: boolean,
): void {
  if (!db) return
  if (success || abandon) {
    db.prepare('DELETE FROM pending_patches WHERE id = ?').run(id)
  } else {
    db
      .prepare(
        'UPDATE pending_patches SET attempts = attempts + 1, nextRetryAt = ? WHERE id = ?',
      )
      .run(nextRetryAt ?? new Date(Date.now() + 30_000).toISOString(), id)
  }
}
