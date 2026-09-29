// ============================================================================
// 模拟终端：扫描收件箱（替代真实终端程序监听「打印机扫描到 SMB 共享目录」的那一半）。
//
// 真实链路 apps/terminal-agent/src/agent/scan-watcher.ts（整体照这个顺序走）：
//   启动  目录里已有的文件一律视为上次残留，直接移进 _unclaimed，绝不投递（:1365-1400 isolateStartupBacklog）
//   新文件 → 取一次租约记「开启时属于哪个扫描任务」（:756-772）
//         → 等文件写完：每 1 秒采样，连续 3 次大小 / 修改时间一致（:187-207，最多 15 次）
//         → 再取一次租约（:853-864）；没有等待中的扫描任务 → 移进 _unclaimed（:883-892）
//         → 开启时的任务 ≠ 现在的任务、或文件早于任务开始（notBefore − 5 秒）→ 移进 _unclaimed（:896-947）
//         → POST /terminals/:id/scan-sessions/deliver（multipart：file / scanTaskId / deliveryLease /
//           candidateSnapshotAt / observedAt，不重试）（:949-969）
//         → 成功删源文件；NO_WAITING_SCAN_TASK / SCAN_LEASE_* / SCAN_TASK_STATE_CHANGED /
//           SCAN_FILE_* 等明确拒绝 → 移进 _unclaimed；网络 / 5xx → 原地保留，下一轮清点重试，
//           超过 2 小时移进 _unclaimed（:970-1090）
//   每 5 分钟清点一次目录（:1567）
//   租约 GET /terminals/:id/scan-tasks/current-lease（scan-candidate-barrier.ts:210-233，409/404 视为没有）
//
// 模拟与真实的区别：用 1 秒轮询代替 chokidar；不做 Windows 安全句柄读取、inode 血缘跨改名继承；
// _unclaimed 里的文件不按 24 小时自动删除、也不上报删除审计（留给走查人员查看）。
// ============================================================================

import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { HttpError, apiRequest, errorText, info, isUnauthorized, markUnauthorized, sleep, warn, error } from './common.mjs'

const STABILITY_CHECK_INTERVAL_MS = 1_000
const STABILITY_MAX_CHECKS = 15
const STABILITY_REQUIRED_CONSECUTIVE = 3
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const PRE_EXISTING_TOLERANCE_MS = 5_000
const DELIVERY_RETRY_MAX_MS = 2 * 60 * 60 * 1000
const UNCLAIMED = '_unclaimed'
const QUARANTINE_CODES = new Set([
  'NO_WAITING_SCAN_TASK', 'SCAN_LEASE_INVALID', 'SCAN_LEASE_EXPIRED', 'SCAN_TASK_STATE_CHANGED',
  'SCAN_FILE_ALREADY_DELIVERED', 'SCAN_FILE_PREVIOUSLY_ATTEMPTED', 'SCAN_FILE_STALE_CAPTURE',
])

/** 日志不落扫描件原名（scan-watcher.ts:96-101 maskScanName）。 */
export function maskScanName(filename) {
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  return `***(${base.length})${dot > 0 ? filename.slice(dot) : ''}`
}

export function isAcceptedScanName(name) {
  return /\.(?:pdf|jpe?g|png)$/i.test(name) // scan-input/verified-folder.ts:48-55
}

