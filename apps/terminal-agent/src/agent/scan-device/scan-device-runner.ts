/**
 * agent/scan-device/scan-device-runner.ts — 屏上扫描调度
 *
 * 一个进程同时只一场。云端只收状态回报；开始 / 下一页 / 完成 / 中止由本机路由进来。
 * 开关关着时 scanDeviceRuntimeForConfig 直接返回 undefined，不创建、不扫残留、不探测。
 * 页文件只进 A1 的私有目录。日志只有任务号、状态、错误码，没有路径和文件名。
 */

import fs from 'fs'
import { log, warn } from '../../logger'
import { createApiClient } from '../api-client'
import { globalDeviceLock } from '../device-lock'
import { buildScanDeliveryForm, postScanDeliveryForm } from '../scan-delivery'
import type { AgentConfig } from '../types'
import {
  fetchDeviceLease,
  postDeviceReport,
  type DeviceLease,
  type DeviceReportBody,
  type DeviceReportResult,
} from './scan-device-backend'
import { createScanDeviceHealth, type ScanDeviceClock, type ScanDeviceHealth } from './scan-device-health'
import { composeScanPdf } from './scan-pdf-compose'
import {
  createScanTaskDir,
  purgeScanTaskDir,
  sweepScanDeviceResidue,
  type ScanDeviceDeletionReason,
  type ScanTempPurgeResult,
} from './scan-temp-dir'
import { createRoundDriver, type RoundSession, type RoundState } from './scan-device-round'
import {
  LocalScanError,
  SCAN_DEVICE_REPORT_ATTEMPTS,
  SCAN_DEVICE_REPORT_RETRY_DELAYS_MS,
  type ScanDeviceDeliveryInput,
  type ScanDeviceRuntime,
  type ScanDeviceRuntimeDeps,
  type ScanDeviceView,
} from './scan-device-types'
import { runWiaProbe } from './wia-probe'
import { startWiaScan } from './wia-runner'

export {
  LocalScanError,
  SCAN_DEVICE_REPORT_ATTEMPTS,
  SCAN_DEVICE_REPORT_RETRY_DELAYS_MS,
  SCAN_PDF_COMPOSE_MARGIN_BYTES,
} from './scan-device-types'
export type { ScanDeviceDeliveryInput, ScanDeviceRuntime, ScanDeviceRuntimeDeps, ScanDeviceView }

const LIVE = new Set<RoundSession['phase']>(['scanning', 'page_ready', 'composing', 'delivering'])

function viewOf(session: RoundSession | undefined): ScanDeviceView {
  if (!session || session.phase === 'idle') return { state: 'ready', pageCount: 0, errorCode: null }
  return { state: session.phase, pageCount: session.pageCount, errorCode: session.errorCode }
}

let printFinishedProbe: (() => void) | undefined

/** index 在开关打开时登记。打印循环结束（锁已放）后由 task-runner 调用。 */
export function bindScanDevicePrintFinishedProbe(probe: (() => void) | undefined): void {
  printFinishedProbe = probe
}

export function notifyScanDevicePrintFinished(): void {
  printFinishedProbe?.()
}

export async function deliverScanDevicePdf(
  config: AgentConfig,
  input: ScanDeviceDeliveryInput,
): Promise<void> {
  const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)
  const form = buildScanDeliveryForm({
    bytes: input.bytes,
    filename: 'scan.pdf',
    scanTaskId: input.scanTaskId,
    deliveryLease: input.deliveryLease,
    candidateSnapshotAt: input.candidateSnapshotAt,
    origin: input.origin,
  })
  await postScanDeliveryForm(client, config.terminalId, form)
}

