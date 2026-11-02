/**
 * verify-scan-device-runner 的夹具。
 * 不改环境变量、不打开数据库、不 import 屏上扫描引擎那份会在加载时改 PROGRAMDATA 的 helper。
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import axios from 'axios'
import { DeviceLock, type DeviceLockClock } from '../src/agent/device-lock'
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
        const produced = script.errorCode === 'paper_jam' ? [] : pages
        const ok = script.ok ?? (!script.errorCode && produced.length > 0 && !aborted)
        const endedBy = aborted
          ? 'canceled'
          : script.endedBy ?? (ok ? (request.source === 'flatbed' ? 'single_page' : 'feeder_emptied') : 'error')
        return {
          ok,
          endedBy,
          pages: ok ? produced : produced,
          ...(script.errorCode ? { errorCode: script.errorCode } : {}),
          discardedPages: script.errorCode === 'paper_jam' ? pages.length : 0,
          forceKilled,
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
    clock,
    lock,
    root: input.root,
    reportDelaysMs: [200, 400],
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

export async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  return address.port
}
