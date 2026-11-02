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
import type { ScanDeviceHealth } from './scan-device-health'
import type { ScanDeviceDeletionReason, ScanTempPurgeResult } from './scan-temp-dir'
import { deliverComposedRound } from './scan-device-deliver'
import {
  SCAN_PDF_COMPOSE_MARGIN_BYTES,
  type ScanDeviceRuntimeDeps,
  type ScanDeviceView,
} from './scan-device-types'
import { SCAN_PDF_MAX_BYTES } from './scan-pdf-compose'
import type { WiaScanHandle, WiaScannedPage } from './wia-runner'
import type { ScanDeviceErrorCode, WiaColor, WiaSource } from './wia-script'

const PAGE_BUDGET_BYTES = SCAN_PDF_MAX_BYTES - SCAN_PDF_COMPOSE_MARGIN_BYTES

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
  note(state: string, code?: string | null): void
  sendReport(body: DeviceReportBody): Promise<ReportOutcome>
  enqueueReport(body: DeviceReportBody): Promise<ReportOutcome>
  flushReports(): Promise<void>
  track(work: Promise<void>): void
  getGeneration(): number
  setGeneration(next: number): void
}

function viewOf(session: RoundSession | undefined): ScanDeviceView {
  if (!session || session.phase === 'idle') return { state: 'ready', pageCount: 0, errorCode: null }
  return { state: session.phase, pageCount: session.pageCount, errorCode: session.errorCode }
}

export interface RoundDriver {
  fail(code: ScanDeviceErrorCode): Promise<ScanDeviceView>
  finishStop(): ScanDeviceView
  finishAbort(): Promise<ScanDeviceView>
  runBatch(lock: DeviceLockHandle, batchPages: number, startIndex: number, current: number): Promise<void>
  composeAndDeliver(current: number): Promise<ScanDeviceView>
  acquire(taskId: string): Promise<DeviceLockHandle | undefined>
  begin(lease: DeviceLease): Promise<ScanDeviceView>
}

