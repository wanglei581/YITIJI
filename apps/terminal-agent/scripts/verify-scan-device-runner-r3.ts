/**
 * 屏上扫描接线第三轮的行为门禁。由 verify-scan-device-runner.ts 调用。
 * 不起 PowerShell，不碰扫描仪。不 import 引擎 helper（那份文件一加载就会改 PROGRAMDATA）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { getScanDeletionAudits, type AgentDatabase } from '../src/agent/db'
import type { DeviceReportBody, DeviceReportResult, FetchDeviceLeaseResult } from '../src/agent/scan-device/scan-device-backend'
import type { ResidualSurvey } from '../src/agent/scan-device/scan-device-health'
import { SCAN_DEVICE_CLEANUP_RETRY_MS, SCAN_DEVICE_PAGE_READY_IDLE_MS, cleanupJobMayDelete } from '../src/agent/scan-device/scan-device-housekeeping'
import { createScanDeviceRuntime, type ScanDeviceRuntime } from '../src/agent/scan-device/scan-device-runner'
import { LocalScanError } from '../src/agent/scan-device/scan-device-types'
import { purgeScanTaskDir } from '../src/agent/scan-device/scan-temp-dir'
import { buildWiaPowerShellArgs, buildWiaProbeScript, commandLineIsOurWiaProcess, encodeWiaCommand } from '../src/agent/scan-device/wia-script'
import {
  agentConfig,
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

function ourCommandLine(): string {
  const args = buildWiaPowerShellArgs(encodeWiaCommand(buildWiaProbeScript('')))
  return `C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe ${args.join(' ')}`
}

async function toPageReady(harness: Harness, taskId: string): Promise<void> {
  harness.lease.current = {
    kind: 'lease',
    lease: deviceLease(taskId, harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }),
  }
  pushScript(harness.scanner, { pages: [{ bytes: 40 }] })
  await harness.runtime.start(taskId)
  await harness.runtime.whenIdle()
}

function bindRuntime(harness: Harness, patch: {
  deliver?: (input: { scanTaskId: string }) => Promise<void>
  fetchLease?: () => Promise<FetchDeviceLeaseResult>
  report?: (body: DeviceReportBody) => Promise<DeviceReportResult>
  runProbe?: ScanDeviceRuntime extends never ? never : () => Promise<ReturnType<typeof probeResult>>
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
      if (patch.deliver) await patch.deliver(input)
    },
    fetchLease: async () => (patch.fetchLease ? patch.fetchLease() : harness.lease.current),
    report: async (_id, body) => {
      harness.reports.push(body)
      return patch.report ? patch.report(body) : { kind: 'ok' }
    },
    readFile: async () => Buffer.from('%PDF-test'),
    clock: harness.clock,
    lock: harness.lock,
    root: harness.root,
    reportDelaysMs: [0, 0],
  })
}

/** 探测强杀未确认也进健康管理器；命令行能认出本程序拉起的 PowerShell。 */
export async function verifyProbeStopReachesHealth(root: string): Promise<void> {
  const line = ourCommandLine()
  assert.equal(commandLineIsOurWiaProcess(line), true)
  assert.equal(commandLineIsOurWiaProcess('powershell.exe -NoProfile -Command "Get-CimInstance"'), false)
  assert.equal(commandLineIsOurWiaProcess('notepad.exe -EncodedCommand QUJD'), false)

  let mode: 'stop' | 'ready' = 'stop'
  let alive = true
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0], isProcessAlive: () => alive })
  const runtime = createScanDeviceRuntime(agentConfig(), {
    startScan: harness.scanner.start,
    runProbe: async () => {
      harness.probeCalls.count += 1
      if (mode === 'stop') {
        return { state: 'error' as const, forceKilled: true, stopUnconfirmed: true, processId: 77, elapsedMs: 1 }
      }
      return probeResult('ready')
    },
    compose: async () => ({ ok: true as const, path: path.join(root, 'probe', 'scan.pdf'), pageCount: 1, bytes: 4 }),
    deliver: async () => undefined,
    fetchLease: async () => harness.lease.current,
    report: async () => ({ kind: 'ok' as const }),
    readFile: async () => Buffer.from('pdf'),
    isProcessAlive: () => alive,
    clock: harness.clock,
    lock: harness.lock,
    root,
    reportDelaysMs: [0, 0],
  })
  const first = await runtime.probe()
  assert.equal(first.health, 'error')
  assert.equal(harness.probeCalls.count, 1)
  const second = await runtime.probe()
  assert.equal(second.health, 'error')
  assert.equal(harness.probeCalls.count, 1, '已知 PID 还在时不得再连扫描仪')
  harness.lease.current = { kind: 'lease', lease: deviceLease('probe', harness.clock.now()) }
  const blocked = await runtime.start('probe')
  assert.equal(blocked.state, 'error')
  assert.equal(blocked.errorCode, 'busy')
  assert.equal(harness.scanner.calls.length, 0)
  assert.equal(harness.probeCalls.count, 1)
  alive = false
  mode = 'ready'
  const cleared = await runtime.probe()
  assert.equal(cleared.health, 'ready')
  assert.equal(harness.probeCalls.count, 2)
  await runtime.stop()

  let residuals: ResidualSurvey = { kind: 'ok', processes: [{ pid: 9, commandLine: line }] }
  let anon: 'stop' | 'ready' = 'stop'
  const anonCalls = { count: 0 }
  const anonRuntime = createScanDeviceRuntime(agentConfig(), {
    startScan: harness.scanner.start,
    runProbe: async () => {
      anonCalls.count += 1
      if (anon === 'stop') return { state: 'error' as const, forceKilled: true, stopUnconfirmed: true, elapsedMs: 1 }
      return probeResult('ready')
    },
    compose: async () => ({ ok: true as const, path: path.join(root, 'anon', 'scan.pdf'), pageCount: 1, bytes: 4 }),
    deliver: async () => undefined,
    fetchLease: async () => ({ kind: 'lease' as const, lease: deviceLease('anon', harness.clock.now()) }),
    report: async () => ({ kind: 'ok' as const }),
    readFile: async () => Buffer.from('pdf'),
    listResiduals: () => residuals,
    clock: harness.clock,
    lock: harness.lock,
    root,
    reportDelaysMs: [0, 0],
  })
  assert.equal((await anonRuntime.probe()).health, 'error')
  assert.equal(anonCalls.count, 1)
  assert.equal((await anonRuntime.probe()).health, 'error')
  assert.equal(anonCalls.count, 1, '没有 PID 且还能看见本程序的 PowerShell 时不得再连')
  residuals = { kind: 'ok', processes: [] }
  anon = 'ready'
  assert.equal((await anonRuntime.probe()).health, 'ready')
  assert.equal(anonCalls.count, 2, '残留列表空了才允许再探测，探测成功才解除')
  await anonRuntime.stop()
}

