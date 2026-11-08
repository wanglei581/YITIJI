// ============================================================
// verify-scan-device-engine 的共用零件与「进程 / 时序」类用例。
// 照 scan-lease-barrier.helper.ts 的先例从门禁主文件拆出（CLAUDE.md §8 文件体积）。
//
// 本文件放：临时根与环境隔离、步进框架、假时钟 / 假子进程 / 假执行器（Rig）、图片与 PDF 夹具，
// 以及用到它们的三组用例：1. stdout 协议、3. 运行器（假执行器 + 假时钟）、4. 真实子进程。
// 其余用例（脚本与参数、临时目录、合 PDF、设备锁、投递抽取）在 verify-scan-device-engine.ts。
// 只被门禁主文件 import，自己不执行任何检查。
// ============================================================

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawn, type ChildProcess } from 'node:child_process'
import { __setUnauthorizedMarkerPathForTests } from '../src/agent/auth-state'
import { createScanTaskDir, scanCancelFlagPath } from '../src/agent/scan-device/scan-temp-dir'
import {
  LineBuffer,
  WIA_HRESULT,
  WiaParamError,
  mapWiaHresult,
  normalizeHresult,
  parseWiaLine,
  type ScanDeviceErrorCode,
} from '../src/agent/scan-device/wia-script'
import {
  WIA_ABORT_GRACE_MS,
  WIA_FORCE_KILL_WAIT_MS,
  WIA_IDLE_TIMEOUT_MS,
  WIA_TOTAL_TIMEOUT_MS,
  buildTaskkillArgs,
  startWiaScan,
  type WiaRunnerDeps,
  type WiaScanRequest,
} from '../src/agent/scan-device/wia-runner'
import { runWiaProbe } from '../src/agent/scan-device/wia-probe'

export const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-scan-device-engine-'))
process.env['PROGRAMDATA'] = path.join(tmpRoot, 'programdata')
fs.mkdirSync(process.env['PROGRAMDATA'], { recursive: true })
__setUnauthorizedMarkerPathForTests(path.join(tmpRoot, 'agent.unauthorized'))

export const noAcl = (): void => undefined
export const srcRoot = path.join(__dirname, '..', 'src')

// ── 小测试框架 ────────────────────────────────────────────────────────────

/** 步进结果汇总，主文件在最后据此退出。 */
export const summary: { passed: number; failures: string[] } = { passed: 0, failures: [] }

/** 被测模块的日志在通过时静音，失败时随错误一起回放，方便定位。 */
export async function step(name: string, fn: () => void | Promise<void>): Promise<void> {
  const writeOut = process.stdout.write.bind(process.stdout)
  const writeErr = process.stderr.write.bind(process.stderr)
  let captured = ''
  const capture = ((chunk: unknown) => {
    captured += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stdout.write = capture
  process.stderr.write = capture
  const restore = (): void => {
    process.stdout.write = writeOut
    process.stderr.write = writeErr
  }
  try {
    await fn()
    restore()
    summary.passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    restore()
    summary.failures.push(name)
    console.error(`FAIL ${name}`)
    console.error(error instanceof Error ? (error.stack ?? error.message) : error)
    if (captured) console.error(`--- 该项运行期间被测模块的日志 ---\n${captured}`)
  }
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise<void>((resolve) => setImmediate(resolve))
}

// ── 假时钟 / 假子进程 ──────────────────────────────────────────────────────

export class FakeClock {
  private nowMs = 1_000_000
  private seq = 0
  private readonly timers = new Map<number, { at: number; callback: () => void }>()
  now(): number {
    return this.nowMs
  }
  setTimeout(callback: () => void, ms: number): unknown {
    this.seq += 1
    this.timers.set(this.seq, { at: this.nowMs + ms, callback })
    return this.seq
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number)
  }
  pending(): number {
    return this.timers.size
  }
  /** 推进时间，按到期顺序触发；每个回调之后让出事件循环，让依赖它的 async 代码先跑完。 */
  async advance(ms: number): Promise<void> {
    const target = this.nowMs + ms
    for (;;) {
      let nextId: number | undefined
      let nextAt = Infinity
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextAt = timer.at
          nextId = id
        }
      }
      if (nextId === undefined) break
      const timer = this.timers.get(nextId)
      this.timers.delete(nextId)
      this.nowMs = Math.max(this.nowMs, nextAt)
      timer?.callback()
      await settle()
    }
    this.nowMs = target
    await settle()
  }
}

class FakeChild extends EventEmitter {
  pid: number | undefined = 4242
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  send(text: string): void {
    this.stdout.emit('data', Buffer.from(text, 'utf8'))
  }
  exit(code = 0): void {
    this.emit('close', code, null)
  }
}

export interface Rig {
  root: string
  taskDir: string
  clock: FakeClock
  children: FakeChild[]
  spawnCalls: Array<{ command: string; args: string[] }>
  killed: number[]
  deps: Partial<WiaRunnerDeps>
}

