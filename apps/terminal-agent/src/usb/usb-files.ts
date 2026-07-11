/**
 * usb/usb-files.ts — U 盘导入（Task 9）
 *
 * 浏览器不直接读 U 盘。Agent 通过 Windows CIM/PowerShell 枚举可移动磁盘，
 * 只把脱敏元数据（文件名/扩展名/大小 + 一次性 safeId）交给 local-api 层，
 * 从不把绝对路径透出到 Kiosk 前端。
 *
 * safeId 只在当前一次枚举快照内有效：
 *   - 被读取（consumeUsbFile）后立即从注册表移除，不可重放；
 *   - 超过 TTL 未读取自动失效；
 *   - 下一次枚举（refreshUsbFileList）整体重建注册表，旧快照的 safeId 全部失效。
 *
 * 白名单口径对齐后端 print_doc purpose（services/api/src/files/file-validation.ts
 * 的 PRINTABLE 常量）：仅 pdf/jpg/jpeg/png。大小上限对齐 kiosk-upload 实际生效值：
 * 外部 multipart 固定走 proxy 校验，min(print_doc 20MB, PROXY_MAX_BYTES 15MB) = 15MB，
 * 避免前端放行了后端必拒的文件。
 *
 * PowerShell 查询走异步 execFile（不经 shell，无引号拼接风险），不阻塞与
 * QR 登录 / 心跳共享的事件循环；磁盘检测结果做短 TTL 缓存，status/files
 * 同一轮轮询共享一次真实查询。
 */

import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'fs'
import { extname, join, sep } from 'path'
import { promisify } from 'util'
import { warn } from '../logger'

const execFileAsync = promisify(execFile)

export const ALLOWED_USB_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png'])
export const MAX_USB_FILE_BYTES = 15 * 1024 * 1024
export const MAX_USB_FILES_LISTED = 200
const SAFE_ID_TTL_MS = 10 * 60 * 1000
const DRIVE_DETECT_CACHE_MS = 1_500
const IGNORED_NAMES = new Set(['system volume information', '$recycle.bin'])

export interface UsbDriveInfo {
  /** 盘符根路径，如 "E:\\"。仅在本模块内部使用，不出现在任何返回给前端的对象里。 */
  rootPath: string
  label: string | null
}

/** 驱动/隐藏文件 provider 允许同步或异步实现：真实实现是异步 PowerShell，verify 注入同步假驱动。 */
export type UsbDriveProvider = () => UsbDriveInfo | null | Promise<UsbDriveInfo | null>
export type HiddenNamesProvider = (rootPath: string) => Set<string> | Promise<Set<string>>

export interface UsbFileListItem {
  safeId: string
  filename: string
  extension: string
  sizeBytes: number
}

export interface UsbFileListResult {
  present: boolean
  driveLabel: string | null
  files: UsbFileListItem[]
}

export interface UsbStatus {
  present: boolean
  driveLabel: string | null
}

export interface ConsumedUsbFile {
  buffer: Buffer
  filename: string
  extension: string
}

interface RegisteredUsbFile {
  filename: string
  extension: string
  sizeBytes: number
  absolutePath: string
  driveRoot: string
  createdAt: number
}

interface RawUsbFileEntry {
  filename: string
  extension: string
  sizeBytes: number
  absolutePath: string
}

async function runPowerShellJson(command: string): Promise<unknown> {
  const { stdout } = await execFileAsync(
    'powershell',
    ['-NonInteractive', '-NoProfile', '-Command', command],
    { encoding: 'utf-8', timeout: 10_000, windowsHide: true },
  )
  const raw = stdout.trim()
  if (!raw) return null
  return JSON.parse(raw)
}

let driveDetectCache: { at: number; value: UsbDriveInfo | null } | null = null

/**
 * 查询可移动磁盘（Win32_LogicalDisk DriveType=2）。非 Windows 平台或查询失败
 * 一律返回 null（不抛错，不影响心跳 / claim 等其余 Agent 功能）。
 * 一体机场景只处理单个 U 盘插槽：多块可移动磁盘时只取第一块。
 * 结果缓存 1.5 秒：Kiosk 每 2 秒轮询 status（有盘时紧接着请求 files），
 * 缓存让同一轮轮询只 spawn 一次 PowerShell。
 */
