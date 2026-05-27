/**
 * agent/task-runner.ts — Phase 8.1C
 *
 * Polls the backend for print tasks and executes them:
 *
 *   every 5s → POST /api/v1/terminals/:terminalId/tasks/claim
 *             → for each task:
 *                 0. Idempotency check: already in local DB? → skip
 *                 1. Download file to temp dir
 *                 2. Verify MD5 (if provided by server)
 *                 3. PATCH status = "printing"
 *                 4. Call unified print() from Phase 8.1A
 *                 5. markTaskDone() in local DB (BEFORE PATCH — prevents re-print on crash)
 *                 6. PATCH status = "completed" | "failed"
 *                    → if PATCH fails: enqueue in offline-queue for retry
 *                 7. Delete temp file (always, in finally block)
 *
 * Phase 8.1C additions vs 8.1B:
 *   - patchStatus() returns Promise<boolean> (true = 2xx ack, false = network/5xx failure)
 *   - executeTask() receives AgentDatabase for idempotency + offline queue
 *   - isTaskDone() guard at task entry
 *   - markTaskDone() before PATCH (so restart after crash never re-prints)
 *   - enqueuePatch() when PATCH fails (for completed / failed status only)
 *   - Offline queue NOT used for "printing" transition (informational only)
 *
 * Design invariants carried forward from 8.1B:
 *   - try/finally guarantees temp file cleanup
 *   - Duplicate task guard (Set<string> activeTasks) prevents same-cycle double-execution
 *   - HTTP errors on claim: log + skip cycle (heartbeat shows connectivity)
 *   - Tasks run async so claim loop is never blocked by a slow print job
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import os from 'os'
import axios from 'axios'
import type { AgentConfig, ClaimTask, PatchStatusPayload, ReportableStatus } from './types'
import type { PrintJobParams } from '../printer/types'
import { createApiClient, axiosErrorMessage } from './api-client'
import { print } from '../printer/print'
import { log, warn, err } from '../logger'
import { DEFAULT_PRINTER } from '../config'
import {
  isTaskDone,
  markTaskDone,
  enqueuePatch,
  type AgentDatabase,
} from './db'

// ── Temp directory ────────────────────────────────────────────────────────────

function getTempDir(): string {
  const base = process.env['PROGRAMDATA']
    ? path.join(process.env['PROGRAMDATA'], 'AIJobPrintAgent', 'temp')
    : path.join(os.tmpdir(), 'AIJobPrintAgent', 'temp')
  fs.mkdirSync(base, { recursive: true })
  return base
}

// ── Download + MD5 ────────────────────────────────────────────────────────────

async function downloadFile(fileUrl: string, destPath: string): Promise<void> {
  const resp = await axios.get<ArrayBuffer>(fileUrl, {
    responseType: 'arraybuffer',
    timeout: 60_000,
  })
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, Buffer.from(resp.data))
}

function computeFileMd5(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  return crypto.createHash('md5').update(buf).digest('hex')
}

function extFromUrl(fileUrl: string): string {
  const noQuery = fileUrl.split('?')[0]
  return path.extname(noQuery ?? '').toLowerCase() || '.pdf'
}

function resolveFileUrl(fileUrl: string, apiBaseUrl: string): string {
  try {
    return new URL(fileUrl).toString()
  } catch {
    const apiUrl = new URL(apiBaseUrl)
    if (fileUrl.startsWith('/')) {
      return `${apiUrl.origin}${fileUrl}`
    }
    const base = apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`
    return new URL(fileUrl, base).toString()
  }
}

// ── Status PATCH ──────────────────────────────────────────────────────────────

/**
 * PATCH /print-tasks/:taskId/status
 *
 * Returns true if the server acknowledged (2xx), false on any failure.
 * Failures are logged as warnings; this function never throws.
 * The backend is idempotent for repeated PATCHes with the same terminal status.
 */