let rigSeq = 0
export function makeRig(taskId = 'task1'): Rig {
  rigSeq += 1
  const root = path.join(tmpRoot, `root-${rigSeq}`)
  const taskDir = createScanTaskDir(taskId, { root, assertDirectoryAcl: noAcl })
  const clock = new FakeClock()
  const children: FakeChild[] = []
  const spawnCalls: Array<{ command: string; args: string[] }> = []
  const killed: number[] = []
  return {
    root,
    taskDir,
    clock,
    children,
    spawnCalls,
    killed,
    deps: {
      root,
      clock,
      powershellPath: 'powershell-test',
      spawnProcess: (command, args) => {
        spawnCalls.push({ command, args })
        const child = new FakeChild()
        children.push(child)
        return child as unknown as ChildProcess
      },
      killProcessTree: async (pid) => {
        killed.push(pid)
      },
    },
  }
}

function pageLine(rig: Rig, index: number, bytes = 64): string {
  const file = `page-${String(index).padStart(3, '0')}.jpg`
  fs.writeFileSync(path.join(rig.taskDir, file), Buffer.alloc(bytes, 0x61))
  return JSON.stringify({ page: index, file, bytes, via: 'wia' })
}
const doneLine = (pages: number, canceled = false): string =>
  JSON.stringify({ ok: true, pages, canceled, setFailed: [] })
const failedLine = (code: string, hresult: string | null, pages: number): string =>
  JSON.stringify({ ok: false, code, hresult, pages, setFailed: [] })

const flatbedRequest = (rig: Rig, extra: Partial<WiaScanRequest> = {}): WiaScanRequest => ({
  source: 'flatbed',
  color: 'gray',
  outDir: rig.taskDir,
  ...extra,
})
const feederRequest = (rig: Rig, extra: Partial<WiaScanRequest> = {}): WiaScanRequest => ({
  source: 'feeder',
  color: 'gray',
  outDir: rig.taskDir,
  ...extra,
})

// ── 图片夹具 ──────────────────────────────────────────────────────────────

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n += 1) {
    let c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([len, typed, crc])
}
export function makePng(width: number, height: number, dpi: number | null): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr)]
  if (dpi !== null) {
    const ppm = Math.round(dpi / 0.0254)
    const phys = Buffer.alloc(9)
    phys.writeUInt32BE(ppm, 0)
    phys.writeUInt32BE(ppm, 4)
    phys[8] = 1
    parts.push(pngChunk('pHYs', phys))
  }
  parts.push(pngChunk('IDAT', zlib.deflateSync(Buffer.alloc(height * (1 + width * 3), 0))), pngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}
/** 只有头部结构的 JPEG：pdfkit 只读 SOF 取宽高，原样嵌入。payload 用来控制体积。 */
export function makeJpeg(width: number, height: number, payloadBytes: number): Buffer {
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
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, sos, Buffer.alloc(payloadBytes, 0x5a), Buffer.from([0xff, 0xd9])])
}
export const countPdfPages = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length
/** 按页序（/Kids 顺序）读出每页图片的摆放尺寸（pt）：page 对象 → /Contents → 内容流里的 cm 矩阵。 */
export function readPagePlacements(pdf: Buffer): Array<{ width: number; height: number }> {
  const text = pdf.toString('latin1')
  const kids = /\/Kids \[([^\]]*)\]/.exec(text)
  assert.ok(kids, '找不到 /Kids')
  const pageIds = [...kids[1].matchAll(/(\d+) 0 R/g)].map((m) => m[1])
  return pageIds.map((pageId) => {
    const page = new RegExp(`(?:^|\\n)${pageId} 0 obj\\n<<\\n/Type /Page\\n[\\s\\S]*?/Contents (\\d+) 0 R`).exec(text)
    assert.ok(page, `找不到页对象 ${pageId}`)
    const header = new RegExp(`(?:^|\\n)${page[1]} 0 obj\\n<<[\\s\\S]*?>>\\nstream\\n`).exec(text)
    assert.ok(header, `找不到内容流 ${page[1]}`)
    const from = header.index + header[0].length
    const content = zlib.inflateSync(Buffer.from(text.slice(from, text.indexOf('\nendstream', from)), 'latin1')).toString('latin1')
    const cm = /([\d.-]+) 0 0 ([\d.-]+) ([\d.-]+) ([\d.-]+) cm\s*\/\w+ Do/.exec(content)
    assert.ok(cm, `页 ${pageId} 的内容流里没有图片摆放矩阵`)
    return { width: Number(cm[1]), height: Math.abs(Number(cm[2])) }
  })
}
export const normalizePdf = (pdf: Buffer): string =>
  pdf.toString('latin1').replace(/\(D:\d{14}Z\)/g, '(D:<D>)').replace(/\/ID \[[^\]]*\]/g, '/ID [<ID>]')

