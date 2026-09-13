import { lstatSync } from 'fs'
import { resolve } from 'path'
import type { AxiosInstance } from 'axios'
import { NO_RETRY_CONFIG } from './api-client'
import type { ScanInputLockoutReason, ScanInputRuntimeTelemetry } from './types'

export interface ScanTaskLease {
  scanTaskId: string
  serverNow: string
  notBefore: string
  expiresAt: string
  deliveryLease: string
}

export const SCAN_PRE_EXISTING_TOLERANCE_MS = 5_000

/**
 * Windows SMB 可保证边界与设计考量：
 *
 * 1. Windows SMB / NTFS 可保证边界：
 *    - 宿主机 NTFS 内核负责为共享目录中的每个新文件生成目录项、记录 birthtime（创建时间）和 mtime（最后写入时间）。
 *    - 打印机/扫描仪通过 SMB 协议分块写入文件期间，由于写锁定或连续增长，Agent 借由连续两次一致的采样快照
 *      （waitForStableFile: STABILITY_REQUIRED_CONSECUTIVE）可确定文件已完全写入落盘。
 *
 * 2. Windows SMB 无法保证的边界：
 *    - 扫描仪硬件（如富士施乐、惠普、佳能复合机）投递至 SMB 共享目录属于无状态网络文件流，
 *      硬件内部并不包含 Kiosk 当前用户的会话身份或认证 Token。
 *    - 扫描仪内嵌 RTC 时钟可能存在偏差，甚至 SMB 客户端可通过 SetFileTime 操纵时间戳。
 *    - 如果前一用户 A 取消或超时，其残留扫描件若滞留在目录中，与后一用户 B 的扫描件在文件系统层无天然隔离。
 *    - 绝不能将 Agent 处理文件时的执行时刻（new Date()）或者单纯的 mtime 视作用户身份凭据。
 *
 * 3. 租约与防线屏障（Pre-existing Barrier）：
 *    - Agent 在读取和投递候选文件前，必须向 API 服务端申请当前有效任务的短期加密租约（deliveryLease）。
 *    - 若服务端无等待任务（NO_WAITING_SCAN_TASK），候选文件立即隔离进 _unclaimed，严防残留。
 *    - 若取得租约，将候选文件的本地可信快照时间与租约生效时间（notBefore / task.createdAt）比对：
 *      任何在当前任务租约开始前已经存在的文件（mtime 或 birthtime 早于 notBefore - 5s 容差），
 *      判定为上一会话残留的旧文件，直接移入 _unclaimed 隔离，绝不投递至当前新任务中。
 *    - 投递请求必须在 multipart 中携带 scanTaskId、短期 deliveryLease 和 candidateSnapshotAt。
 */
