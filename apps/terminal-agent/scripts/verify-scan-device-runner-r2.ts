/**
 * 屏上扫描接线第二轮的行为门禁。由 verify-scan-device-runner.ts 调用。
 * 不起 PowerShell，不碰扫描仪。不 import 引擎 helper（那份文件一加载就会改 PROGRAMDATA）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'
import { once } from 'node:events'
import { getScanDeletionAudits, type AgentDatabase } from '../src/agent/db'
import { readDeviceLease } from '../src/agent/scan-device/scan-device-backend'
import { SCAN_DEVICE_CLEANUP_RETRY_MS, SCAN_DEVICE_PAGE_READY_CHECK_MS, SCAN_DEVICE_PAGE_READY_IDLE_MS } from '../src/agent/scan-device/scan-device-housekeeping'
import { composeScanPdf } from '../src/agent/scan-device/scan-pdf-compose'
import { createScanDeviceRuntime, type ScanDeviceRuntime, type ScanDeviceView } from '../src/agent/scan-device/scan-device-runner'
import { scanDeviceReportBridge } from '../src/agent/scan-device/scan-device-sync'
import { SCAN_PDF_COMPOSE_MARGIN_BYTES, scanPagesAligned } from '../src/agent/scan-device/scan-device-types'
import type { WiaScanHandle, WiaScanResult } from '../src/agent/scan-device/wia-runner'
import { startQrLoginLocalServer } from '../src/local-api/qr-login-server'
import { agentConfig, createHarness, deviceLease, flush, probeResult, pushScript, type Harness } from './verify-scan-device-runner.helper'

const ALLOWED = 'https://kiosk.example.test'
const BRIDGE = 'bridge-token-scan-device-r2'

function reasonsSince(db: AgentDatabase, before: Set<string>): string[] {
  return getScanDeletionAudits(db).filter((row) => !before.has(row.eventId)).map((row) => row.reasonCode)
}

function snapshot(db: AgentDatabase): Set<string> {
  return new Set(getScanDeletionAudits(db).map((row) => row.eventId))
}

function makeJpeg(width: number, height: number): Buffer {
  const app0 = Buffer.alloc(18)
  app0.writeUInt16BE(0xffe0, 0)
  app0.writeUInt16BE(16, 2)
  app0.write('JFIF\0', 4, 'ascii')
  app0[9] = 1
  app0[10] = 2
  app0[11] = 1
  app0.writeUInt16BE(300, 12)
  app0.writeUInt16BE(300, 14)
  const sof = Buffer.alloc(19)
  sof.writeUInt16BE(0xffc0, 0)
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 3
  sof[10] = 1
  sof[11] = 0x22
  sof[13] = 2
  sof[14] = 0x11
  sof[16] = 3
  sof[17] = 0x11
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, sos, Buffer.alloc(8, 0x5a), Buffer.from([0xff, 0xd9])])
}

function readAspects(pdf: Buffer): number[] {
  const text = pdf.toString('latin1')
  const kids = /\/Kids \[([^\]]*)\]/.exec(text)
  assert.ok(kids, '找不到 /Kids')
  const pageIds = [...kids[1].matchAll(/(\d+) 0 R/g)].map((match) => match[1])
  return pageIds.map((pageId) => {
    const page = new RegExp(`(?:^|\\n)${pageId} 0 obj\\n<<\\n/Type /Page\\n[\\s\\S]*?/Contents (\\d+) 0 R`).exec(text)
    assert.ok(page, `找不到页对象 ${pageId}`)
    const header = new RegExp(`(?:^|\\n)${page[1]} 0 obj\\n<<[\\s\\S]*?>>\\nstream\\n`).exec(text)
    assert.ok(header, `找不到内容流 ${page[1]}`)
    const from = header.index + header[0].length
    const content = zlib.inflateSync(Buffer.from(text.slice(from, text.indexOf('\nendstream', from)), 'latin1')).toString('latin1')
    const cm = /([\d.-]+) 0 0 ([\d.-]+) ([\d.-]+) ([\d.-]+) cm\s*\/\w+ Do/.exec(content)
    assert.ok(cm, `页 ${pageId} 没有图片摆放矩阵`)
    return Number(cm[1]) / Math.abs(Number(cm[2]))
  })
}

async function toPageReady(harness: Harness, taskId: string): Promise<void> {
  harness.lease.current = { kind: 'lease', lease: deviceLease(taskId, harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(harness.scanner, { pages: [{ bytes: 40 }] })
  await harness.runtime.start(taskId)
  await harness.runtime.whenIdle()
}

export async function verifyFlatbedThreePages(root: string): Promise<void> {
  assert.equal(scanPagesAligned(3, [{ index: 1 }, { index: 2 }, { index: 3 }]), true)
  assert.equal(scanPagesAligned(3, [{ index: 3 }]), false, '只剩最后一页时合成前必须判错')
  const sizes: Array<[number, number]> = [[100, 200], [400, 100], [300, 300]]
  const starts: number[] = []
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  const runtime = createScanDeviceRuntime(agentConfig(), {
    startScan: (request) => {
      const index = request.startIndex ?? 1
      starts.push(index)
      const size = sizes[index - 1] ?? [10, 10]
      const file = path.join(request.outDir, `page-${String(index).padStart(3, '0')}.jpg`)
      fs.mkdirSync(request.outDir, { recursive: true })
      const jpeg = makeJpeg(size[0], size[1])
      fs.writeFileSync(file, jpeg)
      const result: Promise<WiaScanResult> = (async () => {
        await Promise.resolve()
        await request.onPage?.({ index, file, bytes: jpeg.length })
        return {
          ok: true,
          endedBy: 'single_page',
          pages: [{ index, file, bytes: jpeg.length }],
          discardedPages: 0,
          forceKilled: false,
          stopUnconfirmed: false,
          attempts: 1,
          setFailed: [],
          elapsedMs: 1,
        }
      })()
      const handle: WiaScanHandle = { abort() { return undefined }, result }
      return handle
    },
    runProbe: async () => probeResult('ready'),
    compose: composeScanPdf,
    deliver: async (input) => { harness.deliveries.push(input) },
    fetchLease: async () => harness.lease.current,
    report: async (_id, body) => {
      harness.reports.push(body)
      return { kind: 'ok' }
    },
    readFile: (file) => fs.promises.readFile(file),
    clock: harness.clock,
    lock: harness.lock,
    root,
    reportDelaysMs: [0, 0],
  })
  harness.lease.current = { kind: 'lease', lease: deviceLease('flat3', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  await runtime.start('flat3')
  await runtime.whenIdle()
  await runtime.nextPage('flat3')
  await runtime.whenIdle()
  await runtime.nextPage('flat3')
  await runtime.whenIdle()
  const finished = await runtime.finish('flat3')
  assert.equal(finished.state, 'delivering')
  assert.deepEqual(starts, [1, 2, 3])
  const pdf = harness.deliveries[0]?.bytes
  assert.ok(pdf)
  const aspects = readAspects(pdf)
  assert.equal(aspects.length, 3, '玻璃台 3 页必须合成恰好 3 页')
  assert.ok(Math.abs(aspects[0]! - 0.5) < 0.05, `第 1 页应来自 100×200，实际宽高比 ${aspects[0]}`)
  assert.ok(Math.abs(aspects[1]! - 4) < 0.05, `第 2 页应来自 400×100，实际宽高比 ${aspects[1]}`)
  assert.ok(Math.abs(aspects[2]! - 1) < 0.05, `第 3 页应来自 300×300，实际宽高比 ${aspects[2]}`)
  await runtime.stop()
}

export async function verifyUnconfirmedStop(root: string, db: AgentDatabase): Promise<void> {
  let alive = true
  const harness = createHarness({
    root,
    config: agentConfig(),
    reportDelaysMs: [0, 0],
    isProcessAlive: () => alive,
  })
  const before = snapshot(db)
  harness.lease.current = { kind: 'lease', lease: deviceLease('stuck', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
  pushScript(harness.scanner, { pages: [{ bytes: 20 }], holdAfterPage: true, forceKillOnAbort: true, stopUnconfirmed: true, processId: 4242 })
  await harness.runtime.start('stuck')
  await flush()
  const pending = harness.runtime.abort('stuck')
  await flush()
  harness.scanner.release()
  const aborted = await pending
  assert.equal(aborted.state, 'aborted')
  assert.equal(aborted.purged, false, '进程没确认退出时不能宣称已经删完')
  assert.equal(fs.existsSync(path.join(root, 'stuck')), true)
  assert.equal(harness.runtime.health().health, 'error')
  assert.equal(harness.runtime.cleanupPending(), 1)
  assert.equal(reasonsSince(db, before).includes('SCAN_DEVICE_FAILED'), false)
  const probes = harness.probeCalls.count
  const blocked = await harness.runtime.start('stuck')
  assert.equal(blocked.state, 'error')
  assert.equal(blocked.errorCode, 'busy')
  assert.equal(harness.scanner.calls.length, 1, '旧进程还在时不得再扫')
  assert.equal(harness.probeCalls.count, probes, '旧进程还在时探测不得去连扫描仪')
  harness.clock.advance(SCAN_DEVICE_CLEANUP_RETRY_MS)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'stuck')), true, '进程还在时重试也不许删')
  alive = false
  harness.clock.advance(SCAN_DEVICE_CLEANUP_RETRY_MS)
  await flush()
  assert.equal(harness.runtime.cleanupPending(), 0)
  assert.equal(fs.existsSync(path.join(root, 'stuck')), false)
  pushScript(harness.scanner, { pages: [{ bytes: 20 }] })
  const again = await harness.runtime.start('stuck')
  assert.equal(again.state, 'scanning')
  await harness.runtime.whenIdle()
  await harness.runtime.stop()
}

async function abortAt(root: string, point: 'delivering' | 'read' | 'lease' | 'upload' | 'during'): Promise<ScanDeviceView> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  let runtime: ScanDeviceRuntime = harness.runtime
  let aborting: Promise<ScanDeviceView> | undefined
  const arm = async (): Promise<void> => {
    aborting = runtime.abort('race')
    await flush()
  }
  let reads = 0
  let fetches = 0
  runtime = createScanDeviceRuntime(agentConfig(), {
    startScan: harness.scanner.start,
    runProbe: async () => probeResult('ready'),
    compose: async (dir, files) => ({ ok: true, path: path.join(dir, 'scan.pdf'), pageCount: files.length, bytes: 8 }),
    deliver: async (input) => {
      harness.deliveries.push(input)
      if (point === 'during') await arm()
    },
    fetchLease: async () => {
      fetches += 1
      if (point === 'lease' && fetches > 1) await arm()
      return harness.lease.current
    },
    report: async (_id, body) => {
      harness.reports.push(body)
      if (point === 'delivering' && body.state === 'delivering') await arm()
      return { kind: 'ok' }
    },
    readFile: async () => {
      reads += 1
      if (point === 'read') await arm()
      return Buffer.from('%PDF-test')
    },
    beforeUpload: async () => {
      if (point === 'upload') await arm()
    },
    clock: harness.clock,
    lock: harness.lock,
    root,
    reportDelaysMs: [0, 0],
  })
  await toPageReady({ ...harness, runtime }, 'race')
  const finished = runtime.finish('race')
  const view = await finished
  const aborted = aborting ? await aborting : view
  if (point === 'during') {
    assert.equal(harness.deliveries.length, 1, '上传已经发出并被收下')
    assert.equal(aborted.state, 'delivering', '后端已收下时中止要如实返回已投递')
  } else {
    assert.equal(harness.deliveries.length, 0, `${point} 之后不得再上传`)
    assert.equal(aborted.state, 'aborted')
    assert.equal(view.state, 'aborted')
  }
  await runtime.stop()
  return aborted
}

export async function verifyAbortDuringDeliver(root: string): Promise<void> {
  await abortAt(path.join(root, 'd1'), 'delivering')
  await abortAt(path.join(root, 'd2'), 'read')
  await abortAt(path.join(root, 'd3'), 'lease')
  await abortAt(path.join(root, 'd4'), 'upload')
  await abortAt(path.join(root, 'd5'), 'during')
}

export async function verifyBusyKeepsPages(root: string, db: AgentDatabase): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  await toPageReady(harness, 'busyPage')
  const before = snapshot(db)
  const holder = await harness.lock.acquire('print-claim')
  const pending = harness.runtime.nextPage('busyPage')
  await flush()
  harness.clock.advance(30_000)
  await flush()
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error && typeof error === 'object' && 'code' in error)
    const busy = error as { code: string; snapshot: ScanDeviceView }
    assert.equal(busy.code, 'LOCAL_SCAN_BUSY')
    assert.equal(busy.snapshot.state, 'page_ready')
    assert.equal(busy.snapshot.pageCount, 1)
    return true
  })
  assert.equal(fs.existsSync(path.join(root, 'busyPage')), true, '等锁超时不得删已扫的页')
  assert.equal(reasonsSince(db, before).includes('SCAN_DEVICE_FAILED'), false)
  holder.release()
  const done = await harness.runtime.finish('busyPage')
  assert.equal(done.state, 'delivering', '超时之后仍可以点扫完了')
  await harness.runtime.stop()
}

export async function verifyAbortWhileWaiting(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  await toPageReady(harness, 'waitAbort')
  const holder = await harness.lock.acquire('print-claim')
  const pending = harness.runtime.nextPage('waitAbort')
  await flush()
  const aborted = await harness.runtime.abort('waitAbort')
  assert.equal(aborted.state, 'aborted')
  assert.equal(aborted.purged, true)
  assert.equal(harness.scanner.calls.length, 1, '等锁期间中止不得再开一次扫描')
  holder.release()
  harness.clock.advance(30_000)
  await flush()
  const next = await pending
  assert.equal(next.state, 'aborted')
  assert.equal(harness.scanner.calls.length, 1)
  await harness.runtime.stop()
}

export async function verifyPageReadyIdle(root: string, db: AgentDatabase): Promise<void> {
  assert.equal(SCAN_DEVICE_PAGE_READY_IDLE_MS, 10 * 60 * 1000)
  assert.equal(SCAN_DEVICE_PAGE_READY_CHECK_MS, 60 * 1000)
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  await toPageReady(harness, 'idle')
  const before = snapshot(db)
  harness.clock.advance(SCAN_DEVICE_PAGE_READY_CHECK_MS - 1)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'idle')), true)
  harness.lease.current = { kind: 'unavailable' }
  harness.clock.advance(1)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'idle')), true, '对不上云端时先留着页')
  harness.lease.current = { kind: 'rejected', code: 'SCAN_DEVICE_TRANSITION_INVALID' }
  harness.clock.advance(SCAN_DEVICE_PAGE_READY_CHECK_MS)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'idle')), true, '非停扫 409 不删页')
  harness.lease.current = { kind: 'none', stopCode: 'SWITCHED_TO_PANEL' }
  harness.clock.advance(SCAN_DEVICE_PAGE_READY_CHECK_MS)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'idle')), false)
  assert.ok(reasonsSince(db, before).includes('SCAN_DEVICE_SWITCHED_TO_PANEL'))
  assert.equal(harness.deliveries.length, 0)
  await harness.runtime.stop()

  const expired = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  await toPageReady(expired, 'gone')
  const beforeGone = snapshot(db)
  expired.lease.current = { kind: 'none' }
  expired.clock.advance(SCAN_DEVICE_PAGE_READY_CHECK_MS)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'gone')), false)
  assert.ok(reasonsSince(db, beforeGone).includes('SCAN_DEVICE_SESSION_CLEARED'))
  await expired.runtime.stop()

  const timed = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  await toPageReady(timed, 'ten')
  const beforeTen = snapshot(db)
  for (let i = 0; i < 9; i += 1) {
    timed.clock.advance(SCAN_DEVICE_PAGE_READY_CHECK_MS)
    await flush()
  }
  assert.equal(fs.existsSync(path.join(root, 'ten')), true, '未满 10 分钟不自动结束')
  timed.clock.advance(SCAN_DEVICE_PAGE_READY_CHECK_MS)
  await flush()
  assert.equal(fs.existsSync(path.join(root, 'ten')), false)
  assert.ok(reasonsSince(db, beforeTen).includes('SCAN_DEVICE_ABORTED'))
  assert.ok(timed.reports.some((row) => row.state === 'aborted'))
  await timed.runtime.stop()
}

export async function verifyReportBackfill(root: string, db: AgentDatabase): Promise<void> {
  assert.deepEqual(scanDeviceReportBridge('ready', 'composing'), ['scanning'])
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  let calls = 0
  harness.lease.current = { kind: 'lease', lease: deviceLease('bridge', harness.clock.now()) }
  harness.reportResult.current = () => {
    calls += 1
    if (calls <= 6) return { kind: 'unavailable' }
    return { kind: 'ok' }
  }
  pushScript(harness.scanner, { pages: [{ bytes: 30 }] })
  await harness.runtime.start('bridge')
  await harness.runtime.whenIdle()
  const states = harness.reports.map((row) => row.state)
  const composingAt = states.lastIndexOf('composing')
  assert.ok(composingAt > 0)
  assert.equal(states[composingAt - 1], 'scanning', '后端还停在 ready 时，先补 scanning 再发 composing')
  assert.equal(harness.deliveries.length, 1)
  await harness.runtime.stop()

  const blocked = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  const before = snapshot(db)
  let blockedCalls = 0
  blocked.lease.current = { kind: 'lease', lease: deviceLease('nobridge', blocked.clock.now()) }
  blocked.reportResult.current = () => {
    blockedCalls += 1
    if (blockedCalls <= 6) return { kind: 'unavailable' }
    if (blockedCalls === 7) return { kind: 'rejected', code: 'SCAN_DEVICE_TRANSITION_INVALID' }
    return { kind: 'ok' }
  }
  pushScript(blocked.scanner, { pages: [{ bytes: 30 }] })
  await blocked.runtime.start('nobridge')
  await blocked.runtime.whenIdle()
  assert.equal(blocked.deliveries.length, 0, '补不上中间状态就不得投递')
  assert.equal(fs.existsSync(path.join(root, 'nobridge')), false)
  assert.ok(reasonsSince(db, before).includes('SCAN_DEVICE_FAILED'))
  await blocked.runtime.stop()
}

export async function verifyPurgeFlag(root: string): Promise<void> {
  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  await toPageReady(harness, 'clean')
  const ok = await harness.runtime.abort('clean')
  assert.equal(ok.purged, true)
  assert.equal(ok.state, 'aborted')
  assert.equal(fs.existsSync(path.join(root, 'clean')), false)
  await harness.runtime.stop()

  const runtime = createScanDeviceRuntime(agentConfig({ localApiPort: 0, localApiAllowedOrigins: [ALLOWED], localApiBridgeToken: BRIDGE }), {
    startScan: harness.scanner.start,
    runProbe: async () => probeResult('ready'),
    compose: async (dir, files) => ({ ok: true, path: path.join(dir, 'scan.pdf'), pageCount: files.length, bytes: 4 }),
    deliver: async () => undefined,
    fetchLease: async () => ({ kind: 'lease', lease: deviceLease('dirty', harness.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }),
    report: async () => ({ kind: 'ok' }),
    purge: (taskId) => {
      const dir = path.join(root, taskId)
      if (!fs.existsSync(dir)) return { status: 'absent', entryCount: 0 }
      return { status: 'failed', entryCount: 1, errorCode: 'EBUSY' }
    },
    readFile: async () => Buffer.from('pdf'),
    clock: harness.clock,
    lock: harness.lock,
    root,
    reportDelaysMs: [0, 0],
  })
  pushScript(harness.scanner, { pages: [{ bytes: 12 }] })
  await runtime.start('dirty')
  await runtime.whenIdle()
  const failed = await runtime.abort('dirty')
  assert.equal(failed.purged, false)
  assert.equal(runtime.cleanupPending(), 1)
  assert.equal(fs.existsSync(path.join(root, 'dirty')), true)
  const server = startQrLoginLocalServer(
    agentConfig({ localApiPort: 0, localApiAllowedOrigins: [ALLOWED], localApiBridgeToken: BRIDGE }),
    { scanDevice: runtime },
  )
  assert.ok(server)
  if (!server.server.listening) await once(server.server, 'listening')
  const port = (server.server.address() as { port: number }).port
  const body = JSON.stringify({ scanTaskId: 'dirty' })
  const response = await new Promise<{ status: number; json: { data?: { purged?: boolean; state?: string } } }>((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/local/scan/abort',
      method: 'POST',
      headers: {
        Origin: ALLOWED,
        'X-Local-Bridge-Token': BRIDGE,
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) as { data?: { purged?: boolean } } }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
  assert.equal(response.status, 200)
  assert.equal(response.json.data?.purged, false)
  await server.close()
  await runtime.stop()
}

export async function verifyLeaseLimits(root: string): Promise<void> {
  const now = 1_700_000_000_000
  const idLease = deviceLease('idtask', now, { device: { source: 'feeder', colorMode: 'gray', maxPages: 4, maxBytes: 10 * 1024 * 1024 } })
  assert.equal(readDeviceLease({ data: idLease }, now)?.device.maxPages, 4)
  assert.equal(readDeviceLease({ data: idLease }, now)?.device.maxBytes, 10 * 1024 * 1024)
  const broken = deviceLease('idtask', now, { device: { source: 'feeder', colorMode: 'gray', maxPages: 0, maxBytes: 1.5 } })
  const readBroken = readDeviceLease({ data: broken }, now)
  assert.equal(readBroken?.scanTaskId, 'idtask', '上限不合法时整张租约仍有效')
  assert.equal(readBroken?.device.maxPages, undefined)
  assert.equal(readBroken?.device.maxBytes, undefined)

  const harness = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  harness.lease.current = { kind: 'lease', lease: idLease }
  pushScript(harness.scanner, { pages: [{ bytes: 10 }, { bytes: 10 }, { bytes: 10 }, { bytes: 10 }, { bytes: 10 }], endedBy: 'page_limit' })
  await harness.runtime.start('idtask')
  await harness.runtime.whenIdle()
  assert.equal(harness.scanner.calls[0]?.maxPages, 4, '证件页数上限取租约的 4')
  assert.equal(harness.deliveries.length, 1)
  await harness.runtime.stop()

  const huge = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  const budget = 10 * 1024 * 1024 - SCAN_PDF_COMPOSE_MARGIN_BYTES
  huge.lease.current = {
    kind: 'lease',
    lease: deviceLease('big', huge.clock.now(), { device: { source: 'feeder', colorMode: 'gray', maxBytes: 10 * 1024 * 1024 } }),
  }
  pushScript(huge.scanner, { pages: [{ bytes: budget + 1 }] })
  await huge.runtime.start('big')
  await huge.runtime.whenIdle()
  assert.equal(huge.reports.at(-1)?.errorCode, 'too_large')
  assert.equal(huge.deliveries.length, 0, '累计超过证件 10 MiB 就停，不投递')
  await huge.runtime.stop()
}

export async function verifyReportSettings(root: string, db: AgentDatabase): Promise<void> {
  const off = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  off.lease.current = { kind: 'lease', lease: deviceLease('off', off.clock.now(), { device: { source: 'feeder', colorMode: 'color' } }) }
  pushScript(off.scanner, { pages: [{ bytes: 8 }] })
  await off.runtime.start('off')
  await off.runtime.whenIdle()
  assert.equal(off.reports.every((row) => !('source' in row) && !('colorMode' in row)), true)
  await off.runtime.stop()

  const on = createHarness({ root, config: agentConfig({ scanDeviceReportSettings: true }), reportDelaysMs: [0, 0] })
  on.lease.current = { kind: 'lease', lease: deviceLease('on', on.clock.now(), { device: { source: 'flatbed', colorMode: 'color' } }) }
  pushScript(on.scanner, { pages: [{ bytes: 8 }] })
  await on.runtime.start('on')
  await on.runtime.whenIdle()
  assert.ok(on.reports.length > 0)
  assert.equal(on.reports.every((row) => row.source === 'flatbed' && row.colorMode === 'color'), true)
  await on.runtime.stop()

  const changed = createHarness({ root, config: agentConfig({ scanDeviceReportSettings: true }), reportDelaysMs: [0, 0] })
  const before = snapshot(db)
  changed.lease.current = { kind: 'lease', lease: deviceLease('chg', changed.clock.now()) }
  changed.reportResult.current = () => ({ kind: 'stop', code: 'SCAN_DEVICE_SETTINGS_CHANGED' })
  pushScript(changed.scanner, { pages: [{ bytes: 8 }] })
  const view = await changed.runtime.start('chg')
  assert.equal(view.state, 'aborted')
  assert.equal(changed.deliveries.length, 0)
  assert.equal(changed.scanner.calls.length, 0)
  assert.ok(reasonsSince(db, before).includes('SCAN_DEVICE_SESSION_CLEARED'))
  assert.equal(reasonsSince(db, before).includes('SCAN_DEVICE_SWITCHED_TO_PANEL'), false)
  await changed.runtime.stop()
}

export async function verifyRound2(root: string, db: AgentDatabase): Promise<void> {
  await verifyFlatbedThreePages(path.join(root, 'pdf'))
  await verifyUnconfirmedStop(path.join(root, 'kill'), db)
  await verifyAbortDuringDeliver(path.join(root, 'abort'))
  await verifyBusyKeepsPages(path.join(root, 'busy'), db)
  await verifyAbortWhileWaiting(path.join(root, 'wait'))
  await verifyPageReadyIdle(path.join(root, 'idle'), db)
  await verifyReportBackfill(path.join(root, 'bridge'), db)
  await verifyPurgeFlag(path.join(root, 'purge'))
  await verifyLeaseLimits(path.join(root, 'limits'))
  await verifyReportSettings(path.join(root, 'settings'), db)
}