function systemClock(): ScanDeviceClock {
  return {
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
}

export function createScanDeviceRuntime(
  config: AgentConfig,
  overrides: Partial<ScanDeviceRuntimeDeps> = {},
): ScanDeviceRuntime {
  const maxPages = config.scanDeviceMaxPages ?? 20
  const deps: ScanDeviceRuntimeDeps = {
    startScan: startWiaScan,
    runProbe: runWiaProbe,
    compose: composeScanPdf,
    deliver: (input) => deliverScanDevicePdf(config, input),
    fetchLease: (now) => {
      const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)
      return fetchDeviceLease(client, config.terminalId, now)
    },
    report: (taskId, body) => {
      const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)
      return postDeviceReport(client, config.terminalId, taskId, body)
    },
    purge: purgeScanTaskDir,
    sweep: sweepScanDeviceResidue,
    createDir: createScanTaskDir,
    readFile: (file) => fs.promises.readFile(file),
    clock: systemClock(),
    lock: globalDeviceLock,
    reportDelaysMs: SCAN_DEVICE_REPORT_RETRY_DELAYS_MS,
    ...overrides,
  }
  const root = deps.root
  const state: RoundState = {}
  let generation = 0
  let inflight = 0
  let tail: Promise<void> = Promise.resolve()
  let gate: Promise<void> = Promise.resolve()
  let reportChain: Promise<void> = Promise.resolve()
  let armed = false

  const health: ScanDeviceHealth = createScanDeviceHealth({
    clock: deps.clock,
    lock: deps.lock,
    runProbe: (options) => deps.runProbe(options),
    deviceName: () => config.scanDeviceName ?? '',
    getPhase: () => state.session?.phase ?? 'idle',
  })

  const sleep = (ms: number): Promise<void> => {
    if (ms <= 0) return Promise.resolve()
    return new Promise((resolve) => {
      deps.clock.setTimeout(resolve, ms)
    })
  }

  const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = gate
    let release: () => void = () => undefined
    gate = new Promise((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }

  const track = (work: Promise<void>): void => {
    inflight += 1
    const done = work.finally(() => {
      inflight -= 1
    })
    tail = tail.then(() => done).then(
      () => undefined,
      () => undefined,
    )
  }

  const purge = (taskId: string, reason: ScanDeviceDeletionReason): ScanTempPurgeResult => {
    try {
      return deps.purge(taskId, reason, root ? { root } : {})
    } catch {
      warn(`scan-device: purge failed task=${taskId} reason=${reason} code=PURGE_THROW`)
      return { status: 'failed', entryCount: 0, errorCode: 'PURGE_THROW' }
    }
  }

  const applyReport = (result: DeviceReportResult): 'go' | 'stop' | 'dead' => {
    const session = state.session
    if (!session) return 'go'
    if (result.kind === 'ok' || result.kind === 'unavailable') return 'go'
    if (result.kind === 'rejected') {
      warn(`scan-device: report rejected task=${session.taskId} code=${result.code}`)
      return 'go'
    }
    if (result.kind === 'unauthorized') {
      session.unauthorized = true
      session.handle?.abort()
      return 'dead'
    }
    session.stopCode = result.code
    session.handle?.abort()
    warn(`scan-device: report stop task=${session.taskId} code=${result.code}`)
    return 'stop'
  }

  const sendReport = async (body: DeviceReportBody): Promise<'go' | 'stop' | 'dead'> => {
    const taskId = state.session?.taskId
    if (!taskId) return 'go'
    let last: DeviceReportResult = { kind: 'unavailable' }
    for (let attempt = 0; attempt < SCAN_DEVICE_REPORT_ATTEMPTS; attempt += 1) {
      try {
        last = await deps.report(taskId, body)
      } catch {
        last = { kind: 'unavailable' }
      }
      if (last.kind !== 'unavailable') break
      if (attempt < SCAN_DEVICE_REPORT_ATTEMPTS - 1) {
        const delay = deps.reportDelaysMs[Math.min(attempt, deps.reportDelaysMs.length - 1)] ?? 0
        await sleep(delay)
      }
    }
    return applyReport(last)
  }

  const enqueueReport = (body: DeviceReportBody): Promise<'go' | 'stop' | 'dead'> => {
    const run = reportChain.then(() => sendReport(body))
    reportChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  const note = (stateName: string, code?: string | null): void => {
    const session = state.session
    log(`scan-device: task=${session?.taskId ?? '-'} state=${stateName} pageCount=${session?.pageCount ?? 0} code=${code ?? '-'}`)
  }

  const round = createRoundDriver({
    state,
    deps,
    maxPages,
    ...(root ? { root } : {}),
    deviceName: config.scanDeviceName ?? '',
    health,
    purge,
    note,
    sendReport,
    enqueueReport,
    flushReports: () => reportChain,
    track,
    getGeneration: () => generation,
    setGeneration: (next) => {
      generation = next
    },
  })

  const requireLease = async (taskId: string): Promise<DeviceLease> => {
    const fetched = await deps.fetchLease(deps.clock.now())
    if (fetched.kind === 'lease' && fetched.lease.scanTaskId === taskId) return fetched.lease
    if (fetched.kind === 'unavailable' || fetched.kind === 'unauthorized') {
      throw new LocalScanError(503, 'LOCAL_SCAN_BACKEND_UNAVAILABLE', viewOf(state.session), '暂时对不上云端扫描任务，请稍后再试')
    }
    throw new LocalScanError(409, 'LOCAL_SCAN_TASK_NOT_ACTIVE', viewOf(undefined), '当前没有可执行的屏上扫描任务')
  }

  const restart = async (lease: DeviceLease): Promise<ScanDeviceView> => {
    const session = state.session
    if (session && inflight > 0) {
      session.stopCode = session.stopCode ?? 'LOCAL_RESTART'
      session.handle?.abort()
      await tail
    } else if (session) {
      purge(session.taskId, 'SCAN_DEVICE_SESSION_CLEARED')
    }
    return round.begin(lease)
  }

  const sameParams = (lease: DeviceLease): boolean => {
    const session = state.session
    return !!session && lease.device.source === session.source && lease.device.colorMode === session.color
  }

  return {
    async start(taskId) {
      return exclusive(async () => {
        const session = state.session
        if (session && session.taskId !== taskId && LIVE.has(session.phase)) {
          throw new LocalScanError(409, 'LOCAL_SCAN_BUSY', viewOf(session), '本机正在进行另一场扫描')
        }
        if (session && session.taskId === taskId && LIVE.has(session.phase)) {
          const fetched = await deps.fetchLease(deps.clock.now())
          if (fetched.kind === 'lease' && fetched.lease.scanTaskId === taskId) {
            if (sameParams(fetched.lease)) return viewOf(session)
            if (session.phase === 'scanning' || session.phase === 'page_ready') return restart(fetched.lease)
          }
          return viewOf(session)
        }
        return round.begin(await requireLease(taskId))
      })
    },
    async nextPage(taskId) {
      return exclusive(async () => {
        const session = state.session
        if (!session || session.taskId !== taskId || session.phase !== 'page_ready' || session.pageCount < 1) {
          throw new LocalScanError(409, 'LOCAL_SCAN_STATE_CONFLICT', viewOf(session), '现在不能扫描下一页')
        }
        if (session.pageCount >= maxPages) {
          throw new LocalScanError(409, 'LOCAL_SCAN_PAGE_LIMIT', viewOf(session), '已达到本机页数上限，请完成或中止')
        }
        const startIndex = session.pageCount + 1
        session.phase = 'scanning'
        const lock = await round.acquire(taskId)
        if (!lock) {
          await round.fail('busy')
          return viewOf(state.session)
        }
        if (state.session?.generation !== session.generation) {
          lock.release()
          return viewOf(state.session)
        }
        track(round.runBatch(lock, 1, startIndex, session.generation))
        note('scanning')
        return viewOf(state.session)
      })
    },
    async finish(taskId) {
      const current = await exclusive(async () => {
        const session = state.session
        if (!session || session.taskId !== taskId || session.phase !== 'page_ready' || session.pageCount < 1) {
          throw new LocalScanError(409, 'LOCAL_SCAN_STATE_CONFLICT', viewOf(session), '现在不能完成扫描')
        }
        return session.generation
      })
      const job = round.composeAndDeliver(current)
      track(job.then(() => undefined))
      try {
        return await job
      } finally {
        await health.probe().catch(() => undefined)
      }
    },
    async abort(taskId) {
      const wait = await exclusive(async () => {
        const session = state.session
        if (session && session.taskId !== taskId && LIVE.has(session.phase)) {
          purge(taskId, 'SCAN_DEVICE_ABORTED')
          return false
        }
        if (!session || session.taskId !== taskId || !LIVE.has(session.phase)) {
          purge(taskId, 'SCAN_DEVICE_ABORTED')
          state.session = undefined
          return false
        }
        session.abortRequested = true
        session.handle?.abort()
        return inflight > 0
      })
      if (wait) await tail
      else if (
        state.session?.taskId === taskId &&
        state.session.abortRequested &&
        state.session.phase !== 'aborted'
      ) {
        await round.finishAbort()
      }
      if (state.session?.taskId === taskId && state.session.phase === 'aborted') return viewOf(state.session)
      return {
        state: 'aborted',
        pageCount: state.session?.taskId === taskId ? state.session.pageCount : 0,
        errorCode: null,
      }
    },
    probe: () => health.probe(),
    health: () => health.snapshot(),
    arm() {
      if (armed) return
      armed = true
      try {
        const swept = deps.sweep(root ? { root } : {})
        log(
          `scan-device: startup residue sweep taskDirs=${swept.removedTaskDirs} other=${swept.removedOther} failed=${swept.failed}`,
        )
      } catch {
        warn('scan-device: startup residue sweep failed')
      }
      health.arm()
    },
    stop() {
      health.stop()
      armed = false
    },
    whenIdle: () => tail,
  }
}

/** 开关不是 true 时不创建、不扫残留、不探测。 */
export function scanDeviceRuntimeForConfig(
  config: AgentConfig,
  overrides: Partial<ScanDeviceRuntimeDeps> = {},
): ScanDeviceRuntime | undefined {
  if (config.scanDeviceEnabled !== true) return undefined
  const runtime = createScanDeviceRuntime(config, overrides)
  runtime.arm()
  return runtime
}
