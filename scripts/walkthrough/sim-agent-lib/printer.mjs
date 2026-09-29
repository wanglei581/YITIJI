// ============================================================================
// 模拟终端：心跳 + 领打印任务 + 回写状态 + 本机重试队列。
//
// 逐条照抄 apps/terminal-agent 的协议，不发明新接口：
//   心跳    PUT   /terminals/:id/heartbeat       agent/heartbeat.ts:146-169（字段）、:229-237（30 秒）
//   领任务  POST  /terminals/:id/tasks/claim     agent/task-runner.ts:852-855（maxTasks: 1，每 5 秒）
//   回写    PATCH /print-tasks/:taskId/status    agent/task-runner.ts:253-283
//   限流    429 → Retry-After / 指数退避          agent/claim-rate-limit.ts（整段照抄）
//   单飞    定时领取与本机唤醒共用一个在途标志     agent/task-runner-control.ts
//   重试队列 终态回写失败 → 60 秒轮询、指数退避    agent/offline-queue.ts:35-44
//   执行顺序 agent/task-runner.ts:301-601 executeTask：本机幂等 → 下载（2s/5s/10s 重试）→ SHA-256
//     → 打印机预检 → 回写 printing（失败再试一次）→ 记 dispatching → 「出纸」→ 记终态 → 回写 → 删临时文件
//
// 与真实终端程序的区别：不调用打印机、不查 WMI / 打印队列。打印机状态来自控制文件
// ${SIM_AGENT_DIR}/printer（见 README）。「出纸」= 把下载并校验过的文件存进 printed/。
// ============================================================================

