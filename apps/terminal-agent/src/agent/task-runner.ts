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
import { getPrinterPreflight, getPrintJobStatus, type PrinterPreflight } from './wmi'
import { log, warn, err } from '../logger'
import { DEFAULT_PRINTER } from '../config'
import {
  isTaskDone,
  getTaskLocalStatus,
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
    // Must bypass system proxy (same reason as api-client.ts proxy:false):
    // Windows http_proxy env var would route this request through a local proxy
    // (e.g. Clash/v2ray at 127.0.0.1:xxxx), causing download timeouts.
    proxy: false,
  })
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, Buffer.from(resp.data))
}

/**
 * 计算下载文件的 SHA-256 摘要（hex）。
 *
 * 方案②命名说明：服务端 files 服务计算的是 SHA-256，并通过 `sha256` 字段返回，
 * Kiosk 原样作为 `fileMd5`（wire 字段名未改）上送。因此这里必须用 SHA-256 重算，
 * 才能与 `task.fileMd5`（实为 sha256）正确比对。
 * 历史 bug：此前用 md5 重算 → 与 sha256 永不相等 → 真实上传文件 100% DOWNLOAD_HASH_MISMATCH。
 */
function computeFileSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/** 打印机预检结果 → 明确的 errorCode + 中文消息；返回 null 表示可继续打印。 */
function preflightToError(
  pf: PrinterPreflight,
  printerName: string,
): { errorCode: string; errorMessage: string } | null {
  switch (pf) {
    case 'not_found':
      return { errorCode: 'PRINTER_NOT_FOUND', errorMessage: `打印机未找到：${printerName}` }
    case 'offline':
      return { errorCode: 'PRINTER_OFFLINE', errorMessage: '打印机离线（请检查电源/网线/USB 连接）' }
    case 'paper_empty':
      return { errorCode: 'PAPER_EMPTY', errorMessage: '打印机缺纸，当前无法打印，请联系工作人员补纸后重试' }
    case 'error':
      return { errorCode: 'PRINTER_ERROR', errorMessage: '打印机可能卡纸或发生设备故障，当前暂时无法继续使用，请联系工作人员处理' }
    // 'ok' | 'unknown'（非 Windows / 查询失败）→ 不阻塞
    default:
      return null
  }
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

  // Define patch helper early so it's available in both Step 0 (spooled reconcile)
  // and the main execution path below.
  const patch = (status: ReportableStatus, errorCode?: string, errorMessage?: string) =>
    patchStatus(
      task.taskId,
      { status, ...(errorCode ? { errorCode } : {}), ...(errorMessage ? { errorMessage } : {}) },
      apiBaseUrl,
      agentToken,
      terminalId,
    )

  // ── Step 0: Idempotency check ─────────────────────────────────────────────
  if (isTaskDone(db, task.taskId)) {
    const localStatus = getTaskLocalStatus(db, task.taskId)
    if (localStatus === 'spooled') {
      // Agent crashed during post-spooling monitoring (Step 4.5). The job was
      // already submitted to the Windows spooler before the crash, but we cannot
      // confirm whether it actually printed (paper may or may not have come out).
      // Report as failed+PRINT_JOB_UNCONFIRMED — do NOT assert completed, since
      // that would silently hide a possible no-paper / jam situation.
      // Operator must check the device physically before re-issuing the task.
      const msg = '打印作业已提交到打印队列，但未确认完成，请工作人员检查纸张、卡纸和出纸状态'
      warn(
        `task ${task.taskId}: was already submitted to Windows spooler before restart (crashed during monitoring); ` +
        `outcome cannot be confirmed — PATCH failed+PRINT_JOB_UNCONFIRMED, operator must check device`,
      )
      markTaskDone(db, task.taskId, 'failed')
      const ok = await patch('failed', 'PRINT_JOB_UNCONFIRMED', msg)
      if (!ok) enqueuePatch(db, task.taskId, { status: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED', errorMessage: msg })
    } else {
      log(`task ${task.taskId}: already done in local DB (${localStatus ?? 'unknown'}), skipping (restart-idempotency)`)
    }
    return
  }

  const ext = extFromUrl(task.fileUrl)
  const tempFilePath = path.join(getTempDir(), `task_${task.taskId}${ext}`)

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

    // ── Step 2: Hash verification (SHA-256；wire 字段名仍为 fileMd5) ───────
    if (task.fileMd5) {
      const actual = computeFileSha256(tempFilePath)
      if (actual !== task.fileMd5) {
        err(`task ${task.taskId}: hash mismatch (SHA-256) — expected=${task.fileMd5}  actual=${actual}`)
        markTaskDone(db, task.taskId, 'failed')
        const ok = await patch(
          'failed',
          'DOWNLOAD_HASH_MISMATCH',
          `文件校验失败（SHA-256 不一致）：expected=${task.fileMd5}, got=${actual}`,
        )
        if (!ok) enqueuePatch(db, task.taskId, { status: 'failed', errorCode: 'DOWNLOAD_HASH_MISMATCH' })
        return
      }
      log(`task ${task.taskId}: 文件哈希校验通过 (SHA-256) ✓`)
    } else {
      warn(`task ${task.taskId}: server did not provide file hash, skipping verification`)
    }

    // ── Step 2.5: Printer pre-flight ──────────────────────────────────────
    // 打印前预检：只在 WMI 明确报告故障时拦截，给出精确 errorCode，避免走到 5min 超时。
    // 非 Windows / 查询失败返回 'unknown' → 不阻塞，交由 print() 自然处理。
    const resolvedPrinter = printerName || DEFAULT_PRINTER
    const preflight = await getPrinterPreflight(resolvedPrinter)
    const preflightErr = preflightToError(preflight, resolvedPrinter)
    if (preflightErr) {
      err(`task ${task.taskId}: printer pre-flight failed — ${preflightErr.errorCode} (${preflight})`)
      markTaskDone(db, task.taskId, 'failed')
      const ok = await patch('failed', preflightErr.errorCode, preflightErr.errorMessage)
      if (!ok) {
        enqueuePatch(db, task.taskId, {
          status: 'failed',
          errorCode: preflightErr.errorCode,
          errorMessage: preflightErr.errorMessage,
        })
      }
      return
    }

    // ── Step 3: PATCH printing (informational; failure does not abort) ────
    await patch('printing')

    // ── Step 4: Print ─────────────────────────────────────────────────────
    log(`task ${task.taskId}: printing on "${resolvedPrinter}"...`)

    const result = await print(
      tempFilePath,
      resolvedPrinter,
      task.params as Partial<PrintJobParams>,
    )

    // ── Step 5+6: Record outcome + PATCH terminal status ──────────────────
    if (result.success) {
      log(`task ${task.taskId}: print success in ${result.durationMs}ms ✓`)

      // ── Step 4.5: Immediately write 'spooled' to local DB ─────────────
      // N5 guarantee: if Agent crashes during post-spooling monitoring, restart
      // will see 'spooled' → skip reprint → reconcile as completed (conservative).
      // INSERT OR REPLACE so a later markTaskDone('completed'/'failed') can overwrite.
      try {
        markTaskDone(db, task.taskId, 'spooled')
      } catch (dbErr) {
        err(
          `task ${task.taskId}: failed to record spooled in local DB — ` +
            `${dbErr instanceof Error ? dbErr.message : String(dbErr)}; ` +
            `task may be re-printed after restart`,
        )
      }

      // ── Step 4.5: Post-spooling print queue monitoring (N3 detection) ──
      // Poll Get-PrintJob to detect PaperOut / Jammed / Error after the
      // Windows spooler accepted the job (SumatraPDF already exited).
      // PaperOut requires 2 consecutive confirmations to guard against transient
      // driver state flicker.
      // On timeout / job not found: conservative completed (no false failures).
      const monitorOutcome = await monitorPrintJob(
        resolvedPrinter,
        task.taskId,
        30_000,
        1_500,
      )

      // Log monitor warn regardless of failed/completed (covers Retained timeout detail).
      if (monitorOutcome.warn) {
        warn(`task ${task.taskId}: print queue monitor: ${monitorOutcome.warn}`)
      }

      if (monitorOutcome.failed) {
        err(
          `task ${task.taskId}: print queue monitor detected failure — ` +
            `${monitorOutcome.errorCode} (${monitorOutcome.rawStatus ?? '?'})`,
        )
        try {
          markTaskDone(db, task.taskId, 'failed')
        } catch (dbErr) {
          err(`task ${task.taskId}: failed to record failed in local DB — ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`)
        }
        const ok = await patch('failed', monitorOutcome.errorCode, monitorOutcome.errorMessage)
        if (!ok) {
          enqueuePatch(db, task.taskId, {
            status: 'failed',
            errorCode: monitorOutcome.errorCode,
            errorMessage: monitorOutcome.errorMessage,
          })
        }
      } else {
        try {
          markTaskDone(db, task.taskId, 'completed')
        } catch (dbErr) {
          err(
            `task ${task.taskId}: failed to record completed in local DB — ` +
              `${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
          )
        }
        const ok = await patch('completed')
        if (!ok) {
          enqueuePatch(db, task.taskId, { status: 'completed' })
        }
      }
    } else {
      err(
        `task ${task.taskId}: print failed — errorCode=${result.errorCode ?? 'UNKNOWN'}` +
          `  msg=${result.errorMessage ?? ''}`,
      )
      try {
        markTaskDone(db, task.taskId, 'failed')
      } catch (dbErr) {
        err(
          `task ${task.taskId}: failed to record failed in local DB — ` +
            `${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        )
      }
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

// ── Post-spooling print job monitor ──────────────────────────────────────────

interface MonitorOutcome {
  failed: boolean
  errorCode: string
  errorMessage?: string
  rawStatus?: string
  warn?: string
}

/**
 * Poll Get-PrintJob until the job completes, errors, or the timeout expires.
 *
 * Design invariants:
 *   - PaperOut must appear on 2 consecutive polls before returning 'paper_empty'
 *     (guards against transient driver state flicker).
 *   - If the job never appears (taskId not in DocumentName), return conservative
 *     completed + warn (no time-window fallback to avoid mismatching other jobs).
 *   - Timeout → conservative completed + warn (could be large/slow document).
 *   - Non-Windows → skip monitoring, return conservative completed immediately.
 *
 * @param printerName     Windows printer name (from config)
 * @param taskId          Task ID — matched against DocumentName via "*taskId*"
 * @param timeoutMs       Maximum monitoring wall time (default 30 000 ms)
 * @param pollIntervalMs  Time between polls (default 1 500 ms)
 */
async function monitorPrintJob(
  printerName: string,
  taskId: string,
  timeoutMs = 30_000,
  pollIntervalMs = 1_500,
): Promise<MonitorOutcome> {
  if (process.platform !== 'win32') {
    return { failed: false, errorCode: '', warn: 'non-Windows: skipped print queue monitoring' }
  }

  // How many consecutive 'not_found' polls (without ever seeing the job) before
  // we give up waiting and return conservative completed.  Fast single-page jobs
  // complete and leave the spooler queue before the first 1.5s poll fires; 5
  // consecutive not-found results (≈7.5s after print()) is long enough to catch
  // any delayed spooler registration without making normal prints wait 30s.
  const NOT_FOUND_LIMIT = 5

  const deadline = Date.now() + timeoutMs
  let paperEmptyCount = 0
  let notFoundCount = 0
  let jobSeenOnce = false
  let seenRetainedOnce = false  // Pantum 'Printing, Retained' indeterminate flag

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs)

    const { status, rawStatus } = await getPrintJobStatus(printerName, taskId)

    switch (status) {
      case 'paper_empty':
        paperEmptyCount++
        notFoundCount = 0
        jobSeenOnce = true
        // Require 2 consecutive PaperOut confirmations before declaring failure.
        if (paperEmptyCount >= 2) {
          return {
            failed: true,
            errorCode: 'PAPER_EMPTY',
            errorMessage: '打印机缺纸，当前无法打印，请联系工作人员补纸后重试',
            rawStatus,
          }
        }
        break

      case 'error': {
        // Covers Jammed / Error / UserIntervention / Deleting — explicit driver error flags.
        const isJammed = rawStatus?.toLowerCase().includes('jammed') ?? false
        return {
          failed: true,
          errorCode: 'PRINTER_ERROR',
          errorMessage: isJammed
            ? `打印机可能卡纸或发生设备故障，当前暂时无法继续使用，请联系工作人员处理（队列状态: ${rawStatus ?? '?'}）`
            : `打印机发生设备异常，当前暂时无法继续使用，请联系工作人员处理（队列状态: ${rawStatus ?? '?'}）`,
          rawStatus,
        }
      }

      case 'retained':
        // Pantum CM2800ADN: job submitted to printer + spooler retained copy.
        // Indeterminate: cannot distinguish "printed and kept" from "waiting for paper".
        // Keep polling — in case the driver eventually reports an explicit PaperOut or Error.
        jobSeenOnce = true
        seenRetainedOnce = true
        notFoundCount = 0
        paperEmptyCount = 0
        break

      case 'completed':
        // Job disappeared from queue — normal successful completion (non-Pantum).
        return { failed: false, errorCode: '' }

      case 'printing':
        // Job still spooling/rendering (no Retained flag yet).
        jobSeenOnce = true
        paperEmptyCount = 0
        notFoundCount = 0
        break

      case 'not_found':
        if (jobSeenOnce) {
          // Job was visible and then disappeared — completed successfully.
          return { failed: false, errorCode: '' }
        }
        notFoundCount++
        paperEmptyCount = 0
        if (notFoundCount >= NOT_FOUND_LIMIT) {
          // Job never appeared after NOT_FOUND_LIMIT polls. Either it completed
          // before we could observe it (fast job) or DocumentName didn't match.
          // Conservative: completed + warn.
          return {
            failed: false,
            errorCode: '',
            warn: `job not found in queue after ${NOT_FOUND_LIMIT} polls (${(NOT_FOUND_LIMIT * pollIntervalMs / 1000).toFixed(1)}s); treating as completed`,
          }
        }
        break

      case 'unknown':
        // Query failure — don't penalise; keep waiting.
        paperEmptyCount = 0
        break
    }
  }

  // Hard timeout reached.
  if (seenRetainedOnce) {
    // Pantum driver limitation: job was visible as 'Printing, Retained' throughout
    // the monitoring window. Cannot distinguish normal completion from waiting-for-paper.
    // Report as failed+PRINT_JOB_UNCONFIRMED — never assert false completed.
    // Operator must check the device physically.
    const retainedMsg = `print queue monitoring timed out after ${timeoutMs}ms: ` +
      `job remained in 'Printing, Retained' state (Pantum CM2800ADN driver limitation — ` +
      `cannot distinguish completed vs paper-empty via Get-PrintJob); ` +
      `reporting PRINT_JOB_UNCONFIRMED — operator must check device`
    return {
      failed: true,
      errorCode: 'PRINT_JOB_UNCONFIRMED',
      errorMessage: '打印作业已提交到打印队列，但未确认完成，请工作人员检查纸张、卡纸和出纸状态',
      rawStatus: 'Printing, Retained (timeout)',
      warn: retainedMsg,
    }
  }

  // Job never appeared or was in normal 'printing' state but timed out.
  // Conservative: treat as completed + warn (large/slow document on non-Pantum printer).
  const warnMsg = jobSeenOnce
    ? `print queue monitoring timed out after ${timeoutMs}ms (job visible as 'printing' but did not complete); treating as completed`
    : `print queue monitoring timed out after ${timeoutMs}ms (job never matched in queue); treating as completed`
  return { failed: false, errorCode: '', warn: warnMsg }
}

/** Async sleep helper (avoids blocking the event loop). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
