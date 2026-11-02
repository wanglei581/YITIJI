// ============================================================
// 门禁：屏上扫描引擎底座（A1）。
//
// 守的是「终端程序能在 Windows 服务身份下经 WIA 无界面扫描，并且出错时不吞页、
// 不泄露、不卡死」这一层底座，以及从 scan-watcher 抽出的受保护投递没有变形：
//
//   1. PowerShell 脚本：参数只走白名单，路径穿越、引号注入、非白名单值一律拒绝；
//      脚本纯 ASCII、无反引号 / ${ / 双引号字符串、括号配平、长度受限。
//   2. stdout 协议：分块边界与行边界无关，半行缓冲，杂音忽略，字段越界丢弃。
//   3. HRESULT → 对外错误码；首页无纸 vs 中途无纸；中途卡纸删页；预热中等 10 秒重试一次。
//   4. 取消标记与强杀：45 秒内进程自己退出就不杀；到点才 taskkill /T /F；返回值标明强杀过。
//      超时（空闲 / 总时长）走同一条升级路径。时间用假时钟，进程用假执行器；另有一组
//      真实子进程，验证管道、stderr 读空、SIGKILL 这些假执行器测不到的真行为。
//   5. 私有临时目录：任务号白名单、符号链接拒绝、ACL 核对只做一次且失败关闭、
//      删除审计（假出口 + 真本地账本，账本只有 HMAC）、启动清残留且不跟随链接。
//   6. 合 PDF：页数等于输入张数；页数上限 20 / 体积上限 18 MiB（边界精确）；超限不留半成品。
//   7. 设备锁：互斥、先来先得、超时带持有者标签、幂等释放、别人的句柄放不掉你的锁。
//   8. 受保护投递抽取：表单字节与抽取前的内联写法逐字节相同；origin 不传就不出现；
//      watcher 路径上线上字段恰为五个、顺序固定、没有 origin；失败归类对原型链字符串免疫。
//
// 全程只写临时目录，不起 PowerShell、不碰 Windows API、打印机或扫描仪。
// 脚本本身（WIA 调用、BMP→JPEG）在 Windows 上的真实行为不在本门禁范围，见 wia-script.ts 文件头。
// ============================================================

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import FormData from 'form-data'
import type { AxiosInstance } from 'axios'
import { imageToPdf, imagesToPdf, ImagesToPdfError } from '../src/printer/image-to-pdf'
import { processCandidate } from '../src/agent/scan-watcher'
import { __setUnauthorizedMarkerPathForTests } from '../src/agent/auth-state'
import { getScanDeletionAudits, openDatabase } from '../src/agent/db'
import {
  buildScanDeliveryForm,
  classifyScanDeliveryFailure,
  guessScanMimeType,
  postScanDeliveryForm,
} from '../src/agent/scan-delivery'
import {
  DEVICE_LOCK_DEFAULT_TIMEOUT_MS,
  DeviceLock,
  DeviceLockTimeoutError,
  sanitizeDeviceLockLabel,
} from '../src/agent/device-lock'
import {
  ScanTempDirError,
  assertScanCancelFlag,
  assertScanTaskDir,
  assertScanTaskId,
  createLedgerAuditPort,
  createScanTaskDir,
  getScanDeviceRoot,
  purgeScanTaskDir,
  resetScanTempDirStateForTest,
  scanCancelFlagPath,
  scanPageFileName,
  sweepScanDeviceResidue,
  type ScanTempAuditPort,
} from '../src/agent/scan-device/scan-temp-dir'
import {
  LineBuffer,
  SCAN_MAX_PAGES_DEFAULT,
  WIA_ENCODED_COMMAND_MAX_CHARS,
  WIA_HRESULT,
  WiaParamError,
  buildWiaPowerShellArgs,
  buildWiaProbeScript,
  buildWiaScanScript,
  encodeWiaCommand,
  mapWiaHresult,
  normalizeHresult,
  parseWiaLine,
  readScanDeviceName,
  resolvePowerShellPath,
  type ScanDeviceErrorCode,
  type WiaScanScriptParams,
} from '../src/agent/scan-device/wia-script'
import {
  SCAN_PDF_MAX_BYTES,
  WIA_ABORT_GRACE_MS,
  WIA_FORCE_KILL_WAIT_MS,
  WIA_IDLE_TIMEOUT_MS,
  WIA_TOTAL_TIMEOUT_MS,
  buildTaskkillArgs,
  composeScanPdf,
  runWiaProbe,
  startWiaScan,
  type WiaRunnerDeps,
  type WiaScanRequest,
} from '../src/agent/scan-device/wia-runner'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-scan-device-engine-'))
process.env['PROGRAMDATA'] = path.join(tmpRoot, 'programdata')
fs.mkdirSync(process.env['PROGRAMDATA'], { recursive: true })
__setUnauthorizedMarkerPathForTests(path.join(tmpRoot, 'agent.unauthorized'))

const noAcl = (): void => undefined
const srcRoot = path.join(__dirname, '..', 'src')

// ── 小测试框架 ────────────────────────────────────────────────────────────

const failures: string[] = []
let passed = 0

/** 被测模块的日志在通过时静音，失败时随错误一起回放，方便定位。 */
async function step(name: string, fn: () => void | Promise<void>): Promise<void> {
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
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    restore()
    failures.push(name)
    console.error(`FAIL ${name}`)
    console.error(error instanceof Error ? (error.stack ?? error.message) : error)
    if (captured) console.error(`--- 该项运行期间被测模块的日志 ---\n${captured}`)
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise<void>((resolve) => setImmediate(resolve))
}

// ── 假时钟 / 假子进程 ──────────────────────────────────────────────────────

