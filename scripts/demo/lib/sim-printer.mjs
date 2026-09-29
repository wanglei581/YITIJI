// ============================================================================
// 演示用「模拟打印机」（可选，默认关闭）：替代 Windows 终端程序（apps/terminal-agent）
// 里心跳与领打印任务那一半，让演示环境能从下单一路走到「打印完成」。
//
//   打开：node scripts/demo/demo.mjs start --sim-printer   或   DEMO_SIM_PRINTER=1
//
// 协议逐条照抄真实终端程序，不发明新接口：
//   心跳   PUT   /terminals/:id/heartbeat      apps/terminal-agent/src/agent/heartbeat.ts:146-169
//   领任务 POST  /terminals/:id/tasks/claim    apps/terminal-agent/src/agent/task-runner.ts:852-855（maxTasks: 1）
//   回写   PATCH /print-tasks/:taskId/status   apps/terminal-agent/src/agent/task-runner.ts:266
//   鉴权头 Authorization: Bearer <终端凭证> + X-Terminal-Id   apps/terminal-agent/src/agent/api-client.ts:288-307
//   执行顺序（task-runner.ts:301-600）：本地幂等检查 → 下载（网络错误 / 5xx 按 2s、5s、10s 重试）
//     → SHA-256 校验（wire 字段名仍叫 fileMd5）→ 打印机预检（缺纸即回写 failed + PAPER_EMPTY）
//     → 回写 printing（失败再试一次）→ 「出纸」→ 回写 completed（失败进本机重试队列）→ 删临时文件。
//
// 与真实终端程序唯一的区别：不调用打印机。文件确实下载下来并校验，然后只在终端打印一行
// 「（演示）模拟打印机：任务 xxx 已模拟出纸，未真实打印」。打印机名一律是「（演示）模拟打印机」，
// 不写任何真实型号（CLAUDE.md §3）。
//
// 模拟缺纸：在 .demo/ 下放一个名为 sim-printer-paper-empty 的空文件即进入缺纸，删掉即恢复。
// 心跳的 printerStatus 随之在 paper_empty / ready 之间切换（服务端据此派生「打印机缺纸」告警，
// 见 services/api/src/admin-ops/derived-alerts.ts:213-223）。
//
// 终端凭证只在本进程内存里（由 demo.mjs 注册演示终端时拿到），不写日志、不打印到终端。
// 只用 node 内置模块（门禁 scripts/verify-demo-kit.mjs 会直接 import 本文件）。
// ============================================================================

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 打印机名 / 型号：如实标注是模拟的。不得写成任何真实型号。 */
export const SIM_PRINTER_NAME = '（演示）模拟打印机'
/** 心跳里的 agentVersion：后台终端列表会显示它，让人一眼看出这台不是真终端程序。 */
export const SIM_AGENT_VERSION = '（演示）模拟打印机，不会真实出纸'
/** .demo/ 下的缺纸标记文件名：存在 = 缺纸，删除 = 恢复。 */
export const SIM_PAPER_EMPTY_MARKER = 'sim-printer-paper-empty'

// 与真实终端程序相同的节奏：心跳 30 秒（heartbeat.ts:230），领任务 5 秒（task-runner.ts:934）。
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_CLAIM_INTERVAL_MS = 5_000
const MIN_CLAIM_INTERVAL_MS = 5_000
const MARKER_POLL_MS = 1_000
const API_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 60_000
// api-client.ts:321-330：网络错误与 5xx 重试 3 次，间隔 2s / 4s / 6s。
const API_RETRY_LIMIT = 3
// task-runner.ts:94：下载失败按 2s / 5s / 10s 退避。
const DOWNLOAD_RETRY_DELAYS_MS = [2_000, 5_000, 10_000]
// 「出纸」耗时：只是让一体机能看到「打印中」这一步，不代表任何真实设备时间。
const SIMULATED_PRINT_MS = 1_500

// task-runner.ts:164 的原文。
const PAPER_EMPTY_MESSAGE = '打印机缺纸，当前无法打印，请联系工作人员补纸后重试'