function guessMimeType(filename) {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

function snapshot(filePath) {
  const s = lstatSync(filePath)
  return { isFile: s.isFile(), nlink: s.nlink, size: s.size, mtimeMs: s.mtimeMs, birthtimeMs: s.birthtimeMs, ino: s.ino, dev: s.dev }
}
const same = (a, b) => a.size === b.size && a.mtimeMs === b.mtimeMs && a.isFile === b.isFile && a.ino === b.ino

/** GET 当前租约；没有等待中的扫描任务返回 null。 */
export async function fetchScanLease({ apiBaseUrl, credential }) {
  try {
    const data = await apiRequest({ apiBaseUrl, method: 'GET', path: `/terminals/${credential.terminalId}/scan-tasks/current-lease`, credential, retries: 0 })
    return data && data.deliveryLease ? data : null
  } catch (err) {
    if (err instanceof HttpError && (err.status === 409 || err.status === 404 || err.code === 'NO_WAITING_SCAN_TASK')) return null
    throw err
  }
}

/**
 * @param {{ paths: object, apiBaseUrl: string, credential: { terminalId: string, terminalToken: string },
 *           pollMs?: number, stabilityIntervalMs?: number }} options
 */
export function startScanInbox(options) {
  const { paths, apiBaseUrl, credential } = options
  const folder = paths.scanInbox
  const pollMs = options.pollMs ?? 1_000
  const stabilityIntervalMs = options.stabilityIntervalMs ?? STABILITY_CHECK_INTERVAL_MS
  const seen = new Map() // 文件名 → { firstSeenAt, openingTaskId }（本进程内血缘，重启即清）
  const inFlight = new Set()
  const leftForSweep = new Set()
  const warnedNonAccepted = new Set()
  let closed = false
  let telemetry = { health: 'unknown', requiredAction: 'none', reason: null, observedAt: new Date().toISOString() }
  const setTelemetry = (health, requiredAction, reason) => {
    if (telemetry.health === health && telemetry.reason === reason) return
    telemetry = { health, requiredAction, reason, observedAt: new Date().toISOString() }
  }

  function quarantine(name, why) {
    const src = join(folder, name)
    let dest = join(folder, UNCLAIMED, name)
    if (existsSync(dest)) dest = join(folder, UNCLAIMED, `${Date.now()}-${name}`)
    try {
      renameSync(src, dest)
      warn('scan.quarantined', `扫描件移进 _unclaimed（${why}）— ${maskScanName(name)}`, { reason: why })
    } catch (err) {
      error('scan.quarantine_failed', `扫描件隔离失败（${errorText(err)}）— ${maskScanName(name)}`)
    }
    seen.delete(name)
    leftForSweep.delete(name)
  }

  async function waitForStable(filePath) {
    let previous
    let streak = 1
    for (let i = 0; i < STABILITY_MAX_CHECKS; i++) {
      if (closed || !existsSync(filePath)) return undefined
      const current = snapshot(filePath)
      if (!current.isFile || current.nlink !== 1) return undefined
      if (current.size > 0 && previous && same(previous, current)) {
        streak += 1
        if (streak >= STABILITY_REQUIRED_CONSECUTIVE) return current
      } else {
        streak = 1
      }
      previous = current
      await sleep(stabilityIntervalMs)
    }
    return undefined
  }

  const keepForRetry = (name) => leftForSweep.add(name)

  async function processCandidate(name) {
    const filePath = join(folder, name)
    if (inFlight.has(filePath) || closed) return
    inFlight.add(filePath)
    try {
      if (isUnauthorized()) return // 保留原文件，重新绑定后再处理
      let initial
      try {
        initial = snapshot(filePath)
      } catch {
        return
      }
      if (!initial.isFile || initial.nlink !== 1 || !isAcceptedScanName(name)) {
        if (!warnedNonAccepted.has(name)) {
          warnedNonAccepted.add(name)
          warn('scan.rejected', `扫描目录里的文件不是单一普通 pdf/jpg/png，不处理 — ${maskScanName(name)}`)
        }
        return
      }

      // 开启租约：只用于判定「这份捕获属于哪个任务」，首次看到时记下，之后不改。
      let opening
      try {
        opening = await fetchScanLease({ apiBaseUrl, credential })
      } catch (err) {
        if (err instanceof HttpError && err.status === 401) return markUnauthorized('scan-lease')
        warn('scan.lease_failed', `取扫描租约失败（${errorText(err)}），文件留待下一轮清点 — ${maskScanName(name)}`)
        return keepForRetry(name)
      }
      if (!seen.has(name)) seen.set(name, { firstSeenAt: Date.now(), openingTaskId: opening?.scanTaskId ?? null })
      info('scan.detected', `发现扫描件 ${maskScanName(name)}（${opening ? '有等待中的扫描任务' : '当前没有等待中的扫描任务'}），等待写完`, { openingTaskId: opening?.scanTaskId ?? null })

      const stable = await waitForStable(filePath)
      if (!stable) {
        warn('scan.unstable', `扫描件在限定时间内没写完，本轮跳过 — ${maskScanName(name)}`)
        return keepForRetry(name)
      }
      if (!existsSync(filePath)) return
      const final = snapshot(filePath)
      if (!final.isFile || final.nlink !== 1 || !same(stable, final)) {
        warn('scan.changed', `扫描件在读取前又变了，本轮跳过 — ${maskScanName(name)}`)
        return keepForRetry(name)
      }
      const bytes = readFileSync(filePath)

      let lease
      try {
        lease = await fetchScanLease({ apiBaseUrl, credential })
      } catch (err) {
        if (err instanceof HttpError && err.status === 401) return markUnauthorized('scan-lease')
        warn('scan.lease_failed', `取扫描租约失败（${errorText(err)}），文件留待下一轮清点 — ${maskScanName(name)}`)
        return keepForRetry(name)
      }
      if (!lease) return quarantine(name, '没有等待中的扫描任务')
      const notBeforeMs = new Date(lease.notBefore).getTime()
      if (!Number.isFinite(notBeforeMs)) return quarantine(name, '租约 notBefore 无法解析')
      const origin = seen.get(name)
      if (!origin || origin.openingTaskId !== lease.scanTaskId) return quarantine(name, '这份扫描件开始时属于另一个任务（或当时没有任务），拒绝跨会话投递')
      const threshold = notBeforeMs - PRE_EXISTING_TOLERANCE_MS
      const preExisting = final.mtimeMs < threshold
        || (Number.isFinite(final.birthtimeMs) && final.birthtimeMs > 0 && final.birthtimeMs < threshold)
        || origin.firstSeenAt < threshold
      if (preExisting) return quarantine(name, '文件早于这次扫描任务开始，按上一位用户残留处理')

      const snapshotAt = new Date(final.mtimeMs).toISOString()
      const form = new FormData()
      form.append('file', new Blob([bytes], { type: guessMimeType(name) }), name)
      form.append('scanTaskId', lease.scanTaskId)
      form.append('deliveryLease', lease.deliveryLease)
      form.append('candidateSnapshotAt', snapshotAt)
      form.append('observedAt', snapshotAt)
      try {
        await apiRequest({ apiBaseUrl, method: 'POST', path: `/terminals/${credential.terminalId}/scan-sessions/deliver`, form, credential, retries: 0 })
      } catch (err) {
        if (err instanceof HttpError && err.status === 401) return markUnauthorized('scan-deliver')
        if (err instanceof HttpError && QUARANTINE_CODES.has(err.code)) return quarantine(name, `服务端拒收：${err.code}`)
        let mtimeMs
        try {
          mtimeMs = lstatSync(filePath).mtimeMs
        } catch {
          return
        }
        if (Date.now() - mtimeMs > DELIVERY_RETRY_MAX_MS) return quarantine(name, '投递重试超过 2 小时，放弃')
        error('scan.deliver_failed', `扫描件投递失败（${errorText(err)}），文件留待下一轮清点 — ${maskScanName(name)}`, { httpStatus: err?.status ?? null, code: err?.code ?? null })
        return keepForRetry(name)
      }
      unlinkSync(filePath)
      seen.delete(name)
      leftForSweep.delete(name)
      info('scan.delivered', `扫描件已投递给扫描任务 ${lease.scanTaskId}（${(bytes.length / 1024).toFixed(1)} KB），源文件已删除`, { scanTaskId: lease.scanTaskId, bytes: bytes.length })
    } catch (err) {
      error('scan.unexpected', `处理扫描件出错，文件留在原地 — ${maskScanName(name)}：${errorText(err)}`)
      keepForRetry(name)
    } finally {
      inFlight.delete(filePath)
    }
  }

  function listCandidates() {
    try {
      return readdirSync(folder).filter((n) => n !== UNCLAIMED)
    } catch {
      setTelemetry('locked_out', 'restart_required', 'readdir_failed')
      return []
    }
  }

  // 启动：目录里已有的文件一律隔离（isolateStartupBacklog）
  const backlog = listCandidates().filter((n) => {
    try {
      return lstatSync(join(folder, n)).isFile() && isAcceptedScanName(n)
    } catch {
      return false
    }
  })
  for (const name of backlog) quarantine(name, '模拟终端启动前就在收件箱里（启动残留）')
  if (telemetry.health !== 'locked_out') setTelemetry('healthy', 'none', null)
  info('scan.ready', `扫描收件箱就绪：${folder}${backlog.length ? `（启动时隔离了 ${backlog.length} 个残留文件）` : ''}`)

  const pollTimer = setInterval(() => {
    if (closed) return
    for (const name of listCandidates()) {
      if (leftForSweep.has(name)) continue
      void processCandidate(name)
    }
  }, pollMs)
  const sweepTimer = setInterval(() => {
    if (closed) return
    leftForSweep.clear()
    for (const name of listCandidates()) void processCandidate(name)
  }, SWEEP_INTERVAL_MS)

  return {
    getTelemetry: () => telemetry,
    async close() {
      closed = true
      clearInterval(pollTimer)
      clearInterval(sweepTimer)
    },
  }
}

