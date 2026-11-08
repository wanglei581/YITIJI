/**
 * 屏上扫描接线第四轮的行为门禁。由 verify-scan-device-runner.ts 调用。
 * 不起 PowerShell，不碰扫描仪。不 import 引擎 helper（那份文件一加载就会改 PROGRAMDATA）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { AxiosInstance } from 'axios'
import { getScanDeletionAudits, type AgentDatabase } from '../src/agent/db'
import type { DeviceReportBody, DeviceReportResult, FetchDeviceLeaseResult } from '../src/agent/scan-device/scan-device-backend'
import { postDeviceReport } from '../src/agent/scan-device/scan-device-backend'
import { SCAN_DEVICE_DELIVERY_RECHECK_MS, verdictFromDeliveryProbe } from '../src/agent/scan-device/scan-device-deliver'
import { SCAN_DEVICE_PAGE_READY_IDLE_MS } from '../src/agent/scan-device/scan-device-housekeeping'
import { createScanDeviceRuntime, type ScanDeviceRuntime } from '../src/agent/scan-device/scan-device-runner'
import { LocalScanError } from '../src/agent/scan-device/scan-device-types'
import { buildScanDeliveryForm } from '../src/agent/scan-delivery'
import {
  agentConfig,
  axiosStatus,
  createHarness,
  deviceLease,
  flush,
  probeResult,
  pushScript,
  type Harness,
} from './verify-scan-device-runner.helper'

function reasonsSince(db: AgentDatabase, before: Set<string>): string[] {
  return getScanDeletionAudits(db).filter((row) => !before.has(row.eventId)).map((row) => row.reasonCode)
}

function snapshot(db: AgentDatabase): Set<string> {
  return new Set(getScanDeletionAudits(db).map((row) => row.eventId))
}

function bindRuntime(harness: Harness, patch: {
  deliver?: () => Promise<void>
  fetchLease?: () => Promise<FetchDeviceLeaseResult>
  report?: (body: DeviceReportBody) => Promise<DeviceReportResult>
  runProbe?: () => Promise<ReturnType<typeof probeResult>>
  isProcessAlive?: (pid: number) => boolean
}): ScanDeviceRuntime {
  return createScanDeviceRuntime(agentConfig(), {
    startScan: harness.scanner.start,
    runProbe: async () => {
      harness.probeCalls.count += 1
      return patch.runProbe ? patch.runProbe() : probeResult('ready')
    },
    compose: async (dir, files) => ({ ok: true, path: path.join(dir, 'scan.pdf'), pageCount: files.length, bytes: 8 }),
    deliver: async (input) => {
      harness.deliveries.push(input)
      if (patch.deliver) await patch.deliver()
    },
    fetchLease: async () => (patch.fetchLease ? patch.fetchLease() : harness.lease.current),
    report: async (_id, body) => {
      harness.reports.push(body)
      return patch.report ? patch.report(body) : { kind: 'ok' }
    },
    readFile: async () => Buffer.from('%PDF-test'),
    ...(patch.isProcessAlive ? { isProcessAlive: patch.isProcessAlive } : {}),
    clock: harness.clock,
    lock: harness.lock,
    root: harness.root,
    reportDelaysMs: [0, 0],
  })
}

async function toPageReady(harness: Harness, runtime: ScanDeviceRuntime, taskId: string): Promise<void> {
  harness.lease.current = {
    kind: 'lease',
    lease: deviceLease(taskId, harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }),
  }
  pushScript(harness.scanner, { pages: [{ bytes: 40 }] })
  await runtime.start(taskId)
  await runtime.whenIdle()
}

function ended(taskStatus: string, fileDelivered?: boolean): DeviceReportResult {
  return {
    kind: 'stop',
    code: 'SCAN_DEVICE_TASK_ENDED',
    details: {
      taskStatus,
      ...(fileDelivered !== undefined ? { fileDelivered } : {}),
    },
  }
}

function axiosWithDetails(code: string, details: Record<string, unknown>): unknown {
  const error = axiosStatus(409, code) as { response: { data: { error: { details?: unknown } } } }
  error.response.data.error.details = details
  return error
}

/** 探查结果的每一种，以及旧后端不带 details 时客户端原样解析。 */
export async function verifyDeliveryProbeMatrix(): Promise<void> {
  assert.equal(verdictFromDeliveryProbe(ended('completed')), 'received')
  assert.equal(verdictFromDeliveryProbe(ended('cancelled', true)), 'received')
  assert.equal(verdictFromDeliveryProbe(ended('expired', true)), 'received')
  assert.equal(verdictFromDeliveryProbe({ kind: 'stop', code: 'SCAN_DEVICE_TASK_ENDED', details: { fileDelivered: true } }), 'received')
  for (const status of ['cancelled', 'expired', 'failed']) {
    assert.equal(verdictFromDeliveryProbe(ended(status, false)), 'rejected', status)
  }
  assert.equal(verdictFromDeliveryProbe(ended('waiting', false)), 'waiting')
  assert.equal(verdictFromDeliveryProbe({ kind: 'ok' }), 'waiting')
  assert.equal(verdictFromDeliveryProbe({ kind: 'stop', code: 'SCAN_DEVICE_TASK_ENDED' }), 'uncertain')
  assert.equal(verdictFromDeliveryProbe({ kind: 'stop', code: 'TASK_ENDED' }), 'uncertain')
  assert.equal(verdictFromDeliveryProbe({ kind: 'stop', code: 'TASK_CANCELLED' }), 'rejected')
  assert.equal(verdictFromDeliveryProbe({ kind: 'rejected', code: 'SCAN_DEVICE_TASK_DELIVERING', details: { taskStatus: 'matched' } }), 'uncertain')
  assert.equal(verdictFromDeliveryProbe({ kind: 'unavailable' }), 'uncertain')
  assert.equal(verdictFromDeliveryProbe({ kind: 'unauthorized' }), 'uncertain')
  assert.equal(SCAN_DEVICE_DELIVERY_RECHECK_MS, 30_000)

  const detailed = {
    async post() {
      throw axiosWithDetails('SCAN_DEVICE_TASK_ENDED', {
        taskStatus: 'expired',
        fileDelivered: false,
        hardExpiresAt: '2026-11-04T00:00:00.000Z',
        ignored: 1,
      })
    },
  } as unknown as AxiosInstance
  assert.deepEqual(
    await postDeviceReport(detailed, 'terminal-scan-device', 'taskA', { state: 'delivering', pageCount: 1 }),
    {
      kind: 'stop',
      code: 'SCAN_DEVICE_TASK_ENDED',
      details: { taskStatus: 'expired', fileDelivered: false, hardExpiresAt: '2026-11-04T00:00:00.000Z' },
    },
  )
  const bare = { async post() { throw axiosStatus(409, 'SCAN_DEVICE_TASK_ENDED') } } as unknown as AxiosInstance
  assert.deepEqual(
    await postDeviceReport(bare, 'terminal-scan-device', 'taskA', { state: 'delivering', pageCount: 1 }),
    { kind: 'stop', code: 'SCAN_DEVICE_TASK_ENDED' },
  )
  const accepted = {
    async post() {
      return { data: { data: { deviceRound: 5, expiresAt: '2026-11-04T00:00:00.000Z' } } }
    },
  } as unknown as AxiosInstance
  assert.deepEqual(
    await postDeviceReport(accepted, 'terminal-scan-device', 'taskA', { state: 'scanning', pageCount: 0 }),
    { kind: 'ok', deviceRound: 5, expiresAt: '2026-11-04T00:00:00.000Z' },
  )
  const empty = { async post() { return { data: {} } } } as unknown as AxiosInstance
  assert.deepEqual(await postDeviceReport(empty, 'terminal-scan-device', 'taskA', { state: 'scanning', pageCount: 0 }), { kind: 'ok' })

  const form = buildScanDeliveryForm({
    bytes: Buffer.from('x'),
    filename: 'scan.pdf',
    scanTaskId: 't',
    deliveryLease: 'l',
    candidateSnapshotAt: '2026-11-04T00:00:00.000Z',
    origin: 'device',
    deviceRound: 5,
  })
  const names = [...form.getBuffer().toString('latin1').matchAll(/name="([^"]+)"/g)].map((match) => match[1])
  assert.deepEqual(names.at(-1), 'deviceRound')
  const plain = buildScanDeliveryForm({
    bytes: Buffer.from('x'),
    filename: 'scan.pdf',
    scanTaskId: 't',
    deliveryLease: 'l',
    candidateSnapshotAt: '2026-11-04T00:00:00.000Z',
    origin: 'device',
  })
  assert.equal(plain.getBuffer().toString('latin1').includes('deviceRound'), false)
}