/** --sim-printer 或 DEMO_SIM_PRINTER=1/true 才打开；默认关闭。 */
export function simPrinterEnabled(argv = [], env = process.env) {
  if (argv.includes('--sim-printer')) return true
  const raw = String(env['DEMO_SIM_PRINTER'] ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true'
}

class HttpError extends Error {
  constructor(status, code) {
    super(`HTTP ${status}${code ? ` [${code}]` : ''}`)
    this.status = status
    this.code = code
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const retryable = (error) => !(error instanceof HttpError) || error.status >= 500

function unwrap(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) && 'data' in payload ? payload.data : payload
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

/** task-runner.ts:191-229：扩展名按 mimeType → fileName → URL → .pdf 推断（只用于临时文件名）。 */
function inferExt(task) {
  const byMime = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/bmp': '.bmp', 'image/tiff': '.tiff' }
  const mime = String(task.mimeType ?? '').split(';')[0].trim().toLowerCase()
  if (byMime[mime]) return byMime[mime]
  const fromName = String(task.fileName ?? '').match(/\.[A-Za-z0-9]{1,5}$/)
  if (fromName) return fromName[0].toLowerCase()
  return '.pdf'
}

function freeDiskGB(dir) {
  try {
    const s = statfsSync(dir)
    return Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10
  } catch {
    return -1 // 与真实终端程序查询不到时的取值一致（wmi.ts getDiskFreeGB）
  }
}

/**
 * @param {{ apiBaseUrl: string, terminalId: string, agentToken: string, workDir: string,
 *           log?: (line: string) => void, heartbeatIntervalMs?: number, claimIntervalMs?: number,
 *           markerPollMs?: number, simulatedPrintMs?: number }} options
 */
export function startSimPrinter(options) {
  const { apiBaseUrl, terminalId, agentToken, workDir } = options
  const log = options.log ?? (() => {})
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
  let claimIntervalMs = options.claimIntervalMs ?? DEFAULT_CLAIM_INTERVAL_MS
  const simulatedPrintMs = options.simulatedPrintMs ?? SIMULATED_PRINT_MS
  const markerFile = join(workDir, SIM_PAPER_EMPTY_MARKER)
  const tempDir = join(workDir, 'sim-printer-temp')
  mkdirSync(tempDir, { recursive: true })

  const config = { printerName: SIM_PRINTER_NAME }
  const localStatus = new Map() // taskId → completed / failed（替代真实终端程序的本机 SQLite 幂等表）
  const pendingPatches = new Map() // 回写失败的终态，下一轮领任务前重发（替代 offline-queue）
  const inFlight = new AbortController()
  let paperEmpty = existsSync(markerFile)
  let unauthorized = false
  let claimPausedUntil = 0
  let cycle = null
  let wakeRequested = false
  let closed = false
  const timers = []

  async function api(method, path, body, { retries = API_RETRY_LIMIT } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(`${apiBaseUrl}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${agentToken}`,
            'X-Terminal-Id': terminalId,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.any([inFlight.signal, AbortSignal.timeout(API_TIMEOUT_MS)]),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          const error = new HttpError(response.status, payload?.error?.code)
          error.retryAfter = response.headers.get('retry-after')
          throw error
        }
        return unwrap(payload)
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) {
          // auth-state.ts：凭证被吊销就停止领任务与打印，等待重新绑定。
          if (!unauthorized) log('终端凭证被服务端拒绝（HTTP 401），模拟打印机停止领任务。重启演示环境会重新登记。')
          unauthorized = true
          throw error
        }
        if (closed || attempt >= retries || !retryable(error)) throw error
        await sleep((attempt + 1) * 2_000)
      }
    }
  }

  // ── 心跳 ──────────────────────────────────────────────────────────────────
  async function sendHeartbeat() {
    if (closed || unauthorized) return
    const payload = {
      status: 'online',
      printerStatus: paperEmpty ? 'paper_empty' : 'ready',
      diskFreeGB: freeDiskGB(workDir),
      agentVersion: SIM_AGENT_VERSION,
      ipAddress: '127.0.0.1',
      reportedAt: new Date().toISOString(),
      localTaskDatabaseAvailable: true,
    }
    try {
      const response = await api('PUT', `/terminals/${terminalId}/heartbeat`, payload, { retries: 0 })
      const serverClaimInterval = Number(response?.config?.claimIntervalMs)
      if (Number.isFinite(serverClaimInterval) && serverClaimInterval >= MIN_CLAIM_INTERVAL_MS) claimIntervalMs = serverClaimInterval
    } catch (error) {
      if (!closed) log(`心跳未送达：${error instanceof Error ? error.message : String(error)}（下一次心跳会重试）`)
    }
  }

  function checkMarker() {
    const now = existsSync(markerFile)
    if (now === paperEmpty) return
    paperEmpty = now
    log(now
      ? `${SIM_PRINTER_NAME}：已模拟缺纸（删除 .demo/${SIM_PAPER_EMPTY_MARKER} 即恢复）`
      : `${SIM_PRINTER_NAME}：已恢复有纸`)
    void sendHeartbeat()
  }

  // ── 回写状态 ──────────────────────────────────────────────────────────────
  async function patch(taskId, status, errorCode, errorMessage) {
    const body = { status, ...(errorCode ? { errorCode } : {}), ...(errorMessage ? { errorMessage } : {}) }
    try {
      await api('PATCH', `/print-tasks/${taskId}/status`, body)
      pendingPatches.delete(taskId)
      return true
    } catch (error) {
      if (!closed) log(`任务 ${taskId}：回写 ${status} 未送达（${error instanceof Error ? error.message : String(error)}）`)
      return false
    }
  }

  async function finish(taskId, status, errorCode, errorMessage) {
    localStatus.set(taskId, status) // 先记本机终态再回写（task-runner.ts:22），崩溃重领也不会再「出纸」
    const ok = await patch(taskId, status, errorCode, errorMessage)
    if (!ok && !unauthorized) pendingPatches.set(taskId, { status, errorCode, errorMessage })
  }

  async function download(url, dest) {
    let lastError
    for (let attempt = 0; attempt <= DOWNLOAD_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.any([inFlight.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]) })
        if (!response.ok) throw new HttpError(response.status)
        const buffer = Buffer.from(await response.arrayBuffer())
        writeFileSync(dest, buffer)
        return buffer
      } catch (error) {
        lastError = error
        if (closed || !retryable(error) || attempt === DOWNLOAD_RETRY_DELAYS_MS.length) break
        await sleep(DOWNLOAD_RETRY_DELAYS_MS[attempt])
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  // ── 执行一个任务（task-runner.ts executeTask 的顺序，去掉真实打印）────────
  async function executeTask(task) {
    const taskId = task.taskId
    const done = localStatus.get(taskId)
    if (done) {
      log(`任务 ${taskId}：本机已记为 ${done}，重发终态，不再出纸`)
      await finish(taskId, done)
      return
    }

    const tempFile = join(tempDir, `task_${taskId}${inferExt(task)}`)
    try {
      let buffer
      try {
        buffer = await download(resolveFileUrl(task.fileUrl, apiBaseUrl), tempFile)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        log(`任务 ${taskId}：文件下载失败（${detail}）`)
        await finish(taskId, 'failed', 'PRINT_COMMAND_FAILED', `Download failed: ${detail}`)
        return
      }

      if (task.fileMd5) {
        const actual = createHash('sha256').update(buffer).digest('hex')
        if (actual !== task.fileMd5) {
          log(`任务 ${taskId}：文件校验失败（SHA-256 不一致）`)
          await finish(taskId, 'failed', 'DOWNLOAD_HASH_MISMATCH', `文件校验失败（SHA-256 不一致）：expected=${task.fileMd5}, got=${actual}`)
          return
        }
        log(`任务 ${taskId}：已下载 ${(buffer.length / 1024).toFixed(1)} KB，SHA-256 校验通过`)
      } else {
        log(`任务 ${taskId}：已下载 ${(buffer.length / 1024).toFixed(1)} KB（服务端未给哈希，跳过校验）`)
      }

      // 打印机预检（task-runner.ts:415-430）：缺纸不出纸，直接回写失败。
      if (paperEmpty) {
        log(`${SIM_PRINTER_NAME}：任务 ${taskId} 因模拟缺纸未出纸，已回写失败（PAPER_EMPTY）`)
        await finish(taskId, 'failed', 'PAPER_EMPTY', PAPER_EMPTY_MESSAGE)
        return
      }
      if (unauthorized || closed) return

      // printing 只是信息性中间态，失败重试一次后继续（task-runner.ts:439）。
      if (!(await patch(taskId, 'printing')) && !unauthorized) await patch(taskId, 'printing')
      if (unauthorized || closed) return

      await sleep(simulatedPrintMs)
      log(`${SIM_PRINTER_NAME}：任务 ${taskId} 已模拟出纸，未真实打印`)
      await finish(taskId, 'completed')
    } finally {
      rmSync(tempFile, { force: true }) // 真实终端程序同样在 finally 里删临时文件
    }
  }

  // ── 领任务循环（单飞：同一时间只处理一个任务，与真实终端程序一致）─────────
  async function runClaimCycle() {
    if (closed || unauthorized || Date.now() < claimPausedUntil) return
    for (const [taskId, p] of pendingPatches) await patch(taskId, p.status, p.errorCode, p.errorMessage)

    let tasks
    try {
      const data = await api('POST', `/terminals/${terminalId}/tasks/claim`, { maxTasks: 1 }, { retries: 0 })
      tasks = Array.isArray(data) ? data : []
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        const seconds = Number(error.retryAfter)
        claimPausedUntil = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000)
        log(`领任务被限流（HTTP 429），暂停 ${Math.round((claimPausedUntil - Date.now()) / 1000)} 秒`)
      } else if (!closed && !(error instanceof HttpError && error.status === 401)) {
        log(`领任务失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }

    for (const task of tasks) {
      if (closed || unauthorized) return
      if (task?.type !== 'print') {
        log(`任务 ${task?.taskId}：类型 ${task?.type} 不支持，跳过`)
        continue
      }
      log(`领到打印任务 ${task.taskId}`)
      try {
        await executeTask(task)
      } catch (error) {
        log(`任务 ${task.taskId}：执行出错 — ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  function kick() {
    if (closed) return { accepted: false, coalesced: false }
    if (cycle) {
      wakeRequested = true
      return { accepted: true, coalesced: true }
    }
    cycle = runClaimCycle()
      .catch((error) => log(`领任务循环出错：${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        cycle = null
        if (wakeRequested && !closed) {
          wakeRequested = false
          kick()
        }
      })
    return { accepted: true, coalesced: false }
  }

  let claimTimer = null
  function scheduleClaim() {
    if (closed) return
    claimTimer = setTimeout(() => {
      kick()
      scheduleClaim()
    }, claimIntervalMs)
  }

  log(`${SIM_PRINTER_NAME}已启动：心跳每 ${heartbeatIntervalMs / 1000} 秒，领任务每 ${claimIntervalMs / 1000} 秒；不会真实出纸`)
  if (paperEmpty) log(`${SIM_PRINTER_NAME}：启动时发现缺纸标记，当前按缺纸上报（删除 .demo/${SIM_PAPER_EMPTY_MARKER} 即恢复）`)
  void sendHeartbeat().then(() => kick())
  timers.push(setInterval(() => void sendHeartbeat(), heartbeatIntervalMs))
  timers.push(setInterval(checkMarker, options.markerPollMs ?? MARKER_POLL_MS))
  scheduleClaim()

  return {
    config,
    markerFile,
    /** 本机打印唤醒（一体机提交后调用）：立刻领一次任务。 */
    wake: kick,
    get paperEmpty() {
      return paperEmpty
    },
    async close() {
      closed = true
      clearTimeout(claimTimer)
      for (const timer of timers) clearInterval(timer)
      inFlight.abort()
      if (cycle) await Promise.race([cycle, sleep(3_000)])
      rmSync(tempDir, { recursive: true, force: true })
    },
  }
}