// ═════════════════════════════════════════════════════════════════════════
// 1. stdout 协议
// ═════════════════════════════════════════════════════════════════════════

export async function protocolChecks(): Promise<void> {
  await step('stdout 逐行解析：分块边界与行边界无关，半行留待下一块', () => {
    const lb = new LineBuffer()
    assert.deepEqual(lb.push('{"page":1,"fi'), [])
    assert.deepEqual(lb.push('le":"page-001.jpg","bytes":10}\r\n{"ok"'), ['{"page":1,"file":"page-001.jpg","bytes":10}'])
    assert.deepEqual(lb.push(':true,"pages":1}\n\nbanner\n'), ['{"ok":true,"pages":1}', '', 'banner'])
    assert.deepEqual(lb.flush(), [])
    const tail = new LineBuffer()
    assert.deepEqual(tail.push('{"ok":true,"pages":0}'), [], '没有换行的末行不能提前交出')
    assert.deepEqual(tail.flush(), ['{"ok":true,"pages":0}'], '进程结束后 flush 必须取出末行')
    assert.deepEqual(tail.flush(), [], 'flush 之后缓冲为空')
    const utf8 = new LineBuffer()
    const bytes = Buffer.from('中文\n', 'utf8')
    assert.deepEqual(utf8.push(bytes.subarray(0, 2)), [], 'UTF-8 多字节被切开时不能吐出乱码')
    assert.deepEqual(utf8.push(bytes.subarray(2)), ['中文'])
    const flood = new LineBuffer()
    assert.deepEqual(flood.push('x'.repeat(LineBuffer.MAX_PENDING_CHARS + 10)), [])
    assert.equal(flood.droppedOverlong, 1, '超长半行必须丢弃而不是无限增长')
    assert.deepEqual(flood.push('ok\n'), ['ok'], '丢弃之后后续行仍能正常解析')
  })

  await step('stdout 行解析：只认形状正确、字段在范围内的协议行', () => {
    assert.deepEqual(parseWiaLine('{"page":2,"file":"page-002.jpg","bytes":1234,"via":"drawing"}'), {
      kind: 'page', page: 2, file: 'page-002.jpg', bytes: 1234, via: 'drawing',
    })
    assert.deepEqual(parseWiaLine('{"ok":true,"pages":3,"canceled":true,"setFailed":[6149,6150]}'), {
      kind: 'done', pages: 3, canceled: true, probe: false, setFailed: [6149, 6150],
    })
    assert.deepEqual(parseWiaLine('{"ok":false,"code":"wia_error","hresult":"0x8021000a","pages":1,"setFailed":[]}'), {
      kind: 'failed', stage: 'wia_error', hresult: '0x8021000A', pages: 1, setFailed: [],
    })
    assert.equal((parseWiaLine('{"ok":false,"code":"made_up","hresult":null,"pages":0}') as { stage: string }).stage, 'script_error', '未知阶段码一律当脚本错误')
    const rejected = [
      '', 'banner text', '[1]', '"x"', 'null', '{"page":1,', '{}', '{"ok":"yes","pages":1}', '{"ok":true}',
      '{"page":0,"file":"page-000.jpg","bytes":1}', '{"page":1000,"file":"page-1000.jpg","bytes":1}',
      '{"page":1,"file":"page-002.jpg","bytes":1}', '{"page":1,"file":"../page-001.jpg","bytes":1}',
      '{"page":1,"file":"sub/page-001.jpg","bytes":1}', '{"page":1,"file":"page-001.png","bytes":1}',
      '{"page":1,"file":"page-001.jpg","bytes":-1}', '{"page":1,"file":"page-001.jpg","bytes":1.5}',
      '{"page":1,"file":"page-001.jpg","bytes":"9"}', '{"ok":true,"pages":-1}', '{"ok":false,"pages":"0"}',
    ]
    for (const line of rejected) assert.equal(parseWiaLine(line), undefined, `应拒绝：${line}`)
  })

  await step('HRESULT 映射：每个码对应的对外错误码', () => {
    const table: Array<[string | undefined, ScanDeviceErrorCode]> = [
      ['0x80210003', 'feeder_empty'], ['0x80210002', 'paper_jam'], ['0x80210006', 'busy'],
      ['0x80210007', 'warming_up'], ['0x80210016', 'cover_open'], ['0x80210005', 'not_ready'],
      ['0x8021000A', 'not_ready'], ['0x80210004', 'unknown'], ['0x8021000D', 'unknown'],
      ['0x80004005', 'unknown'], [undefined, 'unknown'],
    ]
    for (const [hresult, code] of table) assert.equal(mapWiaHresult(hresult), code, `${hresult} → ${code}`)
    assert.deepEqual(
      Object.values(WIA_HRESULT).sort(),
      ['0x80210002', '0x80210003', '0x80210005', '0x80210006', '0x80210007', '0x8021000A', '0x80210016'],
      'WIA_HRESULT 只登记任务包列出的七个码',
    )
    assert.equal(normalizeHresult('0x8021000a'), '0x8021000A')
    assert.equal(normalizeHresult(' 0x80210003 '), '0x80210003')
    for (const bad of ['80210003', '0x8021', '0x8021000AA', 'ERROR', 5, null, undefined]) assert.equal(normalizeHresult(bad), undefined)
  })
}

