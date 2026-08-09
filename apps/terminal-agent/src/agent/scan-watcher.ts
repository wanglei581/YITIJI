/**
 * agent/scan-watcher.ts — 首期真实扫描
 *
 * 监听打印机"扫描到 SMB 共享目录"产生的文件：
 *   1. 新文件出现 → 等待文件大小稳定（避免读到还没写完的文件）
 *   2. 整体读取 → POST /terminals/:id/scan-sessions/deliver
 *   3. 投递成功 → 删除源文件
 *   4. 投递失败因为没有匹配的等待中任务（409/NO_WAITING_SCAN_TASK）→ 移入 _unclaimed 子目录，不重试
 *   5. 投递失败因为匹配后任务状态已变化（409/SCAN_TASK_STATE_CHANGED，B1-11）→ 同样立即移入
 *      _unclaimed，不重试——这次"匹配"已经永久失效，重试有把文件错误挂到该终端后续
 *      另一个用户新会话上的跨用户 PII 泄露风险
 *   6. 投递失败因为该文件内容此前已经成功投递过（409/SCAN_FILE_ALREADY_DELIVERED，B1-11
 *      点4边缘案例：原投递其实已在服务端成功、只是响应在回传途中丢失）→ 同样立即移入
 *      _unclaimed，不重试
 *   7. 其它网络/5xx 错误 → 文件保留原地，交给下一轮周期性清点重试
 *
 * 启动时 + 之后每 5 分钟做一次目录清点，处理 Agent 重启期间到达、
 * 或此前投递失败但文件本身未再变化的文件（不会有新的 chokidar change 事件）。
 */

import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'fs'
import { createHmac } from 'crypto'
import { basename, dirname, join, resolve } from 'path'
import chokidar, { FSWatcher } from 'chokidar'
import FormData from 'form-data'
import type { AgentConfig } from './types'
import { createApiClient, axiosErrorMessage, isUnauthorizedHttpError, NO_RETRY_CONFIG } from './api-client'
import { isUnauthorized, markUnauthorized } from './auth-state'
import { writeStartupDiagnosticSafely } from './startup-diagnostics'
import {
  classifyScanInputCandidate,
  inspectScanInputFolder,
  isStableScanInputCandidate,
} from './scan-input/verified-folder'
import { log, warn, err } from '../logger'
import type { ScanInputCandidateSnapshot } from './types'
import {
  beginScanDeletionAudit,
  finishScanDeletionAudit,
  getActiveDatabase,
  getOrCreateScanAuditHmacKey,
  type AgentDatabase,
} from './db'

const STABILITY_CHECK_INTERVAL_MS = 500
const STABILITY_MAX_CHECKS = 10
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const UNCLAIMED_DIRNAME = '_unclaimed'
const UNCLAIMED_EXPIRY_REASON = 'UNCLAIMED_TTL_EXPIRED'

/** Returns true when a 401 requires preserving the source file for re-bind. */
export function preserveScanFileForUnauthorized(error: unknown): boolean {
  if (!isUnauthorizedHttpError(error)) return false
  markUnauthorized()
  writeStartupDiagnosticSafely('AGENT_UNAUTHORIZED')
  return true
}
/**
 * `_unclaimed` 隔离目录里的文件超过这个时长（按文件 mtime 计算）就会被周期清理
 * 删除。24 小时——给现场人工核查留出一个完整工作日的窗口，同时不让身份证/简历
 * 这类高敏原始扫描件在本地磁盘无限期堆积。
 */
