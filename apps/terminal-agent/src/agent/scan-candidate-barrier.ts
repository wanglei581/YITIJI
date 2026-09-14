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

/** Per-file quarantine: capture lineage belongs to a different waiting task. Not a process lockout. */
export const SCAN_CAPTURE_FOREIGN_LEASE = 'SCAN_CAPTURE_FOREIGN_LEASE'
/** Per-file quarantine: lease notBefore cannot be parsed, so newness cannot be proved. */
export const SCAN_LEASE_NOT_BEFORE_INVALID = 'SCAN_LEASE_NOT_BEFORE_INVALID'

export function captureNameStem(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim().toLowerCase()
  return stem.length > 0 ? stem : base.toLowerCase()
}

export interface ScanCaptureFileIdentity {
  dev: number
  ino: number
  /** Proven create generation. 0/missing cannot prove a recycled inode is new. */
  birthtimeMs?: number
}

interface ScanCaptureObservation {
  firstSeenMs: number
  seenUnderTaskId: string | null
  identity?: ScanCaptureFileIdentity
}

export function isSameScanCaptureFile(
  a: ScanCaptureFileIdentity | undefined,
  b: ScanCaptureFileIdentity | undefined,
): boolean | 'unknown' {
  if (!a || !b) return 'unknown'
  if (a.dev !== b.dev || a.ino !== b.ino) return false
  // ATOMIC_SCAN_CAPTURE_INODE_GENERATION: Linux may recycle the inode number
  // after unlink. Proven-different birthtime is a new directory entry, not a
  // rename of the same capture. Missing/zero birthtime cannot prove a new
  // generation — fail-closed to same capture so a rename cannot bind to B.
  const aBirth = a.birthtimeMs
  const bBirth = b.birthtimeMs
  if (
    aBirth !== undefined
    && bBirth !== undefined
    && Number.isFinite(aBirth)
    && Number.isFinite(bBirth)
    && aBirth > 0
    && bBirth > 0
    && aBirth !== bBirth
  ) {
    return false
  }
  return true
}

/** Flight key only. Rename and recycled inodes share this lock. Leftover and successor matching must use isSameScanCaptureFile. */
export function scanCaptureIdentityKey(identity: ScanCaptureFileIdentity): string {
  return `${identity.dev}:${identity.ino}`
}

export interface ScanCaptureIdentityFlight {
  previous: Promise<void> | undefined
  release: () => void
}

interface ScanCaptureIdentityFlightEntry {
  done: Promise<void>
  resolve: () => void
}

const scanCaptureIdentityFlights = new Map<string, ScanCaptureIdentityFlightEntry>()
let scanCaptureIdentityFlightClaims = 0
/** Reserved flight key so ino===0 / missing identity cannot bypass via concurrent path keys. */
const UNPROVABLE_SCAN_CAPTURE_FLIGHT_KEY = '__unprovable__'
let scanCaptureIdentityInoForTest: number | undefined

/**
 * Test-only: force scanCaptureFileIdentity to treat every lstat as this ino.
 * `0` reproduces Windows/SMB unprovable identity. `undefined` restores real ino.
 */
export function setScanCaptureIdentityInoForTest(ino: number | undefined): void {
  scanCaptureIdentityInoForTest = ino
}

/** Non-zero ino is a real directory-entry id; 0/missing cannot prove sameness. */
export function scanCaptureFileIdentity(
  dev: number,
  ino: number,
  birthtimeMs?: number,
): ScanCaptureFileIdentity | undefined {
  const effectiveIno = scanCaptureIdentityInoForTest !== undefined ? scanCaptureIdentityInoForTest : ino
  if (!Number.isFinite(dev) || !Number.isFinite(effectiveIno) || effectiveIno === 0) return undefined
  if (birthtimeMs === undefined || !Number.isFinite(birthtimeMs) || birthtimeMs <= 0) {
    return { dev, ino: effectiveIno }
  }
  return { dev, ino: effectiveIno, birthtimeMs }
}

/**
 * Single-flight for a directory entry. Callers must invoke this synchronously
 * after lstat and before any lease await so a same-inode rename cannot bind a
 * later task while the opening observation is in flight.
 * Unprovable identity (ino === 0 / missing) cannot prove sameness, so it takes
 * a reserved flight key: concurrent path keys must not bypass the flight.
 * processCandidate must still lock out and refuse delivery for that capture.
 */
