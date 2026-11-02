/**
 * agent/scan-device/wia-script.ts — 屏上扫描的 WIA PowerShell 脚本与它的参数、输出协议
 *
 * 本文件回答三件事：
 *   1. 脚本长什么样、怎么把参数安全地写进去（白名单值拼接，不用字符串拼用户输入）；
 *   2. 脚本往 stdout 打什么（逐页一行 JSON + 结束一行结果），怎么逐行解析（含半行缓冲）；
 *   3. WIA 的 HRESULT 对应哪个对外错误码。
 * 起进程、超时、取消、强杀在 wia-runner.ts。
 *
 * 脚本主体取自 KSK-001 上以 SYSTEM / 会话 0 / 非交互身份实扫成功的 wia-min.ps1
 * （设备枚举、Connect、属性 3088/6146/4103/6147–6152、Transfer 的写法一字不改），
 * 新增的只有：JSON 输出、取消标记、BMP→JPEG 转换。下面几处在 Windows 真机上还没实跑
 * 过，必须在 A2 之前补：ImageProcess Convert 滤镜与 System.Drawing 兜底（V0-11）、进纸器
 * 多页与各 HRESULT（V0-3 / V0-4）。Mac 上的门禁只能验证参数、协议与映射，验证不了脚本本身。
 *
 * 调用方式：-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand <UTF-16LE base64>。
 * 脚本全程纯 ASCII，stdout 只出 JSON，不受 Windows 控制台代码页（GBK）影响。
 *
 * 脚本约束（verify:scan-device-engine 有静态检查）：纯 ASCII、不含反引号和 ${、不出现双引号
 * 字符串（JSON 里的双引号都在单引号字符串里）、大括号 / 圆括号 / 方括号配平、长度受限。
 */

import path from 'path'
import { StringDecoder } from 'string_decoder'
import { SCAN_PAGE_FILE_PATTERN, assertScanCancelFlag, assertScanTaskDir } from './scan-temp-dir'

// ── 对外错误码与 HRESULT 映射 ────────────────────────────────────────────

export type ScanDeviceErrorCode =
  | 'feeder_empty'
  | 'paper_jam'
  | 'cover_open'
  | 'busy'
  | 'warming_up'
  | 'not_ready'
  | 'timeout'
  | 'too_large'
  | 'unknown'

/** 微软 WIA 错误码（facility 0x21）。现场 V0-4 实测前，屏上对这些都只显示通用句。 */
export const WIA_HRESULT = {
  PAPER_JAM: '0x80210002',
  PAPER_EMPTY: '0x80210003',
  OFFLINE: '0x80210005',
  BUSY: '0x80210006',
  WARMING_UP: '0x80210007',
  DEVICE_COMMUNICATION: '0x8021000A',
  COVER_OPEN: '0x80210016',
} as const

/**
 * 设失败或属性不存在就必须当这次扫描没成功。
 * 3088 来源，6146/4103 颜色，6147/6148 分辨率，6151/6152 扫描区域。
 * 3096（进纸器）和 6149/6150（原点）失败只记日志，不在这张表里。
 */
export const WIA_REQUIRED_PROPERTY_IDS = [3088, 6146, 4103, 6147, 6148, 6151, 6152] as const

const WIA_REQUIRED_PROPERTY_ID_SET = new Set<number>(WIA_REQUIRED_PROPERTY_IDS)

/** 必需属性里设失败的那些。空数组表示可以按扫描结果本身判断成功与否。 */
export function requiredWiaPropertiesFailed(setFailed: readonly number[]): number[] {
  return setFailed.filter((id) => WIA_REQUIRED_PROPERTY_ID_SET.has(id))
}

/** 规范成 0x + 8 位大写十六进制；不是 HRESULT 形状返回 undefined。 */
export function normalizeHresult(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const match = /^0x([0-9a-fA-F]{8})$/.exec(raw.trim())
  return match ? `0x${match[1].toUpperCase()}` : undefined
}

/**
 * 只做「这个 HRESULT 是什么」的静态映射。依赖上下文的判断（首页无纸 vs 中途无纸、
 * 预热中重试一次）在 wia-runner.ts。
 */