/** 取租约还没回来时中止，租约回来后不得建会话、不得开扫。 */
export async function verifyAbortDuringLeaseDoesNotStartScan(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  let fetches = 0
  let releaseLease: (value: FetchDeviceLeaseResult) => void = () => undefined
  const runtime = bindRuntime(harness, {
    fetchLease: () => {
      fetches += 1
      if (fetches === 1) return new Promise((resolve) => { releaseLease = resolve })
      return Promise.resolve(harness.lease.current)
    },
  })
  harness.lease.current = { kind: 'lease', lease: deviceLease('leaseAbort', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(harness.scanner, { pages: [{ bytes: 20 }] })
  const pending = runtime.start('leaseAbort')
  try {
    await flush()
    assert.equal(fetches, 1)
    assert.equal(harness.scanner.calls.length, 0)
    const aborting = runtime.abort('leaseAbort')
    releaseLease(harness.lease.current)
    const started = await pending
    const aborted = await aborting
    assert.equal(harness.scanner.calls.length, 0, '取租约期间中止不得开扫')
    assert.equal(started.state, 'aborted')
    assert.equal(aborted.state, 'aborted')
    assert.equal(fs.existsSync(path.join(root, 'leaseAbort')), false)
  } finally {
    releaseLease(harness.lease.current)
    await runtime.stop()
  }
}

/** 强杀之后的探测还挂着时中止，探测回来后不得建目录、不得开扫。 */
export async function verifyAbortDuringProbeBeforeDirDoesNotScan(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  let holdProbe = false
  let releaseProbe: () => void = () => undefined
  const runtime = bindRuntime(harness, {
    isProcessAlive: () => false,
    runProbe: async () => {
      if (holdProbe) await new Promise<void>((resolve) => { releaseProbe = resolve })
      // 第一次收尾探测不能回报 ready，否则可疑进程会被清掉，第二次开始就不会再等探测。
      return probeResult('not_found')
    },
  })
  harness.lease.current = { kind: 'lease', lease: deviceLease('beforeDir', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(harness.scanner, { pages: [{ bytes: 20 }], holdAfterPage: true, forceKillOnAbort: true, stopUnconfirmed: true, processId: 4242 })
  try {
    await runtime.start('beforeDir')
    await flush()
    const firstAbort = runtime.abort('beforeDir')
    await flush()
    harness.scanner.release()
    await firstAbort
    assert.equal(harness.scanner.calls.length, 1)
    const probesBefore = harness.probeCalls.count
    holdProbe = true
    pushScript(harness.scanner, { pages: [{ bytes: 20 }] })
    const pending = runtime.start('beforeDir')
    await flush()
    assert.ok(harness.probeCalls.count > probesBefore, '建目录前确实在等探测')
    assert.equal(harness.scanner.calls.length, 1)
    const aborting = runtime.abort('beforeDir')
    await flush()
    releaseProbe()
    const started = await pending
    const aborted = await aborting
    assert.equal(harness.scanner.calls.length, 1, '建目录前中止不得开扫')
    assert.equal(started.state, 'aborted')
    assert.equal(aborted.state, 'aborted')
  } finally {
    releaseProbe()
    harness.scanner.release()
    await runtime.stop()
  }
}

/** page_ready 回报回来之后先看取消标记，取消了就不得再起 10 分钟空闲计时。 */
export async function verifyAbortAfterPageReadyReportDoesNotArmIdle(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  let releaseReport: () => void = () => undefined
  let sawPageReady = false
  const runtime = bindRuntime(harness, {
    report: async (body) => {
      if (body.state === 'page_ready') {
        sawPageReady = true
        await new Promise<void>((resolve) => { releaseReport = resolve })
      }
      return { kind: 'ok' }
    },
  })
  harness.lease.current = { kind: 'lease', lease: deviceLease('armIdle', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(harness.scanner, { pages: [{ bytes: 20 }] })
  try {
    await runtime.start('armIdle')
    for (let i = 0; i < 10 && !sawPageReady; i += 1) await flush()
    assert.equal(sawPageReady, true)
    assert.equal(harness.clock.scheduled.includes(SCAN_DEVICE_PAGE_READY_IDLE_MS), false)
    const aborting = runtime.abort('armIdle')
    await flush()
    releaseReport()
    const aborted = await aborting
    await runtime.whenIdle()
    assert.equal(aborted.state, 'aborted')
    assert.equal(harness.clock.scheduled.includes(SCAN_DEVICE_PAGE_READY_IDLE_MS), false, '回报回来后已取消，不得起空闲计时')
    assert.equal(fs.existsSync(path.join(root, 'armIdle')), false)
  } finally {
    releaseReport()
    await runtime.stop()
  }
}

/** 下一页的租约挂在队列外面。它还没回来时，空闲截止仍然能删页，回来后不得再扫。 */
export async function verifyNextPageLeaseDoesNotBlockIdleCleanup(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  let hang = false
  let hangPromise: Promise<FetchDeviceLeaseResult> | undefined
  let releaseHang: (value: FetchDeviceLeaseResult) => void = () => undefined
  const runtime = bindRuntime(harness, {
    fetchLease: () => {
      if (!hang) return Promise.resolve(harness.lease.current)
      if (!hangPromise) hangPromise = new Promise((resolve) => { releaseHang = resolve })
      return hangPromise
    },
  })
  try {
    await toPageReady(harness, runtime, 'idleLease')
    assert.equal(harness.scanner.calls.length, 1)
    hang = true
    pushScript(harness.scanner, { pages: [{ bytes: 12 }] })
    const pending = runtime.nextPage('idleLease')
    await flush()
    harness.clock.advance(SCAN_DEVICE_PAGE_READY_IDLE_MS)
    await flush()
    assert.equal(fs.existsSync(path.join(root, 'idleLease')), false, '租约还挂着时截止清理不得被挡住')
    assert.equal(harness.scanner.calls.length, 1)
    releaseHang(harness.lease.current)
    const view = await pending
    assert.notEqual(view.state, 'scanning')
    assert.equal(harness.scanner.calls.length, 1, '过了截止的租约回来后不得开扫')
  } finally {
    releaseHang({ kind: 'none' })
    await runtime.stop()
  }
}

/** 租约在截止之后才回来，而且空闲计时器还没跑：开扫前再看绝对时间，不得扫。 */
export async function verifyNextPageRechecksDeadlineAfterLease(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  let jump = false
  const runtime = bindRuntime(harness, {
    fetchLease: async () => {
      if (jump) harness.clock.jump(SCAN_DEVICE_PAGE_READY_IDLE_MS)
      return harness.lease.current
    },
  })
  try {
    await toPageReady(harness, runtime, 'lateLease')
    jump = true
    pushScript(harness.scanner, { pages: [{ bytes: 12 }] })
    const view = await runtime.nextPage('lateLease')
    assert.notEqual(view.state, 'scanning')
    assert.equal(harness.scanner.calls.length, 1, '租约回来时已经过了截止，不得开扫')
    assert.equal(fs.existsSync(path.join(root, 'lateLease')), false)
    assert.ok(harness.reports.some((row) => row.state === 'aborted'))
  } finally {
    await runtime.stop()
  }
}

/** 租约还在，但探查说已完成：算已投递。租约没了且没有 taskStatus：保持不确定，不删页。 */
export async function verifyDeliveryIgnoresLeasePresence(root: string, db: AgentDatabase): Promise<void> {
  const before = snapshot(db)
  let uploaded = false
  const harness = createHarness({ root: path.join(root, 'stay'), config: agentConfig(), reportDelaysMs: [0, 0] })
  const runtime = bindRuntime(harness, {
    deliver: async () => {
      uploaded = true
      throw new Error('lost response')
    },
    fetchLease: async () => harness.lease.current,
    report: async (body) => (uploaded && body.state === 'delivering' ? ended('completed', false) : { kind: 'ok' }),
  })
  try {
    await toPageReady(harness, runtime, 'leaseStays')
    const view = await runtime.finish('leaseStays')
    assert.equal(view.state, 'delivering')
    assert.equal(harness.deliveries.length, 1)
    assert.equal(fs.existsSync(path.join(harness.root, 'leaseStays')), false)
    assert.ok(reasonsSince(db, before).includes('SCAN_DEVICE_DELIVERED'))
  } finally {
    await runtime.stop()
  }

  let lost = false
  const absent = createHarness({ root: path.join(root, 'gone'), config: agentConfig(), reportDelaysMs: [0, 0] })
  const absentRuntime = bindRuntime(absent, {
    deliver: async () => {
      lost = true
      throw new Error('lost response')
    },
    fetchLease: async () => (lost ? { kind: 'none' } : absent.lease.current),
    report: async (body) => (lost && body.state === 'delivering' ? { kind: 'stop', code: 'SCAN_DEVICE_TASK_ENDED' } : { kind: 'ok' }),
  })
  try {
    await toPageReady(absent, absentRuntime, 'leaseGone')
    await assert.rejects(absentRuntime.finish('leaseGone'), (error: unknown) => {
      assert.ok(error instanceof LocalScanError)
      assert.equal(error.code, 'LOCAL_SCAN_DELIVERY_UNCONFIRMED')
      assert.equal(error.message, '投递结果不确定')
      return true
    })
    assert.equal(absent.deliveries.length, 1, '租约没了且没有 taskStatus，不得当成已投递再传或删页')
    assert.equal(fs.existsSync(path.join(absent.root, 'leaseGone')), true)
  } finally {
    await absentRuntime.stop()
  }
}

/** cancelled / expired / failed 且没投出文件：删页，不说已投递。fileDelivered 为真则仍算已投递。 */
export async function verifyDeliveryProbeEndedNotDelivered(root: string, db: AgentDatabase): Promise<void> {
  for (const status of ['cancelled', 'expired', 'failed'] as const) {
    const before = snapshot(db)
    let lost = false
    const harness = createHarness({ root: path.join(root, status), config: agentConfig(), reportDelaysMs: [0, 0] })
    const runtime = bindRuntime(harness, {
      deliver: async () => {
        lost = true
        throw new Error('lost response')
      },
      fetchLease: async () => harness.lease.current,
      report: async (body) => (lost && body.state === 'delivering' ? ended(status, false) : { kind: 'ok' }),
    })
    try {
      await toPageReady(harness, runtime, status)
      const view = await runtime.finish(status)
      assert.equal(view.state, 'error', status)
      assert.notEqual(view.state, 'delivering', status)
      assert.equal(harness.deliveries.length, 1, status)
      assert.equal(fs.existsSync(path.join(harness.root, status)), false, status)
      assert.ok(reasonsSince(db, before).includes('SCAN_DEVICE_FAILED'), status)
    } finally {
      await runtime.stop()
    }
  }

  const before = snapshot(db)
  let lost = false
  const harness = createHarness({ root: path.join(root, 'kept'), config: agentConfig(), reportDelaysMs: [0, 0] })
  const runtime = bindRuntime(harness, {
    deliver: async () => {
      lost = true
      throw new Error('lost response')
    },
    report: async (body) => (lost && body.state === 'delivering' ? ended('cancelled', true) : { kind: 'ok' }),
  })
  try {
    await toPageReady(harness, runtime, 'keptFile')
    const view = await runtime.finish('keptFile')
    assert.equal(view.state, 'delivering')
    assert.equal(harness.deliveries.length, 1)
    assert.ok(reasonsSince(db, before).includes('SCAN_DEVICE_DELIVERED'))
  } finally {
    await runtime.stop()
  }
}

/** 探查仍是 waiting：用同一份 PDF 再投一次。重复内容回已投递也算收下。再失败就停，不连着投第三次。 */
export async function verifyDeliveryProbeWaitingRetriesOnce(root: string, db: AgentDatabase): Promise<void> {
  const before = snapshot(db)
  let uploads = 0
  const once = createHarness({ root: path.join(root, 'once'), config: agentConfig(), reportDelaysMs: [0, 0] })
  const onceRuntime = bindRuntime(once, {
    deliver: async () => {
      uploads += 1
      if (uploads === 1) throw new Error('lost response')
    },
    report: async (body) => (uploads >= 1 && body.state === 'delivering' ? ended('waiting', false) : { kind: 'ok' }),
  })
  try {
    await toPageReady(once, onceRuntime, 'retryOnce')
    const view = await onceRuntime.finish('retryOnce')
    assert.equal(view.state, 'delivering')
    assert.equal(once.deliveries.length, 2)
    assert.equal(once.deliveries[0]?.bytes, once.deliveries[1]?.bytes)
    assert.ok(reasonsSince(db, before).includes('SCAN_DEVICE_DELIVERED'))
  } finally {
    await onceRuntime.stop()
  }

  let tries = 0
  const already = createHarness({ root: path.join(root, 'already'), config: agentConfig(), reportDelaysMs: [0, 0] })
  const alreadyRuntime = bindRuntime(already, {
    deliver: async () => {
      tries += 1
      if (tries === 1) throw new Error('lost response')
      throw axiosStatus(409, 'SCAN_FILE_ALREADY_DELIVERED')
    },
    report: async (body) => (tries >= 1 && body.state === 'delivering' ? ended('waiting', false) : { kind: 'ok' }),
  })
  try {
    await toPageReady(already, alreadyRuntime, 'alreadyIn')
    const view = await alreadyRuntime.finish('alreadyIn')
    assert.equal(view.state, 'delivering')
    assert.equal(already.deliveries.length, 2)
  } finally {
    await alreadyRuntime.stop()
  }

  let attempts = 0
  let probes = 0
  const stuck = createHarness({ root: path.join(root, 'stuck'), config: agentConfig(), reportDelaysMs: [0, 0] })
  const stuckRuntime = bindRuntime(stuck, {
    deliver: async () => {
      attempts += 1
      throw new Error('lost response')
    },
    report: async (body) => {
      if (attempts >= 1 && body.state === 'delivering') {
        probes += 1
        return ended('waiting', false)
      }
      return { kind: 'ok' }
    },
  })
  try {
    await toPageReady(stuck, stuckRuntime, 'stillWait')
    await assert.rejects(stuckRuntime.finish('stillWait'), (error: unknown) => {
      assert.ok(error instanceof LocalScanError)
      assert.equal(error.code, 'LOCAL_SCAN_DELIVERY_UNCONFIRMED')
      return true
    })
    assert.equal(attempts, 2, '同一轮里 waiting 只重投一次')
    assert.equal(probes, 2)
    assert.equal(fs.existsSync(path.join(stuck.root, 'stillWait')), true)
  } finally {
    await stuckRuntime.stop()
  }
}

/** matched 且没有 fileDelivered：还在途，保持不确定，不得当成已投递再投一次。 */
export async function verifyDeliveryProbeMatchedStaysUncertain(root: string): Promise<void> {
  let lost = false
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  const runtime = bindRuntime(harness, {
    deliver: async () => {
      lost = true
      throw new Error('lost response')
    },
    report: async (body) => (
      lost && body.state === 'delivering'
        ? { kind: 'rejected', code: 'SCAN_DEVICE_TASK_DELIVERING', details: { taskStatus: 'matched' } }
        : { kind: 'ok' }
    ),
  })
  try {
    await toPageReady(harness, runtime, 'matched')
    await assert.rejects(runtime.finish('matched'), (error: unknown) => {
      assert.ok(error instanceof LocalScanError)
      assert.equal(error.code, 'LOCAL_SCAN_DELIVERY_UNCONFIRMED')
      assert.equal(error.message, '投递结果不确定')
      return true
    })
    assert.equal(harness.deliveries.length, 1)
  } finally {
    await runtime.stop()
  }
}

/** 断网就隔 30 秒再探，到 hardExpiresAt 仍不确定就删页，本机仍说结果不确定。 */
export async function verifyDeliveryRecheckUntilHardExpiry(root: string, db: AgentDatabase): Promise<void> {
  const before = snapshot(db)
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  const hardAt = harness.clock.now() + 50_000
  let lost = false
  const runtime = bindRuntime(harness, {
    deliver: async () => {
      lost = true
      throw new Error('lost response')
    },
    fetchLease: async () => harness.lease.current,
    report: async () => (lost ? { kind: 'unavailable' } : { kind: 'ok' }),
  })
  harness.lease.current = {
    kind: 'lease',
    lease: deviceLease('recheck', harness.clock.now(), {
      device: { source: 'flatbed', colorMode: 'gray' },
      expiresAt: new Date(harness.clock.now() + 600_000).toISOString(),
      hardExpiresAt: new Date(hardAt).toISOString(),
    }),
  }
  pushScript(harness.scanner, { pages: [{ bytes: 16 }] })
  try {
    await runtime.start('recheck')
    await runtime.whenIdle()
    await assert.rejects(runtime.finish('recheck'), (error: unknown) => {
      assert.ok(error instanceof LocalScanError)
      assert.equal(error.code, 'LOCAL_SCAN_DELIVERY_UNCONFIRMED')
      assert.equal(error.message, '投递结果不确定')
      return true
    })
    assert.equal(harness.deliveries.length, 1)
    assert.equal(fs.existsSync(path.join(root, 'recheck')), true)
    assert.ok(harness.clock.scheduled.includes(SCAN_DEVICE_DELIVERY_RECHECK_MS))
    harness.clock.advance(SCAN_DEVICE_DELIVERY_RECHECK_MS)
    await flush()
    assert.equal(fs.existsSync(path.join(root, 'recheck')), true, '还没到硬截止，页先留着')
    assert.equal(harness.deliveries.length, 1)
    harness.clock.advance(SCAN_DEVICE_DELIVERY_RECHECK_MS)
    await flush()
    assert.equal(fs.existsSync(path.join(root, 'recheck')), false)
    assert.ok(reasonsSince(db, before).includes('SCAN_DEVICE_FAILED'))
    await assert.rejects(runtime.abort('recheck'), (error: unknown) => {
      assert.ok(error instanceof LocalScanError)
      assert.equal(error.code, 'LOCAL_SCAN_DELIVERY_UNCONFIRMED')
      assert.equal(error.message, '投递结果不确定')
      return true
    })
    await assert.rejects(runtime.finish('recheck'), (error: unknown) => {
      assert.ok(error instanceof LocalScanError)
      assert.equal(error.code, 'LOCAL_SCAN_DELIVERY_UNCONFIRMED')
      return true
    })
  } finally {
    await runtime.stop()
  }
}

/** scanning 回报里的 deviceRound 带到投递；没带就不传这个字段。换了轮次就作废，不合成。 */
export async function verifyDeliveryCarriesDeviceRound(root: string, db: AgentDatabase): Promise<void> {
  const harness = createHarness({ root: path.join(root, 'round'), config: agentConfig(), reportDelaysMs: [0, 0] })
  const runtime = bindRuntime(harness, {
    report: async (body) => (body.state === 'scanning' ? { kind: 'ok', deviceRound: 7 } : { kind: 'ok' }),
  })
  try {
    await toPageReady(harness, runtime, 'round7')
    const view = await runtime.finish('round7')
    assert.equal(view.state, 'delivering')
    assert.equal(harness.deliveries.length, 1)
    assert.equal(harness.deliveries[0]?.deviceRound, 7)
  } finally {
    await runtime.stop()
  }

  const plain = createHarness({ root: path.join(root, 'noround'), config: agentConfig(), reportDelaysMs: [0, 0] })
  const plainRuntime = bindRuntime(plain, {})
  try {
    await toPageReady(plain, plainRuntime, 'noRound')
    await plainRuntime.finish('noRound')
    assert.equal(plain.deliveries[0]?.deviceRound, undefined)
  } finally {
    await plainRuntime.stop()
  }

  const before = snapshot(db)
  let scanning = 0
  const changed = createHarness({ root: path.join(root, 'changed'), config: agentConfig(), reportDelaysMs: [0, 0] })
  const changedRuntime = bindRuntime(changed, {
    report: async (body) => {
      if (body.state !== 'scanning') return { kind: 'ok' }
      scanning += 1
      return { kind: 'ok', deviceRound: scanning === 1 ? 1 : 2 }
    },
  })
  try {
    changed.lease.current = { kind: 'lease', lease: deviceLease('newRound', changed.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
    pushScript(changed.scanner, { pages: [{ bytes: 18 }] })
    await changedRuntime.start('newRound')
    await changedRuntime.whenIdle()
    assert.equal(changed.deliveries.length, 0, '换了轮次不得把两场页合成一份 PDF')
    assert.equal(fs.existsSync(path.join(changed.root, 'newRound')), false)
    assert.ok(reasonsSince(db, before).includes('SCAN_DEVICE_SESSION_CLEARED'))
    assert.ok(scanning >= 2)
  } finally {
    await changedRuntime.stop()
  }
}

export async function verifyRound4(root: string, db: AgentDatabase): Promise<void> {
  await verifyDeliveryProbeMatrix()
  await verifyAbortDuringLeaseDoesNotStartScan(path.join(root, 'lease'))
  await verifyAbortDuringProbeBeforeDirDoesNotScan(path.join(root, 'probe'))
  await verifyAbortAfterPageReadyReportDoesNotArmIdle(path.join(root, 'idle-arm'))
  await verifyNextPageLeaseDoesNotBlockIdleCleanup(path.join(root, 'next-hang'))
  await verifyNextPageRechecksDeadlineAfterLease(path.join(root, 'next-late'))
  await verifyDeliveryIgnoresLeasePresence(path.join(root, 'lease-signal'), db)
  await verifyDeliveryProbeEndedNotDelivered(path.join(root, 'ended'), db)
  await verifyDeliveryProbeWaitingRetriesOnce(path.join(root, 'waiting'), db)
  await verifyDeliveryProbeMatchedStaysUncertain(path.join(root, 'matched'))
  await verifyDeliveryRecheckUntilHardExpiry(path.join(root, 'recheck'), db)
  await verifyDeliveryCarriesDeviceRound(path.join(root, 'device-round'), db)
}
