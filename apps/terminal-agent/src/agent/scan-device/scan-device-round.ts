/**
 * agent/scan-device/scan-device-round.ts — 一场屏上扫描的拿锁、逐页、合成与投递
 *
 * 调度器（scan-device-runner.ts）负责本机命令和租约核对。这里只跑已经决定要扫的那一轮。
 */

import {
  DEVICE_LOCK_DEFAULT_TIMEOUT_MS,
  DeviceLockTimeoutError,
  type DeviceLockHandle,
} from '../device-lock'
import type { DeviceLease, DeviceReportBody } from './scan-device-backend'
import { isSwitchedToPanelCode } from './scan-device-backend'
import { scanDeviceStartHealth, type ScanDeviceHealth } from './scan-device-health'
import type { CleanupMeta } from './scan-device-housekeeping'
import type { ScanDeviceDeletionReason, ScanTempPurgeResult } from './scan-temp-dir'
import { deliverComposedRound } from './scan-device-deliver'
import {
  LocalScanError,
  resolveScanDeviceLimits,
  type ScanDeviceRuntimeDeps,
  type ScanDeviceView,
} from './scan-device-types'
import type { WiaScanHandle, WiaScannedPage } from './wia-runner'
import type { ScanDeviceErrorCode, WiaColor, WiaSource } from './wia-script'

export interface RoundSession {
  taskId: string
  phase: 'scanning' | 'page_ready' | 'composing' | 'delivering' | 'error' | 'aborted' | 'idle'
  pageCount: number
  errorCode: ScanDeviceErrorCode | null
  source: WiaSource
  color: WiaColor
  pages: WiaScannedPage[]
  bytes: number
  outDir: string
  handle?: WiaScanHandle
  stopCode?: string
  unauthorized: boolean
  tooLarge: boolean
  abortRequested: boolean
  generation: number
  pageCap: number
  byteBudget: number
  purgeSettled: boolean
  purged: boolean
  delivered: boolean
  awaitingLock: boolean
  /** 已经接过一次下一页，还没开扫或还在等锁。再点一次直接回当前状态。 */
  nextAccepted: boolean
  /** 这一次下一页预定的页号。拿到锁之后对不上就不开扫。 */
  reservedIndex: number
  stopUnconfirmed: boolean
  suspectPid?: number
  reportUnsyncable: boolean
  /** 上传已经分清，或还悬着。不确定时不能报已中止或已投递。 */
  deliveryOutcome?: 'received' | 'rejected' | 'uncertain'
  /** scanning 回报被收下时记下的轮次。页和 PDF 都属于这一轮，换了就作废。 */
  deviceRound?: number
  /** 投递结果重查的绝对截止。有 hardExpiresAt 用它，否则用租约 expiresAt。 */
  confirmUntil?: number
  deadlineIsHard?: boolean
  /** 同一份 PDF，等着不确定时重投。 */
  pendingUpload?: import('./scan-device-types').ScanDeviceDeliveryInput
  lastResult?: import('./wia-runner').WiaScanResult
}

export interface RoundState {
  session?: RoundSession
}

export type ReportOutcome = 'go' | 'stop' | 'dead'

export interface RoundHost {
  state: RoundState
  deps: ScanDeviceRuntimeDeps
  maxPages: number
  root?: string
  deviceName: string
  health: ScanDeviceHealth
  purge(taskId: string, reason: ScanDeviceDeletionReason): ScanTempPurgeResult
  commitPurge(taskId: string, reason: ScanDeviceDeletionReason): boolean
  scheduleCleanup(taskId: string, reason: ScanDeviceDeletionReason, meta?: CleanupMeta): void
  revokeCleanup(taskId: string): void
  note(state: string, code?: string | null): void
  /** 正在等这场中止收尾的请求，在这里拿到最终视图。 */
  releaseAbort(view: ScanDeviceView): ScanDeviceView
  sendReport(body: DeviceReportBody): Promise<ReportOutcome>
  enqueueReport(body: DeviceReportBody): Promise<ReportOutcome>
  flushReports(): Promise<void>
  track(work: Promise<void>): void
  getGeneration(): number
  setGeneration(next: number): void
  armIdle(generation: number): void
  disarmIdle(): void
  resetReportCursor(): void
  /** 这一场是不是在取租约之前就被取消了。 */
  startCancelled(taskId: string): boolean
  /** 取租约之前占下的场次。没有就由准备阶段自己加一。 */
  reservedGeneration(taskId: string): number | undefined
  clearStartTicket(): void
  /** 投递结果还不确定时，按固定间隔再探，到截止为止。 */
  scheduleDeliveryRecheck(generation: number): void
  clearDeliveryRecheck(): void
}