export function mapWiaHresult(hresult: string | undefined): ScanDeviceErrorCode {
  switch (hresult) {
    case WIA_HRESULT.PAPER_EMPTY:
      return 'feeder_empty'
    case WIA_HRESULT.PAPER_JAM:
      return 'paper_jam'
    case WIA_HRESULT.BUSY:
      return 'busy'
    case WIA_HRESULT.WARMING_UP:
      return 'warming_up'
    case WIA_HRESULT.COVER_OPEN:
      return 'cover_open'
    case WIA_HRESULT.OFFLINE:
    case WIA_HRESULT.DEVICE_COMMUNICATION:
      return 'not_ready'
    default:
      return 'unknown'
  }
}

// ── 参数白名单 ───────────────────────────────────────────────────────────

export const WIA_SOURCES = ['flatbed', 'feeder'] as const
export const WIA_COLORS = ['gray', 'color'] as const
export const WIA_ALLOWED_DPI = [300] as const
export const WIA_JPEG_QUALITY = 75
export const WIA_MAX_PAGES_CEILING = 50
export const SCAN_MAX_PAGES_DEFAULT = 20

export type WiaSource = (typeof WIA_SOURCES)[number]
export type WiaColor = (typeof WIA_COLORS)[number]

export class WiaParamError extends Error {
  constructor(readonly field: string) {
    super(`wia-script: 参数 ${field} 不在白名单内`)
    this.name = 'WiaParamError'
  }
}

export interface WiaScanScriptParams {
  /** 空 = 第一个 type=1 的 WIA 扫描仪。不写死型号，由配置项 scanDeviceName 提供。 */
  deviceName: string
  source: WiaSource
  color: WiaColor
  dpi: number
  maxPages: number
  /** 本次运行第一页的页序号（玻璃台逐页扫时，第 2 页从 2 开始，文件名不冲突）。 */
  startIndex: number
  /** 必须恰好是 <私有根>\<taskId>。 */
  outDir: string
  /** 必须恰好是 <outDir>\cancel.flag。 */
  cancelFlagPath: string
}

export interface WiaScriptContext {
  /** 私有临时根目录（getScanDeviceRoot()）。 */
  root: string
  /** 路径语义，单测可传 path.win32。 */
  pathImpl?: path.PlatformPath
}

const DEVICE_NAME_PATTERN = /^[\p{L}\p{N} _.()#+/-]{1,128}$/u
// 写进单引号字符串的路径只允许这些字符；引号、$、反引号、分号、管道、%、换行一概不要。
const PS_PATH_PATTERN = /^[A-Za-z0-9 _.:\\/()-]{1,260}$/

/**
 * 读配置项 scanDeviceName。空 / 缺省 / 非字符串 = 空串（取第一个 WIA 扫描仪）。
 * 不在这里校验字符：配了但含不允许字符时，建脚本会拒绝（失败关闭），而不是悄悄换一台。
 */
export function readScanDeviceName(config: object | null | undefined): string {
  const value = (config as { scanDeviceName?: unknown } | null | undefined)?.scanDeviceName
  return typeof value === 'string' ? value.trim() : ''
}

function assertEnum<T extends string>(field: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  throw new WiaParamError(field)
}

function assertIntInRange(field: string, value: unknown, min: number, max: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) return value
  throw new WiaParamError(field)
}

function assertDpi(value: unknown): number {
  if (typeof value === 'number' && (WIA_ALLOWED_DPI as readonly number[]).includes(value)) return value
  throw new WiaParamError('dpi')
}

function assertDeviceName(value: unknown): string {
  if (typeof value !== 'string') throw new WiaParamError('deviceName')
  if (value === '') return ''
  if (value !== value.trim() || !DEVICE_NAME_PATTERN.test(value)) throw new WiaParamError('deviceName')
  return value
}

function assertPsPath(field: string, value: string): string {
  if (!PS_PATH_PATTERN.test(value)) throw new WiaParamError(field)
  return value
}

export interface ValidatedWiaScanParams extends WiaScanScriptParams {
  /** 已规范化的绝对路径，脚本里用的就是它们。 */
  outDir: string
  cancelFlagPath: string
}

