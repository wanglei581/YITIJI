/**
 * agent/task-runner.ts — Phase 8.1B
 *
 * Polls the backend for print tasks and executes them:
 *
 *   every 5s → POST /api/v1/terminals/:terminalId/tasks/claim
 *             → for each task:
 *                 1. Download file to temp dir
 *                 2. Verify MD5 (if provided by server)
 *                 3. PATCH status = "printing"
 *                 4. Call unified print() from Phase 8.1A
 *                 5. PATCH status = "completed" | "failed"
 *                 6. Delete temp file (in finally block)
 *
 * Design constraints:
 *   - Never leave a claimed task without a status PATCH (try/finally guarantees this)
 *   - Never falsify success (if PATCH fails, log warn but don't pretend it succeeded)
 *   - HTTP errors on claim: log + skip cycle (heartbeat shows connectivity issues)
 *   - Duplicate task guard: Set<string> of active taskIds prevents double-execution
 *   - Tasks run async so the claim loop is never blocked by a slow print job
 *
 * Phase 8.1B scope:
 *   - type: 'print' only (scan tasks logged and skipped)
 *   - maxTasks: 1 per claim cycle
 *   - No lease renewal (Phase 8.1C)
 *   - No SQLite persistence (Phase 8.1C)
 *   - BMP/TIFF: print() returns UNSUPPORTED_FILE_TYPE → PATCH failed
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

// ── Temp directory ────────────────────────────────────────────────────────────

/**
 * Temp directory for downloaded print files.
 * Mirrors image-to-pdf.ts: %ProgramData%\AIJobPrintAgent\temp\ on Windows,
 * os.tmpdir()/AIJobPrintAgent/temp/ on macOS/Linux (dev/test).
 */
function getTempDir(): string {
  const base = process.env['PROGRAMDATA']
    ? path.join(process.env['PROGRAMDATA'], 'AIJobPrintAgent', 'temp')
    : path.join(os.tmpdir(), 'AIJobPrintAgent', 'temp')
  fs.mkdirSync(base, { recursive: true })
  return base
}

// ── Download + MD5 ────────────────────────────────────────────────────────────

/**
 * Download a file to destPath using axios (supports presigned OSS/S3 URLs).
 * Timeout: 60s (large PDFs on slow terminal network).
 */
async function downloadFile(fileUrl: string, destPath: string): Promise<void> {
  const resp = await axios.get<ArrayBuffer>(fileUrl, {
    responseType: 'arraybuffer',
    timeout: 60_000,
  })
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, Buffer.from(resp.data))
}

/** Compute MD5 hex digest of a local file. */
function computeFileMd5(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  return crypto.createHash('md5').update(buf).digest('hex')
}

/** Extract file extension from a URL (strips query string first). */
function extFromUrl(fileUrl: string): string {
  const noQuery = fileUrl.split('?')[0]
  return path.extname(noQuery).toLowerCase() || '.pdf'
}

/** Resolve relative task file URLs against the configured backend API base URL. */
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
 * Failures are logged as warnings (never throws).
 * The backend is idempotent for repeated PATCHes with the same status.
 */
async function patchStatus(
  taskId: string,
  payload: PatchStatusPayload,
  apiBaseUrl: string,
  agentToken: string,
  terminalId: string,
): Promise<void> {
  const client = createApiClient(apiBaseUrl, agentToken, terminalId)
  try {
    await client.patch(`/print-tasks/${taskId}/status`, payload)
    log(`task ${taskId}: PATCH status=${payload.status} ✓`)
  } catch (e) {
    warn(
      `task ${taskId}: PATCH status=${payload.status} failed — ${axiosErrorMessage(e)}` +
        ' (task may appear stuck in backend; will be reset by claimExpiresAt timeout)',
    )
  }
}

// ── Task execution ────────────────────────────────────────────────────────────

/**
 * Execute a single claimed print task end-to-end.
 * Guarantees: PATCH status is always called, temp file is always deleted.
 */