class FakeClock {
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

interface Rig {
  root: string
  taskDir: string
  clock: FakeClock
  children: FakeChild[]
  spawnCalls: Array<{ command: string; args: string[] }>
  killed: number[]
  deps: Partial<WiaRunnerDeps>
}

let rigSeq = 0
function makeRig(taskId = 'task1'): Rig {
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
function makePng(width: number, height: number, dpi: number | null): Buffer {
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
function makeJpeg(width: number, height: number, payloadBytes: number): Buffer {
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
const countPdfPages = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length
const normalizePdf = (pdf: Buffer): string =>
  pdf.toString('latin1').replace(/\(D:\d{14}Z\)/g, '(D:<D>)').replace(/\/ID \[[^\]]*\]/g, '/ID [<ID>]')

// ═════════════════════════════════════════════════════════════════════════
// 1. stdout 协议
// ═════════════════════════════════════════════════════════════════════════

async function protocolChecks(): Promise<void> {
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
// 2. 脚本与参数白名单
// ═════════════════════════════════════════════════════════════════════════

/** 单引号字符串之外：不许双引号、括号必须配平。返回问题清单。 */
function lintPowerShell(script: string): string[] {
  const problems: string[] = []
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(script)) problems.push('含非 ASCII 字符')
  if (script.includes('`')) problems.push('含反引号')
  if (script.includes('${')) problems.push('含 ${')
  const depth: Record<string, number> = { '{': 0, '(': 0, '[': 0 }
  const open: Record<string, string> = { '}': '{', ')': '(', ']': '[' }
  let inString = false
  for (let i = 0; i < script.length; i += 1) {
    const ch = script[i]
    if (inString) {
      if (ch === "'") {
        if (script[i + 1] === "'") i += 1
        else inString = false
      }
      continue
    }
    if (ch === "'") inString = true
    else if (ch === '"') problems.push('单引号字符串之外出现双引号')
    else if (ch === '#') while (i < script.length && script[i] !== '\n') i += 1
    else if (ch in depth) depth[ch] += 1
    else if (ch in open) {
      depth[open[ch]] -= 1
      if (depth[open[ch]] < 0) problems.push(`多余的 ${ch}`)
    }
  }
  if (inString) problems.push('单引号字符串没有闭合')
  for (const [bracket, count] of Object.entries(depth)) if (count !== 0) problems.push(`${bracket} 未配平（${count}）`)
  return problems
}

function baseParams(rig: Rig, extra: Partial<WiaScanScriptParams> = {}): WiaScanScriptParams {
  return {
    deviceName: '',
    source: 'flatbed',
    color: 'gray',
    dpi: 300,
    maxPages: 1,
    startIndex: 1,
    outDir: rig.taskDir,
    cancelFlagPath: scanCancelFlagPath(rig.taskDir),
    ...extra,
  }
}

async function scriptChecks(): Promise<void> {
  const rig = makeRig()

  await step('脚本：纯 ASCII、无反引号 / ${ / 双引号字符串、括号配平、长度受限、编码可逆', () => {
    const scripts = [
      buildWiaScanScript(baseParams(rig), { root: rig.root }),
      buildWiaScanScript(baseParams(rig, { source: 'feeder', color: 'color', maxPages: 20, startIndex: 2, deviceName: 'Scanner (USB) #2' }), { root: rig.root }),
      buildWiaProbeScript(''),
    ]
    for (const script of scripts) {
      assert.deepEqual(lintPowerShell(script), [], `脚本静态检查：${lintPowerShell(script).join('；')}`)
      assert.ok(script.length < 8_000, `脚本应远小于命令行上限，实际 ${script.length} 字符`)
      const encoded = encodeWiaCommand(script)
      assert.ok(encoded.length < WIA_ENCODED_COMMAND_MAX_CHARS)
      assert.equal(Buffer.from(encoded, 'base64').toString('utf16le'), script, 'EncodedCommand 必须是 UTF-16LE base64 且可逆')
    }
    assert.throws(() => encodeWiaCommand('x'.repeat(WIA_ENCODED_COMMAND_MAX_CHARS)), WiaParamError, '编码后超过命令行上限必须拒绝')
    assert.deepEqual(buildWiaPowerShellArgs('QUJD'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', 'QUJD'])
  })

  await step('脚本：参数前缀只含白名单值，主体保留现场实扫成功的 WIA 调用', () => {
    const script = buildWiaScanScript(baseParams(rig, { source: 'feeder', color: 'color', maxPages: 20, startIndex: 3, deviceName: 'Scanner (USB) #2' }), { root: rig.root })
    const prologue = script.split('\n').slice(0, 11)
    assert.deepEqual(prologue, [
      "$ErrorActionPreference = 'Stop'",
      "$Mode = 'scan'",
      "$DeviceName = 'Scanner (USB) #2'",
      "$Source = 'feeder'",
      "$Color = 'color'",
      '$Dpi = 300',
      '$MaxPages = 20',
      '$StartIndex = 3',
      '$JpegQuality = 75',
      `$OutDir = '${path.resolve(rig.taskDir)}'`,
      `$CancelFlag = '${path.resolve(scanCancelFlagPath(rig.taskDir))}'`,
    ])
    // 与 wia-min.ps1 一致的 WIA 调用（属性号、Transfer、设备类型过滤）
    for (const token of [
      'New-Object -ComObject WIA.DeviceManager', '$d.Type -ne 1', '$info.Connect()', '$dev.Items.Item(1)',
      'SetProp $dev.Properties 3088 1', 'SetProp $dev.Properties 3096 1', 'SetProp $dev.Properties 3088 2',
      'SetProp $ip 6146 1', 'SetProp $ip 4103 3', 'SetProp $ip 6146 2', 'SetProp $ip 4103 2',
      'SetProp $ip 6147 $Dpi', 'SetProp $ip 6148 $Dpi', 'SetProp $ip 6149 0', 'SetProp $ip 6150 0',
      '[math]::Floor(8.267 * $Dpi)', '[math]::Floor(11.692 * $Dpi)', '$item.Transfer($bmpFormat)',
      "'{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}'", 'Test-Path -LiteralPath $CancelFlag',
      "FilterInfos.Item('Convert')", "'{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'", 'System.Drawing.Imaging.EncoderParameter',
    ]) {
      assert.ok(script.includes(token), `脚本主体缺少：${token}`)
    }
    assert.match(buildWiaProbeScript('X'), /\$Mode = 'probe'/)
  })

  await step('参数白名单：非法来源 / 颜色 / dpi / 页数 / 起始页 / 设备名一律拒绝', () => {
    const bad: Array<[Partial<WiaScanScriptParams>, string]> = [
      [{ source: 'adf' as never }, 'source'], [{ source: '' as never }, 'source'], [{ color: 'rgb' as never }, 'color'],
      [{ dpi: 600 }, 'dpi'], [{ dpi: 299.5 }, 'dpi'], [{ dpi: '300' as never }, 'dpi'],
      [{ maxPages: 0 }, 'maxPages'], [{ maxPages: 51 }, 'maxPages'], [{ maxPages: 1.5 }, 'maxPages'], [{ maxPages: NaN }, 'maxPages'],
      [{ startIndex: 0 }, 'startIndex'], [{ startIndex: 1000 }, 'startIndex'], [{ startIndex: 990, maxPages: 20 }, 'startIndex'],
    ]
    for (const [extra, field] of bad) {
      assert.throws(
        () => buildWiaScanScript(baseParams(rig, extra), { root: rig.root }),
        (error: unknown) => error instanceof WiaParamError && error.field === field,
        `应拒绝 ${JSON.stringify(extra)}`,
      )
    }
    const hostileNames = [
      "a'; Remove-Item C:\\ -Recurse; '", 'x"y', 'a`b', 'a$(calc)', 'a;b', 'a|b', 'a&b', 'a\nb', 'a\0b',
      '\u2018smart\u2019', ' leading', 'trailing ', 'a'.repeat(129), 'a<b>', '%PATH%', 'a{b}', 'a[b]',
    ]
    for (const deviceName of hostileNames) {
      assert.throws(
        () => buildWiaScanScript(baseParams(rig, { deviceName }), { root: rig.root }),
        (error: unknown) => error instanceof WiaParamError && error.field === 'deviceName',
        `设备名应拒绝：${JSON.stringify(deviceName)}`,
      )
    }
    for (const deviceName of ['', 'Scanner (USB) #2', 'Vendor-Model_1.0 Scanner', '某品牌 扫描仪 2800']) {
      assert.doesNotThrow(() => buildWiaScanScript(baseParams(rig, { deviceName }), { root: rig.root }), `设备名应接受：${deviceName}`)
    }
  })

  await step('路径白名单（POSIX）：路径穿越、跳出私有根、多一层、根本身一律拒绝', () => {
    const root = rig.root
    const flag = (dir: string): string => path.join(dir, 'cancel.flag')
    const badDirs = [
      path.join(root, '..', 'evil'), root, path.join(root, 'task1', 'sub'), '/etc', path.join(root, 'task 1'),
      `${root}/task1/../../evil`, path.join(os.tmpdir(), 'task1'), 'task1', '', path.join(root, '.'), path.join(root, '..'),
    ]
    for (const outDir of badDirs) {
      assert.throws(
        () => buildWiaScanScript(baseParams(rig, { outDir, cancelFlagPath: flag(outDir) }), { root }),
        (error: unknown) => error instanceof WiaParamError && error.field === 'outDir',
        `outDir 应拒绝：${outDir}`,
      )
    }
    const badFlags = [
      path.join(rig.taskDir, 'other.flag'), path.join(root, 'task2', 'cancel.flag'),
      `${rig.taskDir}/../task2/cancel.flag`, '/tmp/cancel.flag', rig.taskDir, '',
    ]
    for (const cancelFlagPath of badFlags) {
      assert.throws(
        () => buildWiaScanScript(baseParams(rig, { cancelFlagPath }), { root }),
        (error: unknown) => error instanceof WiaParamError && error.field === 'cancelFlagPath',
        `取消标记应拒绝：${cancelFlagPath}`,
      )
    }
    // 单引号会破坏 PowerShell 单引号字符串：根目录含引号也必须拒绝，而不是靠转义硬写进去
    assert.throws(
      () => buildWiaScanScript(baseParams(rig, { outDir: "/tmp/it's/task1", cancelFlagPath: "/tmp/it's/task1/cancel.flag" }), { root: "/tmp/it's" }),
      WiaParamError,
    )
    // 带尾部斜杠的合法目录会被规范化，脚本里写入的是规范路径
    const script = buildWiaScanScript(baseParams(rig, { outDir: `${rig.taskDir}/` }), { root })
    assert.ok(script.includes(`$OutDir = '${path.resolve(rig.taskDir)}'`))
  })

  await step('路径白名单（Windows 语义）：穿越、盘符、UNC、8.3、流、尾点、大小写', () => {
    const win = path.win32
    const root = 'C:\\ProgramData\\AIJobPrintAgent\\scan-device'
    const ctx = { root, pathImpl: win }
    const ok = `${root}\\task1`
    assert.equal(assertScanTaskDir(ok, root, win), 'task1')
    assert.equal(assertScanTaskDir('c:\\programdata\\aijobprintagent\\SCAN-DEVICE\\task1', root, win), 'task1', 'Windows 路径大小写不敏感')
    assert.doesNotThrow(() => assertScanCancelFlag(`${ok}\\cancel.flag`, ok, win))
    const build = (outDir: string, cancelFlagPath = `${outDir}\\cancel.flag`): string =>
      buildWiaScanScript({ deviceName: '', source: 'flatbed', color: 'gray', dpi: 300, maxPages: 1, startIndex: 1, outDir, cancelFlagPath }, ctx)
    assert.ok(build(ok).includes(`$OutDir = '${ok}'`))
    const bad = [
      `${root}\\..\\..\\evil`, `${root}\\..`, root, 'D:\\task1', '\\\\server\\share\\task1', `${root}\\task1\\sub`,
      `${root}\\task1::$DATA`, `${root}\\task1.`, `${root}\\task 1`, 'C:\\ProgramData\\AIJobPrintAgent\\SCAN-D~1\\task1',
      `${root}\\task1\\..\\task2\\..\\..\\x`, `${root}x\\task1`,
    ]
    for (const outDir of bad) assert.throws(() => build(outDir), WiaParamError, `Windows outDir 应拒绝：${outDir}`)
    assert.throws(() => build(ok, `${root}\\task2\\cancel.flag`), WiaParamError)
    assert.throws(() => build(ok, `${ok}\\..\\task2\\cancel.flag`), WiaParamError)
  })

  await step('powershell 路径解析与 scanDeviceName 配置项：不写死型号', () => {
    assert.equal(resolvePowerShellPath({ SystemRoot: 'C:\\Windows' }, 'win32'), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    assert.equal(resolvePowerShellPath({}, 'win32'), 'powershell')
    assert.equal(resolvePowerShellPath({ SystemRoot: 'C:\\Windows' }, 'darwin'), 'powershell')
    assert.equal(readScanDeviceName(undefined), '')
    assert.equal(readScanDeviceName(null), '')
    assert.equal(readScanDeviceName({}), '')
    assert.equal(readScanDeviceName({ scanDeviceName: 5 }), '')
    assert.equal(readScanDeviceName({ scanDeviceName: '   ' }), '')
    assert.equal(readScanDeviceName({ scanDeviceName: '  Some Scanner ' }), 'Some Scanner')
    for (const file of ['scan-delivery.ts', 'device-lock.ts', 'scan-device/wia-script.ts', 'scan-device/wia-runner.ts', 'scan-device/scan-temp-dir.ts']) {
      const text = fs.readFileSync(path.join(srcRoot, 'agent', file), 'utf8')
      assert.doesNotMatch(text, /pantum|cm2800/i, `${file} 不得写死扫描仪 / 打印机型号（走配置项）`)
    }
  })
}

// ═════════════════════════════════════════════════════════════════════════
// 3. 运行器（假执行器 + 假时钟）
// ═════════════════════════════════════════════════════════════════════════

async function runnerChecks(): Promise<void> {
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

  await step('扫描：中途卡纸 → 已扫页全部删除并清空，错误码 paper_jam', async () => {
    const rig = makeRig()
    const handle = startWiaScan(feederRequest(rig), rig.deps)
    rig.children[0].send(`${pageLine(rig, 1)}\n${pageLine(rig, 2)}\n${failedLine('wia_error', WIA_HRESULT.PAPER_JAM, 2)}\n`)
    rig.children[0].exit(0)
    const result = await handle.result
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'paper_jam')
    assert.equal(result.discardedPages, 2)
    assert.deepEqual(result.pages, [], '一期不做只交已扫部分')
    assert.deepEqual(fs.readdirSync(rig.taskDir), [], '卡纸后磁盘上不能留任何扫描页')
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

async function realProcessChecks(): Promise<void> {
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

// ═════════════════════════════════════════════════════════════════════════
// 5. 私有临时目录
// ═════════════════════════════════════════════════════════════════════════

interface AuditEvent { phase: 'begin' | 'finish'; taskId?: string; reason?: string; outcome?: unknown }

function fakeAudit(events: AuditEvent[], options: { failBegin?: boolean } = {}): ScanTempAuditPort {
  return {
    begin(taskId, reason) {
      if (options.failBegin) throw new Error('audit db down')
      events.push({ phase: 'begin', taskId, reason })
      return { finish: (outcome) => { events.push({ phase: 'finish', outcome }) } }
    },
  }
}

async function tempDirChecks(): Promise<void> {
  await step('私有目录：任务号白名单；根目录与任务目录创建且幂等；拒绝符号链接', () => {
    resetScanTempDirStateForTest()
    const root = path.join(tmpRoot, 'tmpdir-root')
    const dir = createScanTaskDir('task_A-1', { root, assertDirectoryAcl: noAcl })
    assert.equal(dir, path.join(root, 'task_A-1'))
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700, 'POSIX 开发机上目录权限为 0700')
    fs.writeFileSync(path.join(dir, 'page-001.jpg'), 'x')
    assert.equal(createScanTaskDir('task_A-1', { root, assertDirectoryAcl: noAcl }), dir)
    assert.equal(fs.existsSync(path.join(dir, 'page-001.jpg')), true, '重复创建不能清掉已有内容')
    const before = fs.readdirSync(tmpRoot).sort()
    for (const bad of ['', '..', '../x', 'a/b', 'a\\b', 'a b', 'a\0b', 'x'.repeat(65), '.', 'a.b', 123 as never, undefined as never]) {
      assert.throws(() => createScanTaskDir(bad, { root, assertDirectoryAcl: noAcl }), (e: unknown) => e instanceof ScanTempDirError && e.code === 'invalid_task_id', `任务号应拒绝：${String(bad)}`)
      assert.throws(() => assertScanTaskId(bad), ScanTempDirError)
    }
    assert.deepEqual(fs.readdirSync(tmpRoot).sort(), before, '拒绝的任务号不能在私有根之外留下东西')
    assert.equal(scanPageFileName(1), 'page-001.jpg')
    assert.equal(scanPageFileName(42), 'page-042.jpg')
    for (const index of [0, 1000, 1.5, -1, NaN]) assert.throws(() => scanPageFileName(index), ScanTempDirError)

    const elsewhere = path.join(tmpRoot, 'elsewhere')
    fs.mkdirSync(elsewhere)
    const linkRoot = path.join(tmpRoot, 'link-root')
    fs.symlinkSync(elsewhere, linkRoot)
    assert.throws(() => createScanTaskDir('t1', { root: linkRoot, assertDirectoryAcl: noAcl }), (e: unknown) => e instanceof ScanTempDirError && e.code === 'unsafe_directory')
    fs.symlinkSync(elsewhere, path.join(root, 'evil'))
    assert.throws(() => createScanTaskDir('evil', { root, assertDirectoryAcl: noAcl }), (e: unknown) => e instanceof ScanTempDirError && e.code === 'unsafe_directory')
    assert.deepEqual(fs.readdirSync(elsewhere), [], '符号链接指向的目录里不能被写入')
    assert.match(getScanDeviceRoot({ PROGRAMDATA: 'C:\\ProgramData' }), /AIJobPrintAgent[\\/]scan-device$/)
    assert.match(getScanDeviceRoot({}), /AIJobPrintAgent[\\/]scan-device$/)
  })

  await step('私有目录：ACL 核对每个根目录只做一次，失败则关闭（不建任务目录），下次重试', () => {
    resetScanTempDirStateForTest()
    const root = path.join(tmpRoot, 'acl-root')
    let calls = 0
    const failing = (): void => { calls += 1; throw new ScanTempDirError('acl_unsafe', 'denied') }
    assert.throws(() => createScanTaskDir('t1', { root, assertDirectoryAcl: failing }), (e: unknown) => e instanceof ScanTempDirError && e.code === 'acl_unsafe')
    assert.equal(fs.existsSync(path.join(root, 't1')), false, 'ACL 不过就不能建任务目录')
    let ok = 0
    const passing = (): void => { ok += 1 }
    createScanTaskDir('t1', { root, assertDirectoryAcl: passing })
    createScanTaskDir('t2', { root, assertDirectoryAcl: passing })
    assert.deepEqual([calls, ok], [1, 1], '失败不缓存，成功后同一个根只核对一次')
  })

  await step('私有目录：路径校验 —— 目录必须恰是 <根>/<任务号>，取消标记必须恰是其下 cancel.flag', () => {
    const root = path.join(tmpRoot, 'assert-root')
    assert.equal(assertScanTaskDir(path.join(root, 't1'), root), 't1')
    for (const bad of [root, path.join(root, 't1', 'x'), path.join(root, '..', 't1'), '/', '', `${root}/t1/..`]) {
      assert.throws(() => assertScanTaskDir(bad, root), ScanTempDirError, `应拒绝：${bad}`)
    }
    assert.throws(() => assertScanTaskDir('x\0y', root), ScanTempDirError)
    assert.doesNotThrow(() => assertScanCancelFlag(path.join(root, 't1', 'cancel.flag'), path.join(root, 't1')))
    assert.throws(() => assertScanCancelFlag(path.join(root, 't1', 'cancel.FLAG2'), path.join(root, 't1')), ScanTempDirError)
  })

  await step('私有目录：清理即删整个目录并写审计；目录不在不写审计；删除失败如实记录；审计坏了也要删', () => {
    const root = path.join(tmpRoot, 'purge-root')
    const mk = (id: string, files = 2): string => {
      const dir = createScanTaskDir(id, { root, assertDirectoryAcl: noAcl })
      for (let i = 0; i < files; i += 1) fs.writeFileSync(path.join(dir, `page-00${i + 1}.jpg`), 'p')
      return dir
    }
    const events: AuditEvent[] = []
    let dir = mk('del1')
    let result = purgeScanTaskDir('del1', 'SCAN_DEVICE_DELIVERED', { root, audit: fakeAudit(events) })
    assert.deepEqual(result, { status: 'deleted', entryCount: 2 })
    assert.equal(fs.existsSync(dir), false)
    assert.deepEqual(events.map((e) => e.phase), ['begin', 'finish'], '先记意图再删，删完记结果')
    assert.deepEqual([events[0].taskId, events[0].reason], ['del1', 'SCAN_DEVICE_DELIVERED'])
    assert.equal((events[1].outcome as { result: string }).result, 'deleted')

    events.length = 0
    assert.deepEqual(purgeScanTaskDir('nothing-here', 'SCAN_DEVICE_ABORTED', { root, audit: fakeAudit(events) }), { status: 'absent', entryCount: 0 })
    assert.equal(events.length, 0, '没有东西可删就不写审计')

    dir = mk('fail1')
    const busy = (): void => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }) }
    result = purgeScanTaskDir('fail1', 'SCAN_DEVICE_FAILED', { root, audit: fakeAudit(events), removeDirectory: busy })
    assert.deepEqual([result.status, result.errorCode], ['failed', 'EBUSY'])
    assert.equal(fs.existsSync(dir), true)
    assert.deepEqual((events[events.length - 1].outcome as { result: string; errorCode: string }), { result: 'delete_failed', errorCode: 'EBUSY' })
    const notReallyRemoved = (): void => undefined
    assert.equal(purgeScanTaskDir('fail1', 'SCAN_DEVICE_FAILED', { root, audit: fakeAudit([]), removeDirectory: notReallyRemoved }).status, 'failed', '删完目录还在要算失败')

    dir = mk('auditdown')
    assert.equal(purgeScanTaskDir('auditdown', 'SCAN_DEVICE_ABORTED', { root, audit: fakeAudit([], { failBegin: true }) }).status, 'deleted', '审计写入失败不能阻止隐私删除')
    assert.equal(fs.existsSync(dir), false)
    dir = mk('noaudit')
    assert.equal(purgeScanTaskDir('noaudit', 'SCAN_DEVICE_SWITCHED_TO_PANEL', { root }).status, 'deleted')

    const outside = path.join(tmpRoot, 'purge-outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep')
    dir = mk('linky', 1)
    fs.symlinkSync(outside, path.join(dir, 'link'))
    assert.equal(purgeScanTaskDir('linky', 'SCAN_DEVICE_SESSION_CLEARED', { root }).status, 'deleted')
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep', '清理不能跟随符号链接删到目录之外')
  })

  await step('私有目录：服务启动清残留 —— 任务目录、零散文件、符号链接都清，不跟随链接', () => {
    const root = path.join(tmpRoot, 'sweep-root')
    for (const id of ['old1', 'old2']) {
      const dir = createScanTaskDir(id, { root, assertDirectoryAcl: noAcl })
      fs.writeFileSync(path.join(dir, 'page-001.jpg'), 'p')
    }
    fs.writeFileSync(path.join(root, 'stray.pdf'), 'stray')
    fs.mkdirSync(path.join(root, 'not a task id'))
    const outside = path.join(tmpRoot, 'sweep-outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep')
    fs.symlinkSync(outside, path.join(root, 'link'))
    const events: AuditEvent[] = []
    const stats = sweepScanDeviceResidue({ root, audit: fakeAudit(events) })
    assert.deepEqual(stats, { removedTaskDirs: 2, removedOther: 3, failed: 0 })
    assert.deepEqual(fs.readdirSync(root), [])
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep')
    assert.deepEqual(events.filter((e) => e.phase === 'begin').map((e) => e.reason), ['SCAN_DEVICE_STARTUP_RESIDUE', 'SCAN_DEVICE_STARTUP_RESIDUE'])
    assert.deepEqual(sweepScanDeviceResidue({ root: path.join(tmpRoot, 'no-such-root') }), { removedTaskDirs: 0, removedOther: 0, failed: 0 })
  })

  await step('私有目录：真本地账本只存 HMAC，不含任务号 / 路径 / 文件名；重复清理同一事件不重复入账', () => {
    const db = openDatabase()
    assert.ok(db, 'better-sqlite3 必须可用')
    const root = path.join(tmpRoot, 'ledger-root')
    const taskId = 'ledgerTask-secret-id-9f3'
    const dir = createScanTaskDir(taskId, { root, assertDirectoryAcl: noAcl })
    fs.writeFileSync(path.join(dir, 'page-001.jpg'), 'p')
    const port = createLedgerAuditPort(db)
    assert.ok(port)
    assert.equal(purgeScanTaskDir(taskId, 'SCAN_DEVICE_DELIVERED', { root, audit: port }).status, 'deleted')
    let audits = getScanDeletionAudits(db)
    assert.equal(audits.length, 1)
    assert.equal(audits[0].reasonCode, 'SCAN_DEVICE_DELIVERED')
    assert.equal(audits[0].result, 'deleted')
    assert.equal(audits[0].pendingReport, true)
    assert.match(audits[0].eventId, /^[a-f0-9]{64}$/)
    assert.match(audits[0].identifierHash, /^[a-f0-9]{64}$/)
    assert.doesNotMatch(JSON.stringify(audits), /ledgerTask|secret-id|page-001|verify-scan-device/, '账本里不能有任务号、文件名、路径')
    assert.notEqual(audits[0].identifierHash, crypto.createHash('sha256').update(`scan-device-task-v1\0${taskId}`).digest('hex'), '必须是带每安装密钥的 HMAC，不能是可复现的裸哈希')
    createScanTaskDir(taskId, { root, assertDirectoryAcl: noAcl })
    fs.writeFileSync(path.join(root, taskId, 'page-001.jpg'), 'p')
    purgeScanTaskDir(taskId, 'SCAN_DEVICE_DELIVERED', { root, audit: port })
    audits = getScanDeletionAudits(db)
    assert.equal(audits.length, 1, '同一任务同一原因是同一个事件')
    assert.equal(audits[0].attempts, 2)
    assert.equal(createLedgerAuditPort(null), undefined, '没有本地库时没有审计出口，清理仍会继续')
  })
}

// ═════════════════════════════════════════════════════════════════════════
// 6. 合 PDF
// ═════════════════════════════════════════════════════════════════════════

async function pdfChecks(): Promise<void> {
  const dir = path.join(tmpRoot, 'pdf')
  fs.mkdirSync(dir, { recursive: true })
  const jpg = (name: string, payload = 100, width = 640, height = 480): string => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, makeJpeg(width, height, payload))
    return file
  }

  await step('imagesToPdf：PDF 页数恰等于输入张数，页序同输入，每页等比铺满 A4', async () => {
    const files = [jpg('a.jpg', 100, 640, 480), jpg('b.jpg', 100, 480, 640), jpg('c.jpg', 100, 2480, 3508)]
    const png = path.join(dir, 'd.png')
    fs.writeFileSync(png, makePng(100, 200, 300))
    for (const count of [1, 2, 3, 4]) {
      const inputs = [...files, png].slice(0, count)
      const out = await imagesToPdf(inputs, { outputPath: path.join(dir, `out-${count}.pdf`) })
      assert.equal(out.pageCount, count)
      const bytes = fs.readFileSync(out.path)
      assert.equal(countPdfPages(bytes), count, `输入 ${count} 张，PDF 必须恰好 ${count} 页`)
      assert.equal(out.bytes, bytes.length)
    }
    const text = fs.readFileSync(path.join(dir, 'out-3.pdf')).toString('latin1')
    assert.equal((text.match(/\/MediaBox \[0 0 595\.28 841\.89\]/g) ?? []).length, 3, '每页都是 A4')
  })

  await step('imagesToPdf：单张时与 imageToPdf 的 PDF 内容一致（共用同一个页面绘制函数）', async () => {
    const png = path.join(dir, 'single.png')
    fs.writeFileSync(png, makePng(295, 413, 300))
    for (const scale of ['fit', 'actual'] as const) {
      const single = await imageToPdf(png, { scale })
      const multi = await imagesToPdf([png], { scale, outputPath: path.join(dir, `eq-${scale}.pdf`) })
      assert.equal(normalizePdf(fs.readFileSync(single)), normalizePdf(fs.readFileSync(multi.path)), `scale=${scale}`)
      fs.rmSync(single, { force: true })
    }
  })

  await step('imagesToPdf：输入不合格在生成之前拒绝，不留文件；运行时失败不留半成品', async () => {
    const out = path.join(dir, 'never.pdf')
    const expectCode = async (promise: Promise<unknown>, code: string): Promise<void> => {
      await assert.rejects(promise, (e: unknown) => e instanceof ImagesToPdfError && e.code === code, code)
    }
    await expectCode(imagesToPdf([], { outputPath: out }), 'no_images')
    await expectCode(imagesToPdf([jpg('x1.jpg'), jpg('x2.jpg'), jpg('x3.jpg')], { outputPath: out, maxPages: 2 }), 'too_many_pages')
    const bmp = path.join(dir, 'x.bmp')
    fs.writeFileSync(bmp, 'BM')
    await expectCode(imagesToPdf([jpg('x4.jpg'), bmp], { outputPath: out }), 'unsupported_type')
    assert.equal(fs.existsSync(out), false, '生成前拒绝，不能创建输出文件')
    const corrupt = path.join(dir, 'corrupt.jpg')
    fs.writeFileSync(corrupt, 'this is not a jpeg at all')
    await expectCode(imagesToPdf([jpg('x5.jpg'), corrupt], { outputPath: out }), 'write_failed')
    await expectCode(imagesToPdf([path.join(dir, 'missing.jpg')], { outputPath: out }), 'write_failed')
    await expectCode(imagesToPdf([jpg('x6.jpg')], { outputPath: path.join(dir, 'no-such-dir', 'o.pdf') }), 'write_failed')
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(fs.existsSync(out), false, '失败后不能留下半成品 PDF')
    const message = await imagesToPdf([corrupt], { outputPath: out }).catch((e: Error) => e.message)
    assert.doesNotMatch(String(message), /corrupt\.jpg/, '错误信息不带文件名')
  })

  await step('imagesToPdf：体积上限边界精确 —— 恰好等于上限通过，多 1 字节拒绝并删除，不二次压缩', async () => {
    const inputs = [jpg('s1.jpg', 5_000), jpg('s2.jpg', 5_000)]
    const probe = await imagesToPdf(inputs, { outputPath: path.join(dir, 'size-probe.pdf') })
    const size = probe.bytes
    const exact = await imagesToPdf(inputs, { outputPath: path.join(dir, 'size-exact.pdf'), maxBytes: size })
    assert.equal(exact.bytes, size)
    await assert.rejects(
      imagesToPdf(inputs, { outputPath: path.join(dir, 'size-over.pdf'), maxBytes: size - 1 }),
      (e: unknown) => e instanceof ImagesToPdfError && e.code === 'too_large',
    )
    assert.equal(fs.existsSync(path.join(dir, 'size-over.pdf')), false, '超限的 PDF 必须删除')
  })

  await step('合扫描 PDF：默认页数上限 20、体积上限 18 MiB；超限报 too_large，不留 scan.pdf', async () => {
    assert.equal(SCAN_MAX_PAGES_DEFAULT, 20)
    assert.equal(SCAN_PDF_MAX_BYTES, 18 * 1024 * 1024)
    const root = path.join(tmpRoot, 'compose-root')
    const taskDir = createScanTaskDir('compose1', { root, assertDirectoryAcl: noAcl })
    const write = (index: number, payload: number): string => {
      const file = path.join(taskDir, scanPageFileName(index))
      fs.writeFileSync(file, makeJpeg(2480, 3508, payload))
      return file
    }
    const twenty = Array.from({ length: 20 }, (_unused, i) => write(i + 1, 50))
    const ok = await composeScanPdf(taskDir, twenty, { root })
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.pageCount, 20, '恰好 20 页通过')
      assert.equal(ok.path, path.join(taskDir, 'scan.pdf'))
      assert.equal(countPdfPages(fs.readFileSync(ok.path)), 20)
    }
    const twentyOne = [...twenty, write(21, 50)]
    const tooMany = await composeScanPdf(taskDir, twentyOne, { root })
    assert.deepEqual(tooMany.ok ? null : [tooMany.errorCode, tooMany.reason], ['too_large', 'too_many_pages'], '第 21 页拒绝')
    assert.equal(fs.existsSync(path.join(taskDir, 'scan.pdf')), true, '拒绝不能碰上一次成功生成的文件之外的东西')
    fs.rmSync(path.join(taskDir, 'scan.pdf'))
    const configurable = await composeScanPdf(taskDir, twentyOne, { root, maxPages: 21 })
    assert.equal(configurable.ok, true, '页数上限可配')
    fs.rmSync(path.join(taskDir, 'scan.pdf'), { force: true })

    const big = write(30, 19 * 1024 * 1024)
    const oversize = await composeScanPdf(taskDir, [big], { root })
    assert.deepEqual(oversize.ok ? null : [oversize.errorCode, oversize.reason], ['too_large', 'too_large'], '合完超过 18 MiB 报 too_large')
    assert.equal(fs.existsSync(path.join(taskDir, 'scan.pdf')), false, '超限的 scan.pdf 必须删除')
    const justUnder = write(31, 17 * 1024 * 1024)
    const under = await composeScanPdf(taskDir, [justUnder], { root })
    assert.equal(under.ok && under.bytes < SCAN_PDF_MAX_BYTES, true, '17 MiB 的页合完仍在上限内')
  })

  await step('合扫描 PDF：只收该任务目录下的 page-NNN.jpg，其它文件与别处的路径一律拒绝', async () => {
    const root = path.join(tmpRoot, 'compose-root2')
    const taskDir = createScanTaskDir('compose2', { root, assertDirectoryAcl: noAcl })
    const good = path.join(taskDir, 'page-001.jpg')
    fs.writeFileSync(good, makeJpeg(640, 480, 10))
    const secret = path.join(tmpRoot, 'secret.jpg')
    fs.writeFileSync(secret, makeJpeg(640, 480, 10))
    const wrongName = path.join(taskDir, 'resume.jpg')
    fs.writeFileSync(wrongName, makeJpeg(640, 480, 10))
    for (const bad of [[secret], [good, secret], [wrongName], [path.join(taskDir, '..', 'compose2', 'x', 'page-001.jpg')]]) {
      const result = await composeScanPdf(taskDir, bad, { root })
      assert.deepEqual(result.ok ? null : [result.errorCode, result.reason], ['unknown', 'page_outside_task_dir'])
    }
    const empty = await composeScanPdf(taskDir, [], { root })
    assert.deepEqual(empty.ok ? null : empty.errorCode, 'unknown')
    const wrongDir = await composeScanPdf(path.join(root, '..', 'compose-root2', 'a', 'b'), [good], { root })
    assert.equal(wrongDir.ok, false, '任务目录本身也要过校验')
    assert.equal(fs.existsSync(path.join(taskDir, 'scan.pdf')), false)
  })
}

// ═════════════════════════════════════════════════════════════════════════
// 7. 设备锁
// ═════════════════════════════════════════════════════════════════════════

async function lockChecks(): Promise<void> {
  const make = (): { lock: DeviceLock; clock: FakeClock; logs: string[] } => {
    const clock = new FakeClock()
    const logs: string[] = []
    return { clock, logs, lock: new DeviceLock({ clock, logger: { log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) } }) }
  }