export function createRoundDriver(host: RoundHost): RoundDriver {
  const session = (): RoundSession | undefined => host.state.session

  const fail = async (code: ScanDeviceErrorCode): Promise<ScanDeviceView> => {
    const current = session()
    if (!current) return { state: 'error', pageCount: 0, errorCode: code }
    current.phase = 'error'
    current.errorCode = code
    host.note('error', code)
    host.purge(current.taskId, 'SCAN_DEVICE_FAILED')
    if (!current.stopCode && !current.unauthorized) {
      await host.sendReport({ state: 'error', pageCount: current.pageCount, errorCode: code })
    }
    return viewOf(current)
  }

  const finishStop = (): ScanDeviceView => {
    const current = session()
    if (!current) return { state: 'aborted', pageCount: 0, errorCode: null }
    const reason: ScanDeviceDeletionReason = isSwitchedToPanelCode(current.stopCode ?? '')
      ? 'SCAN_DEVICE_SWITCHED_TO_PANEL'
      : 'SCAN_DEVICE_SESSION_CLEARED'
    host.purge(current.taskId, reason)
    current.phase = 'aborted'
    current.errorCode = null
    host.note('aborted', current.stopCode)
    return viewOf(current)
  }

  const finishAbort = async (): Promise<ScanDeviceView> => {
    const current = session()
    if (!current) return { state: 'aborted', pageCount: 0, errorCode: null }
    host.purge(current.taskId, 'SCAN_DEVICE_ABORTED')
    current.phase = 'aborted'
    current.errorCode = null
    host.note('aborted')
    if (!current.stopCode && !current.unauthorized) {
      await host.sendReport({ state: 'aborted', pageCount: current.pageCount })
    }
    return viewOf(current)
  }

  const onPage = (page: WiaScannedPage, box: { scan?: WiaScanHandle }): Promise<void> => {
    const current = session()
    if (!current || current.tooLarge || current.stopCode || current.abortRequested) return Promise.resolve()
    current.pageCount = Math.max(current.pageCount, page.index)
    current.bytes += page.bytes
    current.pages.push(page)
    if (current.bytes > PAGE_BUDGET_BYTES) {
      current.tooLarge = true
      box.scan?.abort()
      current.handle?.abort()
      host.note('error', 'too_large')
      return Promise.resolve()
    }
    return host.enqueueReport({ state: 'scanning', pageCount: current.pageCount }).then(() => undefined)
  }

  const composeAndDeliver = (currentGen: number): Promise<ScanDeviceView> =>
    deliverComposedRound(host, currentGen, { fail, finishStop, finishAbort, viewOf })

  const settle = async (currentGen: number): Promise<void> => {
    await host.flushReports()
    const current = session()
    if (!current || current.generation !== currentGen) return
    if (current.unauthorized) {
      host.purge(current.taskId, 'SCAN_DEVICE_FAILED')
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
    current.pages = result.pages.slice()
    if (current.source === 'flatbed') {
      current.phase = 'page_ready'
      current.errorCode = null
      host.note('page_ready')
      const reported = await host.sendReport({ state: 'page_ready', pageCount: current.pageCount })
      if (reported === 'stop') finishStop()
      else if (reported === 'dead') {
        host.purge(current.taskId, 'SCAN_DEVICE_FAILED')
        current.phase = 'error'
        current.errorCode = 'unknown'
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

  const begin = async (lease: DeviceLease): Promise<ScanDeviceView> => {
    if (host.health.hasForceKilled()) {
      const probed = await host.health.probe()
      if (probed.health !== 'ready') {
        const code: ScanDeviceErrorCode = probed.health === 'busy' ? 'busy' : 'not_ready'
        host.state.session = {
          taskId: lease.scanTaskId,
          phase: 'error',
          pageCount: 0,
          errorCode: code,
          source: lease.device.source,
          color: lease.device.colorMode,
          pages: [],
          bytes: 0,
          outDir: '',
          unauthorized: false,
          tooLarge: false,
          abortRequested: false,
          generation: host.getGeneration(),
        }
        host.note('error', code)
        await host.sendReport({ state: 'error', pageCount: 0, errorCode: code })
        return viewOf(host.state.session)
      }
      host.health.clearForceKilled()
    }
    const taskId = lease.scanTaskId
    const cleared = host.purge(taskId, 'SCAN_DEVICE_SESSION_CLEARED')
    if (cleared.status === 'failed') return { state: 'error', pageCount: 0, errorCode: 'unknown' }
    const outDir = host.deps.createDir(taskId, host.root ? { root: host.root } : {})
    const currentGen = host.getGeneration() + 1
    host.setGeneration(currentGen)
    host.state.session = {
      taskId,
      phase: 'scanning',
      pageCount: 0,
      errorCode: null,
      source: lease.device.source,
      color: lease.device.colorMode,
      pages: [],
      bytes: 0,
      outDir,
      unauthorized: false,
      tooLarge: false,
      abortRequested: false,
      generation: currentGen,
    }
    const lock = await acquire(taskId)
    const current = session()
    if (!current) return { state: 'error', pageCount: 0, errorCode: 'unknown' }
    if (!lock) return fail('busy')
    if (current.generation !== currentGen) {
      lock.release()
      return viewOf(current)
    }
    const reported = await host.sendReport({ state: 'scanning', pageCount: current.pageCount })
    if (reported !== 'go') {
      lock.release()
      if (reported === 'stop') return finishStop()
      host.purge(current.taskId, 'SCAN_DEVICE_FAILED')
      current.phase = 'error'
      current.errorCode = 'unknown'
      return viewOf(current)
    }
    const batchPages = lease.device.source === 'feeder' ? host.maxPages : 1
    host.track(runBatch(lock, batchPages, current.pageCount + 1, currentGen))
    host.note('scanning')
    return viewOf(current)
  }

  return { fail, finishStop, finishAbort, runBatch, composeAndDeliver, acquire, begin }
}