/** 没有 PID 的未确认退出不删目录，直到探测成功且没有残留进程。 */
export async function verifyUnconfirmedWithoutPidKeepsDirectory(root: string): Promise<void> {
  const line = ourCommandLine()
  let residuals: ResidualSurvey = { kind: 'ok', processes: [{ pid: 9, commandLine: line }] }
  const harness = createHarness({
    root,
    config: agentConfig(),
    reportDelaysMs: [0, 0],
    listResiduals: () => residuals,
  })
  harness.lease.current = { kind: 'lease', lease: deviceLease('nopid', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(harness.scanner, { pages: [{ bytes: 20 }], holdAfterPage: true, forceKillOnAbort: true, stopUnconfirmed: true })
  await harness.runtime.start('nopid')
  await flush()
  const pending = harness.runtime.abort('nopid')
  await flush()
  harness.scanner.release()
  const aborted = await pending
  assert.equal(aborted.state, 'aborted')
  assert.equal(aborted.purged, false)
  assert.equal(fs.existsSync(path.join(root, 'nopid')), true)
  assert.equal(harness.runtime.cleanupPending(), 1)
  harness.clock.advance(SCAN_DEVICE_CLEANUP_RETRY_MS)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'nopid')), true, '没有 PID 时重试也不许删')
  await harness.runtime.probe()
  harness.clock.advance(SCAN_DEVICE_CLEANUP_RETRY_MS)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'nopid')), true, '还能看见残留进程时探测不得解除')
  residuals = { kind: 'ok', processes: [] }
  const cleared = await harness.runtime.probe()
  assert.equal(cleared.health, 'ready')
  harness.clock.advance(SCAN_DEVICE_CLEANUP_RETRY_MS)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'nopid')), false)
  assert.equal(harness.runtime.cleanupPending(), 0)
  await harness.runtime.stop()
}