export const UNCLAIMED_MAX_AGE_MS = 24 * 60 * 60 * 1000
/**
 * 网络/5xx 等非"无匹配任务"错误导致投递失败时，最多允许重试这么久（按文件自身
 * mtime 计算，Agent 是无状态 sweep 循环，没有额外状态记录"已经重试几次"）。
 * 2 小时——覆盖正常的网络抖动/短暂后端不可用，同时不让真正投递不了的文件无限期
 * 占着"待投递"状态。超过后移入 _unclaimed，与"无等待任务"走同一隔离归宿，但日志
 * 措辞不同，避免混淆两种不同的原因。
 *
 * ⚠️ 必须与 services/api/src/scan-tasks/scan-tasks.service.ts 的
 * SCAN_CONTENT_DEDUP_WINDOW_MS 保持相等（服务端内容级去重窗口理论上限就是 Agent
 * 可能重试同一份文件的最大时间跨度）。这两个包互相无法运行时 import（本包是独立
 * 部署的 Windows 二进制，未声明 @ai-job-print/shared 或 services/api 依赖），因此
 * 靠 services/api/scripts/verify-scan-tasks.ts 的
 * assertDeliveryRetryMaxMsStaysInSyncWithDedupWindow() 用源码文本解析兜底：改这行
 * 数值而不同步改 SCAN_CONTENT_DEDUP_WINDOW_MS 会让 verify:scan-tasks 直接失败。
 */
export const DELIVERY_RETRY_MAX_MS = 2 * 60 * 60 * 1000

