/**
 * verify-scan-device-runner 的夹具。
 * 不改环境变量、不打开数据库、不 import 屏上扫描引擎那份会在加载时改 PROGRAMDATA 的 helper。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import axios from 'axios'
import type { AgentDatabase } from '../src/agent/db'
import { DeviceLock, globalDeviceLock, type DeviceLockClock } from '../src/agent/device-lock'
import { __resetPrintDispatchGateForTests } from '../src/agent/print-dispatch-gate'
import { bindScanDevicePrintFinishedProbe } from '../src/agent/scan-device/scan-device-runner'
import { __resetClaimRateLimitForTests, startTaskRunner } from '../src/agent/task-runner'
import type { AgentConfig } from '../src/agent/types'
import type { DeviceLease, DeviceReportBody, DeviceReportResult, FetchDeviceLeaseResult } from '../src/agent/scan-device/scan-device-backend'
import {
  createScanDeviceRuntime,
  type ScanDeviceDeliveryInput,
  type ScanDeviceRuntime,
  type ScanDeviceRuntimeDeps,
} from '../src/agent/scan-device/scan-device-runner'
import type { WiaScanHandle, WiaScanRequest, WiaScanResult, WiaScannedPage } from '../src/agent/scan-device/wia-runner'
import type { WiaProbeResult } from '../src/agent/scan-device/wia-probe'
import type { ScanDeviceErrorCode } from '../src/agent/scan-device/wia-script'

export function probeResult(state: WiaProbeResult['state']): WiaProbeResult {
  return { state, forceKilled: false, elapsedMs: 1 }
}

export interface ManualClock extends DeviceLockClock {
  advance(ms: number): void
  scheduled: number[]
}

export function createManualClock(start = 1_700_000_000_000): ManualClock {
  let now = start
  const timers: { at: number; cb: () => void }[] = []
  const scheduled: number[] = []
  return {
    scheduled,
    now: () => now,
    setTimeout(callback, ms) {
      scheduled.push(ms)
      const handle = { at: now + ms, cb: callback }
      timers.push(handle)
      return handle
    },
    clearTimeout(handle) {
      const index = timers.indexOf(handle as { at: number; cb: () => void })
      if (index >= 0) timers.splice(index, 1)
    },
    advance(ms) {
      const target = now + ms
      for (;;) {
        const due = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.splice(timers.indexOf(due), 1)
        now = due.at
        due.cb()
      }
      now = target
    },
  }
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

export function axiosStatus(status: number, code?: string): unknown {
  const error = new axios.AxiosError(`http ${status}`)
  error.response = {
    status,
    data: code ? { error: { code } } : {},
    statusText: String(status),
    headers: {},
    config: {},
  } as never
  return error
}

export function deviceLease(scanTaskId: string, now: number, patch: Partial<DeviceLease> = {}): DeviceLease {
  return {
    scanTaskId,
    serverNow: new Date(now).toISOString(),
    notBefore: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(),
    deliveryLease: `lease-${scanTaskId}`,
    startMode: 'device',
    ...patch,
    device: { source: 'feeder', colorMode: 'gray', ...patch.device },
  }
}

export interface ScanScript {
  pages: Array<{ bytes: number }>
  ok?: boolean
  endedBy?: WiaScanResult['endedBy']
  errorCode?: ScanDeviceErrorCode
  /** abort() 时把结果标成强杀，用来验证下一轮开始前必须先探测。 */
  forceKillOnAbort?: boolean
  /** 强杀后进程仍未确认退出。 */
  stopUnconfirmed?: boolean
  processId?: number
  /** 每一页回报之后停住，测试可以在这里中止。 */
  holdAfterPage?: boolean
}

export interface ScannerDouble {
  calls: WiaScanRequest[]
  start: ScanDeviceRuntimeDeps['startScan']
  release(): void
}