async function executeTask(task: ClaimTask, config: AgentConfig): Promise<void> {
  const { terminalId, agentToken, apiBaseUrl, printerName } = config
  // Type guard: all required fields confirmed before this function is called
  if (!terminalId || !agentToken) {
    err(`task ${task.taskId}: executeTask called without terminalId/agentToken — skipping`)
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
    // ── Step 1: Download ────────────────────────────────────────────────────
    log(`task ${task.taskId}: downloading...`)
    try {
      await downloadFile(resolveFileUrl(task.fileUrl, apiBaseUrl), tempFilePath)
    } catch (e) {
      err(`task ${task.taskId}: download failed — ${e instanceof Error ? e.message : String(e)}`)
      await patch('failed', 'PRINT_COMMAND_FAILED', `Download failed: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    log(`task ${task.taskId}: downloaded (${(fs.statSync(tempFilePath).size / 1024).toFixed(1)} KB)`)

    // ── Step 2: MD5 verification ────────────────────────────────────────────
    if (task.fileMd5) {
      const actual = computeFileMd5(tempFilePath)
      if (actual !== task.fileMd5) {
        err(`task ${task.taskId}: MD5 mismatch — expected=${task.fileMd5}  actual=${actual}`)
        await patch(
          'failed',
          'DOWNLOAD_HASH_MISMATCH',
          `MD5 mismatch: expected=${task.fileMd5}, got=${actual}`,
        )
        return
      }
      log(`task ${task.taskId}: MD5 ✓`)
    } else {
      warn(`task ${task.taskId}: server did not provide fileMd5, skipping verification`)
    }

    // ── Step 3: PATCH printing ──────────────────────────────────────────────
    await patch('printing')

    // ── Step 4: Print ───────────────────────────────────────────────────────
    const resolvedPrinter = printerName || DEFAULT_PRINTER
    log(`task ${task.taskId}: printing on "${resolvedPrinter}"...`)

    const result = await print(
      tempFilePath,
      resolvedPrinter,
      task.params as Partial<PrintJobParams>,
    )

    // ── Step 5: Report outcome ──────────────────────────────────────────────
    if (result.success) {
      log(`task ${task.taskId}: print success in ${result.durationMs}ms ✓`)
      await patch('completed')
    } else {
      err(
        `task ${task.taskId}: print failed — errorCode=${result.errorCode ?? 'UNKNOWN'}` +
          `  msg=${result.errorMessage ?? ''}`,
      )
      await patch(
        'failed',
        result.errorCode ?? 'PRINT_COMMAND_FAILED',
        result.errorMessage,
      )
    }
  } finally {
    // ── Always clean up temp file ───────────────────────────────────────────
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

/**
 * Run a single claim cycle.
 * POST /terminals/:terminalId/tasks/claim → execute returned tasks asynchronously.
 */
async function runClaimCycle(config: AgentConfig, activeTasks: Set<string>): Promise<void> {
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
    // 404 / 204 = no pending tasks (backend-specific); any other error = connectivity issue
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
      warn(`task-runner: task ${task.taskId} type="${task.type}" not supported in Phase 8.1B — skipping`)
      continue
    }

    activeTasks.add(task.taskId)
    log(`task-runner: claimed task ${task.taskId}`)

    // Execute async — don't block claim loop
    executeTask(task, config)
      .catch((e) => err(`task-runner: unhandled error in task ${task.taskId} — ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        activeTasks.delete(task.taskId)
      })
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface TaskRunnerOptions {
  config: AgentConfig
}

/**
 * Start the task claim polling loop.
 * Returns NodeJS.Timeout — pass to clearInterval() to stop.
 */
export function startTaskRunner(options: TaskRunnerOptions): NodeJS.Timeout {
  const interval = options.config.claimIntervalMs ?? 5_000
  const activeTasks = new Set<string>()

  log(`task-runner: starting — interval=${interval}ms`)

  return setInterval(() => {
    runClaimCycle(options.config, activeTasks).catch((e) =>
      err(`task-runner: unexpected cycle error — ${e instanceof Error ? e.message : String(e)}`),
    )
  }, interval)
}