// ═════════════════════════════════════════════════════════════════════════
// 3. 运行器（假执行器 + 假时钟）
// ═════════════════════════════════════════════════════════════════════════

export async function runnerChecks(): Promise<void> {
  await step('扫描（玻璃台）：一行被切成三段到达，页数只数核实过的整页', async () => {
    const rig = makeRig()
    const handle = startWiaScan(flatbedRequest(rig, { deviceName: 'My Scanner', color: 'color' }), rig.deps)
    assert.equal(rig.spawnCalls.length, 1)
    assert.equal(rig.spawnCalls[0].command, 'powershell-test')
    assert.deepEqual(rig.spawnCalls[0].args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'])
    const script = Buffer.from(rig.spawnCalls[0].args[5], 'base64').toString('utf16le')
    assert.match(script, /\$Source = 'flatbed'/)
    assert.match(script, /\$Color = 'color'/)
    assert.match(script, /\$DeviceName = 'My Scanner'/)
    assert.match(script, /\$MaxPages = 1\n/, '玻璃台默认一次只扫一页')
    const line = pageLine(rig, 1, 2048)
    const child = rig.children[0]
    child.send(line.slice(0, 7))
    child.send(line.slice(7, 30))
    child.send(`${line.slice(30)}\r\n${doneLine(1)}\r\n`)
    child.exit(0)
    const result = await handle.result
    assert.equal(result.ok, true)
    assert.equal(result.endedBy, 'single_page')
    assert.equal(result.pages.length, 1)
    assert.equal(result.pages[0].file, path.join(rig.taskDir, 'page-001.jpg'))
    assert.equal(result.pages[0].bytes, 2048, 'bytes 以磁盘上核实到的为准')
    assert.equal(result.forceKilled, false)
    assert.equal(result.attempts, 1)
    assert.equal(rig.clock.pending(), 0, '结束后不能留下任何定时器')
  })

  await step('扫描（进纸器）：扫空 = 中途无纸 = 正常结束；页序号可从 startIndex 起', async () => {
    const rig = makeRig()
    const handle = startWiaScan(feederRequest(rig, { startIndex: 4 }), rig.deps)
    assert.match(Buffer.from(rig.spawnCalls[0].args[5], 'base64').toString('utf16le'), /\$MaxPages = 20\n/, '进纸器默认页数上限 20')
    const child = rig.children[0]
    child.send(`${pageLine(rig, 4)}\n${pageLine(rig, 5)}\n${pageLine(rig, 6)}\n`)
    child.send(`${failedLine('wia_error', WIA_HRESULT.PAPER_EMPTY, 3)}\n`)
    child.exit(0)
    const result = await handle.result
    assert.equal(result.ok, true, '已有 ≥1 页时 0x80210003 是正常结束')
    assert.equal(result.endedBy, 'feeder_emptied')
    assert.deepEqual(result.pages.map((page) => page.index), [4, 5, 6])
    assert.equal(result.errorCode, undefined)
  })

  await step('扫描（进纸器）：首页就无纸 → feeder_empty；玻璃台上报无纸属异常 → unknown', async () => {
    const first = makeRig()
    const handle = startWiaScan(feederRequest(first), first.deps)
    first.children[0].send(`${failedLine('wia_error', WIA_HRESULT.PAPER_EMPTY, 0)}\n`)
    first.children[0].exit(0)
    const result = await handle.result
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'feeder_empty')
    assert.equal(result.hresult, WIA_HRESULT.PAPER_EMPTY)
    assert.equal(result.endedBy, 'error')

    const flat = makeRig()
    const flatHandle = startWiaScan(flatbedRequest(flat), flat.deps)
    flat.children[0].send(`${failedLine('wia_error', WIA_HRESULT.PAPER_EMPTY, 0)}\n`)
    flat.children[0].exit(0)
    assert.equal((await flatHandle.result).errorCode, 'unknown', '玻璃台没有进纸器，无纸码不能当 feeder_empty')
  })

  await step('扫描：中途卡纸 → 页文件留给调用方整目录清理，错误码 paper_jam', async () => {
    const rig = makeRig()
    const handle = startWiaScan(feederRequest(rig), rig.deps)
    rig.children[0].send(`${pageLine(rig, 1)}\n${pageLine(rig, 2)}\n${failedLine('wia_error', WIA_HRESULT.PAPER_JAM, 2)}\n`)
    rig.children[0].exit(0)
    const result = await handle.result
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'paper_jam')
    assert.equal(result.discardedPages, 0)
    assert.deepEqual(result.pages.map((page) => page.index), [1, 2])
    assert.deepEqual(fs.readdirSync(rig.taskDir).filter((name) => name.endsWith('.jpg')).sort(), ['page-001.jpg', 'page-002.jpg'])
  })

  await step('扫描：其余 HRESULT 与失败阶段逐个映射', async () => {
    const cases: Array<{ code: string; hresult: string | null; expected: ScanDeviceErrorCode }> = [
      { code: 'wia_error', hresult: WIA_HRESULT.BUSY, expected: 'busy' },
      { code: 'wia_error', hresult: WIA_HRESULT.COVER_OPEN, expected: 'cover_open' },
      { code: 'wia_error', hresult: WIA_HRESULT.OFFLINE, expected: 'not_ready' },
      { code: 'wia_error', hresult: WIA_HRESULT.DEVICE_COMMUNICATION, expected: 'not_ready' },
      { code: 'wia_error', hresult: '0x80210099', expected: 'unknown' },
      { code: 'wia_error', hresult: null, expected: 'unknown' },
      { code: 'script_error', hresult: WIA_HRESULT.BUSY, expected: 'busy' },
      { code: 'script_error', hresult: '0x80040154', expected: 'unknown' },
      { code: 'convert_failed', hresult: null, expected: 'unknown' },
      { code: 'device_not_found', hresult: null, expected: 'not_ready' },
    ]
    for (const item of cases) {
      const rig = makeRig()
      const handle = startWiaScan(flatbedRequest(rig), rig.deps)
      rig.children[0].send(`${failedLine(item.code, item.hresult, 0)}\n`)
      rig.children[0].exit(0)
      const result = await handle.result
      assert.equal(result.ok, false)
      assert.equal(result.errorCode, item.expected, `${item.code}/${item.hresult} → ${item.expected}`)
      assert.equal(result.attempts, 1, '只有预热中才重试')
    }
  })

  await step('扫描：预热中先等 10 秒自动重试一次，再失败才报 warming_up', async () => {
    const rig = makeRig()
    const handle = startWiaScan(flatbedRequest(rig), rig.deps)
    rig.children[0].send(`${failedLine('wia_error', WIA_HRESULT.WARMING_UP, 0)}\n`)
    rig.children[0].exit(0)
    await settle()
    await rig.clock.advance(9_999)
    assert.equal(rig.children.length, 1, '10 秒没到不能重试')
    await rig.clock.advance(1)
    assert.equal(rig.children.length, 2, '10 秒到了重试一次')
    rig.children[1].send(`${failedLine('wia_error', WIA_HRESULT.WARMING_UP, 0)}\n`)
    rig.children[1].exit(0)
    const result = await handle.result
    assert.equal(result.errorCode, 'warming_up')
    assert.equal(result.attempts, 2)
    assert.equal(rig.children.length, 2, '最多重试一次')

    const ok = makeRig()
    const okHandle = startWiaScan(flatbedRequest(ok), ok.deps)
    ok.children[0].send(`${failedLine('wia_error', WIA_HRESULT.WARMING_UP, 0)}\n`)
    ok.children[0].exit(0)
    await settle()
    await ok.clock.advance(10_000)
    ok.children[1].send(`${pageLine(ok, 1)}\n${doneLine(1)}\n`)
    ok.children[1].exit(0)
    const okResult = await okHandle.result
    assert.equal(okResult.ok, true)
    assert.equal(okResult.attempts, 2)

    const mid = makeRig()
    const midHandle = startWiaScan(feederRequest(mid), mid.deps)
    mid.children[0].send(`${pageLine(mid, 1)}\n${failedLine('wia_error', WIA_HRESULT.WARMING_UP, 1)}\n`)
    mid.children[0].exit(0)
    const midResult = await midHandle.result
    assert.equal(midResult.errorCode, 'warming_up', '已经扫出页之后出现预热中不重试')
    assert.equal(midResult.attempts, 1)
    assert.equal(mid.children.length, 1)

    const aborted = makeRig()
    const abortedHandle = startWiaScan(flatbedRequest(aborted), aborted.deps)
    aborted.children[0].send(`${failedLine('wia_error', WIA_HRESULT.WARMING_UP, 0)}\n`)
    aborted.children[0].exit(0)
    await settle()
    abortedHandle.abort()
    const abortedResult = await abortedHandle.result
    assert.equal(abortedResult.endedBy, 'aborted', '等待重试期间中止必须立刻收口')
    assert.equal(aborted.children.length, 1)
    assert.equal(aborted.clock.pending(), 0)
  })

  await step('取消标记与强杀：软停写标记，45 秒内进程自己退出就不杀', async () => {
    const rig = makeRig()
    const handle = startWiaScan(feederRequest(rig), rig.deps)
    rig.children[0].send(`${pageLine(rig, 1)}\n`)
    handle.abort()
    handle.abort()
    assert.equal(fs.existsSync(scanCancelFlagPath(rig.taskDir)), true, '中止必须写取消标记')
    await rig.clock.advance(WIA_ABORT_GRACE_MS - 1)
    assert.deepEqual(rig.killed, [], '宽限期内不能强杀')
    rig.children[0].send(`${doneLine(1, true)}\n`)
    rig.children[0].exit(0)
    const result = await handle.result
    assert.equal(result.endedBy, 'aborted')
    assert.equal(result.ok, false)
    assert.equal(result.forceKilled, false)
    assert.deepEqual(rig.killed, [])
    assert.equal(rig.clock.pending(), 0)
    assert.equal(WIA_ABORT_GRACE_MS, 45_000)
  })

  await step('取消标记与强杀：45 秒进程没退 → 恰好此时 taskkill /T /F，并标明强杀过', async () => {
    const rig = makeRig()
    const handle = startWiaScan(feederRequest(rig), rig.deps)
    rig.children[0].pid = 7777
    handle.abort()
    await rig.clock.advance(44_999)
    assert.deepEqual(rig.killed, [])
    await rig.clock.advance(1)
    assert.deepEqual(rig.killed, [7777], '到 45 秒整才强杀，且只杀一次，目标是 PowerShell 进程')
    await rig.clock.advance(5_000)
    assert.deepEqual(rig.killed, [7777])
    rig.children[0].exit(1)
    const result = await handle.result
    assert.equal(result.forceKilled, true, 'A2 据此决定下次开始前先探测')
    assert.equal(result.endedBy, 'aborted')
    assert.deepEqual(buildTaskkillArgs(7777), ['/PID', '7777', '/T', '/F'])
    for (const pid of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => buildTaskkillArgs(pid), WiaParamError)
  })

  await step('取消标记与强杀：强杀后进程仍不退，10 秒后兜底放行，不会永远挂住', async () => {
    const rig = makeRig()
    const handle = startWiaScan(feederRequest(rig), rig.deps)
    handle.abort()
    await rig.clock.advance(WIA_ABORT_GRACE_MS)
    await rig.clock.advance(WIA_FORCE_KILL_WAIT_MS)
    const result = await handle.result
    assert.equal(result.forceKilled, true)
    assert.equal(result.endedBy, 'aborted')
    assert.equal(rig.clock.pending(), 0)
  })

  await step('超时：空闲 120 秒无输出 → timeout，走同一条软停→强杀路径；有输出就重新计时', async () => {
    assert.equal(WIA_IDLE_TIMEOUT_MS, 120_000)
    const rig = makeRig()
    const handle = startWiaScan(feederRequest(rig), rig.deps)
    await rig.clock.advance(100_000)
    rig.children[0].send('still alive, not protocol\n')
    await rig.clock.advance(WIA_IDLE_TIMEOUT_MS - 1)
    assert.equal(fs.existsSync(scanCancelFlagPath(rig.taskDir)), false, '有输出就重新计时')
    await rig.clock.advance(1)
    assert.equal(fs.existsSync(scanCancelFlagPath(rig.taskDir)), true, '空闲超时先软停')
    assert.deepEqual(rig.killed, [])
    await rig.clock.advance(WIA_ABORT_GRACE_MS)
    assert.deepEqual(rig.killed, [4242])
    rig.children[0].exit(1)
    const result = await handle.result
    assert.equal(result.errorCode, 'timeout')
    assert.equal(result.endedBy, 'error')
    assert.equal(result.forceKilled, true)

    const total = makeRig()
    const totalHandle = startWiaScan(feederRequest(total, { idleTimeoutMs: 1e9 }), total.deps)
    assert.equal(WIA_TOTAL_TIMEOUT_MS, 12 * 60_000)
    for (let t = 0; t < WIA_TOTAL_TIMEOUT_MS - 60_000; t += 60_000) {
      await total.clock.advance(60_000)
      total.children[0].send('tick\n')
    }
    assert.equal(fs.existsSync(scanCancelFlagPath(total.taskDir)), false)
    await total.clock.advance(60_000)
    assert.equal(fs.existsSync(scanCancelFlagPath(total.taskDir)), true, '总时长到了也要停')
    total.children[0].exit(0)
    assert.equal((await totalHandle.result).errorCode, 'timeout')
  })

  await step('核实不过的页不算页：文件不存在 / 空文件 / 页序不连续 / 超过上限 / 声称页数对不上', async () => {
    const cases: Array<{ name: string; setup: (rig: Rig) => string }> = [
      { name: '文件不存在', setup: () => JSON.stringify({ page: 1, file: 'page-001.jpg', bytes: 9, via: 'wia' }) },
      { name: '空文件', setup: (rig) => { fs.writeFileSync(path.join(rig.taskDir, 'page-001.jpg'), ''); return JSON.stringify({ page: 1, file: 'page-001.jpg', bytes: 0, via: 'wia' }) } },
      { name: '页序跳号', setup: (rig) => pageLine(rig, 2) },
      { name: '符号链接冒充页', setup: (rig) => {
        const outside = path.join(tmpRoot, 'outside-secret.jpg')
        fs.writeFileSync(outside, 'secret')
        fs.symlinkSync(outside, path.join(rig.taskDir, 'page-001.jpg'))
        return JSON.stringify({ page: 1, file: 'page-001.jpg', bytes: 6, via: 'wia' })
      } },
    ]
    for (const item of cases) {
      const rig = makeRig()
      const handle = startWiaScan(flatbedRequest(rig), rig.deps)
      rig.children[0].send(`${item.setup(rig)}\n`)
      assert.equal(fs.existsSync(scanCancelFlagPath(rig.taskDir)), true, `${item.name}：必须立刻叫停`)
      rig.children[0].send(`${doneLine(1)}\n`)
      rig.children[0].exit(0)
      const result = await handle.result
      assert.equal(result.ok, false, item.name)
      assert.equal(result.errorCode, 'unknown', item.name)
      assert.equal(result.pages.length, 0, `${item.name}：不能把没核实的页算进去`)
    }
    const over = makeRig()
    const overHandle = startWiaScan(feederRequest(over, { maxPages: 2 }), over.deps)
    over.children[0].send(`${pageLine(over, 1)}\n${pageLine(over, 2)}\n${pageLine(over, 3)}\n`)
    assert.equal(fs.existsSync(scanCancelFlagPath(over.taskDir)), true, '第 3 页超过上限必须叫停')
    over.children[0].exit(0)
    const overResult = await overHandle.result
    assert.equal(overResult.errorCode, 'unknown')
    assert.equal(overResult.pages.length, 2, '上限之内核实过的页保留，超出的不收')

    const mismatch = makeRig()
    const mismatchHandle = startWiaScan(flatbedRequest(mismatch), mismatch.deps)
    mismatch.children[0].send(`${pageLine(mismatch, 1)}\n${doneLine(2)}\n`)
    mismatch.children[0].exit(0)
    assert.equal((await mismatchHandle.result).errorCode, 'unknown', '脚本说 2 页、核实到 1 页，不能当成功')
  })

  await step('杂音与异常收尾：非协议行忽略；没有结果行就退出 → unknown；起不来进程 → unknown 且不挂住', async () => {
    const noisy = makeRig()
    const noisyHandle = startWiaScan(flatbedRequest(noisy), noisy.deps)
    noisy.children[0].send(`Windows PowerShell banner\n{not json\n{"unknown":1}\n${pageLine(noisy, 1)}\n[1,2]\n${doneLine(1)}`)
    noisy.children[0].exit(0)
    const noisyResult = await noisyHandle.result
    assert.equal(noisyResult.ok, true, '结果行末尾没有换行也要在进程结束时取出')

    const crash = makeRig()
    const crashHandle = startWiaScan(feederRequest(crash), crash.deps)
    crash.children[0].send(`${pageLine(crash, 1)}\n`)
    crash.children[0].exit(1)
    const crashResult = await crashHandle.result
    assert.equal(crashResult.ok, false)
    assert.equal(crashResult.errorCode, 'unknown')

    const throwing = makeRig()
    const throwingHandle = startWiaScan(flatbedRequest(throwing), {
      ...throwing.deps,
      spawnProcess: () => { throw Object.assign(new Error('spawn blocked'), { code: 'EPERM' }) },
    })
    assert.equal((await throwingHandle.result).errorCode, 'unknown')

    const enoent = makeRig()
    const enoentHandle = startWiaScan(flatbedRequest(enoent), enoent.deps)
    enoent.children[0].pid = undefined
    enoent.children[0].emit('error', Object.assign(new Error('spawn powershell ENOENT'), { code: 'ENOENT' }))
    assert.equal((await enoentHandle.result).errorCode, 'unknown')
  })

  await step('启动前校验：非法参数同步抛出且不起进程；残留的取消标记被清掉', () => {
    const rig = makeRig()
    assert.throws(() => startWiaScan({ source: 'flatbed', color: 'gray', outDir: '/etc' }, rig.deps), WiaParamError)
    assert.throws(() => startWiaScan(flatbedRequest(rig, { deviceName: "x'; y" }), rig.deps), WiaParamError)
    assert.throws(() => startWiaScan(flatbedRequest(rig, { maxPages: 99 }), rig.deps), WiaParamError)
    assert.equal(rig.spawnCalls.length, 0, '参数不过白名单就不能起 PowerShell')
    fs.writeFileSync(scanCancelFlagPath(rig.taskDir), '1')
    startWiaScan(flatbedRequest(rig), rig.deps)
    assert.equal(fs.existsSync(scanCancelFlagPath(rig.taskDir)), false, '上一次遗留的取消标记会让新一轮一开始就被叫停，必须先清掉')
  })

  await step('探测：ready / busy / not_found / error / 超时', async () => {
    const run = async (lines: string[], hang = false): Promise<Awaited<ReturnType<typeof runWiaProbe>>> => {
      const rig = makeRig()
      const probe = runWiaProbe({ deviceName: 'S' }, rig.deps)
      assert.equal(rig.spawnCalls.length, 1)
      assert.match(Buffer.from(rig.spawnCalls[0].args[5], 'base64').toString('utf16le'), /\$Mode = 'probe'/)
      if (hang) {
        await rig.clock.advance(20_000)
        await rig.clock.advance(0)
        rig.children[0].exit(1)
      } else {
        rig.children[0].send(`${lines.join('\n')}\n`)
        rig.children[0].exit(0)
      }
      return probe
    }
    assert.equal((await run(['{"ok":true,"probe":true,"pages":0}'])).state, 'ready')
    assert.equal((await run([failedLine('device_not_found', null, 0)])).state, 'not_found')
    const busy = await run([failedLine('script_error', WIA_HRESULT.BUSY, 0)])
    assert.deepEqual([busy.state, busy.hresult], ['busy', WIA_HRESULT.BUSY])
    assert.equal((await run([failedLine('wia_error', WIA_HRESULT.OFFLINE, 0)])).state, 'error')
    assert.equal((await run([])).state, 'error', '没有结果行不能当 ready')
    assert.equal((await run([doneLine(0)])).state, 'error', '探测必须收到 probe 标记才算 ready')
    assert.equal((await run([], true)).state, 'error', '探测超时 = error')
  })
}

