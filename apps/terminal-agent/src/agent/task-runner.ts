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
 *   - Claim cycles are serialized through task-runner-control so one printer never
 *     executes two tasks concurrently
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import os from 'os'
import axios from 'axios'
import type { AgentConfig, ClaimTask, PatchStatusPayload, ReportableStatus } from './types'
import type { PrintJobParams } from '../printer/types'
import { createApiClient, createDirectHttpAgents, axiosErrorMessage, isUnauthorizedHttpError } from './api-client'
import { isUnauthorized, markUnauthorized } from './auth-state'
import { writeStartupDiagnosticSafely } from './startup-diagnostics'
import { print } from '../printer/print'
import { cleanupStaleOwnPrintJobs, pauseConfiguredPrinterQueue, resumeConfiguredPrinterQueue } from './print-queue-hold'
import { claimPrintTasksIfGateOpen, preparePrinterForDispatch, settlePrinterAfterTerminal } from './print-dispatch-gate'
import { computeMonitorTimeoutMs } from './print-monitor-timeout'

export { computeMonitorTimeoutMs }
import { monitorPrintJob } from './print-job-monitor'
import { getPrinterPreflight, type PrinterPreflight } from './wmi'

export { monitorPrintJob }
export type { MonitorOutcome } from './print-job-monitor'
import { computeClaimPause } from './claim-rate-limit'
import { log, warn, err } from '../logger'
import {
  isTaskDone,
  getTaskLocalStatus,
  markTaskDone,
  enqueuePatch,
  isDatabaseAvailable,
  type AgentDatabase,
} from './db'
import { createTaskRunnerControl, type TaskRunnerControl } from './task-runner-control'

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
    // Avoid reusing stale sockets after proxy / network route changes.
    ...createDirectHttpAgents(),
    headers: {
      'Connection': 'close',
    },
  })
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, Buffer.from(resp.data))
}

const DOWNLOAD_RETRY_DELAYS_MS = [2_000, 5_000, 10_000]

/**
 * AGT-03：下载失败按 2s / 5s / 10s 退避重试（共 4 次尝试）。只对网络层与 5xx 重试；
 * 4xx（签名过期 / 文件已清理）立即失败，重试也不会变好。
 */
