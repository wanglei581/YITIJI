/**
 * verify:scan-device-runner — 屏上扫描接线（A2）的行为门禁。
 *
 * 假执行器、假后端、假时钟。不起 PowerShell，不碰扫描仪或打印机。
 * 不 import verify-scan-device-engine.helper（那份文件一加载就会改 PROGRAMDATA）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import type { AxiosInstance } from 'axios'
import { __resetUnauthorizedForTests, isUnauthorized } from '../src/agent/auth-state'
import {
  beginScanDeletionAudit,
  finishScanDeletionAudit,
  getScanDeletionAudits,
  openDatabase,
  type AgentDatabase,
} from '../src/agent/db'
import { sendHeartbeat } from '../src/agent/heartbeat'
import {
  fetchDeviceLease,
  isScanDeviceStopCode,
  postDeviceReport,
  readDeviceLease,
} from '../src/agent/scan-device/scan-device-backend'
import { SCAN_DEVICE_PROBE_INTERVAL_MS, SCAN_DEVICE_PROBE_START_DELAY_MS } from '../src/agent/scan-device/scan-device-health'
import { deliverScanDevicePdf, LocalScanError, SCAN_DEVICE_REPORT_ATTEMPTS, SCAN_DEVICE_REPORT_RETRY_DELAYS_MS, SCAN_PDF_COMPOSE_MARGIN_BYTES, scanDeviceRuntimeForConfig } from '../src/agent/scan-device/scan-device-runner'
import { SCAN_PDF_MAX_BYTES } from '../src/agent/scan-device/scan-pdf-compose'
import { SCAN_DEVICE_DELETION_REASONS, createScanTaskDir } from '../src/agent/scan-device/scan-temp-dir'
import { startQrLoginLocalServer } from '../src/local-api/qr-login-server'
import {
  agentConfig,
  axiosStatus,
  createHarness,
  deviceLease,
  flush,
  listen,
  probeResult,
  pushScript,
  verifyPrintClaimLock,
  type Harness,
} from './verify-scan-device-runner.helper'
import { verifyRound2 } from './verify-scan-device-runner-r2'
import { verifyRound3 } from './verify-scan-device-runner-r3'
import { verifyRound4 } from './verify-scan-device-runner-r4'

const ALLOWED = 'https://kiosk.example.test'
const BRIDGE = 'bridge-token-scan-device-verify'
const PAGE_BUDGET = SCAN_PDF_MAX_BYTES - SCAN_PDF_COMPOSE_MARGIN_BYTES

let db: AgentDatabase
const passed: string[] = []

function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed.push(name)
    })
}

function reasonsSince(before: Set<string>): string[] {
  return getScanDeletionAudits(db)
    .filter((row) => !before.has(row.eventId))
    .map((row) => row.reasonCode)
}

function snapshotAudits(): Set<string> {
  return new Set(getScanDeletionAudits(db).map((row) => row.eventId))
}

function localRequest(url: string, options: { method?: string; origin?: string | null; token?: string | null; body?: string } = {}): Promise<{ status: number; json: { success?: boolean; data?: { state?: string; pageCount?: number; errorCode?: string | null }; error?: { code?: string; state?: string; pageCount?: number; errorCode?: string | null } } }> {
  const target = new URL(url)
  const headers: Record<string, string> = {}
  if (options.origin) headers.Origin = options.origin
  if (options.token) headers['X-Local-Bridge-Token'] = options.token
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = String(Buffer.byteLength(options.body))
  }
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method ?? 'POST',
      headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: res.statusCode ?? 0,
          json: text ? JSON.parse(text) as { success?: boolean; data?: { state?: string; pageCount?: number; errorCode?: string | null }; error?: { code?: string } } : {},
        })
      })
    })
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

async function verifyRoutes(root: string): Promise<void> {
  const off = startQrLoginLocalServer(agentConfig({ localApiPort: 0, localApiAllowedOrigins: [ALLOWED], localApiBridgeToken: BRIDGE, scanDeviceEnabled: false }), {})
  assert.ok(off)
  if (!off.server.listening) await once(off.server, 'listening')
  const offPort = (off.server.address() as { port: number }).port
  const offStart = `http://127.0.0.1:${offPort}/local/scan/start`
  const offHit = await localRequest(offStart, { origin: ALLOWED, token: BRIDGE, body: JSON.stringify({ scanTaskId: 'taskA' }) })
  assert.equal(offHit.status, 404)
  assert.equal(offHit.json.error?.code, 'LOCAL_QR_NOT_FOUND', '开关关着时扫描路径仍是原来的 404')
  const offOrigin = await localRequest(offStart, { origin: 'https://evil.example', token: BRIDGE, body: '{}' })
  assert.equal(offOrigin.json.error?.code, 'LOCAL_QR_ORIGIN_FORBIDDEN')
  await off.close()

  const harness = createHarness({ root, config: agentConfig() })
  pushScript(harness.scanner, { pages: [{ bytes: 100 }] })
  const on = startQrLoginLocalServer(agentConfig({ localApiPort: 0, localApiAllowedOrigins: [ALLOWED], localApiBridgeToken: BRIDGE }), { scanDevice: harness.runtime })
  assert.ok(on)
  if (!on.server.listening) await once(on.server, 'listening')
  const port = (on.server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`
  try {
    const denied = await localRequest(`${base}/local/scan/start`, { origin: 'https://evil.example', token: BRIDGE, body: '{}' })
    assert.equal(denied.status, 403)
    assert.equal(denied.json.error?.code, 'LOCAL_SCAN_ORIGIN_FORBIDDEN')
    const token = await localRequest(`${base}/local/scan/start`, { origin: ALLOWED, token: 'nope', body: '{}' })
    assert.equal(token.status, 403)
    assert.equal(token.json.error?.code, 'LOCAL_SCAN_BRIDGE_TOKEN_INVALID')
    const query = await localRequest(`${base}/local/scan/start?x=1`, { origin: ALLOWED, token: BRIDGE, body: JSON.stringify({ scanTaskId: 'taskA' }) })
    assert.equal(query.status, 400)
    assert.equal(query.json.error?.code, 'LOCAL_SCAN_QUERY_NOT_ALLOWED')
    const extra = await localRequest(`${base}/local/scan/start`, { origin: ALLOWED, token: BRIDGE, body: JSON.stringify({ scanTaskId: 'taskA', extra: true }) })
    assert.equal(extra.status, 400)
    assert.equal(extra.json.error?.code, 'LOCAL_SCAN_BODY_INVALID')
    const badId = await localRequest(`${base}/local/scan/start`, { origin: ALLOWED, token: BRIDGE, body: JSON.stringify({ scanTaskId: '../x' }) })
    assert.equal(badId.status, 400)
    assert.equal(badId.json.error?.code, 'LOCAL_SCAN_TASK_ID_INVALID')
    const method = await localRequest(`${base}/local/scan/probe`, { method: 'POST', origin: ALLOWED, token: BRIDGE, body: '{}' })
    assert.equal(method.status, 405)
    assert.equal(method.json.error?.code, 'LOCAL_SCAN_METHOD_NOT_ALLOWED')
    const probeBody = await localRequest(`${base}/local/scan/probe`, { method: 'GET', origin: ALLOWED, token: BRIDGE, body: '{}' })
    assert.equal(probeBody.status, 400)
    assert.equal(probeBody.json.error?.code, 'LOCAL_SCAN_BODY_INVALID')
    const unknown = await localRequest(`${base}/local/scan/status`, { method: 'GET', origin: ALLOWED, token: BRIDGE })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.json.error?.code, 'LOCAL_SCAN_NOT_FOUND')
    const probesBefore = harness.probeCalls.count
    const probe = await localRequest(`${base}/local/scan/probe`, { method: 'GET', origin: ALLOWED, token: BRIDGE })
    assert.equal(probe.status, 200)
    assert.equal(probe.json.data?.state, 'ready', '本机探测要当场连一次扫描仪，回最近一次健康结果')
    assert.equal(harness.probeCalls.count, probesBefore + 1)
    assert.equal(probe.json.data?.pageCount, 0)
    assert.equal(probe.json.data?.errorCode, null)
    assert.equal(JSON.stringify(probe.json.data).includes('hresult'), false)
    harness.lease.current = { kind: 'none' }
    const inactive = await localRequest(`${base}/local/scan/start`, { origin: ALLOWED, token: BRIDGE, body: JSON.stringify({ scanTaskId: 'taskA' }) })
    assert.equal(inactive.status, 409)
    assert.equal(inactive.json.error?.code, 'LOCAL_SCAN_TASK_NOT_ACTIVE')
    harness.lease.current = { kind: 'lease', lease: deviceLease('taskA', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
    pushScript(harness.scanner, { pages: [{ bytes: 80 }], holdAfterPage: true })
    const started = await localRequest(`${base}/local/scan/start`, { origin: ALLOWED, token: BRIDGE, body: JSON.stringify({ scanTaskId: 'taskA' }) })
    assert.equal(started.status, 200)
    assert.equal(started.json.data?.state, 'scanning')
    harness.scanner.release()
    await harness.runtime.whenIdle()
  } finally {
    harness.scanner.release()
    await harness.runtime.stop()
    await on.close()
  }
}

async function verifyLeaseClient(now: number): Promise<void> {
  const body = {
    data: deviceLease('taskA', now),
  }
  assert.equal(readDeviceLease(body, now)?.scanTaskId, 'taskA')
  assert.equal(readDeviceLease({ data: { ...deviceLease('taskA', now), startMode: 'panel' } }, now), undefined)
  assert.equal(readDeviceLease({ data: { ...deviceLease('taskA', now), expiresAt: new Date(now - 1).toISOString() } }, now), undefined)
  assert.equal(readDeviceLease({ data: { ...deviceLease('taskA', now), deliveryLease: '' } }, now), undefined)
  assert.equal(readDeviceLease({ data: { scanTaskId: 'taskA', startMode: 'device', device: { source: 'adf', colorMode: 'gray' }, deliveryLease: 'x', notBefore: new Date(now).toISOString(), expiresAt: new Date(now + 1000).toISOString() } }, now), undefined)

  const calls: unknown[] = []
  const client = {
    async get() {
      return { data: body }
    },
    async post(_url: string, payload: unknown) {
      calls.push(payload)
      return { data: {} }
    },
  } as unknown as AxiosInstance
  assert.equal((await fetchDeviceLease(client, 'terminal-scan-device', now)).kind, 'lease')
  const noneClient = { async get() { throw axiosStatus(409, 'NO_WAITING_SCAN_TASK') }, async post() { return { data: {} } } } as unknown as AxiosInstance
  assert.equal((await fetchDeviceLease(noneClient, 'terminal-scan-device', now)).kind, 'none')
  const downClient = { async get() { throw axiosStatus(503) }, async post() { return { data: {} } } } as unknown as AxiosInstance
  assert.equal((await fetchDeviceLease(downClient, 'terminal-scan-device', now)).kind, 'unavailable')
  const authClient = { async get() { throw axiosStatus(401, 'AUTH_TOKEN_INVALID') }, async post() { return { data: {} } } } as unknown as AxiosInstance
  assert.equal((await fetchDeviceLease(authClient, 'terminal-scan-device', now)).kind, 'unauthorized')
  assert.equal(isUnauthorized(), true)
  __resetUnauthorizedForTests(true)
  assert.equal(isUnauthorized(), false)

  assert.equal((await postDeviceReport(client, 'terminal-scan-device', 'taskA', { state: 'scanning', pageCount: 1, errorCode: 'busy' })).kind, 'ok')
  assert.deepEqual(calls[0], { state: 'scanning', pageCount: 1 })
  const stopClient = { async get() { return { data: {} } }, async post() { throw axiosStatus(409, 'TASK_CANCELLED') } } as unknown as AxiosInstance
  const stopped = await postDeviceReport(stopClient, 'terminal-scan-device', 'taskA', { state: 'scanning', pageCount: 0 })
  assert.deepEqual(stopped, { kind: 'stop', code: 'TASK_CANCELLED' })
  const rejectClient = { async get() { return { data: {} } }, async post() { throw axiosStatus(409, 'SCAN_DEVICE_TRANSITION_INVALID') } } as unknown as AxiosInstance
  const rejected = await postDeviceReport(rejectClient, 'terminal-scan-device', 'taskA', { state: 'scanning', pageCount: 1 })
  assert.equal(rejected.kind, 'rejected')
  for (const code of ['SCAN_DEVICE_TASK_CANCELLED', 'TASK_ENDED', 'SWITCHED_TO_PANEL', 'CAPABILITY_DISABLED', 'SCAN_TASK_NOT_DEVICE', 'SCAN_DEVICE_TASK_NOT_ACKED']) {
    assert.equal(isScanDeviceStopCode(code), true, code)
  }
  assert.equal(isScanDeviceStopCode('SCAN_DEVICE_PAGE_COUNT_DECREASED'), false)
  const errorClient = { async get() { return { data: {} } }, async post(_url: string, payload: unknown) { calls.push(payload); return { data: {} } } } as unknown as AxiosInstance
  await postDeviceReport(errorClient, 'terminal-scan-device', 'taskA', { state: 'error', pageCount: 2, errorCode: 'paper_jam' })
  assert.deepEqual(calls[1], { state: 'error', pageCount: 2, errorCode: 'paper_jam' })
}

async function runFeeder(harness: Harness, taskId = 'taskA'): Promise<void> {
  harness.lease.current = { kind: 'lease', lease: deviceLease(taskId, harness.clock.now()) }
  pushScript(harness.scanner, { pages: [{ bytes: 100 }, { bytes: 200 }, { bytes: 50 }] })
  const started = await harness.runtime.start(taskId)
  assert.equal(started.state, 'scanning')
  await harness.runtime.whenIdle()
}

async function verifyFeeder(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig() })
  const before = snapshotAudits()
  await runFeeder(harness)
  const counts = harness.reports.filter((row) => row.state === 'scanning').map((row) => row.pageCount ?? 0)
  for (let i = 1; i < counts.length; i += 1) assert.ok(counts[i]! >= counts[i - 1]!, '页数只增不减')
  assert.ok(harness.reports.some((row) => row.state === 'composing' && (row.pageCount ?? 0) >= 1))
  assert.ok(harness.reports.some((row) => row.state === 'delivering'))
  assert.equal(harness.deliveries.length, 1)
  assert.equal(harness.deliveries[0]?.origin, 'device')
  assert.equal(fs.existsSync(path.join(root, 'taskA')), false)
  assert.ok(reasonsSince(before).includes('SCAN_DEVICE_DELIVERED'))
  assert.equal(harness.scanner.calls[0]?.maxPages, 20)
  await harness.runtime.stop()
}

async function verifyFlatbed(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig({ scanDeviceMaxPages: 2 }) })
  harness.lease.current = { kind: 'lease', lease: deviceLease('taskA', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'color' } }) }
  pushScript(harness.scanner, { pages: [{ bytes: 120 }] })
  await harness.runtime.start('taskA')
  await harness.runtime.whenIdle()
  assert.equal(harness.reports.at(-1)?.state, 'page_ready')
  const printLock = harness.lock.tryAcquire('print-claim')
  assert.ok(printLock, '玻璃台一页扫完必须放锁，打印拿得到')
  printLock?.release()
  pushScript(harness.scanner, { pages: [{ bytes: 80 }] })
  const next = await harness.runtime.nextPage('taskA')
  assert.equal(next.state, 'scanning')
  await harness.runtime.whenIdle()
  assert.equal(harness.scanner.calls[1]?.startIndex, 2)
  assert.equal(harness.scanner.calls[1]?.maxPages, 1)
  assert.equal(harness.reports.filter((row) => row.state === 'page_ready').at(-1)?.pageCount, 2)
  const finished = await harness.runtime.finish('taskA')
  assert.equal(finished.state, 'delivering')
  assert.equal(harness.deliveries[0]?.origin, 'device')
  await assert.rejects(harness.runtime.finish('taskA'), (error: unknown) => error instanceof LocalScanError && error.code === 'LOCAL_SCAN_STATE_CONFLICT')
  harness.lease.current = { kind: 'lease', lease: deviceLease('taskB', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(harness.scanner, { pages: [{ bytes: 10 }] })
  await harness.runtime.start('taskB')
  await harness.runtime.whenIdle()
  assert.equal(harness.reports.filter((row) => row.state === 'page_ready').at(-1)?.pageCount, 1)
  pushScript(harness.scanner, { pages: [{ bytes: 11 }] })
  await harness.runtime.nextPage('taskB')
  await harness.runtime.whenIdle()
  assert.equal(harness.reports.filter((row) => row.state === 'page_ready').at(-1)?.pageCount, 2)
  const callsAtLimit = harness.scanner.calls.length
  await assert.rejects(harness.runtime.nextPage('taskB'), (error: unknown) => {
    assert.ok(error instanceof LocalScanError)
    assert.equal(error.code, 'LOCAL_SCAN_PAGE_LIMIT')
    assert.equal(error.snapshot.state, 'page_ready')
    assert.equal(error.snapshot.pageCount, 2)
    return true
  })
  assert.equal(harness.scanner.calls.length, callsAtLimit, '到页数上限后不得再扫')
  await harness.runtime.stop()
}

async function verifyFailures(root: string): Promise<void> {
  const empty = createHarness({ root, config: agentConfig() })
  empty.lease.current = { kind: 'lease', lease: deviceLease('emptyTask', empty.clock.now()) }
  pushScript(empty.scanner, { pages: [], errorCode: 'unknown' })
  await empty.runtime.start('emptyTask')
  await empty.runtime.whenIdle()
  assert.equal(empty.reports.at(-1)?.errorCode, 'feeder_empty')
  assert.equal(empty.deliveries.length, 0)
  await empty.runtime.stop()

  const jam = createHarness({ root, config: agentConfig() })
  const beforeJam = snapshotAudits()
  jam.lease.current = { kind: 'lease', lease: deviceLease('jamTask', jam.clock.now()) }
  pushScript(jam.scanner, { pages: [{ bytes: 40 }, { bytes: 40 }], errorCode: 'paper_jam', ok: false })
  await jam.runtime.start('jamTask')
  await jam.runtime.whenIdle()
  assert.equal(jam.reports.at(-1)?.errorCode, 'paper_jam')
  assert.equal(fs.existsSync(path.join(root, 'jamTask')), false)
  assert.ok(reasonsSince(beforeJam).includes('SCAN_DEVICE_FAILED'))
  assert.equal(jam.deliveries.length, 0)
  await jam.runtime.stop()

  const huge = createHarness({ root, config: agentConfig() })
  huge.lease.current = { kind: 'lease', lease: deviceLease('hugeTask', huge.clock.now()) }
  pushScript(huge.scanner, { pages: [{ bytes: PAGE_BUDGET + 1 }] })
  await huge.runtime.start('hugeTask')
  await huge.runtime.whenIdle()
  assert.equal(huge.reports.at(-1)?.state, 'error')
  assert.equal(huge.reports.at(-1)?.errorCode, 'too_large')
  assert.equal(huge.reports.at(-1)?.pageCount, 1)
  assert.equal(huge.reports.some((row) => row.state === 'scanning' && row.pageCount === 1), false)
  assert.equal(huge.deliveries.length, 0)
  await huge.runtime.stop()

  const limited = createHarness({ root, config: agentConfig({ scanDeviceMaxPages: 2 }) })
  limited.lease.current = { kind: 'lease', lease: deviceLease('limitTask', limited.clock.now()) }
  pushScript(limited.scanner, { pages: [{ bytes: 10 }, { bytes: 10 }, { bytes: 10 }], endedBy: 'page_limit' })
  await limited.runtime.start('limitTask')
  await limited.runtime.whenIdle()
  assert.equal(limited.scanner.calls[0]?.maxPages, 2)
  assert.equal(limited.deliveries.length, 1)
  await limited.runtime.stop()

  const warm = createHarness({ root, config: agentConfig() })
  warm.lease.current = { kind: 'lease', lease: deviceLease('warmTask', warm.clock.now()) }
  pushScript(warm.scanner, { pages: [], errorCode: 'warming_up', ok: false })
  await warm.runtime.start('warmTask')
  await warm.runtime.whenIdle()
  assert.equal(warm.reports.at(-1)?.errorCode, 'not_ready')
  await warm.runtime.stop()
}

async function verifyForceKill(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig() })
  let probeState: 'ready' | 'not_found' = 'ready'
  harness.runtime.stop()
  const { createScanDeviceRuntime } = await import('../src/agent/scan-device/scan-device-runner')
  const runtime = createScanDeviceRuntime(agentConfig(), {
    startScan: harness.scanner.start,
    runProbe: async () => {
      harness.probeCalls.count += 1
      return probeResult(probeState)
    },
    compose: async (dir, files) => ({ ok: true, path: path.join(dir, 'scan.pdf'), pageCount: files.length, bytes: 8 }),
    deliver: async (input) => { harness.deliveries.push(input) },
    fetchLease: async () => harness.lease.current,
    report: async (_id, body) => {
      harness.reports.push(body)
      return { kind: 'ok' }
    },
    readFile: async () => Buffer.from('pdf'),
    clock: harness.clock,
    lock: harness.lock,
    root,
    reportDelaysMs: [0, 0],
  })
  harness.lease.current = { kind: 'lease', lease: deviceLease('kill2', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(harness.scanner, { pages: [{ bytes: 20 }], holdAfterPage: true, forceKillOnAbort: true })
  await runtime.start('kill2')
  await flush()
  const pending = runtime.abort('kill2')
  await flush()
  harness.scanner.release()
  await pending
  probeState = 'not_found'
  const probesBefore = harness.probeCalls.count
  const blocked = await runtime.start('kill2')
  assert.equal(blocked.state, 'error')
  assert.equal(blocked.errorCode, 'not_ready')
  assert.equal(harness.scanner.calls.length, 1, '强杀后探测未成功就不得再扫')
  assert.ok(harness.probeCalls.count > probesBefore)
  const still = await runtime.start('kill2')
  assert.equal(still.errorCode, 'not_ready')
  assert.equal(harness.scanner.calls.length, 1, '探测没成功时闩还在')
  probeState = 'ready'
  pushScript(harness.scanner, { pages: [{ bytes: 20 }] })
  const again = await runtime.start('kill2')
  assert.equal(again.state, 'scanning')
  await runtime.whenIdle()
  assert.equal(harness.scanner.calls.length, 2)
  await runtime.stop()
}

async function verifyStopCodes(root: string): Promise<void> {
  for (const [taskId, code, reason] of [
    ['stopCancel', 'SCAN_DEVICE_TASK_CANCELLED', 'SCAN_DEVICE_SESSION_CLEARED'],
    ['stopPanel', 'SWITCHED_TO_PANEL', 'SCAN_DEVICE_SWITCHED_TO_PANEL'],
    ['stopAck', 'TASK_NOT_ACKED', 'SCAN_DEVICE_SESSION_CLEARED'],
  ] as const) {
    const harness = createHarness({ root, config: agentConfig() })
    const before = snapshotAudits()
    harness.lease.current = { kind: 'lease', lease: deviceLease(taskId, harness.clock.now()) }
    harness.reportResult.current = () => ({ kind: 'stop', code })
    pushScript(harness.scanner, { pages: [{ bytes: 10 }] })
    const view = await harness.runtime.start(taskId)
    assert.equal(view.state, 'aborted', code)
    assert.equal(harness.scanner.calls.length, 0, code)
    assert.ok(reasonsSince(before).includes(reason), `${code} 应写 ${reason}`)
    assert.equal(harness.deliveries.length, 0)
    await harness.runtime.stop()
  }

  const harness = createHarness({ root, config: agentConfig() })
  let reports = 0
  harness.lease.current = { kind: 'lease', lease: deviceLease('rejectTask', harness.clock.now()) }
  harness.reportResult.current = () => {
    reports += 1
    if (reports === 1) return { kind: 'rejected', code: 'SCAN_DEVICE_STATE_CHANGED' }
    return { kind: 'ok' }
  }
  pushScript(harness.scanner, { pages: [{ bytes: 30 }] })
  await harness.runtime.start('rejectTask')
  await harness.runtime.whenIdle()
  assert.equal(harness.deliveries.length, 1, '非停扫 409 不中止')
  await harness.runtime.stop()
}

async function verifyLock(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig() })
  const holder = await harness.lock.acquire('print-claim')
  const busyProbe = await harness.runtime.probe()
  assert.equal(busyProbe.health, 'busy')
  assert.equal(harness.probeCalls.count, 0, '探测被占着时不得真的去连扫描仪')
  harness.lease.current = { kind: 'lease', lease: deviceLease('busyTask', harness.clock.now()) }
  const pending = harness.runtime.start('busyTask')
  await flush()
  assert.equal(harness.scanner.calls.length, 0)
  harness.clock.advance(30_000)
  await flush()
  const view = await pending
  assert.equal(view.state, 'error')
  assert.equal(view.errorCode, 'busy')
  holder.release()
  await harness.runtime.stop()
}

async function verifyHealthTiming(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig() })
  const observed = harness.runtime.health()
  assert.equal(observed.health, 'unknown')
  harness.lease.current = { kind: 'lease', lease: deviceLease('held', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(harness.scanner, { pages: [{ bytes: 10 }], holdAfterPage: true })
  await harness.runtime.start('held')
  await flush()
  const before = harness.runtime.health().observedAt
  const probes = harness.probeCalls.count
  harness.runtime.arm()
  harness.clock.advance(SCAN_DEVICE_PROBE_START_DELAY_MS)
  await flush()
  assert.equal(harness.probeCalls.count, probes, '正在扫描时周期探测要跳过')
  assert.equal(harness.runtime.health().observedAt, before)
  harness.scanner.release()
  await harness.runtime.whenIdle()
  await harness.runtime.stop()

  const idle = createHarness({ root, config: agentConfig() })
  idle.runtime.arm()
  idle.clock.advance(SCAN_DEVICE_PROBE_START_DELAY_MS - 1)
  await flush()
  assert.equal(idle.probeCalls.count, 0)
  idle.clock.advance(1)
  await flush()
  assert.equal(idle.probeCalls.count, 1)
  idle.clock.advance(SCAN_DEVICE_PROBE_INTERVAL_MS)
  await flush()
  assert.equal(idle.probeCalls.count, 2)
  assert.equal(SCAN_DEVICE_PROBE_INTERVAL_MS, 15 * 60 * 1000)
  await idle.runtime.stop()
}

async function verifyReportRetry(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig() })
  let tries = 0
  harness.lease.current = { kind: 'lease', lease: deviceLease('retryTask', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  harness.reportResult.current = () => {
    tries += 1
    if (tries < SCAN_DEVICE_REPORT_ATTEMPTS) return { kind: 'unavailable' }
    return { kind: 'ok' }
  }
  pushScript(harness.scanner, { pages: [{ bytes: 15 }], holdAfterPage: true })
  const pending = harness.runtime.start('retryTask')
  await flush()
  assert.equal(tries, 1)
  harness.clock.advance(200)
  await flush()
  assert.equal(tries, 2)
  harness.clock.advance(400)
  await flush()
  const view = await pending
  assert.equal(view.state, 'scanning')
  assert.ok(harness.clock.scheduled.includes(200) && harness.clock.scheduled.includes(400))
  assert.deepEqual(SCAN_DEVICE_REPORT_RETRY_DELAYS_MS, [200, 400])
  harness.scanner.release()
  await harness.runtime.whenIdle()
  const pageCounts = harness.reports.map((row) => row.pageCount ?? 0)
  for (let i = 1; i < pageCounts.length; i += 1) assert.ok(pageCounts[i]! >= pageCounts[i - 1]!)
  await harness.runtime.stop()
}

async function verifyIdempotentAndRestart(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig() })
  harness.lease.current = { kind: 'lease', lease: deviceLease('same', harness.clock.now()) }
  pushScript(harness.scanner, { pages: [{ bytes: 10 }, { bytes: 10 }], holdAfterPage: true })
  await harness.runtime.start('same')
  await flush()
  harness.lease.current = { kind: 'unavailable' }
  const again = await harness.runtime.start('same')
  assert.equal(again.state, 'scanning')
  assert.equal(harness.scanner.calls.length, 1, '租约暂时取不到时不得杀掉正在进行的扫描')
  await assert.rejects(harness.runtime.start('other'), (error: unknown) => error instanceof LocalScanError && error.code === 'LOCAL_SCAN_BUSY')
  harness.scanner.release()
  await harness.runtime.abort('same')
  await harness.runtime.stop()

  const flat = createHarness({ root, config: agentConfig() })
  const before = snapshotAudits()
  flat.lease.current = { kind: 'lease', lease: deviceLease('re', flat.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(flat.scanner, { pages: [{ bytes: 12 }] })
  await flat.runtime.start('re')
  await flat.runtime.whenIdle()
  flat.lease.current = { kind: 'lease', lease: deviceLease('re', flat.clock.now(), { device: { source: 'flatbed', colorMode: 'color' } }) }
  pushScript(flat.scanner, { pages: [{ bytes: 12 }] })
  await flat.runtime.start('re')
  await flat.runtime.whenIdle()
  assert.equal(flat.scanner.calls[1]?.color, 'color')
  assert.ok(reasonsSince(before).includes('SCAN_DEVICE_SESSION_CLEARED'))
  assert.equal(reasonsSince(before).includes('LOCAL_RESTART'), false)
  await flat.runtime.stop()

  const composing = createHarness({ root, config: agentConfig() })
  composing.lease.current = { kind: 'lease', lease: deviceLease('mid', composing.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(composing.scanner, { pages: [{ bytes: 12 }] })
  let releaseCompose: (value: { ok: true; path: string; pageCount: number; bytes: number }) => void = () => undefined
  const runtime = (await import('../src/agent/scan-device/scan-device-runner')).createScanDeviceRuntime(agentConfig(), {
    startScan: composing.scanner.start,
    runProbe: async () => probeResult('ready'),
    compose: () => new Promise((resolve) => {
      releaseCompose = resolve
    }),
    deliver: async (input) => { composing.deliveries.push(input) },
    fetchLease: async () => composing.lease.current,
    report: async (_id, body) => {
      composing.reports.push(body)
      return { kind: 'ok' }
    },
    readFile: async () => Buffer.from('pdf'),
    clock: composing.clock,
    lock: composing.lock,
    root,
    reportDelaysMs: [0, 0],
  })
  await runtime.start('mid')
  await runtime.whenIdle()
  const finishing = runtime.finish('mid')
  await flush()
  composing.lease.current = { kind: 'lease', lease: deviceLease('mid', composing.clock.now(), { device: { source: 'feeder', colorMode: 'color' } }) }
  const during = await runtime.start('mid')
  assert.equal(during.state, 'composing')
  assert.equal(composing.scanner.calls.length, 1, '合成过程中换参数不得撕掉投递')
  releaseCompose({ ok: true, path: path.join(root, 'mid', 'scan.pdf'), pageCount: 1, bytes: 4 })
  assert.equal((await finishing).state, 'delivering')
  await runtime.stop()
}

async function verifySnapshotAndUnauthorized(root: string): Promise<void> {
  const now = 1_700_000_000_000
  const harness = createHarness({ root, config: agentConfig(), now })
  const notBefore = new Date(now).toISOString()
  harness.lease.current = { kind: 'lease', lease: deviceLease('snap', now, { notBefore, device: { source: 'feeder', colorMode: 'gray' } }) }
  pushScript(harness.scanner, { pages: [{ bytes: 9 }] })
  await harness.runtime.start('snap')
  await harness.runtime.whenIdle()
  assert.equal(harness.deliveries[0]?.candidateSnapshotAt, new Date(now + 1).toISOString())
  await harness.runtime.stop()

  const denied = createHarness({ root, config: agentConfig() })
  denied.lease.current = { kind: 'lease', lease: deviceLease('auth', denied.clock.now()) }
  pushScript(denied.scanner, { pages: [{ bytes: 9 }] })
  denied.reportResult.current = () => ({ kind: 'ok' })
  const runtime = (await import('../src/agent/scan-device/scan-device-runner')).createScanDeviceRuntime(agentConfig(), {
    startScan: denied.scanner.start,
    runProbe: async () => probeResult('ready'),
    compose: async () => ({ ok: true, path: path.join(root, 'auth', 'scan.pdf'), pageCount: 1, bytes: 4 }),
    deliver: async () => { throw axiosStatus(401, 'AUTH_TOKEN_INVALID') },
    fetchLease: async () => denied.lease.current,
    report: async () => ({ kind: 'ok' }),
    readFile: async () => Buffer.from('pdf'),
    clock: denied.clock,
    lock: denied.lock,
    root,
    reportDelaysMs: [0, 0],
  })
  await runtime.start('auth')
  await runtime.whenIdle()
  assert.equal(isUnauthorized(), true)
  assert.equal(denied.deliveries.length, 0)
  __resetUnauthorizedForTests(true)
  await runtime.stop()
}

async function verifyHeartbeat(): Promise<void> {
  const payloads: Array<Record<string, unknown>> = []
  let plans = 0
  let plansDone: () => void = () => undefined
  const plansSeen = new Promise<void>((resolve) => {
    plansDone = resolve
  })
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      if (request.method === 'GET' && request.url?.endsWith('/release-observation-plan')) {
        plans += 1
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ plan: null }))
        if (plans >= 2) plansDone()
        return
      }
      if (request.method === 'PUT' && request.url?.endsWith('/heartbeat')) payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ acknowledged: true }))
    })
  })
  const port = await listen(server)
  const config = agentConfig({ apiBaseUrl: `http://127.0.0.1:${port}`, scanDeviceEnabled: false })
  try {
    assert.equal(await sendHeartbeat({ config }), true)
    assert.equal('scanDeviceHealth' in (payloads[0] ?? {}), false)
    assert.equal(await sendHeartbeat({
      config,
      getScanDeviceHealth: () => ({ health: 'ready', observedAt: '2026-11-02T00:00:00.000Z' }),
    }), true)
    assert.equal(payloads[1]?.['scanDeviceHealth'], 'ready')
    assert.equal(payloads[1]?.['scanDeviceObservedAt'], '2026-11-02T00:00:00.000Z')
    await plansSeen
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function verifyReporter(): Promise<void> {
  const codes = ['UNCLAIMED_TTL_EXPIRED', ...SCAN_DEVICE_DELETION_REASONS]
  const sent: Array<Record<string, unknown>> = []
  const { processScanDeletionAuditReport } = await import('../src/agent/scan-deletion-audit-reporter')
  for (const reasonCode of codes) {
    const eventId = reasonCode.replace(/[^A-Za-z0-9]/g, '').toLowerCase().padEnd(64, 'a').slice(0, 64)
    const now = new Date().toISOString()
    beginScanDeletionAudit(db, { eventId, reasonCode, identifierHash: 'b'.repeat(64) }, now)
    finishScanDeletionAudit(db, eventId, { result: 'deleted', deletedAt: now })
    const event = getScanDeletionAudits(db).find((row) => row.eventId === eventId)
    assert.ok(event)
    await processScanDeletionAuditReport(event, agentConfig(), db, async (payload) => {
      sent.push(payload as unknown as Record<string, unknown>)
      if (reasonCode === 'UNCLAIMED_TTL_EXPIRED') {
        const expected = JSON.stringify({
          eventId: event.eventId,
          reasonCode: 'UNCLAIMED_TTL_EXPIRED',
          identifierHash: event.identifierHash,
          createdAt: event.createdAt,
          deletedAt: event.deletedAt,
          result: event.result,
          deleteAttempts: event.attempts,
          lastDeleteAttemptAt: event.lastAttemptAt,
          lastErrorCode: event.lastErrorCode,
        })
        assert.equal(JSON.stringify(payload), expected, 'UNCLAIMED 负载必须与改前逐字节相同')
      }
      return { acknowledged: true, eventId: payload.eventId }
    })
  }
  assert.deepEqual(sent.map((row) => row['reasonCode']), codes)
  const unknownId = 'u'.repeat(64)
  const now = new Date().toISOString()
  beginScanDeletionAudit(db, { eventId: unknownId, reasonCode: 'NOT_A_REAL_REASON', identifierHash: 'c'.repeat(64) }, now)
  finishScanDeletionAudit(db, unknownId, { result: 'deleted', deletedAt: now })
  const unknown = getScanDeletionAudits(db).find((row) => row.eventId === unknownId)
  assert.ok(unknown)
  let called = false
  await processScanDeletionAuditReport(unknown, agentConfig(), db, async () => {
    called = true
    return { acknowledged: true, eventId: unknownId }
  })
  assert.equal(called, false)
  const after = getScanDeletionAudits(db).find((row) => row.eventId === unknownId)
  assert.equal(after?.reportErrorCode, 'REASON_CODE_UNSUPPORTED')
  assert.ok(after?.reportDeadLetterAt)
}

async function verifySwitchAndIndex(root: string): Promise<void> {
  let sweeps = 0
  const off = scanDeviceRuntimeForConfig(agentConfig({ scanDeviceEnabled: false }), {
    sweep: () => {
      sweeps += 1
      return { removedTaskDirs: 0, removedOther: 0, failed: 0 }
    },
  })
  assert.equal(off, undefined)
  assert.equal(sweeps, 0)
  createScanTaskDir('residueTask', { root })
  const on = scanDeviceRuntimeForConfig(agentConfig(), {
    root,
    clock: createHarness({ root, config: agentConfig() }).clock,
    lock: new (await import('../src/agent/device-lock')).DeviceLock({ logger: { log() {}, warn() {} } }),
    runProbe: async () => probeResult('ready'),
    startScan: () => { throw new Error('residue sweep must not scan') },
  })
  assert.ok(on)
  on.stop()
  const residue = getScanDeletionAudits(db).some((row) => row.reasonCode === 'SCAN_DEVICE_STARTUP_RESIDUE')
  assert.equal(residue, true)

  const index = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8')
  const runner = fs.readFileSync(path.join(__dirname, '../src/agent/scan-device/scan-device-runner.ts'), 'utf8')
  assert.ok(index.includes('scanDeviceRuntime = scanDeviceRuntimeForConfig(config)'))
  assert.ok(index.includes('scanDevice: scanDeviceRuntime'))
  assert.equal(index.includes('createScanDeviceRuntime'), false)
  assert.match(index.slice(index.indexOf('const heartbeatOptions'), index.indexOf('onConfigUpdate')), /scanDeviceRuntime[\s\S]*getScanDeviceHealth/)
  const fn = runner.slice(runner.indexOf('export function scanDeviceRuntimeForConfig'))
  assert.match(fn, /scanDeviceEnabled !== true/)
}

async function verifyDeliveryWire(): Promise<void> {
  const bodies: string[] = []
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('latin1'))
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"acknowledged":true}')
    })
  })
  const port = await listen(server)
  try {
    await deliverScanDevicePdf(agentConfig({ apiBaseUrl: `http://127.0.0.1:${port}/api/v1` }), {
      scanTaskId: 'taskA',
      bytes: Buffer.from('%PDF'),
      deliveryLease: 'lease-taskA',
      candidateSnapshotAt: '2026-11-02T00:00:00.000Z',
      origin: 'device',
    })
    const names = [...(bodies[0] ?? '').matchAll(/; name="([^"]+)"/g)].map((match) => match[1])
    assert.deepEqual(names, ['file', 'scanTaskId', 'deliveryLease', 'candidateSnapshotAt', 'observedAt', 'origin'])
    assert.match(bodies[0] ?? '', /name="origin"\r\n\r\ndevice\r\n/)
  } finally {
    server.close()
  }
}

async function main(): Promise<void> {
  // 挂起的 Promise 留不住事件循环。没有这个句柄时，命令互相等待会让进程以 0 退出，后面的组不再跑。
  const keepAlive = setInterval(() => undefined, 1_000_000)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-device-runner-'))
  const previous = process.env['PROGRAMDATA']
  process.env['PROGRAMDATA'] = root
  __resetUnauthorizedForTests(true)
  const opened = openDatabase()
  assert.ok(opened)
  db = opened
  try {
    await check('本机路由', () => verifyRoutes(path.join(root, 'routes')))
    await check('租约与回报客户端', () => verifyLeaseClient(1_700_000_000_000))
    await check('进纸器投递', () => verifyFeeder(path.join(root, 'feeder')))
    await check('玻璃台与页数上限', () => verifyFlatbed(path.join(root, 'flat')))
    await check('无纸卡纸超限', () => verifyFailures(path.join(root, 'fail')))
    await check('停扫与非停扫', () => verifyStopCodes(path.join(root, 'stop')))
    await check('设备锁', () => verifyLock(path.join(root, 'lock')))
    await check('健康探测时机', () => verifyHealthTiming(path.join(root, 'health')))
    await check('回报重试', () => verifyReportRetry(path.join(root, 'retry')))
    await check('重复开始与换参数', () => verifyIdempotentAndRestart(path.join(root, 'again')))
    await check('强杀后先探测', () => verifyForceKill(path.join(root, 'kill')))
    await check('快照时间与投递 401', () => verifySnapshotAndUnauthorized(path.join(root, 'snap')))
    await check('心跳字段', () => verifyHeartbeat())
    await check('删除审计上报', () => verifyReporter())
    await check('开关与装配', () => verifySwitchAndIndex(path.join(root, 'switch')))
    await check('投递带 origin', () => verifyDeliveryWire())
    await check('打印领取持锁', () => verifyPrintClaimLock(db))
    await check('第二轮', () => verifyRound2(path.join(root, 'r2'), db))
    await check('第三轮', () => verifyRound3(path.join(root, 'r3'), db))
    await check('第四轮', () => verifyRound4(path.join(root, 'r4'), db))
    console.log(`verify-scan-device-runner: ok（${passed.length} 组）`)
  } finally {
    clearInterval(keepAlive)
    __resetUnauthorizedForTests(true)
    if (previous === undefined) delete process.env['PROGRAMDATA']
    else process.env['PROGRAMDATA'] = previous
  }
}

main().catch((error: unknown) => {
  console.error(`FAIL verify-scan-device-runner: ${passed.length} 组已通过`)
  console.error(error)
  process.exit(1)
})