/** 会话已经投递之后再点中止，接口说已投递。 */
export async function verifyAbortAfterDeliverySaysDelivered(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  await toPageReady(harness, 'later')
  const done = await harness.runtime.finish('later')
  assert.equal(done.state, 'delivering')
  assert.equal(harness.deliveries.length, 1)
  const aborted = await harness.runtime.abort('later')
  assert.equal(aborted.state, 'delivering')
  await harness.runtime.stop()
}

/**
 * 上传结果不确定时不说已中止，也不说已投递。
 * 第四轮起不再用租约还在不在推断：没收下看 409 里的 taskStatus=cancelled，
 * 已收下看 taskStatus=completed。租约在这两种里都还在。
 */
export async function verifyUncertainUploadDoesNotClaimAbort(root: string): Promise<void> {
  const rejected = createHarness({ root: path.join(root, 'rej'), config: agentConfig(), reportDelaysMs: [0, 0] })
  let lost = false
  const rejectedRuntime = bindRuntime(rejected, {
    deliver: async () => {
      lost = true
      throw new Error('lost response')
    },
    fetchLease: async () => rejected.lease.current,
    report: async (body) => {
      if (lost && body.state === 'delivering') {
        return { kind: 'stop', code: 'SCAN_DEVICE_TASK_ENDED', details: { taskStatus: 'cancelled', fileDelivered: false } }
      }
      return { kind: 'ok' }
    },
  })
  rejected.lease.current = { kind: 'lease', lease: deviceLease('rej', rejected.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(rejected.scanner, { pages: [{ bytes: 20 }] })
  await rejectedRuntime.start('rej')
  await rejectedRuntime.whenIdle()
  const failed = await rejectedRuntime.finish('rej')
  assert.equal(failed.state, 'error')
  assert.notEqual(failed.state, 'aborted')
  assert.notEqual(failed.state, 'delivering')
  assert.equal(rejected.deliveries.length, 1, '确认没被收下时不得再传一次')
  await rejectedRuntime.stop()

  const received = createHarness({ root: path.join(root, 'got'), config: agentConfig(), reportDelaysMs: [0, 0] })
  let uploaded = false
  const receivedRuntime = bindRuntime(received, {
    deliver: async () => {
      uploaded = true
      throw new Error('lost response')
    },
    fetchLease: async () => received.lease.current,
    report: async (body) => {
      if (uploaded && body.state === 'delivering') {
        return { kind: 'stop', code: 'SCAN_DEVICE_TASK_ENDED', details: { taskStatus: 'completed', fileDelivered: true } }
      }
      return { kind: 'ok' }
    },
  })
  received.lease.current = { kind: 'lease', lease: deviceLease('got', received.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(received.scanner, { pages: [{ bytes: 20 }] })
  await receivedRuntime.start('got')
  await receivedRuntime.whenIdle()
  const delivered = await receivedRuntime.finish('got')
  assert.equal(delivered.state, 'delivering')
  assert.equal(received.deliveries.length, 1)
  await receivedRuntime.stop()

  const unknown = createHarness({ root: path.join(root, 'unk'), config: agentConfig(), reportDelaysMs: [0, 0] })
  let unsure = false
  const unknownRuntime = bindRuntime(unknown, {
    deliver: async () => {
      unsure = true
      throw new Error('lost response')
    },
    fetchLease: async () => (unsure ? { kind: 'unavailable' } : unknown.lease.current),
    report: async () => (unsure ? { kind: 'unavailable' } : { kind: 'ok' }),
  })
  unknown.lease.current = { kind: 'lease', lease: deviceLease('unk', unknown.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(unknown.scanner, { pages: [{ bytes: 20 }] })
  await unknownRuntime.start('unk')
  await unknownRuntime.whenIdle()
  await assert.rejects(unknownRuntime.finish('unk'), (error: unknown) => {
    assert.ok(error instanceof LocalScanError)
    assert.equal(error.code, 'LOCAL_SCAN_DELIVERY_UNCONFIRMED')
    assert.equal(error.snapshot.state, 'delivering')
    return true
  })
  await assert.rejects(unknownRuntime.abort('unk'), (error: unknown) => {
    assert.ok(error instanceof LocalScanError)
    assert.equal(error.code, 'LOCAL_SCAN_DELIVERY_UNCONFIRMED')
    return true
  })
  assert.equal(unknown.deliveries.length, 1)
  await unknownRuntime.stop()
}

/** 回报还挂着时中止要先置标记，扫描不得启动。 */
export async function verifyAbortDuringReportDoesNotStartScan(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  let releaseReport: () => void = () => undefined
  let sawScanning = false
  const runtime = bindRuntime(harness, {
    report: async (body) => {
      if (body.state === 'scanning') {
        sawScanning = true
        await new Promise<void>((resolve) => {
          releaseReport = resolve
        })
      }
      return { kind: 'ok' }
    },
  })
  harness.lease.current = { kind: 'lease', lease: deviceLease('hang', harness.clock.now()) }
  pushScript(harness.scanner, { pages: [{ bytes: 10 }] })
  const pending = runtime.start('hang')
  try {
    await flush()
    assert.equal(sawScanning, true)
    assert.equal(harness.scanner.calls.length, 0)
    const aborting = runtime.abort('hang')
    await flush()
    assert.equal(harness.scanner.calls.length, 0, '回报返回之前中止已经受理，不得开扫')
    releaseReport()
    const started = await pending
    const aborted = await aborting
    assert.equal(harness.scanner.calls.length, 0)
    assert.equal(aborted.state, 'aborted')
    assert.equal(started.state, 'aborted')
  } finally {
    releaseReport()
    await runtime.stop()
  }
}

/** 等锁失败不把 10 分钟空闲截止重新从零算。 */
export async function verifyIdleDeadlineSurvivesLockWait(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  await toPageReady(harness, 'deadline')
  harness.clock.advance(9 * 60 * 1000)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'deadline')), true)
  const holder = await harness.lock.acquire('print-claim')
  const pending = harness.runtime.nextPage('deadline')
  await flush()
  harness.clock.advance(30_000)
  await flush()
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof LocalScanError)
    assert.equal(error.code, 'LOCAL_SCAN_BUSY')
    return true
  })
  assert.equal(fs.existsSync(path.join(root, 'deadline')), true)
  harness.clock.advance(30_000)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'deadline')), false, '截止仍是进入 page_ready 时的那一个')
  assert.ok(harness.reports.some((row) => row.state === 'aborted'))
  holder.release()
  await harness.runtime.stop()
  assert.equal(SCAN_DEVICE_PAGE_READY_IDLE_MS, 10 * 60 * 1000)
}