export function validateWiaScanParams(
  params: WiaScanScriptParams,
  context: WiaScriptContext,
): ValidatedWiaScanParams {
  const pathImpl = context.pathImpl ?? path
  const maxPages = assertIntInRange('maxPages', params.maxPages, 1, WIA_MAX_PAGES_CEILING)
  const startIndex = assertIntInRange('startIndex', params.startIndex, 1, 999 - maxPages + 1)
  try {
    assertScanTaskDir(params.outDir, context.root, pathImpl)
  } catch {
    throw new WiaParamError('outDir')
  }
  try {
    assertScanCancelFlag(params.cancelFlagPath, params.outDir, pathImpl)
  } catch {
    throw new WiaParamError('cancelFlagPath')
  }
  return {
    deviceName: assertDeviceName(params.deviceName),
    source: assertEnum('source', params.source, WIA_SOURCES),
    color: assertEnum('color', params.color, WIA_COLORS),
    dpi: assertDpi(params.dpi),
    maxPages,
    startIndex,
    outDir: assertPsPath('outDir', pathImpl.resolve(params.outDir)),
    cancelFlagPath: assertPsPath('cancelFlagPath', pathImpl.resolve(params.cancelFlagPath)),
  }
}

// ── 脚本 ─────────────────────────────────────────────────────────────────

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

// 固定主体。不得含反引号、`${`、双引号字符串（见文件头约束）。
const WIA_SCRIPT_BODY = String.raw`
$ProgressPreference = 'SilentlyContinue'
$script:setFailed = New-Object System.Collections.ArrayList
$script:via = 'none'

function Emit([string]$line) {
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}

function SetFailedJson() {
  $ids = @($script:setFailed.ToArray())
  return ('[' + ($ids -join ',') + ']')
}

function Fail([string]$code, [string]$hresult, [int]$pages) {
  $h = 'null'
  if ($hresult) { $h = '"' + $hresult + '"' }
  Emit ('{"ok":false,"code":"' + $code + '","hresult":' + $h + ',"pages":' + $pages + ',"setFailed":' + (SetFailedJson) + '}')
}

function HResultOf($rec) {
  $ex = $rec.Exception
  while ($ex.InnerException -and -not ($ex -is [System.Runtime.InteropServices.COMException])) { $ex = $ex.InnerException }
  return ('0x{0:X8}' -f $ex.HResult)
}

function GetProp($props, [int]$id) {
  foreach ($p in $props) { if ($p.PropertyID -eq $id) { return $p.Value } }
  return $null
}

function SetProp($props, [int]$id, $val) {
  foreach ($p in $props) {
    if ($p.PropertyID -eq $id) {
      try { $p.Value = $val } catch { [void]$script:setFailed.Add($id) }
      return
    }
  }
  [void]$script:setFailed.Add($id)
}

function SaveJpeg($img, [string]$dest) {
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
  try {
    $proc = New-Object -ComObject WIA.ImageProcess
    [void]$proc.Filters.Add($proc.FilterInfos.Item('Convert').FilterID)
    $proc.Filters.Item(1).Properties.Item('FormatID').Value = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'
    $proc.Filters.Item(1).Properties.Item('Quality').Value = $JpegQuality
    $out = $proc.Apply($img)
    $out.SaveFile($dest)
    $script:via = 'wia'
    return
  } catch {
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue }
  }
  Add-Type -AssemblyName System.Drawing
  $tmp = $dest + '.src.' + [string]$img.FileExtension
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  $img.SaveFile($tmp)
  $bmp = [System.Drawing.Image]::FromFile($tmp)
  try {
    $codec = $null
    foreach ($c in [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()) { if ($c.MimeType -eq 'image/jpeg') { $codec = $c } }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$JpegQuality)
    $bmp.Save($dest, $codec, $ep)
  } finally {
    $bmp.Dispose()
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
  $script:via = 'drawing'
}

$n = 0
try {
  $dm = New-Object -ComObject WIA.DeviceManager
  $info = $null
  foreach ($d in $dm.DeviceInfos) {
    if ($d.Type -ne 1) { continue }
    if ($DeviceName -eq '' -or ([string](GetProp $d.Properties 7)) -eq $DeviceName) { $info = $d; break }
  }
  if (-not $info) { Fail 'device_not_found' '' 0; exit 0 }
  $dev = $info.Connect()
  if ($Mode -eq 'probe') { Emit '{"ok":true,"probe":true,"pages":0}'; exit 0 }

  if ($Source -eq 'feeder') {
    SetProp $dev.Properties 3088 1
    SetProp $dev.Properties 3096 1
  } else {
    SetProp $dev.Properties 3088 2
  }
  $item = $dev.Items.Item(1)
  $ip = $item.Properties
  if ($Color -eq 'color') { SetProp $ip 6146 1; SetProp $ip 4103 3 } else { SetProp $ip 6146 2; SetProp $ip 4103 2 }
  SetProp $ip 6147 $Dpi
  SetProp $ip 6148 $Dpi
  SetProp $ip 6149 0
  SetProp $ip 6150 0
  SetProp $ip 6151 ([int][math]::Floor(8.267 * $Dpi))
  SetProp $ip 6152 ([int][math]::Floor(11.692 * $Dpi))

  $bmpFormat = '{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}'
  $idx = $StartIndex
  $canceled = $false
  while ($n -lt $MaxPages) {
    if (Test-Path -LiteralPath $CancelFlag) { $canceled = $true; break }
    try {
      $img = $item.Transfer($bmpFormat)
    } catch {
      Fail 'wia_error' (HResultOf $_) $n
      exit 0
    }
    $name = 'page-' + $idx.ToString('000') + '.jpg'
    $dest = Join-Path $OutDir $name
    try {
      SaveJpeg $img $dest
      $len = (Get-Item -LiteralPath $dest).Length
    } catch {
      Fail 'convert_failed' (HResultOf $_) $n
      exit 0
    }
    $n++
    Emit ('{"page":' + $idx + ',"file":"' + $name + '","bytes":' + $len + ',"via":"' + $script:via + '"}')
    $idx++
    if ($Source -eq 'flatbed') { break }
  }
  $cv = 'false'
  if ($canceled) { $cv = 'true' }
  Emit ('{"ok":true,"pages":' + $n + ',"canceled":' + $cv + ',"setFailed":' + (SetFailedJson) + '}')
  exit 0
} catch {
  Fail 'script_error' (HResultOf $_) $n
  exit 0
}
`