/** 把毫秒时长格式化成人类可读的小时/分钟，用于日志——不掺入任何文件内容。 */
function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}分钟`
  return `${hours}小时${minutes}分钟`
}

export interface ScanWatcherHandle {
  stop: () => Promise<void>
}

function snapshotCandidate(filePath: string, filename: string): ScanInputCandidateSnapshot & {
  dev: number
  ino: number
  nlink: number
} {
  const metadata = lstatSync(filePath)
  const nodeKind = metadata.isSymbolicLink()
    ? 'symbolic_link'
    : metadata.isFile()
      ? 'file'
      : metadata.isDirectory()
        ? 'directory'
        : 'other'
  return {
    name: filename,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    nodeKind,
    dev: metadata.dev,
    ino: metadata.ino,
    nlink: metadata.nlink,
  }
}

function isDirectChild(filePath: string, filename: string, scanWatchFolder: string): boolean {
  return basename(filePath) === filename
    && !filename.includes('/')
    && !filename.includes('\\')
    && resolve(dirname(filePath)) === resolve(scanWatchFolder)
}

/** 等待候选文件的 lstat 快照连续两次一致，不跟随符号链接。 */
async function waitForStableFile(
  filePath: string,
  filename: string,
): Promise<ReturnType<typeof snapshotCandidate> | undefined> {
  let previous: ReturnType<typeof snapshotCandidate> | undefined
  for (let i = 0; i < STABILITY_MAX_CHECKS; i++) {
    if (!existsSync(filePath)) return undefined
    const current = snapshotCandidate(filePath, filename)
    if (classifyScanInputCandidate(current) !== 'accepted' || current.nlink !== 1) return undefined
    if (current.size > 0 && previous && isStableScanInputCandidate(previous, current)) return current
    previous = current
    await new Promise((resolve) => setTimeout(resolve, STABILITY_CHECK_INTERVAL_MS))
  }
  return undefined
}

function readVerifiedCandidate(
  filePath: string,
  stableSnapshot: ReturnType<typeof snapshotCandidate>,
): Buffer {
  if (fsConstants.O_NOFOLLOW === undefined) {
    throw new Error('SCAN_INPUT_NOFOLLOW_UNAVAILABLE')
  }
  const descriptor = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  try {
    const opened = fstatSync(descriptor)
    if (!opened.isFile() || opened.nlink !== 1) throw new Error('SCAN_INPUT_NOT_SINGLE_REGULAR_FILE')
    if (
      opened.dev !== stableSnapshot.dev
      || opened.ino !== stableSnapshot.ino
      || opened.size !== stableSnapshot.size
      || opened.mtimeMs !== stableSnapshot.mtimeMs
    ) {
      throw new Error('SCAN_INPUT_CHANGED_BEFORE_READ')
    }
    return readFileSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function ensureUnclaimedDir(scanWatchFolder: string): string {
  const dir = join(scanWatchFolder, UNCLAIMED_DIRNAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function guessMimeType(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

/**
 * 正在处理中的文件路径集合，用于防止 chokidar 实时 `add` 事件与周期性
 * `sweepFolder` 清点并发处理同一个文件（否则会出现两次投递抢占两个不同
 * 等待中任务、把同一份扫描件误发给另一个用户的严重问题）。
 */
const inFlightPaths = new Set<string>()

/** 处理单个候选文件：稳定性检查 → 投递 → 成功删除 / 未匹配隔离 / 其它错误留原地重试。 */
export async function processCandidate(
  filePath: string,
  filename: string,
  config: AgentConfig,
  deliverFile?: () => Promise<void>,
): Promise<void> {
  if (isUnauthorized()) return
  if (inFlightPaths.has(filePath)) {
    // 已经在被实时监听或另一轮清点处理，跳过，避免同一文件并发投递两次。
    return
  }
  inFlightPaths.add(filePath)
  try {
    const scanWatchFolder = config.scanWatchFolder?.trim()
    const health = inspectScanInputFolder(scanWatchFolder)
    if (health.status !== 'ready' || !scanWatchFolder) {
      warn(`scan-watcher: scan input blocked before candidate read — ${health.reason}`)
      return
    }
    if (!isDirectChild(filePath, filename, scanWatchFolder)) {
      warn(`scan-watcher: unsafe scan input path rejected before read — ${filename}`)
      return
    }

    const initial = snapshotCandidate(filePath, filename)
    const classification = classifyScanInputCandidate(initial)
    if (classification !== 'accepted' || initial.nlink !== 1) {
      const reason = initial.nlink !== 1 ? 'rejected_multiple_links' : classification
      warn(`scan-watcher: unsafe scan input candidate rejected before read (${reason}) — ${filename}`)
      return
    }

    const stable = await waitForStableFile(filePath, filename)
    if (!stable) {
      warn(`scan-watcher: file did not stabilize in time, skipping this round — ${filename}`)
      return
    }

    // 重新确认文件仍存在:稳定性检查通过后、真正处理前,文件有可能已被
    // 另一条并发路径处理完删除(理论上 inFlightPaths 已经防住了这种情况,
    // 但双重确认更安全,尤其是应对本模块之外的原因导致文件消失,例如
    // 杀毒软件锁定后又释放并删除、SMB 短暂断连等)。
    if (!existsSync(filePath)) {
      warn(`scan-watcher: file disappeared before processing, skipping — ${filename}`)
      return
    }

    const finalSnapshot = snapshotCandidate(filePath, filename)
    if (
      classifyScanInputCandidate(finalSnapshot) !== 'accepted'
      || finalSnapshot.nlink !== 1
      || !isStableScanInputCandidate(stable, finalSnapshot)
    ) {
      warn(`scan-watcher: unsafe or changed scan input rejected before read — ${filename}`)
      return
    }

    const buffer = readVerifiedCandidate(filePath, finalSnapshot)
    const form = new FormData()
    form.append('file', buffer, { filename, contentType: guessMimeType(filename) })

    const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)

    try {
      // NO_RETRY_CONFIG: `form` 是一次性消费的流，axios 拦截器的自动重试会复用
      // 同一个已耗尽的请求体，导致 Content-Length 与实际重发字节不匹配、服务端
      // 请求 end 事件永不触发——真实 5xx 场景下会让每次重试都卡满 30s 超时
      // （3 次共 100+ 秒）。失败已由本函数自身的 sweep 重试机制兜底，禁用
      // axios 层重试不影响最终投递成功率。
      if (deliverFile) {
        await deliverFile()
      } else {
        await client.post(`/terminals/${config.terminalId}/scan-sessions/deliver`, form, {
          headers: form.getHeaders(),
          ...NO_RETRY_CONFIG,
        })
      }
      unlinkSync(filePath)
      log(`scan-watcher: delivered and removed source file — ${filename}`)
    } catch (e) {
      if (preserveScanFileForUnauthorized(e)) {
        warn(`scan-watcher: unauthorized; preserving file for retry after re-bind — ${filename}`)
        return
      }
      const code = (e as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code
      if (code === 'NO_WAITING_SCAN_TASK') {
        const unclaimedDir = ensureUnclaimedDir(config.scanWatchFolder!)
        renameSync(filePath, join(unclaimedDir, filename))
        warn(`scan-watcher: no waiting scan task, moved to _unclaimed — ${filename}`)
        return
      }

      // B1-11（Critical code-review 修复 #2）：SCAN_TASK_STATE_CHANGED 说明这份文件在服务端
      // 确实被匹配、CAS 到过 'matched'，但最终 CAS-to-completed 落空（任务在上传期间被取消或
      // 状态变化——服务端已经用 systemDelete() 补偿删掉了那次真实上传出的孤儿文件，见
      // scan-tasks.service.ts deliverScanFile() 的 SCAN_TASK_STATE_CHANGED 分支）。这次"匹配"
      // 已经明确、永久失效——不是网络抖动，绝不能留给下一轮 sweep 重试：重试时该终端"当前
      // 最早一条 waiting 任务"完全可能已经变成另一个用户的新会话（原用户的任务已经不在，
      // 终端已经空出来），继续重试会把这份文件错误地挂到那个新用户身上——跨用户 PII 误挂载。
      // 必须像 NO_WAITING_SCAN_TASK 一样立即隔离，绝不重试；日志措辞与两个既有 _unclaimed
      // 归宿（无等待任务 / 重试超时）分别不同，避免运维排查时混淆三种不同的原因。
      if (code === 'SCAN_TASK_STATE_CHANGED') {
        const unclaimedDir = ensureUnclaimedDir(config.scanWatchFolder!)
        renameSync(filePath, join(unclaimedDir, filename))
        warn(`scan-watcher: scan task state changed after match (no longer valid, will not retry), moved to _unclaimed — ${filename}`)
        return
      }

      // B1-11（点 4 边缘案例修复）：SCAN_FILE_ALREADY_DELIVERED 说明这份文件内容此前已经
      // 真正投递成功过——最可能的原因是上一次投递其实已经在服务端完成，只是 HTTP 响应在
      // 回传给本 Agent 的路上丢失，本 Agent 才把它误当成失败留在原地准备重试。继续重试
      // 没有意义（内容已经交付过），而且和 SCAN_TASK_STATE_CHANGED 一样有跨用户误挂载
      // 风险（重试会被匹配到该终端当前最早一条 waiting 任务，可能已经属于另一个用户）——
      // 同样必须立即隔离，不重试。
      if (code === 'SCAN_FILE_ALREADY_DELIVERED') {
        const unclaimedDir = ensureUnclaimedDir(config.scanWatchFolder!)
        renameSync(filePath, join(unclaimedDir, filename))
        warn(`scan-watcher: file content already delivered previously (duplicate retry, likely a lost response), moved to _unclaimed — ${filename}`)
        return
      }

      // 网络/5xx 等其它错误：默认留在原地交给下一轮 sweep 重试，但重试时长不能
      // 无限——用文件自身 mtime（不是"第一次尝试投递的时间"，Agent 没有额外状态
      // 记录重试次数）判断是否已经超过 DELIVERY_RETRY_MAX_MS。超过后放弃重试，
      // 移入 _unclaimed（与 NO_WAITING_SCAN_TASK 同一归宿，但日志措辞明确区分为
      // "重试超时放弃"，避免和真正的"无等待任务"语义混淆）。
      let mtimeMs: number | undefined
      try {
        mtimeMs = statSync(filePath).mtime.getTime()
      } catch {
        // 文件在此期间消失（已被其它路径处理/删除）——无需再决定去留。
      }
      if (mtimeMs !== undefined && Date.now() - mtimeMs > DELIVERY_RETRY_MAX_MS) {
        try {
          const unclaimedDir = ensureUnclaimedDir(config.scanWatchFolder!)
          renameSync(filePath, join(unclaimedDir, filename))
          warn(
            `scan-watcher: delivery retry timeout exceeded (idle ${formatDuration(Date.now() - mtimeMs)}), ` +
              `abandoning retries and moved to _unclaimed — ${filename}`,
          )
        } catch (moveErr) {
          err(`scan-watcher: failed to quarantine file after retry timeout — ${filename}: ${axiosErrorMessage(moveErr)}`)
        }
        return
      }

      err(`scan-watcher: delivery failed, leaving file for next sweep — ${filename}: ${axiosErrorMessage(e)}`)
    }
  } catch (e) {
    // 兜底:任何其它未预料到的文件系统错误(锁定、权限、竞态残留等)都不能
    // 逃逸成 unhandled rejection——本 Agent 进程有全局 process.exit(1) 兜底,
    // 这里崩了会把心跳/领任务等其它功能一起打挂。
    err(`scan-watcher: unexpected error processing candidate, leaving file in place for retry — ${filename}: ${axiosErrorMessage(e)}`)
  } finally {
    inFlightPaths.delete(filePath)
  }
}

/**
 * 清理 _unclaimed 隔离目录：删除 mtime 早于 UNCLAIMED_MAX_AGE_MS 的文件。
 * 删除意图和结果写入本地 durable audit；账本只保存每安装密钥生成的 HMAC，不保存路径、
 * 文件名、内容或其它明文 PII。审计失败不能阻止隐私删除。
 */
export function sweepUnclaimedDir(
  scanWatchFolder: string,
  auditDb: AgentDatabase = getActiveDatabase(),
  dependencies: { unlinkFile?: (filePath: string) => void; now?: () => number } = {},
): void {
  const dir = join(scanWatchFolder, UNCLAIMED_DIRNAME)
  if (!existsSync(dir)) return

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (e) {
    warn(`scan-watcher: failed to read _unclaimed dir for cleanup — ${axiosErrorMessage(e)}`)
    return
  }

  const now = dependencies.now?.() ?? Date.now()
  const unlinkFile = dependencies.unlinkFile ?? unlinkSync
  for (const name of entries) {
    const fullPath = join(dir, name)
    let mtimeMs: number
    let size: number
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) continue
      mtimeMs = stat.mtime.getTime()
      size = stat.size
    } catch {
      continue
    }

    const ageMs = now - mtimeMs
    if (ageMs <= UNCLAIMED_MAX_AGE_MS) continue

    // HMACs are domain-separated and keyed by a per-install random secret stored
    // in local SQLite metadata. An attacker who guesses a filename/path cannot
    // reproduce or correlate ledger identifiers without that local key.
    let eventId: string | undefined
    let auditLabel = 'untracked'
    let auditIntentRecorded = false
    try {
      if (auditDb) {
        const hmacKey = Buffer.from(getOrCreateScanAuditHmacKey(auditDb), 'hex')
        const identifierHash = createHmac('sha256', hmacKey)
          .update(`unclaimed-scan-v1\0${resolve(fullPath)}\0${size}\0${mtimeMs}`)
          .digest('hex')
        eventId = createHmac('sha256', hmacKey)
          .update(`unclaimed-expiry-delete-v1\0${identifierHash}\0${mtimeMs}`)
          .digest('hex')
        auditLabel = eventId.slice(0, 12)
        beginScanDeletionAudit(
          auditDb,
          { eventId, reasonCode: UNCLAIMED_EXPIRY_REASON, identifierHash },
          new Date(now).toISOString(),
        )
        auditIntentRecorded = true
      } else {
        warn(`scan-watcher: deletion audit unavailable; proceeding with TTL deletion — event=${auditLabel}`)
      }
    } catch (auditError) {
      warn(
        `scan-watcher: failed to persist deletion intent; proceeding with TTL deletion — ` +
          `event=${auditLabel}: ${sanitizedErrorCode(auditError, 'AUDIT_WRITE_FAILED')}`,
      )
    }

    try {
      unlinkFile(fullPath)
      if (auditIntentRecorded && eventId) {
        try {
          finishScanDeletionAudit(auditDb, eventId, {
            result: 'deleted',
            deletedAt: new Date(dependencies.now?.() ?? Date.now()).toISOString(),
          })
        } catch (auditError) {
          err(
            `scan-watcher: deletion succeeded but audit result update failed — ` +
              `event=${auditLabel}: ${sanitizedErrorCode(auditError, 'AUDIT_WRITE_FAILED')}`,
          )
        }
      }
      warn(
        `scan-watcher: deleted stale _unclaimed file after ${formatDuration(ageMs)} idle — ` +
          `event=${auditLabel}`,
      )
    } catch (deleteError) {
      const errorCode = sanitizedErrorCode(deleteError, 'DELETE_FAILED')
      if (auditIntentRecorded && eventId) {
        try {
          finishScanDeletionAudit(auditDb, eventId, { result: 'delete_failed', errorCode })
        } catch (auditError) {
          err(
            `scan-watcher: delete and audit result update both failed — ` +
              `event=${auditLabel}: ${sanitizedErrorCode(auditError, 'AUDIT_WRITE_FAILED')}`,
          )
        }
      }
      err(
        `scan-watcher: failed to delete stale _unclaimed file; will retry next sweep — ` +
          `event=${auditLabel} code=${errorCode}`,
      )
    }
  }
}

/** Store/log only bounded machine-readable codes, never exception messages containing paths. */
function sanitizedErrorCode(error: unknown, fallback: string): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(code)
    ? code.toUpperCase()
    : fallback
}

/** 目录清点：处理当前已存在、不在 _unclaimed 子目录里的文件；同时清理 _unclaimed 里的过期文件。 */
export async function sweepFolder(scanWatchFolder: string, config: AgentConfig): Promise<void> {
  sweepUnclaimedDir(scanWatchFolder)
  if (isUnauthorized()) return

  const health = inspectScanInputFolder(scanWatchFolder)
  if (health.status !== 'ready') {
    warn(`scan-watcher: scan input sweep blocked — ${health.reason}`)
    return
  }

  let entries: string[]
  try {
    entries = readdirSync(scanWatchFolder)
  } catch (e) {
    warn(`scan-watcher: failed to read scanWatchFolder — ${axiosErrorMessage(e)}`)
    return
  }
  for (const name of entries) {
    if (name === UNCLAIMED_DIRNAME) continue
    const fullPath = join(scanWatchFolder, name)
    try {
      const snapshot = snapshotCandidate(fullPath, name)
      if (classifyScanInputCandidate(snapshot) !== 'accepted' || snapshot.nlink !== 1) {
        warn(`scan-watcher: unsafe scan input candidate skipped during sweep — ${name}`)
        continue
      }
    } catch {
      continue
    }
    try {
      await processCandidate(fullPath, name, config)
    } catch (e) {
      err(`scan-watcher: sweep failed to process ${name}, continuing with remaining files: ${axiosErrorMessage(e)}`)
    }
  }
}

/**
 * 启动扫描监听。未配置 config.scanWatchFolder 时直接返回 undefined，
 * 不影响心跳 / claim 等其余 Agent 功能。
 */
export function startScanWatcher(config: AgentConfig): ScanWatcherHandle | undefined {
  const folder = config.scanWatchFolder?.trim()
  if (!folder) {
    log('scan-watcher: scanWatchFolder 未配置，跳过扫描监听')
    return undefined
  }

  const health = inspectScanInputFolder(folder)
  if (health.status !== 'ready') {
    warn(`scan-watcher: scan input blocked; watcher not started — ${health.reason}`)
    return undefined
  }

  log(`scan-watcher: watching ${folder}`)

  const watcher: FSWatcher = chokidar.watch(folder, {
    ignoreInitial: true,
    depth: 0,
    ignored: (path: string) => path.includes(UNCLAIMED_DIRNAME),
  })

  watcher.on('add', (filePath: string) => {
    const filename = filePath.split(/[\\/]/).pop() ?? filePath
    processCandidate(filePath, filename, config).catch((e) => {
      err(`scan-watcher: processCandidate threw unexpectedly for ${filename}: ${axiosErrorMessage(e)}`)
    })
  })

  watcher.on('error', (error: unknown) => {
    err(`scan-watcher: watcher error — ${axiosErrorMessage(error)}`)
  })

  // 启动时清点一次（处理 Agent 重启期间到达、被 ignoreInitial 跳过的文件）
  void sweepFolder(folder, config)

  const sweepTimer = setInterval(() => void sweepFolder(folder, config), SWEEP_INTERVAL_MS)

  return {
    stop: async () => {
      clearInterval(sweepTimer)
      await watcher.close()
    },
  }
}