import { createHash } from 'node:crypto'
import { readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import {
  HttpError, SIM_AGENT_VERSION, SIM_PRINTER_NAME, apiRequest, errorText, getIpAddress, info, warn, error,
  isRetryable, isUnauthorized, markUnauthorized, readJson, readPrinterMode, shanghaiIso, sleep, writeJsonPrivate,
} from './common.mjs'

// ── 打印机控制文件 → 心跳 printerStatus / 打印前预检 ────────────────────────
//
// 心跳（真实终端程序 agent/wmi.ts:112-146 mapWin32PrinterQuery）：
//   ready        → 'ready'
//   unconfirmed  → 'ready'        奔图驱动 DetectedErrorState 恒 0，心跳照报就绪（wmi.ts:129-142）
//   paper_empty  → 'paper_empty'  ★真实终端程序永远报不出这个值（奔图驱动不置 DetectedErrorState=4，
//                                  置了也会被 wmi.ts:124 映射成 'error'）。按 Windows 组要求，模拟终端
//                                  直接上报字面量 'paper_empty'，让服务端「打印机缺纸」告警与一体机提示能走查到。
//   offline      → 'offline'      WorkOffline=True / PrinterStatus=7（wmi.ts:122-123）
//   error        → 'error'        DetectedErrorState=6/7（wmi.ts:124-126）
//   jam          → 'error'        卡纸 DetectedErrorState=8 同样映射成 'error'（wmi.ts:124-126）
//
// 预检（task-runner.ts:154-171 preflightToError，消息原文照抄）：
const PREFLIGHT_ERRORS = {
  paper_empty: { errorCode: 'PAPER_EMPTY', errorMessage: '打印机缺纸，当前无法打印，请联系工作人员补纸后重试' },
  offline: { errorCode: 'PRINTER_OFFLINE', errorMessage: '打印机离线（请检查电源/网线/USB 连接）' },
  error: { errorCode: 'PRINTER_ERROR', errorMessage: '打印机可能卡纸或发生设备故障，当前暂时无法继续使用，请联系工作人员处理' },
  jam: { errorCode: 'PRINTER_ERROR', errorMessage: '打印机可能卡纸或发生设备故障，当前暂时无法继续使用，请联系工作人员处理' },
}
// task-runner.ts:804-811 unconfirmedOutcome 原文。
const UNCONFIRMED = {
  errorCode: 'PRINT_JOB_UNCONFIRMED',
  errorMessage: '打印作业已提交，但未确认打印队列完成，请工作人员现场检查纸张、卡纸和出纸状态；系统不会自动重印',
}
// task-runner.ts:340 重启后发现上次派发未收尾。
const RESTART_UNCONFIRMED_MESSAGE = '打印派发已开始，但无法确认是否已进入队列或完成出纸，请工作人员现场核查'

export function heartbeatPrinterStatus(mode) {
  if (mode === 'paper_empty') return 'paper_empty'
  if (mode === 'offline') return 'offline'
  if (mode === 'error' || mode === 'jam') return 'error'
  return 'ready' // ready / unconfirmed
}

// ── 限流退避（agent/claim-rate-limit.ts 原样）────────────────────────────────
const CLAIM_BACKOFF_BASE_MS = 5_000
const CLAIM_BACKOFF_MAX_MS = 60_000
const CLAIM_RETRY_AFTER_CAP_MS = 5 * 60_000
export function computeClaimPause(status, retryAfterHeader, consecutive429, now, jitterMs) {
  if (status !== 429) return { consecutive429: 0, pauseMs: 0, pausedUntil: 0 }
  const next = Math.max(0, Math.floor(consecutive429)) + 1
  const fallbackMs = Math.min(CLAIM_BACKOFF_MAX_MS, CLAIM_BACKOFF_BASE_MS * (2 ** Math.min(next - 1, 4)))
  const value = retryAfterHeader == null ? '' : String(retryAfterHeader).trim()
  let requestedMs
  if (/^\d+$/.test(value)) requestedMs = Number(value) * 1_000
  else if (value) {
    const retryAt = Date.parse(value)
    if (Number.isFinite(retryAt)) requestedMs = Math.max(0, retryAt - now)
  }
  const jitter = Math.min(1_000, Math.max(0, Math.floor(jitterMs)))
  const bounded = requestedMs !== undefined && requestedMs > 0 ? Math.min(CLAIM_RETRY_AFTER_CAP_MS, requestedMs) : undefined
  const pauseMs = (bounded ?? fallbackMs) + jitter
  return { consecutive429: next, pauseMs, pausedUntil: now + pauseMs }
}

// ── 扩展名推断（task-runner.ts:191-229，mimeType → fileName → URL → .pdf）──────
const MIME_TO_EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/bmp': '.bmp', 'image/tiff': '.tiff' }
function inferTaskExt(task) {
  const mime = String(task.mimeType ?? '').split(';')[0].trim().toLowerCase()
  if (MIME_TO_EXT[mime]) return MIME_TO_EXT[mime]
  const fromName = task.fileName ? extname(String(task.fileName)).toLowerCase() : ''
  if (fromName) return fromName
  const fromUrl = extname(String(task.fileUrl ?? '').split('?')[0]).toLowerCase()
  return fromUrl || '.pdf'
}

/** task-runner.ts:231-242 resolveFileUrl：服务端给的签名地址可能是相对路径。 */
export function resolveFileUrl(fileUrl, apiBaseUrl) {
  try {
    return new URL(fileUrl).toString()
  } catch {
    const apiUrl = new URL(apiBaseUrl)
    if (fileUrl.startsWith('/')) return `${apiUrl.origin}${fileUrl}`
    return new URL(fileUrl, apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`).toString()
  }
}

function safeFileName(task, ext) {
  const raw = task.fileName ? basename(String(task.fileName).replace(/\\/g, '/')) : ''
  let name = raw.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 120)
  if (!name) name = `task${ext}`
  if (!extname(name)) name += ext
  return name
}

/** 粗数 PDF 页数（不解压对象流，数不到时返回 null）。只用来在日志里提示「模拟出纸」几页。 */
function approxPdfPages(buffer) {
  const text = buffer.toString('latin1')
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)
  return matches ? matches.length : null
}

function freeDiskGB(dir) {
  try {
    const s = statfsSync(dir)
    return Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10
  } catch {
    return -1 // 与真实终端程序查询不到时的取值一致（wmi.ts getDiskFreeGB）
  }
}

// ── 本机任务状态库（替代真实终端程序的 SQLite：agent/db.ts）──────────────────

function normalizeAttempt(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 0
  return value
}

function taskKey(taskId, attempt) {
  return `${taskId}\u0000${normalizeAttempt(attempt)}`
}

function loadState(paths) {
  const s = readJson(paths.state, {})
  const raw = s.tasks && typeof s.tasks === 'object' ? s.tasks : {}
  const tasks = {}
  for (const [key, row] of Object.entries(raw)) {
    if (!row || typeof row !== 'object') continue
    if (key.includes('\u0000')) {
      tasks[key] = row
      continue
    }
    // 旧状态文件只按任务号记账，等同 attempt 0，避免升级后把已做过的单再出一遍。
    const attempt = normalizeAttempt(row.attempt)
    tasks[taskKey(key, attempt)] = {
      taskId: key,
      attempt,
      status: row.status,
      at: row.at,
      errorCode: typeof row.errorCode === 'string' && row.errorCode ? row.errorCode : null,
    }
  }
  return {
    tasks,
    pendingPatches: Array.isArray(s.pendingPatches) ? s.pendingPatches : [],
    deadLetters: Array.isArray(s.deadLetters) ? s.deadLetters : [],
  }
}

/** 控制文件 agent-version 的第一行覆盖心跳版本；缺省能过服务端 0.4.13 门槛。 */
function readAgentVersion(dir) {
  try {
    const line = readFileSync(join(dir, 'agent-version'), 'utf8').split('\n')[0].trim()
    if (line) return line
  } catch {
    // 没有这份控制文件
  }
  return SIM_AGENT_VERSION
}

/**
 * @param {{ paths: ReturnType<import('./common.mjs').simPaths>, apiBaseUrl: string,
 *           credential: { terminalId: string, terminalToken: string },
 *           macAddress?: string, getScanTelemetry?: () => object | undefined,
 *           heartbeatIntervalMs?: number, claimIntervalMs?: number, printMs?: number, unconfirmedMs?: number,
 *           offlineRetryMs?: number }} options
 */
export function startPrinterRuntime(options) {
  const { paths, apiBaseUrl, credential } = options
  const config = {
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 30_000,
    claimIntervalMs: options.claimIntervalMs ?? 5_000,
  }
  const printMs = options.printMs ?? 1_500
  const unconfirmedMs = options.unconfirmedMs ?? 20_000
  const offlineRetryMs = options.offlineRetryMs ?? 60_000
  const state = loadState(paths)
  const saveState = () => writeJsonPrivate(paths.state, state)
  const inFlight = new AbortController()
  let closed = false
  let lastPrinterMode = null
  const observation = { connected: false, lastHeartbeatAt: null, printerStatus: 'unknown' }

  const api = (method, path, body, opts = {}) =>
    apiRequest({ apiBaseUrl, method, path, body, credential, signal: inFlight.signal, ...opts })

  function currentPrinter() {
    const p = readPrinterMode(paths)
    if (!p.valid && p.raw !== lastPrinterMode) warn('printer.mode_invalid', `打印机控制文件内容「${p.raw}」不认识，按 ready 处理（可选：ready / paper_empty / offline / error / jam / unconfirmed）`)
    if (p.valid && lastPrinterMode !== null && p.raw !== lastPrinterMode) info('printer.mode_changed', `${SIM_PRINTER_NAME}状态切换为 ${p.mode}`, { mode: p.mode })
    lastPrinterMode = p.raw
    return p.mode
  }

  // ── 心跳 ──────────────────────────────────────────────────────────────────
  async function sendHeartbeat() {
    if (closed) return false
    if (isUnauthorized()) {
      warn('heartbeat.skipped', '心跳跳过：终端凭证已被拒绝，需要重新绑定')
      observation.connected = false
      return false
    }
    const mode = currentPrinter()
    const printerStatus = heartbeatPrinterStatus(mode)
    const payload = {
      status: 'online', // 本机任务库（state.json）始终可用；真实终端程序任务库坏了才报 agent_degraded
      printerStatus,
      diskFreeGB: freeDiskGB(paths.dir),
      agentVersion: readAgentVersion(paths.dir),
      ipAddress: getIpAddress(),
      ...(options.macAddress ? { macAddress: options.macAddress } : {}),
      reportedAt: new Date().toISOString(),
      localTaskDatabaseAvailable: true,
      // 真实终端程序在非 Windows / 查不到时这两项都是 unknown（network-diagnostics.ts:45-53）；模拟终端不测网络，如实报 unknown。
      wiredNetworkStatus: 'unknown',
      printerNetworkStatus: 'unknown',
    }
    const scan = options.getScanTelemetry?.()
    if (scan) {
      payload.scanInputHealth = scan.health
      payload.scanInputAction = scan.requiredAction
      payload.scanInputReason = scan.reason
      payload.scanInputObservedAt = scan.observedAt
    }
    const record = { at: shanghaiIso(), printerMode: mode, printerStatus }
    try {
      // 真实终端程序的心跳走带重试的 axios 客户端（5xx / 网络错误重试 3 次）。
      const response = await api('PUT', `/terminals/${credential.terminalId}/heartbeat`, payload)
      observation.connected = true
      observation.lastHeartbeatAt = payload.reportedAt
      observation.printerStatus = printerStatus
      writeJsonPrivate(paths.heartbeat, { ...record, ok: true, acknowledged: response?.acknowledged ?? null, serverConfig: response?.config ?? null })
      info('heartbeat.ok', `心跳已送达（打印机 ${printerStatus}）`, { printerStatus, printerMode: mode })
      applyServerConfig(response?.config)
      return true
    } catch (err) {
      observation.connected = false
      observation.printerStatus = printerStatus
      const httpStatus = err instanceof HttpError ? err.status : null
      writeJsonPrivate(paths.heartbeat, { ...record, ok: false, httpStatus, code: err?.code ?? null, message: errorText(err) })
      if (err instanceof HttpError && err.status === 401) markUnauthorized('heartbeat')
      else if (!closed) warn('heartbeat.failed', `心跳未送达：${errorText(err)}（下一次心跳会重试）`, { httpStatus, code: err?.code ?? null })
      return false
    }
  }

  // index.ts:148-166 onConfigUpdate：服务端下发的间隔变化时重建定时器。
  function applyServerConfig(patch) {
    if (!patch || typeof patch !== 'object') return
    const hb = Number(patch.heartbeatIntervalMs)
    if (hb && hb !== config.heartbeatIntervalMs) {
      config.heartbeatIntervalMs = hb
      clearInterval(heartbeatTimer)
      heartbeatTimer = setInterval(() => void sendHeartbeat(), hb)
      info('heartbeat.interval', `心跳间隔被服务端改为 ${hb}ms`)
    }
    const claim = Number(patch.claimIntervalMs)
    if (claim && claim !== config.claimIntervalMs) {
      config.claimIntervalMs = claim
      if (claim < 5_000) warn('claim.interval_low', `服务端下发的领任务间隔 ${claim}ms 低于 5 秒限流预算`)
      clearInterval(claimTimer)
      claimTimer = setInterval(() => void wake(), claim)
      info('claim.interval', `领任务间隔被服务端改为 ${claim}ms`)
    }
  }

  // ── 回写 ──────────────────────────────────────────────────────────────────
  async function patch(taskId, attempt, status, errorCode, errorMessage) {
    const n = normalizeAttempt(attempt)
    const body = { status, ...(attempt === undefined || attempt === null ? {} : { attempt: n }), ...(errorCode ? { errorCode } : {}), ...(errorMessage ? { errorMessage } : {}) }
    try {
      await api('PATCH', `/print-tasks/${taskId}/status`, body)
      info('task.patch', `任务 ${taskId}：回写 ${status}${errorCode ? `（${errorCode}）` : ''} 成功`, { taskId, attempt: n, status, errorCode: errorCode ?? null })
      return true
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        markUnauthorized('patch')
        return false
      }
      if (!closed) warn('task.patch_failed', `任务 ${taskId}：回写 ${status} 未送达（${errorText(err)}）`, { taskId, attempt: n, status, httpStatus: err?.status ?? null, code: err?.code ?? null })
      return false
    }
  }

  function markTask(taskId, attempt, status, errorCode) {
    const n = normalizeAttempt(attempt)
    const key = taskKey(taskId, n)
    const prev = state.tasks[key] || {}
    const nextCode = typeof errorCode === 'string' && errorCode.length > 0 ? errorCode : (prev.errorCode || null)
    state.tasks[key] = { taskId, attempt: n, status, at: shanghaiIso(), errorCode: nextCode }
    saveState()
  }

  function enqueuePatch(taskId, attempt, status, errorCode, errorMessage) {
    const n = normalizeAttempt(attempt)
    state.pendingPatches = state.pendingPatches.filter((p) => !(p.taskId === taskId && normalizeAttempt(p.attempt) === n))
    state.pendingPatches.push({ taskId, attempt: n, wireAttempt: attempt === undefined || attempt === null ? null : n, status, errorCode: errorCode ?? null, errorMessage: errorMessage ?? null, attempts: 0, nextRetryAt: Date.now(), createdAt: shanghaiIso() })
    saveState()
    warn('offline_queue.enqueued', `任务 ${taskId}：终态 ${status} 进本机重试队列`, { taskId, attempt: n, status })
  }

  async function finish(taskId, attempt, status, errorCode, errorMessage) {
    markTask(taskId, attempt, status, errorCode) // 先记本机终态再回写；同一 (任务号, attempt) 不再出纸
    const ok = await patch(taskId, attempt, status, errorCode, errorMessage)
    if (!ok) enqueuePatch(taskId, attempt, status, errorCode, errorMessage)
  }

  // offline-queue.ts：60 秒一轮，退避 min(30s × 2^attempts, 30min)，10 次或 4xx 进死信。
  async function processOfflineQueue() {
    if (closed || isUnauthorized() || state.pendingPatches.length === 0) return
    const now = Date.now()
    for (const p of [...state.pendingPatches]) {
      if (closed || isUnauthorized()) return
      if (p.nextRetryAt > now) continue
      if (p.attempts >= 10) {
        moveToDeadLetter(p, 'MAX_ATTEMPTS_REACHED:10')
        continue
      }
      try {
        await api('PATCH', `/print-tasks/${p.taskId}/status`, { status: p.status, ...(p.wireAttempt === null || p.wireAttempt === undefined ? {} : { attempt: p.wireAttempt }), ...(p.errorCode ? { errorCode: p.errorCode } : {}), ...(p.errorMessage ? { errorMessage: p.errorMessage } : {}) })
        state.pendingPatches = state.pendingPatches.filter((x) => x !== p)
        saveState()
        info('offline_queue.sent', `任务 ${p.taskId}：重试队列里的 ${p.status} 已送达`, { taskId: p.taskId })
      } catch (err) {
        if (err instanceof HttpError && err.status === 401) {
          markUnauthorized('offline-queue')
          return
        }
        if (err instanceof HttpError && err.status < 500) {
          moveToDeadLetter(p, `HTTP_${err.status}${err.code ? `:${err.code}` : ''}`)
          continue
        }
        p.attempts += 1
        p.nextRetryAt = Date.now() + Math.min(30_000 * 2 ** p.attempts, 30 * 60_000)
        saveState()
        warn('offline_queue.retry_failed', `任务 ${p.taskId}：重试第 ${p.attempts} 次仍失败（${errorText(err)}）`, { taskId: p.taskId })
      }
    }
  }

  function moveToDeadLetter(p, reason) {
    state.pendingPatches = state.pendingPatches.filter((x) => x !== p)
    state.deadLetters.push({ ...p, reason, deadAt: shanghaiIso() })
    saveState()
    error('offline_queue.dead_letter', `任务 ${p.taskId}：终态回写放弃（${reason}），需人工处理`, { taskId: p.taskId, reason })
  }

  // ── 下载 ──────────────────────────────────────────────────────────────────
  async function download(url) {
    const delays = [2_000, 5_000, 10_000] // task-runner.ts:94
    let lastError
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const response = await fetch(url, { headers: { Connection: 'close' }, signal: AbortSignal.any([inFlight.signal, AbortSignal.timeout(60_000)]) })
        if (!response.ok) throw new HttpError(response.status)
        return Buffer.from(await response.arrayBuffer())
      } catch (err) {
        lastError = err
        if (closed || !isRetryable(err) || attempt === delays.length) break
        warn('task.download_retry', `下载第 ${attempt + 1} 次失败（${errorText(err)}），${delays[attempt] / 1000} 秒后重试`)
        await sleep(delays[attempt])
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  // ── 执行一个任务 ──────────────────────────────────────────────────────────
  async function executeTask(task) {
    const taskId = task.taskId
    // 旧服务端（#1152 之前）不下发 attempt、也不收：此时回写不带 attempt，本机记账仍按 0
    const spoolAttempt = task.attempt === undefined || task.attempt === null ? undefined : normalizeAttempt(task.attempt)
    if (isUnauthorized()) return

    // Step 0：同一 (任务号, attempt) 才判重。attempt 变大才重新出纸（task-runner.ts 领取绑定）。
    const localRow = state.tasks[taskKey(taskId, spoolAttempt)]
    const local = localRow?.status
    if (local) {
      if (local === 'dispatching' || local === 'spooled') {
        warn('task.replay_unconfirmed', `任务 ${taskId} attempt ${spoolAttempt}：上次派发后没收尾（本机记为 ${local}），按「未确认出纸」回写，不重打`, { taskId, attempt: spoolAttempt })
        await finish(taskId, spoolAttempt, 'failed', UNCONFIRMED.errorCode, RESTART_UNCONFIRMED_MESSAGE)
      } else if (local === 'completed') {
        info('task.replay', `任务 ${taskId} attempt ${spoolAttempt}：本机已记为 completed，重发终态，不再出纸`, { taskId, attempt: spoolAttempt })
        const ok = await patch(taskId, spoolAttempt, 'completed')
        if (!ok) enqueuePatch(taskId, spoolAttempt, 'completed')
      } else if (local === 'failed') {
        const localError = typeof localRow.errorCode === 'string' && localRow.errorCode ? localRow.errorCode : undefined
        info('task.replay', `任务 ${taskId} attempt ${spoolAttempt}：本机已记为 failed，重发终态并保留 errorCode，不再出纸`, { taskId, attempt: spoolAttempt, errorCode: localError ?? null })
        const ok = await patch(taskId, spoolAttempt, 'failed', localError)
        if (!ok) enqueuePatch(taskId, spoolAttempt, 'failed', localError)
      } else {
        await finish(taskId, spoolAttempt, 'failed', 'LOCAL_TASK_STATE_UNKNOWN', `本地打印任务状态异常（${local}），为避免重复出纸已停止自动重试，请工作人员核查`)
      }
      return
    }

    const ext = inferTaskExt(task)
    const stem = spoolAttempt > 0 ? `${taskId}_a${spoolAttempt}` : taskId
    const tempFile = join(paths.temp, `task_${stem}${ext}`)
    info('task.start', `任务 ${taskId}：开始（attempt ${spoolAttempt}，扩展名 ${ext}，份数 ${task.params?.copies ?? 1}，计费页数 ${task.billablePages ?? '?'}）`, {
      taskId, attempt: spoolAttempt, ext, mimeType: task.mimeType ?? null, nameLen: task.fileName ? String(task.fileName).length : 0,
      params: task.params ?? null, billablePages: task.billablePages ?? null,
    })
    try {
      // Step 1：下载
      let buffer
      try {
        buffer = await download(resolveFileUrl(task.fileUrl, apiBaseUrl))
        writeFileSync(tempFile, buffer, { mode: 0o600 })
      } catch (err) {
        error('task.download_failed', `任务 ${taskId}：文件下载失败（${errorText(err)}）`, { taskId, attempt: spoolAttempt })
        await finish(taskId, spoolAttempt, 'failed', 'PRINT_COMMAND_FAILED', `Download failed: ${errorText(err)}`)
        return
      }
      const sha256 = createHash('sha256').update(buffer).digest('hex')
      info('task.downloaded', `任务 ${taskId}：已下载 ${(buffer.length / 1024).toFixed(1)} KB`, { taskId, attempt: spoolAttempt, bytes: buffer.length, sha256 })

      // Step 2：SHA-256（wire 字段名仍叫 fileMd5）
      if (task.fileMd5) {
        if (sha256 !== task.fileMd5) {
          error('task.hash_mismatch', `任务 ${taskId}：文件校验失败（SHA-256 不一致）`, { taskId, attempt: spoolAttempt, expected: task.fileMd5, actual: sha256 })
          saveCopy(paths.rejected, task, ext, buffer, { outcome: 'DOWNLOAD_HASH_MISMATCH', attempt: spoolAttempt })
          await finish(taskId, spoolAttempt, 'failed', 'DOWNLOAD_HASH_MISMATCH', `文件校验失败（SHA-256 不一致）：expected=${task.fileMd5}, got=${sha256}`)
          return
        }
        info('task.hash_ok', `任务 ${taskId}：文件哈希校验通过（SHA-256）`, { taskId, attempt: spoolAttempt })
      } else {
        warn('task.hash_missing', `任务 ${taskId}：服务端没给文件哈希，跳过校验`, { taskId, attempt: spoolAttempt })
      }

      // Step 2.5：打印机预检
      const mode = currentPrinter()
      const preflight = PREFLIGHT_ERRORS[mode]
      if (preflight) {
        error('task.preflight_failed', `任务 ${taskId}：${SIM_PRINTER_NAME}预检不通过（${mode}）→ ${preflight.errorCode}，未出纸`, { taskId, attempt: spoolAttempt, mode, errorCode: preflight.errorCode })
        saveCopy(paths.rejected, task, ext, buffer, { outcome: preflight.errorCode, printerMode: mode, attempt: spoolAttempt })
        await finish(taskId, spoolAttempt, 'failed', preflight.errorCode, preflight.errorMessage)
        return
      }

      // Step 3：printing（信息性，失败重试一次后继续）
      if (isUnauthorized() || closed) return
      const acked = (await patch(taskId, spoolAttempt, 'printing')) || (!isUnauthorized() && (await patch(taskId, spoolAttempt, 'printing')))
      if (!acked) warn('task.printing_unacked', `任务 ${taskId}：printing 未确认，继续执行，终态直接回写`, { taskId, attempt: spoolAttempt })
      if (isUnauthorized() || closed) return

      // Step 4：记 dispatching → 「出纸」→ 记 spooled
      markTask(taskId, spoolAttempt, 'dispatching')
      const saved = saveCopy(paths.printed, task, ext, buffer, { outcome: mode === 'unconfirmed' ? 'PRINT_JOB_UNCONFIRMED' : 'completed', printerMode: mode, attempt: spoolAttempt })
      markTask(taskId, spoolAttempt, 'spooled')
      info('task.sim_output', `${SIM_PRINTER_NAME}：任务 ${taskId} attempt ${spoolAttempt} 已模拟出纸${saved.pdfPages ? `（PDF 约 ${saved.pdfPages} 页）` : ''}，未真实打印 → ${saved.file}`, {
        taskId, attempt: spoolAttempt, savedFile: saved.file, pdfPagesApprox: saved.pdfPages, copies: task.params?.copies ?? 1,
      })

      if (mode === 'unconfirmed') {
        info('task.monitor', `任务 ${taskId}：模拟打印队列一直没确认完成，${unconfirmedMs / 1000} 秒后按 PRINT_JOB_UNCONFIRMED 回写`, { taskId, attempt: spoolAttempt })
        await sleep(unconfirmedMs)
        if (closed) return
        await finish(taskId, spoolAttempt, 'failed', UNCONFIRMED.errorCode, UNCONFIRMED.errorMessage)
        return
      }
      await sleep(printMs)
      if (closed) return
      await finish(taskId, spoolAttempt, 'completed')
    } finally {
      rmSync(tempFile, { force: true }) // task-runner.ts:590-600
    }
  }

  function saveCopy(dir, task, ext, buffer, meta) {
    const n = normalizeAttempt(task.attempt ?? meta?.attempt)
    const name = n > 0 ? `${task.taskId}-a${n}-${safeFileName(task, ext)}` : `${task.taskId}-${safeFileName(task, ext)}`
    const file = join(dir, name)
    writeFileSync(file, buffer, { mode: 0o600 })
    const pdfPages = ext === '.pdf' ? approxPdfPages(buffer) : null
    writeJsonPrivate(`${file}.json`, {
      taskId: task.taskId, attempt: normalizeAttempt(task.attempt ?? meta?.attempt), savedAt: shanghaiIso(), ...meta, pdfPagesApprox: pdfPages,
      params: task.params ?? null, billablePages: task.billablePages ?? null, mimeType: task.mimeType ?? null, sizeBytes: buffer.length,
    })
    return { file, pdfPages }
  }

  // ── 领任务循环 ────────────────────────────────────────────────────────────
  let claimPausedUntil = 0
  let consecutive429 = 0
  const activeTasks = new Set()

  async function runClaimCycle() {
    if (closed || Date.now() < claimPausedUntil) return
    if (isUnauthorized()) {
      warn('claim.skipped', '领任务跳过：终端凭证已被拒绝，需要重新绑定')
      return
    }
    let tasks
    try {
      const data = await api('POST', `/terminals/${credential.terminalId}/tasks/claim`, { maxTasks: 1 })
      consecutive429 = 0
      claimPausedUntil = 0
      tasks = Array.isArray(data) ? data : []
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        const d = computeClaimPause(429, err.retryAfter, consecutive429, Date.now(), Math.floor(Math.random() * 1_001))
        consecutive429 = d.consecutive429
        claimPausedUntil = d.pausedUntil
        warn('claim.rate_limited', `领任务被限流（HTTP 429），暂停 ${(d.pauseMs / 1000).toFixed(1)} 秒`)
        return
      }
      if (err instanceof HttpError && err.status === 401) {
        markUnauthorized('claim')
        return
      }
      if (!closed && !(err instanceof HttpError && (err.status === 404 || err.status === 204))) warn('claim.failed', `领任务失败：${errorText(err)}`)
      return
    }
    for (const task of tasks) {
      if (closed || isUnauthorized()) return
      const flightKey = `${task.taskId}#${normalizeAttempt(task.attempt)}`
      if (activeTasks.has(flightKey)) continue
      if (task?.type !== 'print') {
        warn('claim.unsupported', `任务 ${task?.taskId}：类型 ${task?.type} 不支持，跳过`)
        continue
      }
      activeTasks.add(flightKey)
      info('claim.task', `领到打印任务 ${task.taskId}（attempt ${normalizeAttempt(task.attempt)}）`, { taskId: task.taskId, attempt: normalizeAttempt(task.attempt) })
      try {
        await executeTask(task)
      } catch (err) {
        error('task.crashed', `任务 ${task.taskId}：执行出错 — ${errorText(err)}`, { taskId: task.taskId, attempt: normalizeAttempt(task.attempt) })
      } finally {
        activeTasks.delete(flightKey)
      }
    }
  }

  // task-runner-control.ts：定时与唤醒共用一个在途标志，在途时唤醒只记一次「再跑一轮」。
  let cycleInFlight = false
  let rerun = false
  function wake() {
    if (closed) return { accepted: false, coalesced: false }
    if (cycleInFlight) {
      rerun = true
      return { accepted: true, coalesced: true }
    }
    cycleInFlight = true
    void Promise.resolve()
      .then(runClaimCycle)
      .catch((err) => error('claim.cycle_error', `领任务循环出错：${errorText(err)}`))
      .finally(() => {
        cycleInFlight = false
        if (!closed && rerun) {
          rerun = false
          wake()
        }
      })
    return { accepted: true, coalesced: false }
  }

  info('runtime.start', `${SIM_PRINTER_NAME}已启动：心跳每 ${config.heartbeatIntervalMs / 1000} 秒，领任务每 ${config.claimIntervalMs / 1000} 秒；不会真实出纸`, { terminalId: credential.terminalId })
  let heartbeatTimer = setInterval(() => void sendHeartbeat(), config.heartbeatIntervalMs)
  let claimTimer = null
  const offlineTimer = setInterval(() => void processOfflineQueue(), offlineRetryMs)
  const ready = sendHeartbeat().then((ok) => {
    if (closed) return ok
    // 真实终端程序先发一次心跳再启动领任务定时器（index.ts:171-191），首次领取在一个间隔之后。
    if (!claimTimer) claimTimer = setInterval(() => void wake(), config.claimIntervalMs)
    void processOfflineQueue()
    return ok
  })

  return {
    ready,
    wake,
    sendHeartbeat,
    observation,
    config,
    get pendingPatchCount() {
      return state.pendingPatches.length
    },
    async close() {
      closed = true
      clearInterval(heartbeatTimer)
      clearInterval(claimTimer)
      clearInterval(offlineTimer)
      inFlight.abort()
      await sleep(50)
    },
  }
}

