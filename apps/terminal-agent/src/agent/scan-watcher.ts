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
 *
 * 运行中 SMB/Windows 扫描目录不可用、watcher error、根身份变化或明确 rebuild
 * 请求时：本进程立即 generation++ 并 LOCKED_OUT，禁止自动恢复为 RUNNING。
 * 只能 stop + 新进程启动后重新初始化。不得把刷新过 mtime/birthtime 的旧文件
 * 挂到后一用户。
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
import {
  fetchScanLease,
  isPreExistingCandidate,
  globalDirectoryBaseline,
  globalScanDeliveryBarrier,
  canonicalizeScanPath,
  readScanFolderIdentity,
  scanFolderIdentityChanged,
  SCAN_INPUT_RESTART_REQUIRED,
  SCAN_CAPTURE_FOREIGN_LEASE,
  SCAN_LEASE_NOT_BEFORE_INVALID,
  scanCaptureFileIdentity,
  scanCaptureIdentityKey,
  isSameScanCaptureFile,
  type ScanCaptureFileIdentity,
  type ScanFolderIdentity,
  type ScanTaskLease,
} from './scan-candidate-barrier'
import { writeStartupDiagnosticSafely } from './startup-diagnostics'
import {
  classifyScanInputCandidate,
  inspectScanInputFolder,
  isStableScanInputCandidate,
} from './scan-input/verified-folder'
import {
  finalizeTrustedWindowsCandidate,
  inspectTrustedWindowsUnclaimedCandidate,
  readTrustedWindowsCandidate,
  sweepTrustedWindowsUnclaimed,
  type TrustedWindowsCandidate,
} from './scan-input/windows-secure-reader'
import { log, warn, err } from '../logger'
import type { ScanInputCandidateSnapshot } from './types'
import {
  beginScanDeletionAudit,
  finishScanDeletionAudit,
  getActiveDatabase,
  getOrCreateScanAuditHmacKey,
  type AgentDatabase,
} from './db'

// AGT-08：扫描仪经 SMB 分段写入时，两次采样间隔 500ms 内可能恰好停顿，导致读到半个文件。
// 采样间隔放大到 1s，并要求连续 3 次快照一致（约 2s 稳定窗）才视为写完。
const STABILITY_CHECK_INTERVAL_MS = 1_000
const STABILITY_MAX_CHECKS = 15
const STABILITY_REQUIRED_CONSECUTIVE = 3
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const UNCLAIMED_DIRNAME = '_unclaimed'
const UNCLAIMED_EXPIRY_REASON = 'UNCLAIMED_TTL_EXPIRED'

/**
 * AGT-07：日志里不落扫描件原始文件名（CLAUDE.md §11 敏感文件）。
 * 只保留扩展名与基名长度，不保留任何前缀字符。
 */
export function maskScanName(filename: string): string {
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ''
  return `***(${base.length})${ext}`
}

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
  birthtimeMs?: number
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
    birthtimeMs: metadata.birthtimeMs,
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
    && canonicalizeScanPath(dirname(filePath)) === canonicalizeScanPath(scanWatchFolder)
}

/** 等待候选文件的 lstat 快照连续两次一致，不跟随符号链接。 */
async function waitForStableFile(
  filePath: string,
  filename: string,
): Promise<ReturnType<typeof snapshotCandidate> | undefined> {
  let previous: ReturnType<typeof snapshotCandidate> | undefined
  let stableStreak = 1
  for (let i = 0; i < STABILITY_MAX_CHECKS; i++) {
    if (!existsSync(filePath)) return undefined
    const current = snapshotCandidate(filePath, filename)
    if (classifyScanInputCandidate(current) !== 'accepted' || current.nlink !== 1) return undefined
    if (current.size > 0 && previous && isStableScanInputCandidate(previous, current)) {
      stableStreak += 1
      if (stableStreak >= STABILITY_REQUIRED_CONSECUTIVE) return current
    } else {
      stableStreak = 1
    }
    previous = current
    await new Promise((resolve) => setTimeout(resolve, STABILITY_CHECK_INTERVAL_MS))
  }
  return undefined
}

export function readVerifiedCandidate(
  filePath: string,
  scanWatchFolder: string,
  filename: string,
  stableSnapshot: ReturnType<typeof snapshotCandidate>,
): { bytes: Buffer; trustedWindowsCandidate?: TrustedWindowsCandidate } {
  if (process.platform === 'win32') {
    const trustedWindowsCandidate = readTrustedWindowsCandidate(scanWatchFolder, filename, stableSnapshot)
    return { bytes: trustedWindowsCandidate.bytes, trustedWindowsCandidate }
  }
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
    return { bytes: readFileSync(descriptor) }
  } finally {
    closeSync(descriptor)
  }
}