export function createScanner(): ScannerDouble {
  const calls: WiaScanRequest[] = []
  const queue: ScanScript[] = []
  let releaseHold: (() => void) | undefined
  let hold: Promise<void> | undefined
  const scanner: ScannerDouble = {
    calls,
    release() {
      releaseHold?.()
      releaseHold = undefined
      hold = undefined
    },
    start(request) {
      calls.push({ ...request })
      const script = queue.shift() ?? { pages: [{ bytes: 128 }], endedBy: request.source === 'flatbed' ? 'single_page' : 'feeder_emptied' }
      let aborted = false
      let forceKilled = false
      const result = (async (): Promise<WiaScanResult> => {
        const pages: WiaScannedPage[] = []
        const maxPages = request.maxPages ?? 1
        const startIndex = request.startIndex ?? 1
        await Promise.resolve()
        for (let i = 0; i < script.pages.length && pages.length < maxPages; i += 1) {
          if (aborted) break
          const spec = script.pages[i]!
          const index = startIndex + pages.length
          const file = path.join(request.outDir, `page-${String(index).padStart(3, '0')}.jpg`)
          fs.mkdirSync(request.outDir, { recursive: true })
          fs.writeFileSync(file, Buffer.from([1]))
          const page: WiaScannedPage = { index, file, bytes: spec.bytes }
          pages.push(page)
          await request.onPage?.(page)
          if (aborted) break
          if (script.holdAfterPage) {
            hold = new Promise((resolve) => {
              releaseHold = resolve
            })
            await hold
          }
          if (aborted) break
        }
        const ok = script.ok ?? (!script.errorCode && pages.length > 0 && !aborted)
        const endedBy = aborted
          ? 'canceled'
          : script.endedBy ?? (ok ? (request.source === 'flatbed' ? 'single_page' : 'feeder_emptied') : 'error')
        return {
          ok,
          endedBy,
          pages,
          ...(script.errorCode ? { errorCode: script.errorCode } : {}),
          discardedPages: 0,
          forceKilled,
          stopUnconfirmed: script.stopUnconfirmed === true,
          ...(script.processId !== undefined ? { processId: script.processId } : {}),
          attempts: 1,
          setFailed: [],
          elapsedMs: 1,
        }
      })()
      const handle: WiaScanHandle = {
        abort() {
          aborted = true
          if (script.forceKillOnAbort) forceKilled = true
          releaseHold?.()
          releaseHold = undefined
        },
        result,
      }
      return handle
    },
  }
  ;(scanner as ScannerDouble & { push(script: ScanScript): void }).push = (script) => {
    queue.push(script)
  }
  return scanner as ScannerDouble & { push(script: ScanScript): void }
}

export function pushScript(scanner: ScannerDouble, script: ScanScript): void {
  ;(scanner as ScannerDouble & { push(script: ScanScript): void }).push(script)
}

export interface Harness {
  runtime: ScanDeviceRuntime
  clock: ManualClock
  lock: DeviceLock
  scanner: ScannerDouble & { push(script: ScanScript): void }
  reports: DeviceReportBody[]
  deliveries: ScanDeviceDeliveryInput[]
  probeCalls: { count: number }
  lease: { current: FetchDeviceLeaseResult }
  reportResult: { current: (body: DeviceReportBody, attempt: number) => DeviceReportResult }
  root: string
}

export function createHarness(input: {
  root: string
  config: AgentConfig
  now?: number
  reportDelaysMs?: readonly number[]
  isProcessAlive?: (pid: number) => boolean
  beforeUpload?: () => Promise<void>
  purge?: ScanDeviceRuntimeDeps['purge']
}): Harness {
  const clock = createManualClock(input.now)
  const lock = new DeviceLock({ clock, logger: { log() {}, warn() {} } })
  const scanner = createScanner() as ScannerDouble & { push(script: ScanScript): void }
  const reports: DeviceReportBody[] = []
  const deliveries: ScanDeviceDeliveryInput[] = []
  const probeCalls = { count: 0 }
  const lease: Harness['lease'] = {
    current: { kind: 'lease', lease: deviceLease('taskA', clock.now()) },
  }
  let attempt = 0
  const reportResult: Harness['reportResult'] = {
    current: () => ({ kind: 'ok' }),
  }
  const runtime = createScanDeviceRuntime(input.config, {
    startScan: scanner.start,
    runProbe: async () => {
      probeCalls.count += 1
      return probeResult('ready')
    },
    compose: async (dir, files) => ({ ok: true, path: path.join(dir, 'scan.pdf'), pageCount: files.length, bytes: 32 }),
    deliver: async (delivery) => {
      deliveries.push(delivery)
    },
    fetchLease: async () => lease.current,
    report: async (_taskId, body) => {
      reports.push({ ...body })
      attempt += 1
      return reportResult.current(body, attempt)
    },
    readFile: async () => Buffer.from('%PDF-test'),
    ...(input.beforeUpload ? { beforeUpload: input.beforeUpload } : {}),
    ...(input.isProcessAlive ? { isProcessAlive: input.isProcessAlive } : {}),
    ...(input.purge ? { purge: input.purge } : {}),
    clock,
    lock,
    root: input.root,
    reportDelaysMs: input.reportDelaysMs ?? [200, 400],
  })
  return { runtime, clock, lock, scanner, reports, deliveries, probeCalls, lease, reportResult, root: input.root }
}