/** 租约请求悬挂也不推迟空闲截止。 */
export async function verifyIdleDeadlineWhileLeaseHangs(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  let hang = false
  let fetches = 0
  const runtime = bindRuntime(harness, {
    fetchLease: () => {
      fetches += 1
      if (hang) return new Promise(() => undefined)
      return Promise.resolve(harness.lease.current)
    },
  })
  harness.lease.current = { kind: 'lease', lease: deviceLease('hangLease', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(harness.scanner, { pages: [{ bytes: 20 }] })
  await runtime.start('hangLease')
  await runtime.whenIdle()
  const before = fetches
  hang = true
  harness.clock.advance(SCAN_DEVICE_PAGE_READY_IDLE_MS)
  await flush()
  assert.ok(fetches > before, '空闲核对确实发出过，并且被挂起')
  assert.equal(fs.existsSync(path.join(root, 'hangLease')), false)
  assert.ok(harness.reports.some((row) => row.state === 'aborted'))
  await runtime.stop()
}

/** 补发的最后一拍被拒绝就删页，不再投递。 */
export async function verifyBackfillTargetRejectedStopsDelivery(root: string, db: AgentDatabase): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  const before = snapshot(db)
  let calls = 0
  harness.lease.current = { kind: 'lease', lease: deviceLease('target', harness.clock.now()) }
  harness.reportResult.current = () => {
    calls += 1
    if (calls <= 6) return { kind: 'unavailable' }
    if (calls === 7 || calls === 8) return { kind: 'ok' }
    if (calls === 9) return { kind: 'rejected', code: 'SCAN_DEVICE_TRANSITION_INVALID' }
    return { kind: 'ok' }
  }
  pushScript(harness.scanner, { pages: [{ bytes: 30 }] })
  await harness.runtime.start('target')
  await harness.runtime.whenIdle()
  assert.equal(harness.deliveries.length, 0, '最后一拍转移不合法就不得投递')
  assert.equal(fs.existsSync(path.join(root, 'target')), false)
  assert.ok(reasonsSince(db, before).includes('SCAN_DEVICE_FAILED'))
  const states = harness.reports.map((row) => row.state)
  assert.equal(states[states.lastIndexOf('composing') - 1], 'scanning')
  await harness.runtime.stop()
}

/** 后端状态还没核对上时，不继续补发、也不投递。 */
export async function verifyBackfillSkipsWhenStateUnknown(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  let calls = 0
  harness.lease.current = { kind: 'lease', lease: deviceLease('unknown', harness.clock.now()) }
  harness.reportResult.current = () => {
    calls += 1
    if (calls <= 6) return { kind: 'unavailable' }
    return { kind: 'unavailable' }
  }
  pushScript(harness.scanner, { pages: [{ bytes: 30 }] })
  await harness.runtime.start('unknown')
  await harness.runtime.whenIdle()
  assert.equal(harness.deliveries.length, 0)
  assert.equal(harness.reports.some((row) => row.state === 'composing'), false, '确认不了上一拍就不得发 composing')
  assert.ok(harness.reports.some((row) => row.state === 'ready'))
  await harness.runtime.stop()
}

/** 旧场次的清理重试不得删掉新场次的目录。 */
export async function verifyCleanupRetryDoesNotDeleteNewEpoch(root: string): Promise<void> {
  assert.equal(cleanupJobMayDelete({ epoch: 1, stopUnconfirmed: false }, 2, false), false)
  assert.equal(cleanupJobMayDelete({ epoch: 2, stopUnconfirmed: false }, 2, true), false)
  assert.equal(cleanupJobMayDelete({ epoch: 2, stopUnconfirmed: false }, 2, false), true)
  let failPurge = false
  const harness = createHarness({
    root,
    config: agentConfig(),
    reportDelaysMs: [0, 0],
    purge: (taskId, reason) => {
      if (failPurge) return { status: 'failed', entryCount: 1, errorCode: 'EBUSY' }
      return purgeScanTaskDir(taskId, reason, { root })
    },
  })
  await toPageReady(harness, 'epoch')
  failPurge = true
  const aborted = await harness.runtime.abort('epoch')
  assert.equal(aborted.purged, false)
  assert.equal(harness.runtime.cleanupPending(), 1)
  assert.equal(fs.existsSync(path.join(root, 'epoch')), true)
  failPurge = false
  pushScript(harness.scanner, { pages: [{ bytes: 20 }] })
  const again = await harness.runtime.start('epoch')
  assert.equal(again.state, 'scanning')
  await harness.runtime.whenIdle()
  assert.equal(fs.existsSync(path.join(root, 'epoch')), true)
  harness.clock.advance(SCAN_DEVICE_CLEANUP_RETRY_MS)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'epoch')), true, '旧场次的重试不得删掉新目录')
  assert.equal(harness.runtime.cleanupPending(), 0)
  await harness.runtime.stop()
}