export function beginScanCaptureIdentityFlight(
  identity: ScanCaptureFileIdentity | undefined,
): ScanCaptureIdentityFlight {
  if (!identity) {
    // ATOMIC_SCAN_CAPTURE_UNPROVABLE_IDENTITY_FLIGHT: ino===0/missing cannot
    // prove sameness, but concurrent path keys must still single-flight.
    scanCaptureIdentityFlightClaims += 1
    const key = UNPROVABLE_SCAN_CAPTURE_FLIGHT_KEY
    const previous = scanCaptureIdentityFlights.get(key)?.done
    let released = false
    let resolve!: () => void
    const done = new Promise<void>((r) => { resolve = r })
    scanCaptureIdentityFlights.set(key, { done, resolve })
    return {
      previous,
      release() {
        if (released) return
        released = true
        resolve()
        if (scanCaptureIdentityFlights.get(key)?.done === done) {
          scanCaptureIdentityFlights.delete(key)
        }
      },
    }
  }
  scanCaptureIdentityFlightClaims += 1
  // ATOMIC_SCAN_CAPTURE_IDENTITY_FLIGHT: proven dev/ino is owned before any
  // lease await. A missing identity cannot take a lock.
  const key = scanCaptureIdentityKey(identity)
  const previous = scanCaptureIdentityFlights.get(key)?.done
  let released = false
  let resolve!: () => void
  const done = new Promise<void>((r) => { resolve = r })
  scanCaptureIdentityFlights.set(key, { done, resolve })
  return {
    previous,
    release() {
      if (released) return
      released = true
      resolve()
      if (scanCaptureIdentityFlights.get(key)?.done === done) {
        scanCaptureIdentityFlights.delete(key)
      }
    },
  }
}

export function getScanCaptureIdentityFlightClaimCountForTest(): number {
  return scanCaptureIdentityFlightClaims
}