export async function detectRemovableDrive(): Promise<UsbDriveInfo | null> {
  if (process.platform !== 'win32') return null
  if (driveDetectCache && Date.now() - driveDetectCache.at < DRIVE_DETECT_CACHE_MS) {
    return driveDetectCache.value
  }
  let value: UsbDriveInfo | null = null
  try {
    const parsed = await runPowerShellJson(
      'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" | Select-Object DeviceID, VolumeName | ConvertTo-Json -Compress',
    )
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const first = list.find((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    if (first) {
      const deviceId = String(first['DeviceID'] ?? '').trim()
      if (deviceId) {
        const volumeName = first['VolumeName'] != null ? String(first['VolumeName']).trim() : ''
        value = { rootPath: `${deviceId}\\`, label: volumeName || null }
      }
    }
  } catch (e) {
    warn(`usb: detectRemovableDrive failed — ${e instanceof Error ? e.message : String(e)}`)
    value = null
  }
  driveDetectCache = { at: Date.now(), value }
  return value
}

/**
 * Windows 隐藏/系统文件名查询，一次性对整个目录查询（而不是逐文件 spawn 一次
 * PowerShell），避免 U 盘文件较多时枚举变慢。非 Windows 平台返回空集合。
 */
async function listHiddenOrSystemNames(rootPath: string): Promise<Set<string>> {
  if (process.platform !== 'win32') return new Set()
  try {
    const escaped = rootPath.replace(/'/g, "''")
    const parsed = await runPowerShellJson(
      `Get-ChildItem -LiteralPath '${escaped}' -File -Force | ` +
        `Where-Object { $_.Attributes -match 'Hidden' -or $_.Attributes -match 'System' } | ` +
        `Select-Object -ExpandProperty Name | ConvertTo-Json -Compress`,
    )
    if (parsed === null) return new Set()
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return new Set(list.filter((v): v is string => typeof v === 'string'))
  } catch (e) {
    warn(`usb: listHiddenOrSystemNames failed — ${e instanceof Error ? e.message : String(e)}`)
    return new Set()
  }
}

/**
 * 纯文件系统枚举，与 Windows 检测解耦：不做隐藏文件判断（交给调用方按需叠加
 * listHiddenOrSystemNames 的结果过滤），只做扩展名白名单 + 大小 + 命名黑名单。
 * 用 lstat 而非 stat：符号链接 / reparse point 的 lstat 不是常规文件，直接排除，
 * 防止 U 盘上的链接把读取导向盘外文件。
 * 这样本函数在任意平台都可用真实临时目录做 verify，不依赖真实 Windows/U盘。
 */
export function enumerateDriveFiles(rootPath: string): RawUsbFileEntry[] {
  let names: string[]
  try {
    names = readdirSync(rootPath)
  } catch (e) {
    warn(`usb: failed to read drive root — ${e instanceof Error ? e.message : String(e)}`)
    return []
  }

  const entries: RawUsbFileEntry[] = []
  for (const name of names) {
    if (entries.length >= MAX_USB_FILES_LISTED) break
    if (name.startsWith('.') || name.startsWith('$')) continue
    if (IGNORED_NAMES.has(name.toLowerCase())) continue

    const ext = extname(name).toLowerCase()
    if (!ALLOWED_USB_EXTENSIONS.has(ext)) continue

    const fullPath = join(rootPath, name)
    let stat
    try {
      stat = lstatSync(fullPath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    if (stat.size <= 0 || stat.size > MAX_USB_FILE_BYTES) continue

    entries.push({ filename: name, extension: ext, sizeBytes: stat.size, absolutePath: fullPath })
  }
  return entries
}

// ── 一次性 safeId 注册表（进程内存，不落盘，Agent 重启即清空） ──────────────

let registry = new Map<string, RegisteredUsbFile>()

/**
 * 刷新 U 盘文件列表：整体重建注册表快照，旧一轮 safeId 全部失效。
 * driveProvider / hiddenNamesProvider 可注入，供 verify 脚本用假驱动测试。
 */
export async function refreshUsbFileList(
  driveProvider: UsbDriveProvider = detectRemovableDrive,
  hiddenNamesProvider: HiddenNamesProvider = listHiddenOrSystemNames,
): Promise<UsbFileListResult> {
  registry = new Map()

  const drive = await driveProvider()
  if (!drive) return { present: false, driveLabel: null, files: [] }

  const hidden = await hiddenNamesProvider(drive.rootPath)
  const raw = enumerateDriveFiles(drive.rootPath).filter((entry) => !hidden.has(entry.filename))

  const files: UsbFileListItem[] = raw.map((entry) => {
    const safeId = randomUUID()
    registry.set(safeId, {
      filename: entry.filename,
      extension: entry.extension,
      sizeBytes: entry.sizeBytes,
      absolutePath: entry.absolutePath,
      driveRoot: drive.rootPath,
      createdAt: Date.now(),
    })
    return { safeId, filename: entry.filename, extension: entry.extension, sizeBytes: entry.sizeBytes }
  })

  return { present: true, driveLabel: drive.label, files }
}

/** 轻量状态查询，不触碰注册表（不使旧 safeId 失效），供 Kiosk 高频轮询"是否插入"。 */
export async function getUsbStatus(driveProvider: UsbDriveProvider = detectRemovableDrive): Promise<UsbStatus> {
  const drive = await driveProvider()
  return drive ? { present: true, driveLabel: drive.label } : { present: false, driveLabel: null }
}

/**
 * 一次性消费：无论成功失败，safeId 立即从注册表移除，不可重放。
 *
 * 读取前复核（防枚举与读取之间文件被替换 / 链接跳出 U 盘）：
 *   - lstat 必须仍是常规文件（拒绝符号链接 / reparse point）且大小与枚举时一致；
 *   - realpath 解析后的真实路径必须仍在 realpath 解析后的盘根之下（containment）。
 * 已知限制：不校验 volume serial 等设备身份——同盘符换入另一块 U 盘且同名同大小
 * 文件存在时无法区分（需 Windows API，留待真机验收阶段评估），此时读到的是新盘
 * 上用户可见的同名文件，不构成路径逃逸。
 */
export function consumeUsbFile(safeId: string): ConsumedUsbFile | null {
  const entry = registry.get(safeId)
  if (!entry) return null
  registry.delete(safeId)

  if (Date.now() - entry.createdAt > SAFE_ID_TTL_MS) return null

  let stat
  try {
    stat = lstatSync(entry.absolutePath)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  if (stat.size !== entry.sizeBytes) return null

  try {
    const realRoot = realpathSync.native(entry.driveRoot)
    const realFile = realpathSync.native(entry.absolutePath)
    const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep
    if (!realFile.startsWith(rootWithSep)) return null
  } catch {
    return null
  }

  let buffer: Buffer
  try {
    buffer = readFileSync(entry.absolutePath)
  } catch (e) {
    warn(`usb: failed to read file — ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
  if (buffer.length <= 0 || buffer.length > MAX_USB_FILE_BYTES) return null

  return { buffer, filename: entry.filename, extension: entry.extension }
}

/** 仅供 verify 脚本在多个用例之间重置内存态。 */
export function resetUsbRegistryForTest(): void {
  registry = new Map()
  driveDetectCache = null
}