/** 换参数时目录删不掉，要在响应里看见，并且不得开新的一场。 */
export async function verifyRestartPurgeFailureStaysVisible(root: string): Promise<void> {
  let failPurge = false
  const harness = createHarness({
    root,
    config: agentConfig(),
    reportDelaysMs: [0, 0],
    purge: (taskId, reason) => {
      if (failPurge) return { status: 'failed', entryCount: 1, errorCode: 'EBUSY' }
      return purgeScanTaskDir(taskId, reason, { root })
    },
  })
  await toPageReady(harness, 'again')
  harness.lease.current = {
    kind: 'lease',
    lease: deviceLease('again', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'color' } }),
  }
  failPurge = true
  const view = await harness.runtime.start('again')
  assert.equal(view.state, 'error')
  assert.equal(view.purged, false)
  assert.equal(harness.scanner.calls.length, 1, '旧目录没删掉就不得再扫')
  assert.ok(harness.runtime.cleanupPending() >= 1)
  assert.equal(fs.existsSync(path.join(root, 'again')), true)
  await harness.runtime.stop()
}

/** 连续点两次下一页只占用一个页号。 */
export async function verifyDoubleNextPageUsesOneIndex(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  await toPageReady(harness, 'dbl')
  pushScript(harness.scanner, { pages: [{ bytes: 12 }], holdAfterPage: true })
  const first = harness.runtime.nextPage('dbl')
  await flush()
  assert.equal(harness.scanner.calls.length, 2)
  assert.equal(harness.scanner.calls[1]?.startIndex, 2)
  const second = harness.runtime.nextPage('dbl')
  const winner = await Promise.race([
    second.then(() => 'done' as const),
    new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 300)),
  ])
  assert.equal(winner, 'done', '第二次下一页不得再排队等锁')
  assert.equal(harness.scanner.calls.filter((call) => call.startIndex === 2).length, 1)
  harness.scanner.release()
  await first
  await harness.runtime.whenIdle()
  assert.equal(harness.scanner.calls.length, 2)
  await harness.runtime.stop()
}

export async function verifyRound3(root: string, db: AgentDatabase): Promise<void> {
  await verifyProbeStopReachesHealth(path.join(root, 'probe'))
  await verifyUnconfirmedWithoutPidKeepsDirectory(path.join(root, 'nopid'))
  await verifyAbortAfterDeliverySaysDelivered(path.join(root, 'delivered'))
  await verifyUncertainUploadDoesNotClaimAbort(path.join(root, 'verdict'))
  await verifyAbortDuringReportDoesNotStartScan(path.join(root, 'report'))
  await verifyIdleDeadlineSurvivesLockWait(path.join(root, 'idle-lock'))
  await verifyIdleDeadlineWhileLeaseHangs(path.join(root, 'idle-hang'))
  await verifyBackfillTargetRejectedStopsDelivery(path.join(root, 'target'), db)
  await verifyBackfillSkipsWhenStateUnknown(path.join(root, 'unknown'))
  await verifyCleanupRetryDoesNotDeleteNewEpoch(path.join(root, 'epoch'))
  await verifyRestartPurgeFailureStaysVisible(path.join(root, 'restart'))
  await verifyDoubleNextPageUsesOneIndex(path.join(root, 'double'))
}