  await step('设备锁：互斥、先来先得、释放即交给队首', async () => {
    const { lock } = make()
    const order: string[] = []
    const first = await lock.acquire('print:t1')
    const second = lock.acquire('scan:s1').then((h) => { order.push('scan:s1'); return h })
    const third = lock.acquire('probe').then((h) => { order.push('probe'); return h })
    await settle()
    assert.deepEqual(order, [], '锁被占用时后来者必须等')
    assert.deepEqual(lock.snapshot().waiting, ['scan:s1', 'probe'])
    assert.equal(lock.snapshot().heldBy, 'print:t1')
    assert.equal(lock.tryAcquire('x'), undefined, '有人持有或排队时 tryAcquire 拿不到')
    first.release()
    const h2 = await second
    assert.deepEqual(order, ['scan:s1'])
    assert.equal(lock.snapshot().heldBy, 'scan:s1')
    h2.release()
    const h3 = await third
    assert.deepEqual(order, ['scan:s1', 'probe'], '严格先来先得')
    h3.release()
    assert.equal(lock.snapshot().heldBy, undefined)
    const quick = lock.tryAcquire('later')
    assert.ok(quick)
    quick.release()
  })

  await step('设备锁：等 30 秒仍拿不到则超时，错误带当前持有者标签；超时者不再占队位', async () => {
    assert.equal(DEVICE_LOCK_DEFAULT_TIMEOUT_MS, 30_000)
    const { lock, clock, logs } = make()
    const holder = await lock.acquire('print:task-77')
    const state: { outcome?: unknown } = {}
    const waiting = lock.acquire('scan:abc').then(() => { state.outcome = 'granted' }, (e: unknown) => { state.outcome = e })
    await clock.advance(29_999)
    assert.equal(state.outcome, undefined, '29.999 秒还在等')
    await clock.advance(1)
    await waiting
    const timeout = state.outcome as unknown
    assert.ok(timeout instanceof DeviceLockTimeoutError)
    assert.equal(timeout.heldBy, 'print:task-77', '要能看出谁占着')
    assert.equal(timeout.waitedMs, 30_000)
    assert.equal(timeout.code, 'DEVICE_LOCK_TIMEOUT')
    assert.deepEqual(lock.snapshot().waiting, [])
    assert.equal(clock.pending(), 0, '超时后不留定时器')
    assert.ok(logs.some((l) => l.includes('scan:abc') && l.includes('print:task-77')), '日志里要查得到等待者与持有者')
    holder.release()
    const next = await lock.acquire('after')
    next.release()

    const custom = make()
    const h = await custom.lock.acquire('a')
    const quick = custom.lock.acquire('b', { timeoutMs: 1_000 })
    const settled = quick.then(() => 'granted', () => 'timeout')
    await custom.clock.advance(1_000)
    assert.equal(await settled, 'timeout')
    await assert.rejects(custom.lock.acquire('c', { timeoutMs: 0 }), DeviceLockTimeoutError, 'timeoutMs=0 被占用就立刻拒绝')
    h.release()
  })