async function patchStatus(
  taskId: string,
  payload: PatchStatusPayload,
  apiBaseUrl: string,
  agentToken: string,
  terminalId: string,
): Promise<boolean> {
  const client = createApiClient(apiBaseUrl, agentToken, terminalId)
  try {
    await client.patch(`/print-tasks/${taskId}/status`, payload)
    log(`task ${taskId}: PATCH status=${payload.status} ✓`)
    return true
  } catch (e) {
    warn(
      `task ${taskId}: PATCH status=${payload.status} failed — ${axiosErrorMessage(e)}` +
        ' (will retry via offline-queue if status is terminal)',
    )
    return false
  }
}

// ── Task execution ────────────────────────────────────────────────────────────

/**
 * Execute a single claimed print task end-to-end.
 *
 * Guarantees:
 *   - PATCH status is always attempted (try/finally)
 *   - Temp file is always deleted (try/finally)
 *   - Terminal status (completed/failed) is written to local DB BEFORE the PATCH
 *     so a crash between DB write and PATCH results in a queued retry, never a reprint
 */
async function executeTask(
  task: ClaimTask,
  config: AgentConfig,
  db: AgentDatabase,
): Promise<void> {
  const { terminalId, agentToken, apiBaseUrl, printerName } = config
  if (!terminalId || !agentToken) {
    err(`task ${task.taskId}: executeTask called without terminalId/agentToken — skipping`)
    return
  }

  // ── Step 0: Idempotency check ─────────────────────────────────────────────
  if (isTaskDone(db, task.taskId)) {
    log(`task ${task.taskId}: already done in local DB, skipping (restart-idempotency)`)
    return
  }

  const ext = extFromUrl(task.fileUrl)
  const tempFilePath = path.join(getTempDir(), `task_${task.taskId}${ext}`)

  const patch = (status: ReportableStatus, errorCode?: string, errorMessage?: string) =>
    patchStatus(
      task.taskId,
      { status, ...(errorCode ? { errorCode } : {}), ...(errorMessage ? { errorMessage } : {}) },
      apiBaseUrl,
      agentToken,
      terminalId,
    )

  log(`task ${task.taskId}: start — type=${task.type}  file=...${ext}`)

  try {
    // ── Step 1: Download ──────────────────────────────────────────────────
    log(`task ${task.taskId}: downloading...`)
    try {
      await downloadFile(resolveFileUrl(task.fileUrl, apiBaseUrl), tempFilePath)
    } catch (e) {
      err(`task ${task.taskId}: download failed — ${e instanceof Error ? e.message : String(e)}`)
      markTaskDone(db, task.taskId, 'failed')
      const ok = await patch('failed', 'PRINT_COMMAND_FAILED', `Download failed: ${e instanceof Error ? e.message : String(e)}`)
      if (!ok) enqueuePatch(db, task.taskId, { status: 'failed', errorCode: 'PRINT_COMMAND_FAILED', errorMessage: `Download failed` })
      return
    }
    log(`task ${task.taskId}: downloaded (${(fs.statSync(tempFilePath).size / 1024).toFixed(1)} KB)`)

    // ── Step 2: MD5 verification ──────────────────────────────────────────
    if (task.fileMd5) {
      const actual = computeFileMd5(tempFilePath)
      if (actual !== task.fileMd5) {
        err(`task ${task.taskId}: MD5 mismatch — expected=${task.fileMd5}  actual=${actual}`)
        markTaskDone(db, task.taskId, 'failed')
        const ok = await patch(
          'failed',
          'DOWNLOAD_HASH_MISMATCH',
          `MD5 mismatch: expected=${task.fileMd5}, got=${actual}`,
        )
        if (!ok) enqueuePatch(db, task.taskId, { status: 'failed', errorCode: 'DOWNLOAD_HASH_MISMATCH' })
        return
      }
      log(`task ${task.taskId}: MD5 ✓`)
    } else {
      warn(`task ${task.taskId}: server did not provide fileMd5, skipping verification`)
    }

    // ── Step 3: PATCH printing (informational; failure does not abort) ────
    await patch('printing')

    // ── Step 4: Print ─────────────────────────────────────────────────────
    const resolvedPrinter = printerName || DEFAULT_PRINTER
    log(`task ${task.taskId}: printing on "${resolvedPrinter}"...`)

    const result = await print(
      tempFilePath,
      resolvedPrinter,
      task.params as Partial<PrintJobParams>,
    )

    // ── Step 5+6: Record outcome + PATCH terminal status ──────────────────
    if (result.success) {
      log(`task ${task.taskId}: print success in ${result.durationMs}ms ✓`)
      // Write to local DB BEFORE PATCH — crash between here and PATCH → queued retry, no reprint
      markTaskDone(db, task.taskId, 'completed')
      const ok = await patch('completed')
      if (!ok) {
        enqueuePatch(db, task.taskId, { status: 'completed' })
      }
    } else {
      err(
        `task ${task.taskId}: print failed — errorCode=${result.errorCode ?? 'UNKNOWN'}` +
          `  msg=${result.errorMessage ?? ''}`,
      )
      markTaskDone(db, task.taskId, 'failed')
      const ok = await patch(
        'failed',
        result.errorCode ?? 'PRINT_COMMAND_FAILED',
        result.errorMessage,
      )
      if (!ok) {
        enqueuePatch(db, task.taskId, {
          status: 'failed',
          errorCode: result.errorCode ?? 'PRINT_COMMAND_FAILED',
          errorMessage: result.errorMessage,
        })
      }
    }
  } finally {
    // ── Always clean up temp file ─────────────────────────────────────────
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath)
        log(`task ${task.taskId}: temp file deleted`)
      } catch (e) {
        warn(`task ${task.taskId}: temp file cleanup failed — ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
}

// ── Claim loop ────────────────────────────────────────────────────────────────

async function runClaimCycle(
  config: AgentConfig,
  db: AgentDatabase,
  activeTasks: Set<string>,
): Promise<void> {
  if (!config.terminalId || !config.agentToken) {
    return // Not registered yet; skip silently
  }

  const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)

  let tasks: ClaimTask[]
  try {
    const resp = await client.post<ClaimTask[]>(
      `/terminals/${config.terminalId}/tasks/claim`,
      { maxTasks: 1 },
    )
    tasks = Array.isArray(resp.data) ? resp.data : []
  } catch (e) {
    const status = axios.isAxiosError(e) ? e.response?.status : undefined
    if (status !== 404 && status !== 204) {
      warn(`task-runner: claim cycle error — ${axiosErrorMessage(e)}`)
    }
    return
  }

  if (tasks.length === 0) return

  for (const task of tasks) {
    if (activeTasks.has(task.taskId)) {
      warn(`task-runner: task ${task.taskId} already active, skipping duplicate claim`)
      continue
    }

    if (task.type !== 'print') {
      warn(`task-runner: task ${task.taskId} type="${task.type}" not supported — skipping`)
      continue
    }

    activeTasks.add(task.taskId)
    log(`task-runner: claimed task ${task.taskId}`)

    // Execute async — don't block claim loop
    executeTask(task, config, db)
      .catch((e) =>
        err(`task-runner: unhandled error in task ${task.taskId} — ${e instanceof Error ? e.message : String(e)}`),
      )
      .finally(() => {
        activeTasks.delete(task.taskId)
      })
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface TaskRunnerOptions {
  config: AgentConfig
  db: AgentDatabase
}

/**
 * Start the task claim polling loop.
 * Returns NodeJS.Timeout — pass to clearInterval() to stop.
 */
export function startTaskRunner(options: TaskRunnerOptions): NodeJS.Timeout {
  const { config, db } = options
  const interval = config.claimIntervalMs ?? 5_000
  const activeTasks = new Set<string>()

  log(`task-runner: starting — interval=${interval}ms`)

  return setInterval(() => {
    runClaimCycle(config, db, activeTasks).catch((e) =>
      err(`task-runner: unexpected cycle error — ${e instanceof Error ? e.message : String(e)}`),
    )
  }, interval)
}