export function agentConfig(patch: Partial<AgentConfig> = {}): AgentConfig {
  return {
    apiBaseUrl: 'http://127.0.0.1:9/api/v1',
    terminalCode: 'T-SCAN-DEVICE',
    printerName: 'Configured Test Printer',
    agentVersion: 'verify',
    terminalId: 'terminal-scan-device',
    agentToken: 'scan-device-token',
    scanDeviceEnabled: true,
    scanDeviceName: '',
    scanDeviceMaxPages: 20,
    ...patch,
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for print claim')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** 开关关着不碰设备锁；开着时领取到执行结束一直持锁，空领取不探测。 */
export async function verifyPrintClaimLock(db: AgentDatabase): Promise<void> {
  __resetPrintDispatchGateForTests()
  __resetClaimRateLimitForTests()
  bindScanDevicePrintFinishedProbe(undefined)
  const held = globalDeviceLock.tryAcquire('scan:taskA')
  assert.ok(held, '测试要先占住设备锁')
  let released = false
  const releaseHeld = (): void => {
    if (released) return
    released = true
    held.release()
  }
  let mode: 'empty' | 'file' = 'empty'
  let claims = 0
  let downloads = 0
  let releaseDownload: () => void = () => undefined
  const downloadGate = new Promise<void>((resolve) => {
    releaseDownload = resolve
  })
  const server = http.createServer((request, response) => {
    request.on('data', () => undefined)
    request.on('end', () => {
      const url = request.url ?? ''
      if (request.method === 'POST' && url.includes('/tasks/claim')) {
        claims += 1
        response.writeHead(200, { 'content-type': 'application/json' })
        if (mode === 'empty') {
          response.end('[]')
          return
        }
        response.end(JSON.stringify([{
          taskId: 'print-scan-lock',
          type: 'print',
          fileUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/missing.pdf`,
          fileMd5: '',
          actionToken: 'token',
          claimedBy: 'terminal-scan-device',
          claimExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          params: {
            copies: 1,
            colorMode: 'black_white',
            duplex: 'simplex',
            paperSize: 'A4',
            orientation: 'portrait',
            quality: 'standard',
            scale: 'fit',
            pagesPerSheet: 1,
          },
          createdAt: new Date().toISOString(),
        }]))
        return
      }
      if (url.includes('/missing.pdf')) {
        downloads += 1
        void downloadGate.then(() => {
          if (!response.writableEnded) {
            response.writeHead(404)
            response.end()
          }
        })
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"acknowledged":true}')
    })
  })
  const port = await listen(server)
  const configFor = (enabled: boolean) => agentConfig({
    apiBaseUrl: `http://127.0.0.1:${port}/api/v1`,
    scanDeviceEnabled: enabled,
    claimIntervalMs: 3_600_000,
    holdPrinterQueueWhenIdle: false,
  })
  const runners: Array<{ stop(): void }> = []
  try {
    const off = startTaskRunner({ config: configFor(false), db })
    runners.push(off)
    off.wake()
    await waitUntil(() => claims >= 1)
    assert.equal(claims, 1, '开关关着时别人占着锁也要照常领取')
    off.stop()

    const blocked = startTaskRunner({ config: configFor(true), db })
    runners.push(blocked)
    const claimsAtBlock = claims
    blocked.wake()
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(claims, claimsAtBlock, '开关开着且锁被扫描占着时不得领取')
    blocked.stop()
    releaseHeld()

    let probes = 0
    bindScanDevicePrintFinishedProbe(() => {
      probes += 1
    })
    const empty = startTaskRunner({ config: configFor(true), db })
    runners.push(empty)
    const beforeEmpty = claims
    empty.wake()
    await waitUntil(() => claims > beforeEmpty)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(probes, 0, '没领到任务不得探测扫描仪')
    empty.stop()

    mode = 'file'
    const printing = startTaskRunner({ config: configFor(true), db })
    runners.push(printing)
    printing.wake()
    await waitUntil(() => downloads >= 1)
    assert.equal(globalDeviceLock.tryAcquire('scan:during'), undefined, '下载未结束时打印仍持着设备锁')
    assert.equal(probes, 0)
    releaseDownload()
    await waitUntil(() => probes === 1)
    const after = globalDeviceLock.tryAcquire('scan:after')
    assert.ok(after, '打印结束后要放锁再探测')
    after.release()
    printing.stop()
  } finally {
    releaseDownload()
    releaseHeld()
    for (const runner of runners) runner.stop()
    bindScanDevicePrintFinishedProbe(undefined)
    __resetClaimRateLimitForTests()
    __resetPrintDispatchGateForTests()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

export async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  return address.port
}