  await step('设备锁：释放幂等；别人的句柄放不掉你的锁；等待者拿到锁后超时计时器作废', async () => {
    const { lock, clock, logs } = make()
    const a = await lock.acquire('a')
    const pending = lock.acquire('b')
    a.release()
    a.release()
    const b = await pending
    assert.equal(lock.snapshot().heldBy, 'b')
    a.release()
    assert.equal(lock.snapshot().heldBy, 'b', '旧句柄再次释放不能放掉新持有者的锁')
    await clock.advance(DEVICE_LOCK_DEFAULT_TIMEOUT_MS * 2)
    assert.equal(lock.snapshot().heldBy, 'b', '已经拿到锁的等待者不会被它自己的超时计时器影响')
    b.release()
    assert.equal(lock.snapshot().heldBy, undefined)
    assert.equal(logs.filter((l) => l.startsWith('device-lock: released by a')).length, 1, '重复释放只记一次')
    assert.equal(sanitizeDeviceLockLabel('print:task-1_a.b'), 'print:task-1_a.b')
    assert.equal(sanitizeDeviceLockLabel('a b/c\n"d"'), 'a_b_c__d_')
    assert.equal(sanitizeDeviceLockLabel(''), 'unknown')
    assert.equal(sanitizeDeviceLockLabel('x'.repeat(100)).length, 64)
  })
}