export function resetScanCaptureIdentityFlightsForTest(): void {
  for (const entry of scanCaptureIdentityFlights.values()) entry.resolve()
  scanCaptureIdentityFlights.clear()
  scanCaptureIdentityFlightClaims = 0
  scanCaptureIdentityInoForTest = undefined
}

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
 *    - 捕获血缘按本次 process 的 opening scanTaskId 绑定，不把 mtime 当用户身份，也不用
 *      模块级“最近租约”。同一目录项（rename，dev/ino 相同且 birthtime 未证明不同）
 *      跨 basename/stem 继承（job.pdf.tmp → job.pdf）；仅当 inode 无法证明时，
 *      同 stem 才 fail-closed 继承。隔离/删除后该条目关闭，文件名复用、不同 inode、
 *      或同 inode 但可证明的新 birthtime（内核复用）都不会继承已关闭捕获。
 *      notBefore 无法解析则 fail-closed。
 *    - 若 Agent 从未见过 A 期间的任何目录项（原子 create/rename 在 B 下才首次可见），被动
 *      SMB 无法证明归属；该物理歧义留给 Windows/奔图验收，不得声称完美归因。
 *    - 投递请求必须在 multipart 中携带 scanTaskId、短期 deliveryLease 和 candidateSnapshotAt。
 *    - 误隔离的恢复路径：新的面板扫描产生新文件，或服务端签名安全重扫（retryOfScanTaskId +
 *      prior controlToken）投递一份新捕获，而不是把磁盘上这份字节绑到后一用户。
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
  // Unparsable notBefore cannot prove the file is newer than the waiting task.
  if (!Number.isFinite(leaseNotBeforeMs)) return true
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
  private readonly observations = new Map<string, ScanCaptureObservation>()

  /**
   * First sight of this exact basename. `taskId` must be the lease observed for
   * this file (or null if that fetch found no waiting task). There is no ambient
   * "last lease" default — callers pass the value they just fetched.
   * A later directory entry that reuses the name with a different dev/ino replaces
   * the closed observation; same entry keeps first sight.
   */
  recordObservation(
    filename: string,
    nowMs: number,
    taskId: string | null,
    identity?: ScanCaptureFileIdentity,
  ): void {
    const existing = this.observations.get(filename)
    if (existing && isSameScanCaptureFile(existing.identity, identity) !== false) return
    this.observations.set(filename, { firstSeenMs: nowMs, seenUnderTaskId: taskId, identity })
  }

  remove(filename: string): void {
    this.observations.delete(filename)
  }

  clear(): void {
    this.observations.clear()
  }

  /**
   * Drop observations whose names are gone and that have no live successor.
   * A vanished name is kept only so a live same-inode rename (any stem) or a
   * same-stem successor can adopt it. Isolation/delete with no successor drops
   * the capture so a later different inode is not poisoned.
   */
  retainLiveEntries(
    liveNames: ReadonlySet<string>,
    identityOf?: (name: string) => ScanCaptureFileIdentity | undefined,
  ): void {
    const liveStems = new Set<string>()
    for (const name of liveNames) liveStems.add(captureNameStem(name))
    const liveIdentities: ScanCaptureFileIdentity[] = []
    let liveIdentitiesComplete = !identityOf
    if (identityOf) {
      liveIdentitiesComplete = true
      for (const name of liveNames) {
        const identity = identityOf(name)
        if (!identity) {
          liveIdentitiesComplete = false
          continue
        }
        liveIdentities.push(identity)
      }
    }
    for (const [name, rec] of [...this.observations]) {
      if (liveNames.has(name)) continue
      if (liveStems.has(captureNameStem(name))) continue
      if (
        rec.identity
        && liveIdentities.some((id) => isSameScanCaptureFile(rec.identity, id) === true)
      ) continue
      if (rec.identity && !liveIdentitiesComplete) continue
      this.observations.delete(name)
    }
  }

  /**
   * Bind this basename to an explicit opening task, after absorbing vanished
   * predecessors that are the same directory entry (temp → pdf rename, any stem).
   * First sight / inherited same-inode predecessor wins; a later B fetch cannot
   * overwrite A. Proven-different inodes are not inherited.
   */
  bindCapture(
    filename: string,
    nowMs: number,
    taskId: string | null,
    liveNames: ReadonlySet<string>,
    identity?: ScanCaptureFileIdentity,
    identityOf?: (name: string) => ScanCaptureFileIdentity | undefined,
  ): void {
    const live = new Set(liveNames)
    live.add(filename)
    this.adoptVanishedPredecessors(filename, live, identity)
    this.recordObservation(filename, nowMs, taskId, identity)
    this.retainLiveEntries(live, identityOf ?? (name => (name === filename ? identity : undefined)))
  }

  private adoptVanishedPredecessors(
    filename: string,
    liveNames: ReadonlySet<string>,
    identity?: ScanCaptureFileIdentity,
  ): void {
    const stem = captureNameStem(filename)
    let inherited: ScanCaptureObservation | undefined
    for (const [name, rec] of [...this.observations]) {
      if (name === filename) continue
      if (liveNames.has(name)) continue
      const sameEntry = isSameScanCaptureFile(rec.identity, identity)
      // ATOMIC_SCAN_CAPTURE_INODE_LINEAGE: a vanished directory entry is the
      // same capture when dev/ino match, even if the basename stem changed
      // (job.pdf.tmp -> job.pdf). Stem-only matching cannot prove sameness.
      if (sameEntry === true) {
        this.observations.delete(name)
        if (!inherited || rec.firstSeenMs < inherited.firstSeenMs) inherited = rec
        continue
      }
      if (sameEntry === false) {
        if (captureNameStem(name) === stem) this.observations.delete(name)
        continue
      }
      if (captureNameStem(name) !== stem) continue
      this.observations.delete(name)
      if (!inherited || rec.firstSeenMs < inherited.firstSeenMs) inherited = rec
    }
    if (inherited && !this.observations.has(filename)) {
      this.observations.set(filename, {
        firstSeenMs: inherited.firstSeenMs,
        seenUnderTaskId: inherited.seenUnderTaskId,
        identity: identity ?? inherited.identity,
      })
    }
  }

  /**
   * Original path is gone. Move this observation onto a live name only when
   * that name is the same directory entry (dev/ino), regardless of stem.
   * Otherwise drop it so a later reuse is not poisoned. Does nothing when
   * the name was already closed.
   */
  closeVanishedCapture(
    filename: string,
    liveNames: ReadonlySet<string>,
    identityOf: (name: string) => ScanCaptureFileIdentity | undefined,
  ): string | undefined {
    const rec = this.observations.get(filename)
    if (!rec) return undefined
    let successor: string | undefined
    let successorId: ScanCaptureFileIdentity | undefined
    for (const name of liveNames) {
      if (name === filename) continue
      const id = identityOf(name)
      if (isSameScanCaptureFile(rec.identity, id) !== true) continue
      successor = name
      successorId = id
      break
    }
    this.observations.delete(filename)
    if (!successor) return undefined
    const existing = this.observations.get(successor)
    if (!existing || rec.firstSeenMs <= existing.firstSeenMs) {
      this.observations.set(successor, {
        firstSeenMs: rec.firstSeenMs,
        seenUnderTaskId: rec.seenUnderTaskId,
        identity: successorId ?? rec.identity,
      })
    }
    return successor
  }

  isPreExisting(
    filename: string,
    leaseNotBeforeMs: number,
    toleranceMs: number = SCAN_PRE_EXISTING_TOLERANCE_MS,
  ): boolean {
    if (!Number.isFinite(leaseNotBeforeMs)) return true
    const observedMs = this.observations.get(filename)?.firstSeenMs
    if (observedMs === undefined) return false
    return observedMs < leaseNotBeforeMs - toleranceMs
  }

  /**
   * True when this name, or a still-live same-stem sibling, was first seen
   * under a different waiting scanTaskId, or was explicitly observed while no
   * waiting lease existed (`seenUnderTaskId === null`). A missing record is
   * never-observed and is not foreign. Vanished same-inode predecessors must
   * already have been adopted by `bindCapture`; this check does not consult a
   * module-global last task.
   */
  isForeignToLease(
    filename: string,
    currentTaskId: string,
    liveNames: ReadonlySet<string>,
  ): boolean {
    const current = currentTaskId.trim()
    if (current.length === 0) return false
    const rec = this.observations.get(filename)
    // ATOMIC_SCAN_CAPTURE_NULL_OPENING: explicit observation under no waiting
    // lease (seenUnderTaskId === null) is foreign to every later lease. A missing
    // record is never-observed and is not foreign. Truthy-only checks would let
    // a job.pdf.tmp seen with no lease rename onto B within the 5s window.
    if (rec && rec.seenUnderTaskId !== current) return true
    for (const [name, other] of this.observations) {
      if (name === filename) continue
      if (!liveNames.has(name)) continue
      if (captureNameStem(name) !== captureNameStem(filename)) continue
      if (other.seenUnderTaskId !== current) return true
    }
    return false
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