export async function downloadWithRetry(
  fileUrl: string,
  destPath: string,
  taskId: string,
  dependencies: { download?: typeof downloadFile; wait?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const download = dependencies.download ?? downloadFile
  const sleep = dependencies.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let lastError: unknown
  for (let attempt = 0; attempt <= DOWNLOAD_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await download(fileUrl, destPath)
      return
    } catch (e) {
      lastError = e
      const status = axios.isAxiosError(e) ? e.response?.status : undefined
      const retryable = status === undefined || status >= 500
      if (!retryable || attempt === DOWNLOAD_RETRY_DELAYS_MS.length) break
      const delay = DOWNLOAD_RETRY_DELAYS_MS[attempt] ?? DOWNLOAD_RETRY_DELAYS_MS[DOWNLOAD_RETRY_DELAYS_MS.length - 1]!
      warn(
        `task ${taskId}: download attempt ${attempt + 1} failed — ${axiosErrorMessage(e)}; retry in ${delay / 1000}s`,
      )
      await sleep(delay)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
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

// ── Extension inference (HIGH-1 fix) ──────────────────────────────────────────
//
// 历史 bug：extFromUrl 仅看 URL 后缀。签名 URL 形如
//   /api/v1/files/<id>/content?expires=...&sig=...
// 去掉 query 后没有任何文件后缀 → path.extname() 为空 → 永远回退 .pdf。
// 结果：上传 JPEG/PNG 也被当 PDF 喂给 SumatraPDF，必然失败，print.ts 的
// 图片→pdfkit 分支变成死代码。
//
// 修复：契约 C2 让 claim 响应带上 fileName/mimeType，扩展名按优先级推断：
//   mimeType → fileName 后缀 → URL 后缀 → 最后 .pdf。
//
// MIME → 扩展名映射只覆盖 print() / SUPPORTED_EXTENSIONS（config.ts）能打印的类型。
// 注意：Agent 端 SUPPORTED_EXTENSIONS 与后端 files 服务允许的上传 MIME 白名单
// 并不完全一致（例如后端可能允许 office 文档，但 Agent print() 仅支持
// pdf/jpg/jpeg/png，bmp/tiff 仍待 sharp 预处理）。这部分差异由 Agent4 在
// files 上传侧收口（拒绝 Agent 无法打印的 MIME）；此处仅负责把已落库的任务
// 推断成 print() 可识别的扩展名，识别不出时回退 .pdf 交给 print() 的
// UNSUPPORTED_FILE_TYPE 兜底返回明确错误。
const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg':      '.jpg',
  'image/jpg':       '.jpg',
  'image/png':       '.png',
  'image/bmp':       '.bmp',
  'image/tiff':      '.tiff',
}

function extFromUrl(fileUrl: string): string | undefined {
  const noQuery = fileUrl.split('?')[0]
  const ext = path.extname(noQuery ?? '').toLowerCase()
  return ext || undefined
}

function extFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined
  const ext = path.extname(fileName).toLowerCase()
  return ext || undefined
}

function extFromMime(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase()
  return normalized ? MIME_TO_EXT[normalized] : undefined
}

/**
 * 推断任务文件的打印扩展名。优先级（契约 C2）：
 *   mimeType → fileName 后缀 → URL 后缀 → .pdf
 */
function inferTaskExt(task: ClaimTask): string {
  return (
    extFromMime(task.mimeType) ??
    extFromFileName(task.fileName) ??
    extFromUrl(task.fileUrl) ??
    '.pdf'
  )
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
export async function patchStatus(
  taskId: string,
  payload: PatchStatusPayload,
  apiBaseUrl: string,
  agentToken: string,
  terminalId: string,
  sendPatch?: () => Promise<void>,
): Promise<boolean> {
  try {
    if (sendPatch) {
      await sendPatch()
    } else {
      const client = createApiClient(apiBaseUrl, agentToken, terminalId)
      await client.patch(`/print-tasks/${taskId}/status`, payload)
    }
    log(`task ${taskId}: PATCH status=${payload.status} ✓`)
    return true
  } catch (e) {
    if (isUnauthorizedHttpError(e)) {
      markUnauthorized()
      writeStartupDiagnosticSafely('AGENT_UNAUTHORIZED')
      err(`task ${taskId}: PATCH status=${payload.status} unauthorized — printing stopped (re-bind required)`)
      return false
    }
    warn(
      `task ${taskId}: PATCH status=${payload.status} failed — ${axiosErrorMessage(e)}` +
        ' (will retry via offline-queue if status is terminal)',
    )
    return false
  }
}

/** Testable fail-closed gate used immediately before invoking the printer. */
export function shouldAbortBeforePrint(): boolean {
  return isUnauthorized()
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
export async function executeTask(
  task: ClaimTask,
  config: AgentConfig,
  db: AgentDatabase,
): Promise<void> {
  const { terminalId, agentToken, apiBaseUrl, printerName } = config
  if (!terminalId || !agentToken) {
    err(`task ${task.taskId}: executeTask called without terminalId/agentToken — skipping`)
    return
  }
  if (isUnauthorized()) {
    warn(`task ${task.taskId}: credential unauthorized before execution; print skipped`)
    return
  }
  if (!isDatabaseAvailable(db)) {
    warn(`task ${task.taskId}: local task database unavailable before execution; print skipped`)
    return
  }

  // Define patch helper early so it's available in both Step 0 (spooled reconcile)
  // and the main execution path below.
  let terminalOutcome: 'failed' | 'completed' | 'open' = 'open'
  const patch = (status: ReportableStatus, errorCode?: string, errorMessage?: string) => {
    if (status === 'failed' || status === 'completed') terminalOutcome = status
    return patchStatus(
      task.taskId,
      { status, ...(errorCode ? { errorCode } : {}), ...(errorMessage ? { errorMessage } : {}) },
      apiBaseUrl,
      agentToken,
      terminalId,
    )
  }

  // ── Step 0: Idempotency check ─────────────────────────────────────────────
  if (isTaskDone(db, task.taskId)) {
    const localStatus = getTaskLocalStatus(db, task.taskId)
    if (localStatus === 'spooled' || localStatus === 'dispatching') {
      // Agent crashed after durable dispatch intent. The job may or may not have
      // reached the Windows spooler, so we cannot confirm whether it printed.
      // Report as failed+PRINT_JOB_UNCONFIRMED — do NOT assert completed, since
      // that would silently hide a possible no-paper / jam situation.
      // Operator must check the device physically before re-issuing the task.
      const msg = '打印派发已开始，但无法确认是否已进入队列或完成出纸，请工作人员现场核查'
      warn(
        `task ${task.taskId}: print dispatch was already started before restart; ` +
        `outcome cannot be confirmed — PATCH failed+PRINT_JOB_UNCONFIRMED, operator must check device`,
      )
      markTaskDone(db, task.taskId, 'failed')
      const ok = await patch('failed', 'PRINT_JOB_UNCONFIRMED', msg)
      if (!ok) enqueuePatch(db, task.taskId, { status: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED', errorMessage: msg })
    } else if (localStatus === 'completed') {
      log(`task ${task.taskId}: locally completed task was re-claimed; replaying terminal status`)
      const ok = await patch('completed')
      if (!ok) enqueuePatch(db, task.taskId, { status: 'completed' })
    } else if (localStatus === 'failed') {
      log(`task ${task.taskId}: locally failed task was re-claimed; replaying terminal status`)
      const ok = await patch('failed')
      if (!ok) enqueuePatch(db, task.taskId, { status: 'failed' })
    } else {
      const msg = `本地打印任务状态异常（${localStatus ?? 'unknown'}），为避免重复出纸已停止自动重试，请工作人员核查`
      warn(`task ${task.taskId}: unknown local state; refusing automatic print and reporting failed`)
      markTaskDone(db, task.taskId, 'failed')
      const ok = await patch('failed', 'LOCAL_TASK_STATE_UNKNOWN', msg)
      if (!ok) enqueuePatch(db, task.taskId, { status: 'failed', errorCode: 'LOCAL_TASK_STATE_UNKNOWN', errorMessage: msg })
    }
    await settlePrinterAfterTerminal({
      outcome: terminalOutcome,
      pauseAgain: false,
      removeOwnJobs: async () => { await cleanupStaleOwnPrintJobs({ printerName }) },
      pause: async () => undefined,
    })
    return
  }

  const ext = inferTaskExt(task)
  const tempFilePath = path.join(getTempDir(), `task_${task.taskId}${ext}`)
  // 只有 resume 成功才在终态再暂停。恢复失败时队列仍是暂停的，并合上 queue_pause_failed，下一轮不再领单。
  let releaseQueueAfterTerminalState = false

  // AGT-07：日志不落用户原始文件名（简历常以「姓名+简历.pdf」命名，属 CLAUDE.md §11
  // 敏感文件）。只记扩展名与长度，足够排障。
  log(
    `task ${task.taskId}: start — type=${task.type}  ext=${ext} ` +
      `(mime=${task.mimeType ?? '-'}, nameLen=${task.fileName ? task.fileName.length : 0})`,
  )

  try {
    // ── Step 1: Download ──────────────────────────────────────────────────
    // AGT-03：签名 URL 瞬时超时 / 5xx 不能直接判 failed —— 这时纸还没出，重试没有
    // 重复出纸风险；而一次失败就终态会让已付款订单直接失败。三次退避重试后仍失败
    // 才上报（总耗时上限约 3 分钟，在 5 分钟租约内）。
    log(`task ${task.taskId}: downloading...`)
    try {
      await downloadWithRetry(resolveFileUrl(task.fileUrl, apiBaseUrl), tempFilePath, task.taskId)
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
    const resolvedPrinter = printerName
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
    if (shouldAbortBeforePrint()) {
      warn(`task ${task.taskId}: credential became unauthorized before printing status; print skipped`)
      return
    }
    // AGT-01：printing 只是信息性中间态。上报失败重试一次后继续打印；服务端已接受
    // claimed → completed（补写 printing 日志），所以这里不会再把真出纸记成假失败。
    const printingAcked = (await patch('printing')) || (!shouldAbortBeforePrint() && (await patch('printing')))
    if (!printingAcked) {
      warn(`task ${task.taskId}: printing status not acknowledged; continuing — terminal status will be reported directly`)
    }
    if (shouldAbortBeforePrint()) {
      warn(`task ${task.taskId}: printing status rejected as unauthorized; print skipped`)
      return
    }

    // ── Step 4: Print ─────────────────────────────────────────────────────
    log(`task ${task.taskId}: printing on "${resolvedPrinter}"...`)

    // Durable intent closes the crash window between physical spool submission
    // and the later 'spooled' write. Any restart from this state is reconciled
    // as unconfirmed and never invokes the printer automatically again.
    try {
      markTaskDone(db, task.taskId, 'dispatching')
    } catch (dbErr) {
      const detail = dbErr instanceof Error ? dbErr.message : String(dbErr)
      err(`task ${task.taskId}: could not persist dispatching before print — ${detail}; print blocked`)
      const msg = '本地任务状态无法持久化，为避免重复出纸已停止打印，请联系工作人员'
      const ok = await patch('failed', 'LOCAL_TASK_STATE_PERSIST_FAILED', msg)
      if (!ok) {
        try {
          enqueuePatch(db, task.taskId, {
            status: 'failed',
            errorCode: 'LOCAL_TASK_STATE_PERSIST_FAILED',
            errorMessage: msg,
          })
        } catch (queueErr) {
          err(`task ${task.taskId}: could not enqueue persistence failure status — ${queueErr instanceof Error ? queueErr.message : String(queueErr)}`)
        }
      }
      return
    }

    // 领取与监控串行（inFlight，maxTasks 为 1）。恢复只包住这一单的 print() 与队列监控。
    // 派发前先删本进程 SID 的残留，再按空闲暂停开关决定要不要恢复队列。
    const prepared = await preparePrinterForDispatch({
      holdEnabled: config.holdPrinterQueueWhenIdle === true,
      removeOwnJobs: async () => { await cleanupStaleOwnPrintJobs({ printerName }) },
      resume: async () => { await resumeConfiguredPrinterQueue(printerName) },
    })
    if (prepared !== 'ready') {
      const msg = prepared === 'cleanup-failed'
        ? '打印队列里的残留作业没能删除，本次没有送去打印'
        : '打印队列没能恢复，本次没有送去打印'
      err(`task ${task.taskId}: ${msg}`)
      try {
        markTaskDone(db, task.taskId, 'failed')
      } catch (dbErr) {
        err(`task ${task.taskId}: failed to record failed in local DB — ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`)
      }
      const ok = await patch('failed', 'PRINT_COMMAND_FAILED', msg)
      if (!ok) enqueuePatch(db, task.taskId, { status: 'failed', errorCode: 'PRINT_COMMAND_FAILED', errorMessage: msg })
      return
    }
    if (config.holdPrinterQueueWhenIdle) releaseQueueAfterTerminalState = true

    const result = await print(
      tempFilePath,
      resolvedPrinter,
      task.params as Partial<PrintJobParams>,
      { correlationId: task.taskId },
    )

    // ── Step 5+6: Record outcome + PATCH terminal status ──────────────────
    // AGT-04：PRINT_TIMEOUT 只说明 SumatraPDF 没在 60s 内退出，spool 往往仍在进行、
    // 纸随后照样出来。此时不能直接判 failed（会与真实出纸相反），而是和成功路径一样
    // 进入队列监控：观测到作业完成 → completed；什么都没看到 → 按监控口径 fail-closed
    // 报 PRINT_JOB_UNCONFIRMED，交由核查流处理，绝不自动重印。
    const dispatchTimedOut = !result.success && result.errorCode === 'PRINT_TIMEOUT'
    if (result.success || dispatchTimedOut) {
      if (dispatchTimedOut) {
        warn(`task ${task.taskId}: print command timed out after ${result.durationMs}ms; job may still be spooling — falling through to queue monitoring`)
      } else {
        log(`task ${task.taskId}: print success in ${result.durationMs}ms ✓`)
      }

      // ── Step 4.5: Immediately write 'spooled' to local DB ─────────────
      // N5 guarantee: if Agent crashes during post-spooling monitoring, restart
      // will see 'spooled' → skip reprint → reconcile as unconfirmed.
      // INSERT OR REPLACE so a later markTaskDone('completed'/'failed') can overwrite.
      try {
        markTaskDone(db, task.taskId, 'spooled')
      } catch (dbErr) {
        err(
          `task ${task.taskId}: failed to record spooled in local DB — ` +
            `${dbErr instanceof Error ? dbErr.message : String(dbErr)}; ` +
            `dispatching remains durable; restart will require operator reconciliation`,
        )
      }

      // ── Step 4.5: Post-spooling print queue monitoring (N3 detection) ──
      // Poll Get-PrintJob to detect PaperOut / Jammed / Error after the
      // Windows spooler accepted the job (SumatraPDF already exited).
      // PaperOut requires 2 consecutive confirmations to guard against transient
      // driver state flicker.
      // Ambiguous outcomes (timeout / never observed / monitor unavailable) fail
      // closed. Only an explicit spooler completion or an observed job followed
      // by queue removal may reach the server as completed.
      const monitorTimeoutMs = computeMonitorTimeoutMs(task.billablePages, task.params?.copies, task.params)
      log(`task ${task.taskId}: monitoring print queue for up to ${monitorTimeoutMs / 1000}s (pages=${task.billablePages ?? '?'} copies=${task.params?.copies ?? 1})`)
      const monitorOutcome = await monitorPrintJob(
        resolvedPrinter,
        task.taskId,
        monitorTimeoutMs,
        1_500,
        { dispatchedAtMs: Date.parse(result.startedAt) },
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
    await settlePrinterAfterTerminal({
      outcome: terminalOutcome,
      pauseAgain: releaseQueueAfterTerminalState,
      removeOwnJobs: async () => { await cleanupStaleOwnPrintJobs({ printerName }) },
      pause: async () => {
        const paused = await pauseConfiguredPrinterQueue(printerName)
        if (!paused.skipped) log('print-queue-hold: queue paused after terminal state')
      },
    })
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

let claimPausedUntil = 0
let consecutiveClaimRateLimits = 0

/** Test-only: clear module-level rate-limit state between verification cases. */
export function __resetClaimRateLimitForTests(): void {
  claimPausedUntil = 0
  consecutiveClaimRateLimits = 0
}

async function runClaimCycle(
  config: AgentConfig,
  db: AgentDatabase,
  activeTasks: Set<string>,
): Promise<void> {
  if (Date.now() < claimPausedUntil) return
  if (!config.terminalId || !config.agentToken) {
    return // Not registered yet; skip silently
  }
  if (isUnauthorized()) {
    warn('task-runner: credential unauthorized; claim skipped (re-bind required)')
    return
  }
  if (!isDatabaseAvailable(db)) {
    warn('task-runner: local task database unavailable; printing disabled')
    return
  }

  await claimPrintTasksIfGateOpen(
    {
      holdEnabled: config.holdPrinterQueueWhenIdle === true,
      pause: async () => {
        await pauseConfiguredPrinterQueue(config.printerName)
      },
      cleanup: async () => {
        await cleanupStaleOwnPrintJobs({ printerName: config.printerName })
      },
    },
    () => claimConfiguredPrintTasks(config, db, activeTasks),
  )
}

async function claimConfiguredPrintTasks(
  config: AgentConfig,
  db: AgentDatabase,
  activeTasks: Set<string>,
): Promise<void> {
  const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)

  let tasks: ClaimTask[]
  try {
    const resp = await client.post<ClaimTask[]>(
      `/terminals/${config.terminalId}/tasks/claim`,
      { maxTasks: 1 },
    )
    // Any accepted claim response (including an empty list) ends the rate-limit episode.
    consecutiveClaimRateLimits = 0
    claimPausedUntil = 0
    tasks = Array.isArray(resp.data) ? resp.data : []
  } catch (e) {
    const response = axios.isAxiosError(e) ? e.response : undefined
    const status = response?.status
    if (status === 429) {
      const decision = computeClaimPause(
        status,
        response?.headers?.['retry-after'],
        consecutiveClaimRateLimits,
        Date.now(),
        Math.floor(Math.random() * 1_001),
      )
      consecutiveClaimRateLimits = decision.consecutive429
      claimPausedUntil = decision.pausedUntil
      warn(
        `task-runner: claim rate limited (HTTP 429) — pausing claims for ` +
          `${(decision.pauseMs / 1_000).toFixed(1)}s`,
      )
      return
    }
    if (isUnauthorizedHttpError(e)) {
      markUnauthorized()
      writeStartupDiagnosticSafely('AGENT_UNAUTHORIZED')
      err('task-runner: claim unauthorized — credential revoked/invalid; printing stopped')
      return
    }
    if (status !== 404 && status !== 204) {
      warn(`task-runner: claim cycle error — ${axiosErrorMessage(e)}`)
    }
    return
  }

  if (tasks.length === 0) return
  if (isUnauthorized()) {
    warn('task-runner: credential became unauthorized while claim was in flight; claimed work will not print')
    return
  }

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

    try {
      await executeTask(task, config, db)
    } catch (e) {
      err(`task-runner: unhandled error in task ${task.taskId} — ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      activeTasks.delete(task.taskId)
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface TaskRunnerOptions {
  config: AgentConfig
  db: AgentDatabase
}

/** Start the claim loop. Interval ticks and wake requests share one single-flight guard. */
export function startTaskRunner(options: TaskRunnerOptions): TaskRunnerControl {
  const { config, db } = options
  const interval = config.claimIntervalMs ?? 5_000
  const activeTasks = new Set<string>()

  if (interval < 5_000) {
    warn(
      `task-runner: configured claim interval ${interval}ms is below the server rate-limit budget; ` +
        'update the installed Agent configuration through the production installer',
    )
  }

  if (!isDatabaseAvailable(db)) {
    warn('task-runner: local task database unavailable; printing disabled; claim loop not started')
    return createTaskRunnerControl({
      intervalMs: interval,
      enabled: false,
      runCycle: async () => undefined,
      onCycleError: () => undefined,
    })
  }

  log(`task-runner: starting — interval=${interval}ms`)

  return createTaskRunnerControl({
    intervalMs: interval,
    // Local print wake shares the same cycle, so it must honor claimPausedUntil.
    // The server explicitly asked us to slow down; bypassing it only re-enters the 60s block.
    runCycle: () => runClaimCycle(config, db, activeTasks),
    onCycleError: (e) =>
      err(`task-runner: unexpected cycle error — ${e instanceof Error ? e.message : String(e)}`),
  })
}