export async function fetchScanLease(
  client: AxiosInstance,
  terminalId: string | undefined,
): Promise<ScanTaskLease | null> {
  if (!terminalId) return null
  try {
    const response = await client.get<{ success?: boolean; data?: ScanTaskLease }>(
      `/terminals/${terminalId}/scan-tasks/current-lease`,
      NO_RETRY_CONFIG as unknown as import('axios').AxiosRequestConfig,
    )
    const body = response.data as { success?: boolean; data?: ScanTaskLease } | undefined
    if (body && body.data && body.data.deliveryLease) {
      return body.data
    }
    return null
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status
    const code = (e as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code
    if (status === 409 || status === 404 || code === 'NO_WAITING_SCAN_TASK') {
      return null
    }
    throw e
  }
}

/**
 * 判定候选文件是否属于租约创建前已经存在的陈旧文件。
 */
export function isPreExistingCandidate(
  snapshot: { mtimeMs: number; birthtimeMs?: number },
  leaseNotBeforeIso: string,
  toleranceMs: number = SCAN_PRE_EXISTING_TOLERANCE_MS,
): boolean {
  const leaseNotBeforeMs = new Date(leaseNotBeforeIso).getTime()
  if (!Number.isFinite(leaseNotBeforeMs)) return false
  const barrierThresholdMs = leaseNotBeforeMs - toleranceMs

  // 1. 文件最后写入时间早于任务创建边界 -> 判定为前序任务残留
  if (snapshot.mtimeMs < barrierThresholdMs) {
    return true
  }

  // 2. NTFS 创建时间早于任务创建边界 -> 判定为前序任务残留
  if (snapshot.birthtimeMs !== undefined && Number.isFinite(snapshot.birthtimeMs) && snapshot.birthtimeMs > 0) {
    if (snapshot.birthtimeMs < barrierThresholdMs) {
      return true
    }
  }

  return false
}

/**
 * 内存目录观察基线，辅助记录文件初次被 Agent 发现的本地时间戳。
 */
export class ScanDirectoryBaseline {
  private readonly observedTimes = new Map<string, number>()

  recordObservation(filename: string, nowMs: number = Date.now()): void {
    if (!this.observedTimes.has(filename)) {
      this.observedTimes.set(filename, nowMs)
    }
  }

  remove(filename: string): void {
    this.observedTimes.delete(filename)
  }

  clear(): void {
    this.observedTimes.clear()
  }

  isPreExisting(
    filename: string,
    leaseNotBeforeMs: number,
    toleranceMs: number = SCAN_PRE_EXISTING_TOLERANCE_MS,
  ): boolean {
    const observedMs = this.observedTimes.get(filename)
    if (observedMs === undefined) return false
    return observedMs < leaseNotBeforeMs - toleranceMs
  }
}

export const globalDirectoryBaseline = new ScanDirectoryBaseline()

export const SCAN_INPUT_RESTART_REQUIRED = 'SCAN_INPUT_RESTART_REQUIRED'

export type ScanInputSessionState = 'idle' | 'initializing' | 'running' | 'locked_out' | 'stopped'

const SCAN_INPUT_LOCKOUT_REASONS = new Set<ScanInputLockoutReason>([
  'not_configured',
  'reparse_point_unverifiable',
  'reparse_point',
  'not_directory',
  'unavailable',
  'not_readable',
  'watcher_rebuild',
  'watcher_error',
  'identity_unavailable',
  'root_identity_changed',
  'readdir_failed',
  'watcher_ready_failed',
  'startup_backlog_failed',
  'startup_incomplete',
  'unknown',
])

function safeLockoutReason(reason: string): ScanInputLockoutReason {
  return SCAN_INPUT_LOCKOUT_REASONS.has(reason as ScanInputLockoutReason)
    ? reason as ScanInputLockoutReason
    : 'unknown'
}

/**
 * Canonical path identity for scan candidates. Always `path.resolve`.
 * Do not use realpath (follows links / 8.3 / file-id). Windows keys are
 * case-folded; that is not a claim that 8.3 short names or native file IDs
 * are solved.
 */
export function canonicalizeScanPath(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolved = resolve(filePath)
  if (platform === 'win32') return resolved.toLowerCase()
  return resolved
}

export interface ScanFolderIdentity {
  canonicalPath: string
  dev: number
  ino: number
}

export function readScanFolderIdentity(folder: string): ScanFolderIdentity | undefined {
  try {
    const canonicalPath = canonicalizeScanPath(folder)
    const metadata = lstatSync(canonicalPath)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return undefined
    return { canonicalPath, dev: metadata.dev, ino: metadata.ino }
  } catch {
    return undefined
  }
}

export function scanFolderIdentityChanged(
  previous: ScanFolderIdentity | undefined,
  current: ScanFolderIdentity | undefined,
): boolean {
  if (!previous || !current) return true
  if (previous.dev !== 0 || previous.ino !== 0 || current.dev !== 0 || current.ino !== 0) {
    return previous.dev !== current.dev || previous.ino !== current.ino
  }
  return previous.canonicalPath !== current.canonicalPath
}

/**
 * Conservative lockout-until-restart gate. Automatic remount recovery is not
 * implemented: a dirty scan-input session cannot return to RUNNING in-process.
 * Only stop + a new process (tests: resetForTest) may run again.
 *
 * idle: unit tests that call processCandidate without a watcher session.
 * initializing: watcher registered, quarantine-only until ready + enum.
 * running: delivery allowed for files after the startup boundary.
 * locked_out / stopped: never lease or POST.
 */
export class ScanDeliveryBarrier {
  private state: ScanInputSessionState = 'idle'
  private generation = 0
  private identity: ScanFolderIdentity | undefined
  private lockOutReason: string | undefined
  private stateObservedAt = new Date().toISOString()

  getState(): ScanInputSessionState {
    return this.state
  }

  getGeneration(): number {
    return this.generation
  }

  establishedIdentity(): ScanFolderIdentity | undefined {
    return this.identity
  }

  lockOutCode(): string | undefined {
    return this.lockOutReason
  }

  getTelemetry(): ScanInputRuntimeTelemetry {
    if (this.state === 'locked_out') {
      return {
        health: 'locked_out',
        requiredAction: 'restart_required',
        reason: safeLockoutReason(this.lockOutReason ?? 'unknown'),
        observedAt: this.stateObservedAt,
      }
    }
    if (this.state === 'running') {
      return {
        health: 'healthy',
        requiredAction: 'none',
        reason: null,
        observedAt: this.stateObservedAt,
      }
    }
    return {
      health: 'unknown',
      requiredAction: 'none',
      reason: null,
      observedAt: this.stateObservedAt,
    }
  }

  private transition(nextState: ScanInputSessionState): void {
    this.state = nextState
    this.stateObservedAt = new Date().toISOString()
  }

  isPaused(): boolean {
    return this.state !== 'idle' && this.state !== 'running'
  }

  allowsAttach(): boolean {
    return this.state === 'idle'
  }

  beginWatchSession(): boolean {
    if (this.state !== 'idle') return false
    this.generation += 1
    this.transition('initializing')
    this.identity = undefined
    this.lockOutReason = undefined
    return true
  }

  enterRunning(identity: ScanFolderIdentity): boolean {
    if (this.state !== 'initializing') return false
    this.generation += 1
    this.identity = identity
    this.transition('running')
    this.lockOutReason = undefined
    return true
  }

  lockOut(reason: string): void {
    if (this.state === 'locked_out' || this.state === 'stopped') return
    this.generation += 1
    this.transition('locked_out')
    this.lockOutReason = reason
  }

  stop(): void {
    if (this.state === 'stopped') return
    this.generation += 1
    this.transition('stopped')
    this.lockOutReason = 'stopped'
  }

  noteUnavailable(): void {
    this.lockOut('unavailable')
  }

  noteWatcherRebuild(): void {
    this.lockOut('watcher_rebuild')
  }

  noteWatcherError(): void {
    this.lockOut('watcher_error')
  }

  observeIdentityOrLockOut(current: ScanFolderIdentity | undefined): void {
    if (this.state === 'stopped' || this.state === 'locked_out') return
    if (!current) {
      this.lockOut('identity_unavailable')
      return
    }
    if (
      this.identity
      && (this.state === 'running' || this.state === 'initializing')
      && scanFolderIdentityChanged(this.identity, current)
    ) {
      this.lockOut('root_identity_changed')
    }
  }

  generationAllowsDelivery(capturedGeneration: number): boolean {
    if (this.state !== 'idle' && this.state !== 'running') return false
    return this.generation === capturedGeneration
  }

  resetForTest(): void {
    this.state = 'idle'
    this.generation = 0
    this.identity = undefined
    this.lockOutReason = undefined
    this.stateObservedAt = new Date().toISOString()
  }
}

export const globalScanDeliveryBarrier = new ScanDeliveryBarrier()
