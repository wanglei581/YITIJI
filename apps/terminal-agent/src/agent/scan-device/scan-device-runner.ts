/**
 * agent/scan-device/scan-device-runner.ts — 屏上扫描调度
 *
 * 一个进程同时只一场。开始 / 下一页 / 完成进同一条串行队列。中止不进队列，只置本场取消标记。
 * 清理重试、空闲截止、回报补发都绑在场次上。进程是否退出只交给健康管理器。
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
  type ScanDeviceReportState,
} from './scan-device-backend'
import { sharedScanDeviceHealth, defaultScanProcessAlive, type ScanDeviceClock, type ScanDeviceHealth } from './scan-device-health'
import { createScanDeviceHousekeeping, type CleanupMeta } from './scan-device-housekeeping'
import { scanDeviceReportBridge } from './scan-device-sync'
import { composeScanPdf } from './scan-pdf-compose'
import {
  createScanTaskDir,
  purgeScanTaskDir,
  sweepScanDeviceResidue,
  type ScanDeviceDeletionReason,
  type ScanTempPurgeResult,
} from './scan-temp-dir'
import { noteDeliveryDeadline, recheckUncertainDelivery, SCAN_DEVICE_DELIVERY_RECHECK_MS } from './scan-device-deliver'
import { createRoundDriver, roundView, type RoundHost, type RoundSession, type RoundState } from './scan-device-round'
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
  return roundView(session)
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
    ...(input.deviceRound !== undefined ? { deviceRound: input.deviceRound } : {}),
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
    beforeUpload: () => new Promise((resolve) => {
      setImmediate(resolve)
    }),
    isProcessAlive: defaultScanProcessAlive,
    clock: systemClock(),
    lock: globalDeviceLock,
    reportDelaysMs: SCAN_DEVICE_REPORT_RETRY_DELAYS_MS,
    ...overrides,
  }
  const root = deps.root
  const state: RoundState = {}
  let generation = 0
  let startTicket: { taskId: string; generation: number; cancelled: boolean } | undefined
  let recheckTimer: unknown
  const hostBox: { current?: RoundHost } = {}
  let inflight = 0
  let tail: Promise<void> = Promise.resolve()
  let gate: Promise<void> = Promise.resolve()
  let reportChain: Promise<void> = Promise.resolve()
  let armed = false
  let commandRunning = false
  const abortWaiters: Array<{ resolve: (view: ScanDeviceView) => void; reject: (error: unknown) => void }> = []

  const health: ScanDeviceHealth = sharedScanDeviceHealth({
    clock: deps.clock,
    lock: deps.lock,
    runProbe: (options) => deps.runProbe(options),
    deviceName: () => config.scanDeviceName ?? '',
    getPhase: () => state.session?.phase ?? 'idle',
    isProcessAlive: (pid) => (deps.isProcessAlive ?? defaultScanProcessAlive)(pid),
    ...(deps.listResiduals ? { listResiduals: deps.listResiduals } : {}),
  }, true)

  let ackedState: ScanDeviceReportState = 'ready'
  let unsynced = false
  const resetReportCursor = (): void => {
    ackedState = 'ready'
    unsynced = false
  }
  const alive = (pid: number): boolean => (deps.isProcessAlive ?? defaultScanProcessAlive)(pid)

  const sleep = (ms: number): Promise<void> => {
    if (ms <= 0) return Promise.resolve()
    return new Promise((resolve) => {
      deps.clock.setTimeout(resolve, ms)
    })
  }

  const releaseAbort = (view: ScanDeviceView): ScanDeviceView => {
    const waiters = abortWaiters.splice(0, abortWaiters.length)
    for (const waiter of waiters) waiter.resolve(view)
    return view
  }

  const rejectAbort = (error: unknown): void => {
    const waiters = abortWaiters.splice(0, abortWaiters.length)
    for (const waiter of waiters) waiter.reject(error)
  }

  const isDeviceView = (value: unknown): value is ScanDeviceView =>
    !!value && typeof value === 'object' && 'state' in value && 'pageCount' in value && !('kind' in value)

  const viewFromPlan = (value: unknown): ScanDeviceView | undefined => {
    if (!value || typeof value !== 'object' || !('kind' in value) || !('view' in value)) return undefined
    const plan = value as { kind?: unknown; view?: unknown }
    if (plan.kind !== 'view' || !isDeviceView(plan.view)) return undefined
    return plan.view
  }

  /** 开始 / 下一页 / 完成共用这一条队列。中止不进来。 */
  const enqueue = async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = gate
    let release: () => void = () => undefined
    gate = new Promise((resolve) => {
      release = resolve
    })
    await previous
    commandRunning = true
    try {
      const value = await fn()
      if (abortWaiters.length > 0) {
        if (isDeviceView(value)) releaseAbort(value)
        else {
          const planned = viewFromPlan(value)
          if (planned) releaseAbort(planned)
        }
      }
      return value
    } catch (error) {
      rejectAbort(error)
      throw error
    } finally {
      commandRunning = false
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

  const roundSlot: { driver?: ReturnType<typeof createRoundDriver> } = {}
  const round = (): ReturnType<typeof createRoundDriver> => {
    const driver = roundSlot.driver
    if (!driver) throw new Error('scan-device round is not ready')
    return driver
  }
  const housekeeping = createScanDeviceHousekeeping({
    clock: deps.clock,
    purge,
    isProcessAlive: alive,
    unidentifiedStop: () => health.unidentifiedSuspect(),
    activeEpoch: (taskId) => {
      const current = state.session
      if (!current || current.taskId !== taskId || !LIVE.has(current.phase)) return undefined
      return current.generation
    },
    fetchLease: (now) => deps.fetchLease(now),
    session: () => {
      const current = state.session
      if (!current) return undefined
      return { generation: current.generation, phase: current.phase, taskId: current.taskId, stopCode: current.stopCode }
    },
    onIdleTimeout: async (generation) => {
      await enqueue(async () => {
        const current = state.session
        if (!current || current.generation !== generation || current.phase !== 'page_ready') return
        await round().finishAbort()
      })
    },
    onLeaseLost: (generation, code) => {
      void enqueue(async () => {
        const current = state.session
        if (!current || current.generation !== generation || current.phase !== 'page_ready') return
        current.stopCode = code
        round().finishStop()
      })
    },
    log,
  })

  const cleanupMeta = (taskId: string): CleanupMeta => {
    const current = state.session
    const same = current?.taskId === taskId ? current : undefined
    return {
      epoch: same?.generation ?? 0,
      stopUnconfirmed: same?.stopUnconfirmed === true,
      ...(same?.suspectPid !== undefined ? { pid: same.suspectPid } : {}),
    }
  }

  const commitPurge = (taskId: string, reason: ScanDeviceDeletionReason): boolean => {
    const session = state.session
    const same = session?.taskId === taskId ? session : undefined
    if (same?.stopUnconfirmed) {
      same.purgeSettled = true
      same.purged = false
      housekeeping.scheduleCleanup(taskId, reason, cleanupMeta(taskId))
      return false
    }
    const result = purge(taskId, reason)
    if (same) {
      same.purgeSettled = true
      same.purged = result.status !== 'failed'
    }
    if (result.status === 'failed') {
      housekeeping.scheduleCleanup(taskId, reason, cleanupMeta(taskId))
      return false
    }
    return true
  }

  const decorate = (body: DeviceReportBody): DeviceReportBody => {
    const session = state.session
    if (config.scanDeviceReportSettings !== true || !session) {
      return { state: body.state, ...(body.pageCount !== undefined ? { pageCount: body.pageCount } : {}), ...(body.errorCode ? { errorCode: body.errorCode } : {}) }
    }
    return {
      state: body.state,
      ...(body.pageCount !== undefined ? { pageCount: body.pageCount } : {}),
      ...(body.errorCode ? { errorCode: body.errorCode } : {}),
      source: session.source,
      colorMode: session.color,
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

  const postAttempts = async (taskId: string, body: DeviceReportBody): Promise<DeviceReportResult> => {
    let last: DeviceReportResult = { kind: 'unavailable' }
    for (let attempt = 0; attempt < SCAN_DEVICE_REPORT_ATTEMPTS; attempt += 1) {
      try {
        last = await deps.report(taskId, body)
      } catch {
        last = { kind: 'unavailable' }
      }
      if (last.kind !== 'unavailable') return last
      if (attempt < SCAN_DEVICE_REPORT_ATTEMPTS - 1) {
        const delay = deps.reportDelaysMs[Math.min(attempt, deps.reportDelaysMs.length - 1)] ?? 0
        await sleep(delay)
      }
    }
    return last
  }

  const markUnsyncable = (): 'dead' => {
    const session = state.session
    if (session) {
      session.reportUnsyncable = true
      session.handle?.abort()
    }
    return 'dead'
  }

  const sendReport = async (body: DeviceReportBody): Promise<'go' | 'stop' | 'dead'> => {
    const taskId = state.session?.taskId
    if (!taskId) return 'go'
    const decorated = decorate(body)
    if (unsynced && decorated.state !== ackedState) {
      const bridge = scanDeviceReportBridge(ackedState, decorated.state)
      if (!bridge) return markUnsyncable()
      if (bridge.length > 0) {
        const confirmBody = ackedState === 'ready'
          ? decorate({ state: 'ready' })
          : decorate({ state: ackedState, ...(decorated.pageCount !== undefined ? { pageCount: decorated.pageCount } : {}) })
        const confirmed = await postAttempts(taskId, confirmBody)
        if (confirmed.kind === 'stop' || confirmed.kind === 'unauthorized') return applyReport(confirmed)
        if (confirmed.kind !== 'ok') return markUnsyncable()
        rememberAcceptedReport(confirmBody, confirmed)
        for (const hop of bridge) {
          const hopBody = decorate({ state: hop, ...(decorated.pageCount !== undefined ? { pageCount: decorated.pageCount } : {}) })
          const hopResult = await postAttempts(taskId, hopBody)
          if (hopResult.kind === 'stop' || hopResult.kind === 'unauthorized') return applyReport(hopResult)
          if (hopResult.kind !== 'ok') return markUnsyncable()
          rememberAcceptedReport(hopBody, hopResult)
          ackedState = hop
          if (state.session?.stopCode) return applyReport({ kind: 'stop', code: state.session.stopCode })
        }
      }
    }
    const result = await postAttempts(taskId, decorated)
    if (result.kind === 'ok') {
      ackedState = decorated.state
      unsynced = false
      rememberAcceptedReport(decorated, result)
      return applyReport(result)
    }
    if (result.kind === 'unavailable') unsynced = true
    if (unsynced && result.kind === 'rejected' && result.code === 'SCAN_DEVICE_TRANSITION_INVALID') return markUnsyncable()
    return applyReport(result)
  }

  const enqueueReport = (body: DeviceReportBody): Promise<'go' | 'stop' | 'dead'> => {
    const run = reportChain.then(() => sendReport(body))
    reportChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  const rememberAcceptedReport = (body: DeviceReportBody, result: DeviceReportResult): void => {
    const session = state.session
    if (!session || result.kind !== 'ok') return
    noteDeliveryDeadline(session, { hardExpiresAt: result.hardExpiresAt, expiresAt: result.expiresAt })
    if (body.state !== 'scanning' || result.deviceRound === undefined) return
    if (session.deviceRound !== undefined && session.deviceRound !== result.deviceRound) {
      session.pages = []
      session.pageCount = 0
      session.bytes = 0
      session.deviceRound = result.deviceRound
      session.stopCode = session.stopCode ?? 'SCAN_DEVICE_SESSION_CLEARED'
      session.handle?.abort()
      return
    }
    session.deviceRound = result.deviceRound
  }

  const clearDeliveryRecheck = (): void => {
    if (recheckTimer !== undefined) deps.clock.clearTimeout(recheckTimer)
    recheckTimer = undefined
  }

  const scheduleDeliveryRecheck = (current: number): void => {
    clearDeliveryRecheck()
    recheckTimer = deps.clock.setTimeout(() => {
      recheckTimer = undefined
      const currentHost = hostBox.current
      if (currentHost) void recheckUncertainDelivery(currentHost, current)
    }, SCAN_DEVICE_DELIVERY_RECHECK_MS)
  }

  const note = (stateName: string, code?: string | null): void => {
    const session = state.session
    log(`scan-device: task=${session?.taskId ?? '-'} state=${stateName} pageCount=${session?.pageCount ?? 0} code=${code ?? '-'}`)
  }

  hostBox.current = {
    state,
    deps,
    maxPages,
    ...(root ? { root } : {}),
    deviceName: config.scanDeviceName ?? '',
    health,
    purge,
    commitPurge,
    scheduleCleanup: (taskId, reason, meta) => housekeeping.scheduleCleanup(taskId, reason, meta),
    revokeCleanup: (taskId) => housekeeping.revoke(taskId),
    releaseAbort,
    note,
    sendReport,
    enqueueReport,
    flushReports: () => reportChain,
    track,
    getGeneration: () => generation,
    setGeneration: (next) => {
      generation = next
    },
    armIdle: (current) => housekeeping.armIdle(current),
    disarmIdle: () => housekeeping.disarmIdle(),
    resetReportCursor,
    startCancelled: (taskId) => startTicket?.taskId === taskId && startTicket.cancelled === true,
    reservedGeneration: (taskId) => (startTicket?.taskId === taskId ? startTicket.generation : undefined),
    clearStartTicket: () => {
      startTicket = undefined
    },
    scheduleDeliveryRecheck,
    clearDeliveryRecheck,
  }
  roundSlot.driver = createRoundDriver(hostBox.current)

  const requireLease = async (taskId: string): Promise<DeviceLease> => {
    const fetched = await deps.fetchLease(deps.clock.now())
    if (fetched.kind === 'lease' && fetched.lease.scanTaskId === taskId) return fetched.lease
    if (fetched.kind === 'unavailable' || fetched.kind === 'unauthorized') {
      throw new LocalScanError(503, 'LOCAL_SCAN_BACKEND_UNAVAILABLE', viewOf(state.session), '暂时对不上云端扫描任务，请稍后再试')
    }
    throw new LocalScanError(409, 'LOCAL_SCAN_TASK_NOT_ACTIVE', viewOf(undefined), '当前没有可执行的屏上扫描任务')
  }

  const sameParams = (lease: DeviceLease): boolean => {
    const session = state.session
    return !!session && lease.device.source === session.source && lease.device.colorMode === session.color
  }

  return {
    async start(taskId) {
      const plan = await enqueue(async () => {
        const session = state.session
        if (session && session.taskId !== taskId && LIVE.has(session.phase)) {
          throw new LocalScanError(409, 'LOCAL_SCAN_BUSY', viewOf(session), '本机正在进行另一场扫描')
        }
        if (session?.taskId === taskId && session.deliveryOutcome === 'uncertain') {
          throw new LocalScanError(409, 'LOCAL_SCAN_DELIVERY_UNCONFIRMED', { state: 'delivering', pageCount: session.pageCount, errorCode: null }, '投递结果不确定')
        }
        if (session && session.taskId === taskId && LIVE.has(session.phase)) {
          const fetched = await deps.fetchLease(deps.clock.now())
          const latest = state.session
          if (latest?.taskId === taskId && latest.abortRequested) {
            return { kind: 'view' as const, view: await round().finishAbort() }
          }
          if (fetched.kind === 'lease' && fetched.lease.scanTaskId === taskId && latest?.taskId === taskId) {
            if (sameParams(fetched.lease)) return { kind: 'view' as const, view: viewOf(latest) }
            if (latest.phase === 'scanning' || latest.phase === 'page_ready') {
              if (inflight > 0) {
                latest.stopCode = latest.stopCode ?? 'LOCAL_RESTART'
                latest.handle?.abort()
                await tail
              }
              if (state.session?.abortRequested) {
                return { kind: 'view' as const, view: await round().finishAbort() }
              }
              const prepared = await round().prepare(fetched.lease)
              if (!prepared.ok) return { kind: 'view' as const, view: prepared.view }
              return { kind: 'launch' as const, taskId: fetched.lease.scanTaskId, generation: prepared.generation }
            }
          }
          return { kind: 'view' as const, view: viewOf(state.session) }
        }
        // 取租约是这一场的第一个异步等待。标记必须在它之前立起来，中止才不会落进「没有会话」。
        const ticket = { taskId, generation: generation + 1, cancelled: false }
        generation = ticket.generation
        startTicket = ticket
        let lease: DeviceLease
        try {
          lease = await requireLease(taskId)
        } catch (error) {
          if (ticket.cancelled) {
            startTicket = undefined
            const purged = commitPurge(taskId, 'SCAN_DEVICE_ABORTED')
            return { kind: 'view' as const, view: { state: 'aborted' as const, pageCount: 0, errorCode: null, purged } }
          }
          startTicket = undefined
          throw error
        }
        if (ticket.cancelled) {
          startTicket = undefined
          const purged = commitPurge(taskId, 'SCAN_DEVICE_ABORTED')
          return { kind: 'view' as const, view: { state: 'aborted' as const, pageCount: 0, errorCode: null, purged } }
        }
        const prepared = await round().prepare(lease)
        if (ticket.cancelled || state.session?.abortRequested) {
          startTicket = undefined
          if (state.session?.taskId === taskId && (LIVE.has(state.session.phase) || state.session.abortRequested)) {
            return { kind: 'view' as const, view: await round().finishAbort() }
          }
          const purged = commitPurge(taskId, 'SCAN_DEVICE_ABORTED')
          return { kind: 'view' as const, view: { state: 'aborted' as const, pageCount: 0, errorCode: null, purged } }
        }
        if (!prepared.ok) return { kind: 'view' as const, view: prepared.view }
        return { kind: 'launch' as const, taskId: lease.scanTaskId, generation: prepared.generation }
      })
      if (plan.kind === 'view') return plan.view
      if (state.session?.abortRequested || state.session?.phase === 'aborted') return viewOf(state.session)
      const lock = await round().acquire(plan.taskId)
      return enqueue(() => round().launch(plan.generation, lock))
    },
    async nextPage(taskId) {
      const session = state.session
      if (session && session.taskId === taskId && (session.phase === 'scanning' || session.awaitingLock || session.nextAccepted)) {
        return viewOf(session)
      }
      if (!session || session.taskId !== taskId || session.phase !== 'page_ready' || session.pageCount < 1) {
        throw new LocalScanError(409, 'LOCAL_SCAN_STATE_CONFLICT', viewOf(session), '现在不能扫描下一页')
      }
      if (session.pageCount >= session.pageCap) {
        throw new LocalScanError(409, 'LOCAL_SCAN_PAGE_LIMIT', viewOf(session), '已达到本机页数上限，请完成或中止')
      }
      if (housekeeping.idleDue()) return enqueue(() => round().finishAbort())
      session.nextAccepted = true
      session.reservedIndex = session.pageCount + 1
      session.awaitingLock = true
      const generation = session.generation
      const reservedIndex = session.reservedIndex
      const lock = await round().acquire(taskId).catch((error: unknown) => {
        const current = state.session
        if (current?.generation === generation) {
          current.nextAccepted = false
          current.awaitingLock = false
        }
        throw error
      })
      // 租约请求放在队列外面，空闲截止才能在它还挂着的时候收场。
      let fetched: Awaited<ReturnType<ScanDeviceRuntimeDeps['fetchLease']>>
      try {
        fetched = await deps.fetchLease(deps.clock.now())
      } catch {
        fetched = { kind: 'unavailable' }
      }
      return enqueue(async () => {
        const current = state.session
        if (!current || current.generation !== generation) {
          lock?.release()
          return viewOf(current)
        }
        current.awaitingLock = false
        if (current.abortRequested || current.phase === 'aborted') {
          lock?.release()
          current.nextAccepted = false
          if (current.abortRequested && current.phase === 'page_ready') return round().finishAbort()
          return viewOf(current)
        }
        if (housekeeping.idleDue()) {
          lock?.release()
          current.nextAccepted = false
          if (current.phase === 'page_ready') return round().finishAbort()
          return viewOf(current)
        }
        if (current.phase !== 'page_ready' || current.pageCount + 1 !== reservedIndex) {
          lock?.release()
          current.nextAccepted = false
          return viewOf(current)
        }
        const latest = state.session
        if (!latest || latest.generation !== generation) {
          lock?.release()
          return viewOf(latest)
        }
        if (latest.abortRequested) {
          lock?.release()
          latest.nextAccepted = false
          return round().finishAbort()
        }
        if (fetched.kind === 'none' || (fetched.kind === 'lease' && fetched.lease.scanTaskId !== taskId)) {
          lock?.release()
          latest.nextAccepted = false
          latest.stopCode = fetched.kind === 'none' ? fetched.stopCode ?? 'SCAN_DEVICE_SESSION_CLEARED' : 'SCAN_DEVICE_SESSION_CLEARED'
          return round().finishStop()
        }
        if (!lock) {
          latest.nextAccepted = false
          throw new LocalScanError(409, 'LOCAL_SCAN_BUSY', viewOf(latest), '扫描仪正忙，已扫的页还在。可以再试、点扫完了，或中止')
        }
        // 租约已经回来。开扫前再看一次绝对截止和取消标记，截止到了就不再扫。
        if (latest.abortRequested) {
          lock.release()
          latest.nextAccepted = false
          return round().finishAbort()
        }
        if (housekeeping.idleDue()) {
          lock.release()
          latest.nextAccepted = false
          return round().finishAbort()
        }
        latest.phase = 'scanning'
        latest.nextAccepted = false
        housekeeping.disarmIdle()
        track(round().runBatch(lock, 1, reservedIndex, generation))
        note('scanning')
        return viewOf(latest)
      })
    },
    async finish(taskId) {
      // 只把改状态放进队列。合成和投递在队列外跑，否则进行中的完成会挡住
      // 同一次开始（它只该看到当前状态就返回），两边互相等待，进程会直接退出。
      const generation = await enqueue(async () => {
        const session = state.session
        if (session?.taskId === taskId && session.deliveryOutcome === 'uncertain') {
          throw new LocalScanError(409, 'LOCAL_SCAN_DELIVERY_UNCONFIRMED', { state: 'delivering', pageCount: session.pageCount, errorCode: null }, '投递结果不确定')
        }
        if (!session || session.taskId !== taskId || session.phase !== 'page_ready' || session.pageCount < 1) {
          throw new LocalScanError(409, 'LOCAL_SCAN_STATE_CONFLICT', viewOf(session), '现在不能完成扫描')
        }
        housekeeping.disarmIdle()
        session.phase = 'composing'
        return session.generation
      })
      const job = round().composeAndDeliver(generation)
      track(job.then(() => undefined, () => undefined))
      try {
        return await job
      } finally {
        await health.probe().catch(() => undefined)
      }
    },
    async abort(taskId) {
      const session = state.session
      if (session && session.taskId !== taskId && LIVE.has(session.phase)) {
        const purged = commitPurge(taskId, 'SCAN_DEVICE_ABORTED')
        return { state: 'aborted' as const, pageCount: 0, errorCode: null, purged }
      }
      if (session?.taskId === taskId && (session.delivered || session.deliveryOutcome === 'received')) {
        return {
          state: 'delivering' as const,
          pageCount: session.pageCount,
          errorCode: null,
          ...(session.purgeSettled ? { purged: session.purged } : {}),
        }
      }
      if (session?.taskId === taskId && session.deliveryOutcome === 'uncertain') {
        throw new LocalScanError(
          409,
          'LOCAL_SCAN_DELIVERY_UNCONFIRMED',
          { state: 'delivering', pageCount: session.pageCount, errorCode: null },
          '投递结果不确定',
        )
      }
      if (startTicket?.taskId === taskId) {
        startTicket.cancelled = true
        if (!session || session.taskId !== taskId || !LIVE.has(session.phase)) {
          if (commandRunning) {
            return new Promise((resolve, reject) => {
              abortWaiters.push({ resolve, reject })
            })
          }
          const purged = commitPurge(taskId, 'SCAN_DEVICE_ABORTED')
          startTicket = undefined
          return { state: 'aborted' as const, pageCount: 0, errorCode: null, purged }
        }
      }
      if (!session || session.taskId !== taskId || !LIVE.has(session.phase)) {
        const purged = commitPurge(taskId, 'SCAN_DEVICE_ABORTED')
        if (session?.taskId === taskId) state.session = undefined
        return { state: 'aborted' as const, pageCount: 0, errorCode: null, purged }
      }
      session.abortRequested = true
      session.handle?.abort()
      if (!commandRunning && (session.awaitingLock || inflight === 0)) return round().finishAbort()
      if (!commandRunning) {
        await tail
        const current = state.session
        if (current?.taskId === taskId && (current.delivered || current.deliveryOutcome === 'received')) {
          return {
            state: 'delivering' as const,
            pageCount: current.pageCount,
            errorCode: null,
            ...(current.purgeSettled ? { purged: current.purged } : {}),
          }
        }
        if (current?.taskId === taskId && current.deliveryOutcome === 'uncertain') {
          throw new LocalScanError(
            409,
            'LOCAL_SCAN_DELIVERY_UNCONFIRMED',
            { state: 'delivering', pageCount: current.pageCount, errorCode: null },
            '投递结果不确定',
          )
        }
        if (current?.taskId === taskId) return viewOf(current)
        return { state: 'aborted' as const, pageCount: 0, errorCode: null }
      }
      return new Promise((resolve, reject) => {
        abortWaiters.push({ resolve, reject })
      })
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
      housekeeping.stop()
      clearDeliveryRecheck()
      armed = false
    },
    whenIdle: () => tail,
    cleanupPending: () => housekeeping.pending(),
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