export function finalizeCandidate(
  filePath: string,
  scanWatchFolder: string,
  filename: string,
  trusted: TrustedWindowsCandidate | undefined,
  action: 'delete' | 'quarantine',
): void {
  if (process.platform === 'win32') {
    if (!trusted) throw new Error('SCAN_INPUT_SECURE_MUTATION_TOKEN_MISSING')
    finalizeTrustedWindowsCandidate(scanWatchFolder, filename, trusted, action)
    return
  }
  if (action === 'delete') unlinkSync(filePath)
  else renameSync(filePath, join(ensureUnclaimedDir(scanWatchFolder), filename))
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

/**
 * 启动时识别出的历史 backlog 文件路径集合（resolved absolute path）。
 * 在本进程生命周期内永久 never-deliver：绝不能进入服务端租约申请或正常投递；
 * 后续 sweep 仅重试安全隔离；成功隔离后清理标记；隔离失败记录高严重度日志但不泄露文件名或内容。
 *
 * `startupBacklogIdentities` 跟上同一批目录项的 dev/ino。rename 会换 basename，
 * 不能只靠新路径判断「这是不是启动时那份文件」。
 */
const startupBacklogPaths = new Set<string>()
const startupBacklogIdentities = new Set<string>()

function readStartupBacklogFileIdentity(filePath: string): ScanCaptureFileIdentity | undefined | 'unknown' {
  try {
    const metadata = lstatSync(filePath)
    return scanCaptureFileIdentity(metadata.dev, metadata.ino) ?? 'unknown'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') return undefined
    return 'unknown'
  }
}

function markStartupBacklogIdentity(filePath: string): void {
  const identity = readStartupBacklogFileIdentity(filePath)
  if (identity === 'unknown') {
    globalScanDeliveryBarrier.lockOut('identity_unavailable')
    warn(`scan-watcher: startup backlog file identity unavailable — code=${SCAN_INPUT_RESTART_REQUIRED}`)
    return
  }
  if (!identity) return
  startupBacklogIdentities.add(scanCaptureIdentityKey(identity))
}

function forgetStartupBacklog(filePath: string, identity?: ScanCaptureFileIdentity): void {
  startupBacklogPaths.delete(canonicalizeScanPath(filePath))
  if (identity) startupBacklogIdentities.delete(scanCaptureIdentityKey(identity))
}

export function isStartupBacklogCandidate(filePath: string, identity?: ScanCaptureFileIdentity): boolean {
  if (identity && startupBacklogIdentities.has(scanCaptureIdentityKey(identity))) return true
  if (!startupBacklogPaths.has(canonicalizeScanPath(filePath))) return false
  // Path mark without a matching inode: a later file reusing the basename after
  // the original directory entry was renamed or quarantined is not that leftover.
  if (identity) return false
  return true
}

let scanLifecycleActive = 0
let scanLifecycleSkipped = 0
let scanCandidateTestHooks: {
  afterStable?: (filename: string) => void | Promise<void>
  afterLease?: () => void
  duringStartupIsolation?: () => void
} = {}

export function clearStartupBacklogForTest(): void {
  startupBacklogPaths.clear()
  startupBacklogIdentities.clear()
  globalScanDeliveryBarrier.resetForTest()
  scanCandidateTestHooks = {}
  scanLifecycleSkipped = 0
}

export function noteScanInputUnavailableForTest(): void {
  globalScanDeliveryBarrier.noteUnavailable()
  warn(`scan-watcher: scan input locked out — code=${SCAN_INPUT_RESTART_REQUIRED}`)
}

export function noteScanWatcherRebuildForTest(): void {
  globalScanDeliveryBarrier.noteWatcherRebuild()
  warn(`scan-watcher: scan input locked out — code=${SCAN_INPUT_RESTART_REQUIRED}`)
}

export function isScanDeliveryPausedForTest(): boolean {
  return globalScanDeliveryBarrier.isPaused()
}

export function beginScanWatchSessionForTest(): boolean {
  return globalScanDeliveryBarrier.beginWatchSession()
}

export function enterRunningForTest(identity: ScanFolderIdentity): boolean {
  return globalScanDeliveryBarrier.enterRunning(identity)
}

export function getScanInputStateForTest(): string {
  return globalScanDeliveryBarrier.getState()
}

export function getScanInputGenerationForTest(): number {
  return globalScanDeliveryBarrier.getGeneration()
}

export function getScanInputLockOutReasonForTest(): string | undefined {
  return globalScanDeliveryBarrier.lockOutCode()
}

export function lockOutScanInputForTest(reason = 'test_lockout'): void {
  globalScanDeliveryBarrier.lockOut(reason)
  warn(`scan-watcher: scan input locked out — code=${SCAN_INPUT_RESTART_REQUIRED}`)
}

export function stopScanWatchSessionForTest(): void {
  globalScanDeliveryBarrier.stop()
}

export function setScanCandidateTestHooks(hooks: {
  afterStable?: (filename: string) => void | Promise<void>
  afterLease?: () => void
  duringStartupIsolation?: () => void
}): void {
  scanCandidateTestHooks = { ...hooks }
}

function listLiveBasenames(scanWatchFolder: string): Set<string> | undefined {
  try {
    return new Set(readdirSync(scanWatchFolder).filter((name) => name !== UNCLAIMED_DIRNAME))
  } catch {
    // ATOMIC_SCAN_LIVE_LISTING_KNOWN: failure is unknown, not an empty folder.
    return undefined
  }
}

function lockOutLiveListingUnknown(): void {
  if (globalScanDeliveryBarrier.getState() === 'locked_out' || globalScanDeliveryBarrier.getState() === 'stopped') {
    return
  }
  globalScanDeliveryBarrier.lockOut('readdir_failed')
  warn(`scan-watcher: failed to read scanWatchFolder — code=${SCAN_INPUT_RESTART_REQUIRED}`)
}

function requireLiveBasenames(scanWatchFolder: string): Set<string> | undefined {
  const names = listLiveBasenames(scanWatchFolder)
  if (names !== undefined) return names
  lockOutLiveListingUnknown()
  return undefined
}

function liveNameIdentity(scanWatchFolder: string, name: string): ScanCaptureFileIdentity | undefined {
  try {
    const metadata = lstatSync(join(scanWatchFolder, name))
    return scanCaptureFileIdentity(metadata.dev, metadata.ino)
  } catch {
    return undefined
  }
}

function findLiveSameInodeSuccessor(
  scanWatchFolder: string,
  vanishedName: string,
  identity: ScanCaptureFileIdentity | undefined,
  liveNames: ReadonlySet<string>,
): string | undefined {
  if (!identity) return undefined
  for (const name of liveNames) {
    if (name === vanishedName) continue
    if (isSameScanCaptureFile(identity, liveNameIdentity(scanWatchFolder, name)) === true) return name
  }
  return undefined
}

function finishVanishedCapture(
  filePath: string,
  filename: string,
  scanWatchFolder: string | undefined,
): void {
  if (!scanWatchFolder) return
  try {
    if (existsSync(filePath)) return
  } catch {
    lockOutLiveListingUnknown()
    return
  }
  const liveNames = listLiveBasenames(scanWatchFolder)
  if (liveNames === undefined) {
    lockOutLiveListingUnknown()
    return
  }
  globalDirectoryBaseline.closeVanishedCapture(
    filename,
    liveNames,
    (name) => liveNameIdentity(scanWatchFolder, name),
  )
}

async function observeNonAcceptedCapture(
  filePath: string,
  filename: string,
  config: AgentConfig,
  capturedGeneration: number,
  identity?: ScanCaptureFileIdentity,
): Promise<void> {
  const scanWatchFolder = config.scanWatchFolder?.trim()
  if (!scanWatchFolder) return
  let taskId: string | null = null
  if (
    globalScanDeliveryBarrier.generationAllowsDelivery(capturedGeneration)
    && !isStartupBacklogCandidate(filePath, identity)
  ) {
    try {
      const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)
      const lease = await fetchScanLease(client, config.terminalId)
      taskId = lease?.scanTaskId ?? null
    } catch (error) {
      if (preserveScanFileForUnauthorized(error)) return
      throw error
    }
  }
  const liveNames = requireLiveBasenames(scanWatchFolder)
  if (!liveNames) return
  let bindName = filename
  try {
    if (!existsSync(filePath)) {
      bindName = findLiveSameInodeSuccessor(scanWatchFolder, filename, identity, liveNames) ?? filename
    }
  } catch {
    lockOutLiveListingUnknown()
    return
  }
  globalDirectoryBaseline.bindCapture(
    bindName,
    Date.now(),
    taskId,
    liveNames,
    identity,
    (name) => liveNameIdentity(scanWatchFolder, name),
  )
}