// ═════════════════════════════════════════════════════════════════════════
// 4. 真实子进程（假执行器测不到的管道、读空 stderr、SIGKILL）
// ═════════════════════════════════════════════════════════════════════════

const REAL_CHILD_SOURCE = String.raw`
const fs = require('fs'), path = require('path')
const dir = process.argv[1], mode = process.argv[2]
const page = JSON.stringify({ page: 1, file: 'page-001.jpg', bytes: 5, via: 'wia' })
fs.writeFileSync(path.join(dir, 'page-001.jpg'), 'hello')
process.stderr.write('x'.repeat(200000))
if (mode === 'crash') process.exit(3)
process.stdout.write(page.slice(0, 10))
setTimeout(() => {
  process.stdout.write(page.slice(10) + '\r\n')
  if (mode === 'finish') {
    process.stdout.write(JSON.stringify({ ok: true, pages: 1, canceled: false, setFailed: [] }))
    process.exit(0)
  }
  const flag = path.join(dir, 'cancel.flag')
  setInterval(() => {
    if (mode === 'cooperative' && fs.existsSync(flag)) {
      process.stdout.write(JSON.stringify({ ok: true, pages: 1, canceled: true, setFailed: [] }) + '\n')
      process.exit(0)
    }
  }, 20)
}, 100)
`