// ═════════════════════════════════════════════════════════════════════════
// 8. 受保护投递抽取
// ═════════════════════════════════════════════════════════════════════════

const normalizeBoundary = (form: FormData, buffer: Buffer): string => buffer.toString('latin1').split(form.getBoundary()).join('<B>')

/** 抽取前 scan-watcher 里内联的写法，逐字照抄，当作等价性的对照标准。 */
function legacyInlineForm(bytes: Buffer, filename: string, scanTaskId: string, deliveryLease: string, snapshotAt: string): FormData {
  const guessMimeType = (name: string): string => {
    const lower = name.toLowerCase()
    if (lower.endsWith('.pdf')) return 'application/pdf'
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
    if (lower.endsWith('.png')) return 'image/png'
    return 'application/octet-stream'
  }
  const form = new FormData()
  form.append('file', bytes, { filename, contentType: guessMimeType(filename) })
  form.append('scanTaskId', scanTaskId)
  form.append('deliveryLease', deliveryLease)
  form.append('candidateSnapshotAt', snapshotAt)
  form.append('observedAt', snapshotAt)
  return form
}

async function deliveryChecks(): Promise<void> {
  await step('投递表单：与抽取前的内联写法逐字节相同（含 MIME 推断）；不传 origin 就没有该字段', () => {
    const snapshotAt = '2026-11-02T08:15:30.123Z'
    for (const filename of ['scan.pdf', 'SCAN.PDF', 'a.jpg', 'a.JPEG', 'p.png', '无标题.pdf', 'blob.bin', 'noext']) {
      const bytes = Buffer.from(`%PDF-1.4 ${filename} 内容`)
      const legacy = legacyInlineForm(bytes, filename, 'task-1', 'lease-1', snapshotAt)
      const extracted = buildScanDeliveryForm({ bytes, filename, scanTaskId: 'task-1', deliveryLease: 'lease-1', candidateSnapshotAt: snapshotAt })
      assert.equal(
        normalizeBoundary(extracted, extracted.getBuffer()),
        normalizeBoundary(legacy, legacy.getBuffer()),
        `${filename} 的表单字节必须与抽取前一致`,
      )
      assert.doesNotMatch(extracted.getBuffer().toString('latin1'), /origin/)
    }
    assert.equal(guessScanMimeType('a.PNG'), 'image/png')
    const bytes = Buffer.from('x')
    const withOrigin = buildScanDeliveryForm({ bytes, filename: 'scan.pdf', scanTaskId: 't', deliveryLease: 'l', candidateSnapshotAt: snapshotAt, origin: 'device' })
    const names = [...withOrigin.getBuffer().toString('latin1').matchAll(/; name="([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(names, ['file', 'scanTaskId', 'deliveryLease', 'candidateSnapshotAt', 'observedAt', 'origin'], '传了 origin 才出现，且排在最后')
    assert.match(withOrigin.getBuffer().toString('latin1'), /name="origin"\r\n\r\ndevice\r\n/)
  })

  await step('投递请求：POST 地址、表单请求头、禁用 axios 层重试', async () => {
    const calls: Array<{ url: string; body: unknown; config: Record<string, unknown> }> = []
    const client = { post: async (url: string, body: unknown, config: Record<string, unknown>) => { calls.push({ url, body, config }); return { data: {} } } } as unknown as AxiosInstance
    const form = buildScanDeliveryForm({ bytes: Buffer.from('x'), filename: 'a.pdf', scanTaskId: 't', deliveryLease: 'l', candidateSnapshotAt: '2026-01-01T00:00:00.000Z' })
    await postScanDeliveryForm(client, 'T-9', form)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/terminals/T-9/scan-sessions/deliver')
    assert.equal(calls[0].body, form)
    assert.equal(calls[0].config['_noRetry'], true, 'form 是一次性流，必须禁用 axios 层自动重试')
    assert.match(String((calls[0].config['headers'] as Record<string, string>)['content-type']), /^multipart\/form-data; boundary=/)
  })

  await step('失败归类：六类永久拒绝逐个对应；其余（含原型链字符串、非字符串）一律可重试', () => {
    const err = (code: unknown): unknown => ({ response: { data: { error: { code } } } })
    const refusals: Array<[string, string]> = [
      ['NO_WAITING_SCAN_TASK', 'no_waiting_task'], ['SCAN_LEASE_INVALID', 'lease_invalid'], ['SCAN_LEASE_EXPIRED', 'lease_invalid'],
      ['SCAN_TASK_STATE_CHANGED', 'task_state_changed'], ['SCAN_FILE_ALREADY_DELIVERED', 'file_already_delivered'],
      ['SCAN_FILE_PREVIOUSLY_ATTEMPTED', 'file_previously_attempted'], ['SCAN_FILE_STALE_CAPTURE', 'file_stale_capture'],
    ]
    for (const [code, refusal] of refusals) {
      assert.deepEqual(classifyScanDeliveryFailure(err(code)), { kind: 'refused', refusal, code })
    }
    for (const code of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'no_waiting_scan_task', 'NO_WAITING_SCAN_TASK ', '', 12345, null, undefined, {}]) {
      assert.equal(classifyScanDeliveryFailure(err(code)).kind, 'retryable', `应可重试：${String(code)}`)
    }
    for (const bad of [new Error('network'), undefined, null, 'str', {}, { response: {} }, { response: { data: null } }]) {
      assert.equal(classifyScanDeliveryFailure(bad).kind, 'retryable')
    }
  })

  await step('scan-watcher 源码：投递走 scan-delivery，不再自带 FormData，且从不传 origin', () => {
    const watcher = fs.readFileSync(path.join(srcRoot, 'agent', 'scan-watcher.ts'), 'utf8')
    assert.match(watcher, /buildScanDeliveryForm\(\{[\s\S]*?\}\)/)
    assert.match(watcher, /postScanDeliveryForm\(client, config\.terminalId, form\)/)
    assert.match(watcher, /classifyScanDeliveryFailure\(e\)/)
    assert.doesNotMatch(watcher, /from 'form-data'|new FormData|guessMimeType/, '表单构造只能在 scan-delivery.ts')
    const call = /buildScanDeliveryForm\(\{[\s\S]*?\n    \}\)/.exec(watcher)
    assert.ok(call, '找得到 watcher 的表单构造调用')
    assert.doesNotMatch(call[0], /origin/, '面板路线（watcher）不传 origin：没带 origin 后端一律按 watcher')
    assert.doesNotMatch(watcher, /'origin'|"origin"|origin:/, 'watcher 里没有任何 origin 字段')
  })

  await step('watcher 线上字节：字段恰为五个、顺序固定、值对得上、没有 origin、成功后删除源文件', async () => {
    let captured = ''
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
      req.on('end', () => {
        if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: { scanTaskId: 'scan-task-engine-1', serverNow: new Date().toISOString(), notBefore: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), deliveryLease: 'engine-lease' } }))
          return
        }
        captured = Buffer.concat(chunks).toString('latin1')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, data: { scanTaskId: 'scan-task-engine-1', fileId: 'f1' } }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(typeof address === 'object' && address)
    const folder = fs.mkdtempSync(path.join(tmpRoot, 'watcher-wire-'))
    try {
      const file = path.join(folder, 'wire.pdf')
      fs.writeFileSync(file, '%PDF-1.4 engine wire check')
      const mtime = new Date(Date.now() - 5_000)
      fs.utimesSync(file, mtime, mtime)
      const expectedSnapshotAt = new Date(fs.statSync(file).mtimeMs).toISOString()
      const originalWrite = process.stdout.write.bind(process.stdout)
      process.stdout.write = (() => true) as typeof process.stdout.write
      try {
        await processCandidate(file, 'wire.pdf', {
          apiBaseUrl: `http://127.0.0.1:${address.port}/api/v1`, terminalCode: 'T-ENGINE', printerName: 'x', agentVersion: 'verify',
          terminalId: 'terminal-engine-1', agentToken: 'engine-token', scanWatchFolder: folder,
        })
      } finally {
        process.stdout.write = originalWrite
      }
      const names = [...captured.matchAll(/; name="([^"]+)"/g)].map((m) => m[1])
      assert.deepEqual(names, ['file', 'scanTaskId', 'deliveryLease', 'candidateSnapshotAt', 'observedAt'], 'watcher 上传的字段必须恰为这五个且顺序固定')
      const values = new Map([...captured.matchAll(/; name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)].map((m) => [m[1], m[2]] as const))
      assert.equal(values.get('scanTaskId'), 'scan-task-engine-1', 'scanTaskId 取租约里的任务号')
      assert.equal(values.get('deliveryLease'), 'engine-lease', 'deliveryLease 取租约里的投递令牌（不能和任务号接反）')
      assert.equal(values.get('candidateSnapshotAt'), expectedSnapshotAt, '可信快照时间 = 文件原始 mtime 转 ISO，不夹值')
      assert.equal(values.get('observedAt'), expectedSnapshotAt, 'observedAt 与 candidateSnapshotAt 同值')
      assert.match(captured, /name="file"; filename="wire\.pdf"\r\nContent-Type: application\/pdf\r\n\r\n%PDF-1\.4 engine wire check\r\n/)
      assert.doesNotMatch(captured, /origin/)
      assert.equal(fs.existsSync(file), false, '投递成功后删除源文件')
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)))
    }
  })
}

// ═════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  try {
    await protocolChecks()
    await scriptChecks()
    await runnerChecks()
    await realProcessChecks()
    await tempDirChecks()
    await pdfChecks()
    await lockChecks()
    await deliveryChecks()
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
  if (failures.length > 0) {
    console.error(`FAIL verify-scan-device-engine: ${failures.length} 项失败，${passed} 项通过`)
    for (const name of failures) console.error(`- ${name}`)
    process.exit(1)
  }
  console.log(`verify-scan-device-engine: ok（${passed} 组）`)
  process.exit(0)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