export function roundView(session: RoundSession | undefined): ScanDeviceView {
  if (!session || session.phase === 'idle') return { state: 'ready', pageCount: 0, errorCode: null }
  const view: ScanDeviceView = { state: session.phase, pageCount: session.pageCount, errorCode: session.errorCode }
  if (session.purgeSettled) view.purged = session.purged
  return view
}

export interface RoundDriver {
  fail(code: ScanDeviceErrorCode): Promise<ScanDeviceView>
  finishStop(): ScanDeviceView
  finishAbort(): Promise<ScanDeviceView>
  runBatch(lock: DeviceLockHandle, batchPages: number, startIndex: number, current: number): Promise<void>
  composeAndDeliver(current: number): Promise<ScanDeviceView>
  acquire(taskId: string): Promise<DeviceLockHandle | undefined>
  prepare(lease: DeviceLease): Promise<{ ok: true; generation: number } | { ok: false; view: ScanDeviceView }>
  launch(generation: number, lock: DeviceLockHandle | undefined): Promise<ScanDeviceView>
}

export function createRoundDriver(host: RoundHost): RoundDriver {
  const session = (): RoundSession | undefined => host.state.session
  const viewOf = roundView

  const fresh = (
    fields: Pick<RoundSession, 'taskId' | 'phase' | 'source' | 'color' | 'generation'> & Partial<RoundSession>,
  ): RoundSession => ({
    pageCount: 0,
    errorCode: fields.phase === 'error' ? fields.errorCode ?? 'unknown' : null,
    pages: [],
    bytes: 0,
    outDir: '',
    unauthorized: false,
    tooLarge: false,
    abortRequested: false,
    pageCap: host.maxPages,
    byteBudget: resolveScanDeviceLimits(host.maxPages, undefined).byteBudget,
    purgeSettled: false,
    purged: false,
    delivered: false,
    awaitingLock: false,
    nextAccepted: false,
    reservedIndex: 0,
    stopUnconfirmed: false,
    reportUnsyncable: false,
    ...fields,
  })

  const fail = async (code: ScanDeviceErrorCode): Promise<ScanDeviceView> => {
    host.disarmIdle()
    const current = session()
    if (!current) return host.releaseAbort({ state: 'error', pageCount: 0, errorCode: code })
    current.phase = 'error'
    current.errorCode = code
    current.nextAccepted = false
    current.awaitingLock = false
    host.note('error', code)
    host.commitPurge(current.taskId, 'SCAN_DEVICE_FAILED')
    if (!current.stopCode && !current.unauthorized) {
      await host.sendReport({ state: 'error', pageCount: current.pageCount, errorCode: code })
    }
    return host.releaseAbort(viewOf(current))
  }

  const finishStop = (): ScanDeviceView => {
    host.disarmIdle()
    const current = session()
    if (!current) return host.releaseAbort({ state: 'aborted', pageCount: 0, errorCode: null, purged: false })
    if (current.delivered) {
      return host.releaseAbort({ state: 'delivering', pageCount: current.pageCount, errorCode: null, purged: current.purged })
    }
    if (current.phase === 'aborted' && current.purgeSettled) return host.releaseAbort(viewOf(current))
    const reason: ScanDeviceDeletionReason = isSwitchedToPanelCode(current.stopCode ?? '')
      ? 'SCAN_DEVICE_SWITCHED_TO_PANEL'
      : 'SCAN_DEVICE_SESSION_CLEARED'
    host.commitPurge(current.taskId, reason)
    current.phase = 'aborted'
    current.errorCode = null
    current.nextAccepted = false
    current.awaitingLock = false
    host.note('aborted', current.stopCode)
    return host.releaseAbort(viewOf(current))
  }

  const finishAbort = async (): Promise<ScanDeviceView> => {
    host.disarmIdle()
    const current = session()
    if (!current) return host.releaseAbort({ state: 'aborted', pageCount: 0, errorCode: null, purged: false })
    if (current.delivered || current.deliveryOutcome === 'received') {
      return host.releaseAbort({
        state: 'delivering',
        pageCount: current.pageCount,
        errorCode: null,
        ...(current.purgeSettled ? { purged: current.purged } : {}),
      })
    }
    if (current.deliveryOutcome === 'uncertain') {
      throw new LocalScanError(
        409,
        'LOCAL_SCAN_DELIVERY_UNCONFIRMED',
        { state: 'delivering', pageCount: current.pageCount, errorCode: null },
        '投递结果不确定',
      )
    }
    if (current.phase === 'aborted' && current.purgeSettled) return host.releaseAbort(viewOf(current))
    host.commitPurge(current.taskId, 'SCAN_DEVICE_ABORTED')
    current.phase = 'aborted'
    current.errorCode = null
    current.nextAccepted = false
    current.awaitingLock = false
    host.note('aborted')
    if (!current.stopCode && !current.unauthorized) {
      await host.sendReport({ state: 'aborted', pageCount: current.pageCount })
    }
    return host.releaseAbort(viewOf(current))
  }

  const mergePages = (current: RoundSession, batch: readonly WiaScannedPage[]): void => {
    const byIndex = new Map(current.pages.map((page) => [page.index, page]))
    for (const page of batch) byIndex.set(page.index, page)
    current.pages = [...byIndex.values()].sort((left, right) => left.index - right.index)
  }

  const onPage = (page: WiaScannedPage, box: { scan?: WiaScanHandle }): Promise<void> => {
    const current = session()
    if (!current || current.tooLarge || current.stopCode || current.abortRequested) return Promise.resolve()
    current.pageCount = Math.max(current.pageCount, page.index)
    current.bytes += page.bytes
    current.pages.push(page)
    if (current.bytes > current.byteBudget) {
      current.tooLarge = true
      box.scan?.abort()
      current.handle?.abort()
      host.note('error', 'too_large')
      return Promise.resolve()
    }
    return host.enqueueReport({ state: 'scanning', pageCount: current.pageCount }).then((outcome) => {
      if (outcome === 'dead') current.reportUnsyncable = true
    })
  }

  const composeAndDeliver = (currentGen: number): Promise<ScanDeviceView> =>
    deliverComposedRound(host, currentGen, { fail, finishStop, finishAbort, viewOf })

  const settle = async (currentGen: number): Promise<void> => {
    await host.flushReports()
    const current = session()
    if (!current || current.generation !== currentGen) return
    if (current.reportUnsyncable) {
      await fail('unknown')
      return
    }
    if (current.unauthorized) {
      host.commitPurge(current.taskId, 'SCAN_DEVICE_FAILED')
      current.phase = 'error'
      current.errorCode = 'unknown'
      return
    }
    if (current.stopCode) {
      finishStop()
      return
    }
    if (current.abortRequested) {
      await finishAbort()
      return
    }
    if (current.tooLarge) {
      await fail('too_large')
      return
    }
    const result = current.lastResult
    if (result && (result.endedBy === 'canceled' || result.endedBy === 'aborted')) {
      if (current.tooLarge) {
        await fail('too_large')
        return
      }
      await finishAbort()
      return
    }
    if (!result || !result.ok || result.pages.length === 0) {
      let code: ScanDeviceErrorCode = result?.errorCode ?? 'unknown'
      if (code === 'warming_up') code = 'not_ready'
      if (current.source === 'feeder' && current.pageCount === 0 && (code === 'unknown' || code === 'feeder_empty')) {
        code = 'feeder_empty'
      }
      await fail(code)
      return
    }
    mergePages(current, result.pages)
    if (current.source === 'flatbed') {
      current.phase = 'page_ready'
      current.errorCode = null
      host.note('page_ready')
      const reported = await host.sendReport({ state: 'page_ready', pageCount: current.pageCount })
      if (current.generation !== currentGen) return
      if (current.abortRequested) {
        await finishAbort()
        return
      }
      if (current.stopCode) {
        finishStop()
        return
      }
      if (reported === 'stop') finishStop()
      else if (reported === 'dead') {
        host.commitPurge(current.taskId, 'SCAN_DEVICE_FAILED')
        current.phase = 'error'
        current.errorCode = 'unknown'
      } else if (current.phase === 'page_ready') {
        host.armIdle(current.generation)
      }
      return
    }
    await composeAndDeliver(currentGen)
  }

  const runBatch = async (
    lock: DeviceLockHandle,
    batchPages: number,
    startIndex: number,
    currentGen: number,
  ): Promise<void> => {
    const box: { scan?: WiaScanHandle } = {}
    try {
      const current = session()
      if (!current || current.generation !== currentGen) return
      if (current.abortRequested || current.stopCode) return
      const scan = host.deps.startScan({
        deviceName: host.deviceName || undefined,
        source: current.source,
        color: current.color,
        maxPages: batchPages,
        startIndex,
        outDir: current.outDir,
        onPage: (page) => onPage(page, box),
      })
      box.scan = scan
      current.handle = scan
      if (current.tooLarge || current.abortRequested || current.stopCode) scan.abort()
      current.lastResult = await scan.result
      if (current.lastResult.forceKilled) host.health.noteForceKilled()
      if (current.lastResult.stopUnconfirmed) {
        current.stopUnconfirmed = true
        const processId = current.lastResult.processId
        if (processId !== undefined) current.suspectPid = processId
        else current.suspectPid = undefined
        host.health.noteProcessStop({
          stopUnconfirmed: true,
          ...(processId !== undefined ? { processId } : {}),
        })
      }
    } catch {
      const current = session()
      if (current && current.generation === currentGen && !current.lastResult) {
        current.lastResult = {
          ok: false,
          endedBy: 'error',
          pages: [],
          errorCode: 'unknown',
          discardedPages: 0,
          forceKilled: false,
          stopUnconfirmed: false,
          attempts: 1,
          setFailed: [],
          elapsedMs: 0,
        }
      }
    } finally {
      const current = session()
      if (current?.generation === currentGen) current.handle = undefined
      lock.release()
    }
    try {
      await settle(currentGen)
    } finally {
      await host.health.probe().catch(() => undefined)
    }
  }

  const acquire = async (taskId: string): Promise<DeviceLockHandle | undefined> => {
    try {
      return await host.deps.lock.acquire(`scan:${taskId}`, { timeoutMs: DEVICE_LOCK_DEFAULT_TIMEOUT_MS })
    } catch (error) {
      if (error instanceof DeviceLockTimeoutError) return undefined
      throw error
    }
  }

  const errorView = async (
    lease: DeviceLease,
    code: ScanDeviceErrorCode,
  ): Promise<{ ok: false; view: ScanDeviceView }> => {
    host.state.session = fresh({
      taskId: lease.scanTaskId,
      phase: 'error',
      errorCode: code,
      source: lease.device.source,
      color: lease.device.colorMode,
      generation: host.getGeneration(),
    })
    host.note('error', code)
    await host.sendReport({ state: 'error', pageCount: 0, errorCode: code })
    return { ok: false, view: viewOf(host.state.session) }
  }

  const cancelledBeforeDir = (
    lease: DeviceLease,
  ): { ok: false; view: ScanDeviceView } | undefined => {
    const existing = session()
    const cancelled = host.startCancelled(lease.scanTaskId)
      || (existing?.taskId === lease.scanTaskId && existing.abortRequested === true)
    if (!cancelled) return undefined
    host.clearStartTicket()
    const purged = host.commitPurge(lease.scanTaskId, 'SCAN_DEVICE_ABORTED')
    if (existing?.taskId === lease.scanTaskId) {
      existing.phase = 'aborted'
      existing.errorCode = null
      existing.abortRequested = true
      existing.purgeSettled = true
      existing.purged = purged
      existing.nextAccepted = false
      existing.awaitingLock = false
      return { ok: false, view: viewOf(existing) }
    }
    return { ok: false, view: { state: 'aborted', pageCount: 0, errorCode: null, purged } }
  }

  const prepare = async (
    lease: DeviceLease,
  ): Promise<{ ok: true; generation: number } | { ok: false; view: ScanDeviceView }> => {
    const stale = session()
    if (stale?.taskId === lease.scanTaskId && (stale.phase === 'aborted' || stale.phase === 'error' || stale.phase === 'idle')) {
      stale.abortRequested = false
    }
    const early = cancelledBeforeDir(lease)
    if (early) return early
    if (host.health.knownProcessAlive()) return errorView(lease, 'busy')
    if (host.health.unidentifiedSuspect() || host.health.hasForceKilled() || host.health.hasSuspect()) {
      const probed = await host.health.probe()
      const afterProbe = cancelledBeforeDir(lease)
      if (afterProbe) return afterProbe
      if (host.health.knownProcessAlive() || host.health.unidentifiedSuspect()) return errorView(lease, 'busy')
      if (probed.health !== 'ready') {
        const code: ScanDeviceErrorCode = probed.health === 'busy' ? 'busy' : 'not_ready'
        return errorView(lease, code)
      }
      host.health.clearForceKilled()
      host.health.clearSuspect()
    }
    const beforeDir = cancelledBeforeDir(lease)
    if (beforeDir) return beforeDir
    const taskId = lease.scanTaskId
    host.revokeCleanup(taskId)
    host.disarmIdle()
    host.clearDeliveryRecheck()
    const cleared = host.purge(taskId, 'SCAN_DEVICE_SESSION_CLEARED')
    if (cleared.status === 'failed') {
      host.scheduleCleanup(taskId, 'SCAN_DEVICE_SESSION_CLEARED', {
        epoch: host.getGeneration(),
        stopUnconfirmed: false,
      })
      const current = session()
      if (current?.taskId === taskId) {
        current.phase = 'error'
        current.errorCode = 'unknown'
        current.purgeSettled = true
        current.purged = false
        current.nextAccepted = false
        current.awaitingLock = false
      }
      return { ok: false, view: { state: 'error', pageCount: 0, errorCode: 'unknown', purged: false } }
    }
    const outDir = host.deps.createDir(taskId, host.root ? { root: host.root } : {})
    const afterDir = cancelledBeforeDir(lease)
    if (afterDir) return afterDir
    const limits = resolveScanDeviceLimits(host.maxPages, lease.device)
    const reserved = host.reservedGeneration(taskId)
    const currentGen = reserved ?? host.getGeneration() + 1
    if (reserved === undefined) host.setGeneration(currentGen)
    host.clearStartTicket()
    host.resetReportCursor()
    host.state.session = fresh({
      taskId,
      phase: 'scanning',
      source: lease.device.source,
      color: lease.device.colorMode,
      outDir,
      generation: currentGen,
      pageCap: limits.pageCap,
      byteBudget: limits.byteBudget,
      awaitingLock: true,
    })
    return { ok: true, generation: currentGen }
  }

  const launch = async (currentGen: number, lock: DeviceLockHandle | undefined): Promise<ScanDeviceView> => {
    const current = session()
    if (!current || current.generation !== currentGen) {
      lock?.release()
      return viewOf(current)
    }
    current.awaitingLock = false
    if (current.phase === 'aborted') {
      lock?.release()
      return viewOf(current)
    }
    if (current.abortRequested) {
      lock?.release()
      return finishAbort()
    }
    if (!lock) return fail('busy')
    const reported = await host.sendReport({ state: 'scanning', pageCount: current.pageCount })
    if (current.generation !== currentGen) {
      lock.release()
      return viewOf(session())
    }
    if (current.abortRequested) {
      lock.release()
      return finishAbort()
    }
    if (current.stopCode) {
      lock.release()
      return finishStop()
    }
    if (reported !== 'go') {
      lock.release()
      if (reported === 'stop') return finishStop()
      host.commitPurge(current.taskId, 'SCAN_DEVICE_FAILED')
      current.phase = 'error'
      current.errorCode = 'unknown'
      return viewOf(current)
    }
    const batchPages = current.source === 'feeder' ? current.pageCap : 1
    const health = await scanDeviceStartHealth(host.health, lock)
    if (current.abortRequested || current.stopCode || current.generation !== currentGen) {
      lock.release()
      if (current.abortRequested) return finishAbort()
      if (current.stopCode) return finishStop()
      return viewOf(session())
    }
    if (health !== 'ready') {
      lock.release()
      return fail(health)
    }
    host.track(runBatch(lock, batchPages, current.pageCount + 1, currentGen))
    host.note('scanning')
    return viewOf(current)
  }

  return { fail, finishStop, finishAbort, runBatch, composeAndDeliver, acquire, prepare, launch }
}