export function getScanLifecycleExclusiveStatsForTest(): { active: number; skipped: number } {
  return { active: scanLifecycleActive, skipped: scanLifecycleSkipped }
}

async function runScanLifecycleExclusive(task: () => Promise<void>): Promise<'ran' | 'skipped'> {
  if (scanLifecycleActive > 0) {
    scanLifecycleSkipped += 1
    return 'skipped'
  }
  scanLifecycleActive += 1
  try {
    await task()
    return 'ran'
  } finally {
    scanLifecycleActive -= 1
  }
}

export async function holdScanLifecycleExclusiveForTest(hold: Promise<void>): Promise<void> {
  await runScanLifecycleExclusive(() => hold)
}

export async function runPeriodicScanSweepForTest(folder: string, config: AgentConfig): Promise<'ran' | 'skipped'> {
  return runScanLifecycleExclusive(async () => {
    if (globalScanDeliveryBarrier.getState() === 'stopped') return
    await sweepFolder(folder, config)
  })
}

function logScanInputRestartRequired(): void {
  warn(`scan-watcher: scan input locked out — code=${SCAN_INPUT_RESTART_REQUIRED}`)
}

export function observeScanInputOrLockOut(folder: string): void {
  if (globalScanDeliveryBarrier.getState() === 'stopped') return
  const health = inspectScanInputFolder(folder)
  if (health.status !== 'ready') {
    const alreadyLocked = globalScanDeliveryBarrier.getState() === 'locked_out'
    globalScanDeliveryBarrier.lockOut(health.reason)
    if (!alreadyLocked) logScanInputRestartRequired()
    return
  }
  const before = globalScanDeliveryBarrier.getState()
  globalScanDeliveryBarrier.observeIdentityOrLockOut(readScanFolderIdentity(folder))
  if (before !== 'locked_out' && globalScanDeliveryBarrier.getState() === 'locked_out') {
    logScanInputRestartRequired()
  }
}