export async function realProcessChecks(): Promise<void> {
  const realDeps = (rig: Rig, mode: string): Partial<WiaRunnerDeps> => ({
    root: rig.root,
    spawnProcess: (_command, _args, options) => spawn(process.execPath, ['-e', REAL_CHILD_SOURCE, rig.taskDir, mode], options),
  })

  await step('真实子进程：切开的行 + 20 万字节 stderr 不堵管道，末行无换行也能取出', async () => {
    const rig = makeRig()
    const result = await startWiaScan(flatbedRequest(rig), realDeps(rig, 'finish')).result
    assert.equal(result.ok, true)
    assert.equal(result.pages.length, 1)
    assert.equal(result.pages[0].bytes, 5)
    assert.equal(result.forceKilled, false)
  })

  await step('真实子进程：不配合的进程在宽限期后被真的杀掉（SIGKILL），返回强杀标记', async () => {
    const rig = makeRig()
    const handle = startWiaScan(flatbedRequest(rig, { abortGraceMs: 300 }), realDeps(rig, 'stubborn'))
    await new Promise((resolve) => setTimeout(resolve, 400))
    const startedAbort = Date.now()
    handle.abort()
    const result = await handle.result
    assert.equal(result.endedBy, 'aborted')
    assert.equal(result.forceKilled, true)
    assert.ok(Date.now() - startedAbort < 5_000, '强杀后必须很快收口')
  })

  await step('真实子进程：配合的进程看到取消标记自己退出，不强杀', async () => {
    const rig = makeRig()
    const handle = startWiaScan(flatbedRequest(rig, { abortGraceMs: 5_000 }), realDeps(rig, 'cooperative'))
    await new Promise((resolve) => setTimeout(resolve, 400))
    handle.abort()
    const result = await handle.result
    assert.equal(result.endedBy, 'aborted')
    assert.equal(result.forceKilled, false)
  })

  await step('真实子进程：异常退出且没有结果行 → unknown', async () => {
    const rig = makeRig()
    const result = await startWiaScan(flatbedRequest(rig), realDeps(rig, 'crash')).result
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'unknown')
  })
}