/** 写进脚本的探针 / 扫描公共前缀。所有值都已过白名单，路径已规范化。 */
function buildPrologue(fields: {
  mode: 'scan' | 'probe'
  deviceName: string
  source: WiaSource
  color: WiaColor
  dpi: number
  maxPages: number
  startIndex: number
  outDir: string
  cancelFlagPath: string
}): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$Mode = ${psQuote(fields.mode)}`,
    `$DeviceName = ${psQuote(fields.deviceName)}`,
    `$Source = ${psQuote(fields.source)}`,
    `$Color = ${psQuote(fields.color)}`,
    `$Dpi = ${fields.dpi}`,
    `$MaxPages = ${fields.maxPages}`,
    `$StartIndex = ${fields.startIndex}`,
    `$JpegQuality = ${WIA_JPEG_QUALITY}`,
    `$OutDir = ${psQuote(fields.outDir)}`,
    `$CancelFlag = ${psQuote(fields.cancelFlagPath)}`,
  ].join('\n')
}

export function buildWiaScanScript(params: WiaScanScriptParams, context: WiaScriptContext): string {
  const v = validateWiaScanParams(params, context)
  return `${buildPrologue({ mode: 'scan', ...v })}\n${WIA_SCRIPT_BODY}`
}

/** 健康探测脚本：只枚举并连接一次扫描仪，不设属性、不扫描、不写文件。 */
export function buildWiaProbeScript(deviceName: string): string {
  return `${buildPrologue({
    mode: 'probe',
    deviceName: assertDeviceName(deviceName),
    source: 'flatbed',
    color: 'gray',
    dpi: 300,
    maxPages: 1,
    startIndex: 1,
    outDir: '',
    cancelFlagPath: '',
  })}\n${WIA_SCRIPT_BODY}`
}

/** 命令行总长上限 32767 字符；编码后超过这个数就拒绝，而不是让 CreateProcess 报错。 */
export const WIA_ENCODED_COMMAND_MAX_CHARS = 28_000

export function encodeWiaCommand(script: string): string {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  if (encoded.length > WIA_ENCODED_COMMAND_MAX_CHARS) throw new WiaParamError('script')
  return encoded
}

export function buildWiaPowerShellArgs(encodedCommand: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand]
}

/** 优先用系统目录下的绝对路径，不依赖服务进程的 PATH；取不到才退回 powershell。 */
export function resolvePowerShellPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const systemRoot = env['SystemRoot'] ?? env['SYSTEMROOT']
  if (platform === 'win32' && systemRoot) {
    return path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  }
  return 'powershell'
}

// ── stdout 协议 ──────────────────────────────────────────────────────────

export type WiaFailureStage = 'device_not_found' | 'wia_error' | 'convert_failed' | 'script_error'

export type WiaLine =
  | { kind: 'page'; page: number; file: string; bytes: number; via: string }
  | { kind: 'done'; pages: number; canceled: boolean; probe: boolean; setFailed: number[] }
  | { kind: 'failed'; stage: WiaFailureStage; hresult: string | undefined; pages: number; setFailed: number[] }

const FAILURE_STAGES: ReadonlySet<string> = new Set(['device_not_found', 'wia_error', 'convert_failed', 'script_error'])

function readSetFailed(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => Number.isInteger(item) && item >= 0 && item <= 99999).slice(0, 20)
}

function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647 ? value : undefined
}

/**
 * 解析 stdout 的一行。不是 JSON 对象、形状不对、字段越界的一律返回 undefined
 * （PowerShell 的横幅、警告等杂音由调用方忽略，不当协议处理）。
 */
export function parseWiaLine(line: string): WiaLine | undefined {
  const text = line.trim()
  if (!text.startsWith('{') || !text.endsWith('}')) return undefined
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>

  if ('page' in record) {
    const page = nonNegativeInt(record['page'])
    const bytes = nonNegativeInt(record['bytes'])
    const file = record['file']
    if (page === undefined || page < 1 || page > 999 || bytes === undefined) return undefined
    if (typeof file !== 'string') return undefined
    const match = SCAN_PAGE_FILE_PATTERN.exec(file)
    if (!match || Number(match[1]) !== page) return undefined
    return { kind: 'page', page, file, bytes, via: typeof record['via'] === 'string' ? record['via'].slice(0, 16) : '' }
  }

  if (record['ok'] === true) {
    const pages = nonNegativeInt(record['pages'])
    if (pages === undefined) return undefined
    return {
      kind: 'done',
      pages,
      canceled: record['canceled'] === true,
      probe: record['probe'] === true,
      setFailed: readSetFailed(record['setFailed']),
    }
  }

  if (record['ok'] === false) {
    const pages = nonNegativeInt(record['pages'])
    if (pages === undefined) return undefined
    const code = typeof record['code'] === 'string' ? record['code'] : ''
    return {
      kind: 'failed',
      stage: (FAILURE_STAGES.has(code) ? code : 'script_error') as WiaFailureStage,
      hresult: normalizeHresult(record['hresult']),
      pages,
      setFailed: readSetFailed(record['setFailed']),
    }
  }

  return undefined
}

/**
 * 逐行缓冲：stdout 的分块边界和行边界无关，一行可能被切成几段到达，也可能一块里有好几行。
 * 只返回完整的行；没读完的半行留着等下一块；进程结束后用 flush() 取出末尾没有换行的那一行。
 * 半行超过上限（64 KiB）就丢弃，防止异常输出把内存撑满。
 */
export class LineBuffer {
  static readonly MAX_PENDING_CHARS = 65_536
  private pending = ''
  private readonly decoder = new StringDecoder('utf8')
  /** 因超长被丢弃的次数，仅供日志与单测。 */
  droppedOverlong = 0

  push(chunk: Buffer | string): string[] {
    this.pending += typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    const parts = this.pending.split('\n')
    this.pending = parts.pop() ?? ''
    if (this.pending.length > LineBuffer.MAX_PENDING_CHARS) {
      this.pending = ''
      this.droppedOverlong += 1
    }
    return parts.map((part) => part.replace(/\r$/, ''))
  }

  flush(): string[] {
    const rest = this.pending + this.decoder.end()
    this.pending = ''
    return rest ? [rest.replace(/\r$/, '')] : []
  }
}