export function abortDeliveryIfScanInputLockout(capturedGeneration: number): boolean {
  // ATOMIC_SCAN_INPUT_LOCKOUT_GENERATION: in-flight candidates must not lease or POST
  // after lockout or a generation change; only a new process may run again.
  if (!globalScanDeliveryBarrier.generationAllowsDelivery(capturedGeneration)) {
    warn(`scan-watcher: delivery aborted — code=${SCAN_INPUT_RESTART_REQUIRED}`)
    return true
  }

  return false
}

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
  const capturedGeneration = globalScanDeliveryBarrier.getGeneration()
  let watchFolderForFinally: string | undefined
  try {
    const scanWatchFolder = config.scanWatchFolder?.trim()
    watchFolderForFinally = scanWatchFolder
    if (!scanWatchFolder) {
      return
    }
    observeScanInputOrLockOut(scanWatchFolder)
    if (globalScanDeliveryBarrier.getState() === 'stopped') {
      return
    }
    if (!isDirectChild(filePath, filename, scanWatchFolder)) {
      warn(`scan-watcher: unsafe scan input path rejected before read — ${maskScanName(filename)}`)
      return
    }

    const initial = snapshotCandidate(filePath, filename)
    const openingIdentity = scanCaptureFileIdentity(initial.dev, initial.ino)
    const classification = classifyScanInputCandidate(initial)
    if (classification !== 'accepted' || initial.nlink !== 1) {
      const reason = initial.nlink !== 1 ? 'rejected_multiple_links' : classification
      await observeNonAcceptedCapture(filePath, filename, config, capturedGeneration, openingIdentity)
      warn(`scan-watcher: unsafe scan input candidate rejected before read (${reason}) — ${maskScanName(filename)}`)
      return
    }

    const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)
    // Per-file opening identity for THIS path only. Never a module-global last lease.
    let openingTaskId: string | null | undefined
    if (
      !deliverFile
      && globalScanDeliveryBarrier.generationAllowsDelivery(capturedGeneration)
      && !isStartupBacklogCandidate(filePath, openingIdentity)
    ) {
      try {
        const openingLease = await fetchScanLease(client, config.terminalId)
        openingTaskId = openingLease?.scanTaskId ?? null
      } catch (error) {
        if (preserveScanFileForUnauthorized(error)) {
          warn(`scan-watcher: unauthorized; preserving file for retry after re-bind — ${maskScanName(filename)}`)
          return
        }
        throw error
      }
    }
    const liveNames = requireLiveBasenames(scanWatchFolder)
    if (!liveNames) return
    let bindName = filename
    try {
      if (!existsSync(filePath)) {
        bindName = findLiveSameInodeSuccessor(scanWatchFolder, filename, openingIdentity, liveNames) ?? filename
      }
    } catch {
      lockOutLiveListingUnknown()
      return
    }
    globalDirectoryBaseline.bindCapture(
      bindName,
      Date.now(),
      deliverFile ? null : openingTaskId ?? null,
      liveNames,
      openingIdentity,
      (name) => liveNameIdentity(scanWatchFolder, name),
    )

    const stable = await waitForStableFile(filePath, filename)
    if (!stable) {
      warn(`scan-watcher: file did not stabilize in time, skipping this round — ${maskScanName(filename)}`)
      return
    }
    await Promise.resolve(scanCandidateTestHooks.afterStable?.(filename))

    // 重新确认文件仍存在:稳定性检查通过后、真正处理前,文件有可能已被
    // 另一条并发路径处理完删除(理论上 inFlightPaths 已经防住了这种情况,
    // 但双重确认更安全,尤其是应对本模块之外的原因导致文件消失,例如
    // 杀毒软件锁定后又释放并删除、SMB 短暂断连等)。
    if (!existsSync(filePath)) {
      warn(`scan-watcher: file disappeared before processing, skipping — ${maskScanName(filename)}`)
      return
    }

    const finalSnapshot = snapshotCandidate(filePath, filename)
    if (
      classifyScanInputCandidate(finalSnapshot) !== 'accepted'
      || finalSnapshot.nlink !== 1
      || !isStableScanInputCandidate(stable, finalSnapshot)
    ) {
      warn(`scan-watcher: unsafe or changed scan input rejected before read — ${maskScanName(filename)}`)
      return
    }

    // 先通过 readVerifiedCandidate 获取真实安全候选对象与 verified bytes，
    // 确保在 Windows 平台获得真实 TrustedWindowsCandidate 变异凭据，避免无租约或旧文件隔离抛出
    // SCAN_INPUT_SECURE_MUTATION_TOKEN_MISSING；同时复用同一份字节完成正常投递，避免双重读取。
    const verified = readVerifiedCandidate(filePath, scanWatchFolder, filename, finalSnapshot)

    // 启动时识别为 backlog 的路径，在本进程中必须永久 never-deliver，隔离失败也不能进入正常投递。
    // 后续 sweep 仅重试安全隔离；成功后清理标记；失败需高严重度但不泄露文件名/内容。
    const lockoutAbort = abortDeliveryIfScanInputLockout(capturedGeneration)
    const candidateIdentity = scanCaptureFileIdentity(finalSnapshot.dev, finalSnapshot.ino)
    const isBacklog = isStartupBacklogCandidate(filePath, candidateIdentity)
    if (lockoutAbort || isBacklog) {
      try {
        globalDirectoryBaseline.remove(filename)
        finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
        forgetStartupBacklog(filePath, candidateIdentity)
        if (lockoutAbort) {
          warn(`scan-watcher: locked-out candidate quarantined — code=${SCAN_INPUT_RESTART_REQUIRED}`)
        } else {
          warn(`scan-watcher: startup backlog candidate quarantined — ${maskScanName(filename)}`)
        }
      } catch (e) {
        err(
          `scan-watcher: startup backlog quarantine retry failed — code=${sanitizedErrorCode(e, 'QUARANTINE_FAILED')}`,
        )
      }
      return
    }

    // 1. 投递前再取一次当前租约。opening fetch 只用于血缘；closing 才是投递身份。
    let lease: ScanTaskLease | null = null
    if (deliverFile) {
      lease = {
        scanTaskId: 'test-scan-task-id',
        serverNow: new Date().toISOString(),
        notBefore: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        deliveryLease: 'test-delivery-lease',
      }
    } else {
      try {
        lease = await fetchScanLease(client, config.terminalId)
      } catch (e) {
        if (preserveScanFileForUnauthorized(e)) {
          warn(`scan-watcher: unauthorized; preserving file for retry after re-bind — ${maskScanName(filename)}`)
          return
        }
        throw e
      }
    }
    scanCandidateTestHooks.afterLease?.()
    if (abortDeliveryIfScanInputLockout(capturedGeneration)) {
      try {
        globalDirectoryBaseline.remove(filename)
        finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
        warn(`scan-watcher: locked-out candidate quarantined — code=${SCAN_INPUT_RESTART_REQUIRED}`)
      } catch (e) {
        err(
          `scan-watcher: startup backlog quarantine retry failed — code=${sanitizedErrorCode(e, 'QUARANTINE_FAILED')}`,
        )
      }
      return
    }

    if (!lease) {
      globalDirectoryBaseline.remove(filename)
      finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
      warn(`scan-watcher: no waiting scan task, moved to _unclaimed — ${maskScanName(filename)}`)
      return
    }

    // 2. 血缘与陈旧捕获：mtime 不能单独当身份。等待中任务 A 上打开的捕获，
    // 即使 PDF 在 B.notBefore 之后才稳定/可见，也不得 POST 给 B。
    const leaseNotBeforeMs = new Date(lease.notBefore).getTime()
    // ATOMIC_SCAN_LEASE_NOT_BEFORE_VALID: an unparsable notBefore cannot prove
    // the file is newer than the waiting task; fail closed and quarantine.
    if (!Number.isFinite(leaseNotBeforeMs)) {
      globalDirectoryBaseline.remove(filename)
      finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
      warn(
        `scan-watcher: scan lease notBefore is invalid; refusing delivery, moved to _unclaimed — code=${SCAN_LEASE_NOT_BEFORE_INVALID}`,
      )
      return
    }
    const closingLiveNames = requireLiveBasenames(scanWatchFolder)
    if (!closingLiveNames) {
      globalDirectoryBaseline.remove(filename)
      finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
      warn(`scan-watcher: unknown scan-folder listing; refusing delivery — code=${SCAN_INPUT_RESTART_REQUIRED}`)
      return
    }
    // ATOMIC_SCAN_CAPTURE_LEASE_LINEAGE: a capture opened under waiting task A
    // (or with no waiting task) must not POST to a later waiting task B, even when
    // mtime/observedAt is after B.notBefore. Recovery is a new panel file or
    // server-authorized safe rescan of a fresh capture, not this bytes-on-disk.
    const foreignCapture = deliverFile
      ? false
      : globalDirectoryBaseline.isForeignToLease(filename, lease.scanTaskId, closingLiveNames)
        || (typeof openingTaskId === 'string' && openingTaskId !== lease.scanTaskId)
        || openingTaskId === null
    const preExistingCapture =
      isPreExistingCandidate(finalSnapshot, lease.notBefore)
      || globalDirectoryBaseline.isPreExisting(filename, leaseNotBeforeMs)
    if (foreignCapture || preExistingCapture) {
      globalDirectoryBaseline.remove(filename)
      finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
      if (foreignCapture && !preExistingCapture) {
        warn(
          `scan-watcher: capture lineage belongs to a different waiting task; refusing cross-session bind, moved to _unclaimed — code=${SCAN_CAPTURE_FOREIGN_LEASE}`,
        )
      } else {
        warn(`scan-watcher: candidate file existed prior to scan lease start; refusing pre-existing file binding, moved to _unclaimed — ${maskScanName(filename)}`)
      }
      return
    }

    // 3. 构建可信快照时间（传原始 finalSnapshot.mtimeMs，严禁使用 Math.max 夹值伪造时间证据）
    const candidateSnapshotAt = new Date(finalSnapshot.mtimeMs).toISOString()
    const form = new FormData()
    form.append('file', verified.bytes, { filename, contentType: guessMimeType(filename) })
    form.append('scanTaskId', lease.scanTaskId)
    form.append('deliveryLease', lease.deliveryLease)
    form.append('candidateSnapshotAt', candidateSnapshotAt)
    form.append('observedAt', candidateSnapshotAt)

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
      globalDirectoryBaseline.remove(filename)
      finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'delete')
      log(`scan-watcher: delivered and removed source file — ${maskScanName(filename)}`)
    } catch (e) {
      if (preserveScanFileForUnauthorized(e)) {
        warn(`scan-watcher: unauthorized; preserving file for retry after re-bind — ${maskScanName(filename)}`)
        return
      }
      const code = (e as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code
      if (code === 'NO_WAITING_SCAN_TASK') {
        globalDirectoryBaseline.remove(filename)
        finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
        warn(`scan-watcher: no waiting scan task, moved to _unclaimed — ${maskScanName(filename)}`)
        return
      }
      if (code === 'SCAN_LEASE_INVALID' || code === 'SCAN_LEASE_EXPIRED') {
        globalDirectoryBaseline.remove(filename)
        finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
        warn(`scan-watcher: scan lease invalid or expired; moved to _unclaimed — ${maskScanName(filename)}`)
        return
      }

      // B1-11（Critical code-review 修复 #2）：SCAN_TASK_STATE_CHANGED 说明这份文件在服务端
      // 确实被匹配、CAS 到过 'matched'，但最终 CAS-to-completed 落空（任务在上传期间被取消或
      // 状态变化——服务端已经用 systemDelete() 补偿删掉了那次真实上传出的孤儿文件，见
      // scan-tasks.service.ts deliverScanFile() 的 SCAN_TASK_STATE_CHANGED 分支）。这次"匹配"
      // 已经明确、永久失效——不是网络抖动，绝不能留给下一轮 sweep 重试：重试时该终端"当前
      // waiting 任务"完全可能已经变成另一个用户的新会话（原用户的任务已经不在，
      // 终端已经空出来），继续重试会把这份文件错误地挂到那个新用户身上——跨用户 PII 误挂载。
      // 必须像 NO_WAITING_SCAN_TASK 一样立即隔离，绝不重试；日志措辞与两个既有 _unclaimed
      // 归宿（无等待任务 / 重试超时）分别不同，避免运维排查时混淆三种不同的原因。
      if (code === 'SCAN_TASK_STATE_CHANGED') {
        finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
        warn(`scan-watcher: scan task state changed after match (no longer valid, will not retry), moved to _unclaimed — ${maskScanName(filename)}`)
        return
      }

      // B1-11（点 4 边缘案例修复）：SCAN_FILE_ALREADY_DELIVERED 说明这份文件内容此前已经
      // 真正投递成功过——最可能的原因是上一次投递其实已经在服务端完成，只是 HTTP 响应在
      // 回传给本 Agent 的路上丢失，本 Agent 才把它误当成失败留在原地准备重试。继续重试
      // 没有意义（内容已经交付过），而且和 SCAN_TASK_STATE_CHANGED 一样有跨用户误挂载
      // 风险（重试会被匹配到该终端当前 waiting 任务，可能已经属于另一个用户）——
      // 同样必须立即隔离，不重试。
      if (code === 'SCAN_FILE_ALREADY_DELIVERED') {
        finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
        warn(`scan-watcher: file content already delivered previously (duplicate retry, likely a lost response), moved to _unclaimed — ${maskScanName(filename)}`)
        return
      }

      if (code === 'SCAN_FILE_PREVIOUSLY_ATTEMPTED') {
        finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
        warn(`scan-watcher: file content was previously attempted but not completed; refusing cross-session rebind, moved to _unclaimed — ${maskScanName(filename)}`)
        return
      }

      if (code === 'SCAN_FILE_STALE_CAPTURE') {
        finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
        warn(`scan-watcher: file capture is stale for current session; refusing cross-session rebind, moved to _unclaimed — ${maskScanName(filename)}`)
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
          finalizeCandidate(filePath, scanWatchFolder, filename, verified.trustedWindowsCandidate, 'quarantine')
          warn(
            `scan-watcher: delivery retry timeout exceeded (idle ${formatDuration(Date.now() - mtimeMs)}), ` +
              `abandoning retries and moved to _unclaimed — ${maskScanName(filename)}`,
          )
        } catch (moveErr) {
          err(`scan-watcher: failed to quarantine file after retry timeout — ${maskScanName(filename)}: ${axiosErrorMessage(moveErr)}`)
        }
        return
      }

      err(`scan-watcher: delivery failed, leaving file for next sweep — ${maskScanName(filename)}: ${axiosErrorMessage(e)}`)
    }
  } catch (e) {
    // 兜底:任何其它未预料到的文件系统错误(锁定、权限、竞态残留等)都不能
    // 逃逸成 unhandled rejection——本 Agent 进程有全局 process.exit(1) 兜底,
    // 这里崩了会把心跳/领任务等其它功能一起打挂。
    err(`scan-watcher: unexpected error processing candidate, leaving file in place for retry — ${maskScanName(filename)}: ${axiosErrorMessage(e)}`)
  } finally {
    inFlightPaths.delete(filePath)
    finishVanishedCapture(filePath, filename, watchFolderForFinally)
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
  if (process.platform === 'win32') {
    for (const name of entries) {
      let candidate
      try {
        candidate = inspectTrustedWindowsUnclaimedCandidate(scanWatchFolder, name)
      } catch {
        continue
      }
      const ageMs = now - candidate.mtimeMs
      if (ageMs <= UNCLAIMED_MAX_AGE_MS) continue
      const fullPath = join(dir, name)
      let eventId: string | undefined
      let auditLabel = 'untracked'
      let auditIntentRecorded = false
      try {
        if (auditDb) {
          const hmacKey = Buffer.from(getOrCreateScanAuditHmacKey(auditDb), 'hex')
          const identifierHash = createHmac('sha256', hmacKey)
            .update(`unclaimed-scan-v1\0${resolve(fullPath)}\0${candidate.size}\0${candidate.mtimeMs}`)
            .digest('hex')
          eventId = createHmac('sha256', hmacKey)
            .update(`unclaimed-expiry-delete-v1\0${identifierHash}\0${candidate.mtimeMs}`)
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
        sweepTrustedWindowsUnclaimed(scanWatchFolder, candidate)
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
        warn(`scan-watcher: deleted stale _unclaimed file after ${formatDuration(ageMs)} idle — event=${auditLabel}`)
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
        err(`scan-watcher: failed to delete stale _unclaimed file; will retry next sweep — event=${auditLabel} code=${errorCode}`)
      }
    }
    return
  }
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
  if (typeof code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(code)) {
    return code.toUpperCase()
  }
  const message = (error as Error | undefined)?.message
  if (typeof message === 'string' && /^[A-Z0-9_]{1,64}$/.test(message)) {
    return message
  }
  return fallback
}

/** 目录清点：处理当前已存在、不在 _unclaimed 子目录里的文件；同时清理 _unclaimed 里的过期文件。 */
export async function sweepFolder(scanWatchFolder: string, config: AgentConfig): Promise<void> {
  sweepUnclaimedDir(scanWatchFolder)
  if (isUnauthorized()) return
  if (globalScanDeliveryBarrier.getState() === 'stopped') return
  observeScanInputOrLockOut(scanWatchFolder)
  if (globalScanDeliveryBarrier.getState() === 'stopped') return

  let entries: string[]
  try {
    entries = readdirSync(scanWatchFolder)
  } catch {
    globalScanDeliveryBarrier.lockOut('readdir_failed')
    warn(`scan-watcher: failed to read scanWatchFolder — code=${SCAN_INPUT_RESTART_REQUIRED}`)
    return
  }
  const liveNames = new Set(entries.filter((name) => name !== UNCLAIMED_DIRNAME))
  globalDirectoryBaseline.retainLiveEntries(
    liveNames,
    (name) => liveNameIdentity(scanWatchFolder, name),
  )
  if (globalScanDeliveryBarrier.getState() === 'locked_out' || globalScanDeliveryBarrier.getState() === 'initializing') {
    for (const name of entries) {
      if (name === UNCLAIMED_DIRNAME) continue
      const fullPath = join(scanWatchFolder, name)
      if (!isDirectChild(fullPath, name, scanWatchFolder)) continue
      startupBacklogPaths.add(canonicalizeScanPath(fullPath))
      markStartupBacklogIdentity(fullPath)
    }
  }
  for (const name of entries) {
    if (name === UNCLAIMED_DIRNAME) continue
    const fullPath = join(scanWatchFolder, name)
    try {
      const snapshot = snapshotCandidate(fullPath, name)
      if (classifyScanInputCandidate(snapshot) !== 'accepted' || snapshot.nlink !== 1) {
        await observeNonAcceptedCapture(
          fullPath,
          name,
          config,
          globalScanDeliveryBarrier.getGeneration(),
          scanCaptureFileIdentity(snapshot.dev, snapshot.ino),
        )
        warn(`scan-watcher: unsafe scan input candidate skipped during sweep — ${maskScanName(name)}`)
        continue
      }
    } catch {
      continue
    }
    try {
      await processCandidate(fullPath, name, config)
    } catch (e) {
      err(`scan-watcher: sweep failed to process ${maskScanName(name)}, continuing with remaining files: ${axiosErrorMessage(e)}`)
    }
  }
}

/**
 * 启动时安全隔离目录内已有文件（fail-closed startup backlog）。
 * Agent 每次启动时，扫描目录下已存在的所有文件（启动前旧文件）
 * 均不能获得之后的新租约，必须立即安全隔离至 _unclaimed 目录。
 * readdir 之后、任何 await / watcher add / sweep / process 之前，必须同步把每个
 * 直接子路径记入 startupBacklogPaths，并把能证明的 dev/ino 记入
 * startupBacklogIdentities；随后才按既有 Windows trusted token 串行隔离。
 * 启动时识别为 backlog 的目录项，在本进程中必须永久 never-deliver（rename 换名
 * 也不行），隔离失败也不能进入正常投递。
 * 隔离失败保留标记；成功才清除路径和 inode。unsafe / symlink / hardlink 只保留 never-deliver 标记，绝不投递。
 * 在 Windows 平台上严格使用 readVerifiedCandidate 获取的 TrustedWindowsCandidate
 * 原生凭据执行隔离，绝不抛 SCAN_INPUT_SECURE_MUTATION_TOKEN_MISSING。
 * 隔离后文件在 _unclaimed 目录中，下次重启或周期性 sweep 均不会再次尝试匹配或投递。
 */
export async function isolateStartupBacklog(scanWatchFolder: string): Promise<number> {
  const folder = scanWatchFolder?.trim()
  if (!folder) return 0

  const health = inspectScanInputFolder(folder)
  if (health.status !== 'ready') {
    globalScanDeliveryBarrier.lockOut(health.reason)
    warn(`scan-watcher: scan input startup backlog check blocked — code=${SCAN_INPUT_RESTART_REQUIRED}`)
    return 0
  }

  let entries: string[]
  try {
    entries = readdirSync(folder)
  } catch {
    globalScanDeliveryBarrier.lockOut('readdir_failed')
    warn(`scan-watcher: failed to read scanWatchFolder for startup backlog — code=${SCAN_INPUT_RESTART_REQUIRED}`)
    return 0
  }

  // ATOMIC_STARTUP_BACKLOG_PREMARK: every direct-child path is marked before any
  // await so watcher add/sweep/process cannot deliver a later sibling.
  for (const name of entries) {
    if (name === UNCLAIMED_DIRNAME) continue
    const fullPath = join(folder, name)
    if (!isDirectChild(fullPath, name, folder)) continue
    startupBacklogPaths.add(canonicalizeScanPath(fullPath))
    // ATOMIC_STARTUP_BACKLOG_IDENTITY: never-deliver follows the directory
    // entry (dev/ino) across a later rename; a new basename is not a new capture.
    markStartupBacklogIdentity(fullPath)
  }

  const identity = readScanFolderIdentity(folder)
  if (!identity) {
    globalScanDeliveryBarrier.lockOut('identity_unavailable')
    warn(`scan-watcher: scan input startup identity unavailable — code=${SCAN_INPUT_RESTART_REQUIRED}`)
  }

  let quarantined = 0
  for (const name of entries) {
    if (name === UNCLAIMED_DIRNAME) continue
    const fullPath = join(folder, name)
    if (!isDirectChild(fullPath, name, folder)) continue
    const resolvedPath = canonicalizeScanPath(fullPath)
    startupBacklogPaths.add(resolvedPath)
    if (inFlightPaths.has(fullPath)) continue
    inFlightPaths.add(fullPath)
    try {
      const initial = snapshotCandidate(fullPath, name)
      if (classifyScanInputCandidate(initial) !== 'accepted' || initial.nlink !== 1) {
        continue
      }
      const stable = await waitForStableFile(fullPath, name)
      if (!stable || !existsSync(fullPath)) continue

      const finalSnapshot = snapshotCandidate(fullPath, name)
      const verified = readVerifiedCandidate(fullPath, folder, name, finalSnapshot)
      globalDirectoryBaseline.remove(name)
      finalizeCandidate(fullPath, folder, name, verified.trustedWindowsCandidate, 'quarantine')
      forgetStartupBacklog(fullPath, scanCaptureFileIdentity(finalSnapshot.dev, finalSnapshot.ino))
      warn(`scan-watcher: startup backlog candidate quarantined — ${maskScanName(name)}`)
      quarantined += 1
    } catch (e) {
      err(`scan-watcher: failed to isolate startup backlog candidate — code=${sanitizedErrorCode(e, 'QUARANTINE_FAILED')}`)
    } finally {
      inFlightPaths.delete(fullPath)
    }
  }
  scanCandidateTestHooks.duringStartupIsolation?.()
  const postIsolationIdentity = readScanFolderIdentity(folder)
  if (!postIsolationIdentity) {
    globalScanDeliveryBarrier.lockOut('identity_unavailable')
    logScanInputRestartRequired()
  } else if (!identity || scanFolderIdentityChanged(identity, postIsolationIdentity)) {
    globalScanDeliveryBarrier.lockOut('root_identity_changed')
    logScanInputRestartRequired()
  } else if (globalScanDeliveryBarrier.getState() === 'initializing') {
    globalScanDeliveryBarrier.enterRunning(postIsolationIdentity)
  }
  return quarantined
}

/**
 * 启动扫描监听。未配置 config.scanWatchFolder 时直接返回 undefined，
 * 不影响心跳 / claim 等其余 Agent 功能。
 */
function waitForWatcherReady(watcher: FSWatcher, timeoutMs = 10_000): Promise<boolean> {
  return new Promise((resolveReady) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveReady(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    watcher.once('ready', () => finish(true))
    watcher.once('error', () => finish(false))
  })
}

export function startScanWatcher(config: AgentConfig): ScanWatcherHandle | undefined {
  const folder = config.scanWatchFolder?.trim()
  if (!folder) {
    log('scan-watcher: scanWatchFolder 未配置，跳过扫描监听')
    return undefined
  }
  if (!globalScanDeliveryBarrier.allowsAttach()) {
    warn(`scan-watcher: session stopped; watcher not started — code=${SCAN_INPUT_RESTART_REQUIRED}`)
    return undefined
  }

  const health = inspectScanInputFolder(folder)
  if (health.status !== 'ready') {
    globalScanDeliveryBarrier.lockOut(health.reason)
    logScanInputRestartRequired()
    warn(`scan-watcher: scan input blocked; watcher not started — ${health.reason}`)
    return undefined
  }

  log(`scan-watcher: watching ${folder}`)

  if (!globalScanDeliveryBarrier.beginWatchSession()) {
    warn(`scan-watcher: session stopped; watcher not started — code=${SCAN_INPUT_RESTART_REQUIRED}`)
    return undefined
  }
  globalDirectoryBaseline.clear()
  startupBacklogPaths.clear()
  startupBacklogIdentities.clear()

  const next: FSWatcher = chokidar.watch(folder, {
    ignoreInitial: true,
    depth: 0,
    ignored: (path: string) => path.includes(UNCLAIMED_DIRNAME),
  })
  let watcher: FSWatcher | undefined = next
  next.on('add', (filePath: string) => {
    const filename = filePath.split(/[\\/]/).pop() ?? filePath
    if (globalScanDeliveryBarrier.getState() !== 'running' && globalScanDeliveryBarrier.getState() !== 'idle') {
      startupBacklogPaths.add(canonicalizeScanPath(filePath))
      markStartupBacklogIdentity(filePath)
    }
    processCandidate(filePath, filename, config).catch((e) => {
      err(`scan-watcher: processCandidate threw unexpectedly for ${maskScanName(filename)}: ${axiosErrorMessage(e)}`)
    })
  })
  next.on('error', (error: unknown) => {
    err(`scan-watcher: watcher error — ${axiosErrorMessage(error)}`)
    globalScanDeliveryBarrier.noteWatcherError()
    logScanInputRestartRequired()
  })

  const runPeriodicScanSweep = async (): Promise<void> => {
    await runScanLifecycleExclusive(async () => {
      if (globalScanDeliveryBarrier.getState() === 'stopped') return
      await sweepFolder(folder, config)
    })
  }

  // 启动：quarantine-only until watcher ready + complete enum/premark/isolate.
  // Failure lockouts this process; no automatic watcher rebuild or remount recovery.
  void runScanLifecycleExclusive(async () => {
    const ready = await waitForWatcherReady(next)
    if (!ready || globalScanDeliveryBarrier.getState() === 'stopped') {
      if (globalScanDeliveryBarrier.getState() !== 'stopped') {
        globalScanDeliveryBarrier.lockOut('watcher_ready_failed')
        logScanInputRestartRequired()
      }
      return
    }
    try {
      await isolateStartupBacklog(folder)
    } catch (e) {
      globalScanDeliveryBarrier.lockOut('startup_backlog_failed')
      err(`scan-watcher: startup backlog isolation threw unexpectedly: ${sanitizedErrorCode(e, 'STARTUP_BACKLOG_FAILED')}`)
      logScanInputRestartRequired()
      return
    }
    if (globalScanDeliveryBarrier.getState() === 'initializing') {
      globalScanDeliveryBarrier.lockOut('startup_incomplete')
      logScanInputRestartRequired()
    }
  })

  const sweepTimer = setInterval(() => void runPeriodicScanSweep(), SWEEP_INTERVAL_MS)

  return {
    stop: async () => {
      globalScanDeliveryBarrier.stop()
      clearInterval(sweepTimer)
      const deadline = Date.now() + 15_000
      while (scanLifecycleActive > 0 && Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 20))
      }
      if (watcher) {
        const closing = watcher
        watcher = undefined
        await closing.close()
      }
    },
  }
}
