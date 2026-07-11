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
 * 的 PRINTABLE 常量）：仅 pdf/jpg/jpeg/png，≤20MB，避免前端放行了后端必拒的文件。
 */

import { execSync } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { extname, join } from 'path'
import { warn } from '../logger'

export const ALLOWED_USB_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png'])
export const MAX_USB_FILE_BYTES = 20 * 1024 * 1024
export const MAX_USB_FILES_LISTED = 200
const SAFE_ID_TTL_MS = 10 * 60 * 1000
const IGNORED_NAMES = new Set(['system volume information', '$recycle.bin'])

export interface UsbDriveInfo {
  /** 盘符根路径，如 "E:\\"。仅在本模块内部使用，不出现在任何返回给前端的对象里。 */
  rootPath: string
  label: string | null
}

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

/**
 * 查询可移动磁盘（Win32_LogicalDisk DriveType=2）。非 Windows 平台或查询失败
 * 一律返回 null（不抛错，不影响心跳 / claim 等其余 Agent 功能）。
 * 一体机场景只处理单个 U 盘插槽：多块可移动磁盘时只取第一块。
 */
export function detectRemovableDrive(): UsbDriveInfo | null {
  if (process.platform !== 'win32') return null
  try {
    const ps =
      'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" | Select-Object DeviceID, VolumeName | ConvertTo-Json -Compress'
    const raw = execSync(`powershell -NonInteractive -Command "${ps}"`, {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim()
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const first = list.find((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    if (!first) return null

    const deviceId = String(first['DeviceID'] ?? '').trim()
    if (!deviceId) return null
    const volumeName = first['VolumeName'] != null ? String(first['VolumeName']).trim() : ''
    return { rootPath: `${deviceId}\\`, label: volumeName || null }
  } catch (e) {
    warn(`usb: detectRemovableDrive failed — ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/**
 * Windows 隐藏/系统文件名查询，一次性对整个目录查询（而不是逐文件 spawn 一次
 * PowerShell），避免 U 盘文件较多时枚举变慢。非 Windows 平台返回空集合。
 */
function listHiddenOrSystemNames(rootPath: string): Set<string> {
  if (process.platform !== 'win32') return new Set()
  try {
    const escaped = rootPath.replace(/'/g, "''")
    const ps =
      `Get-ChildItem -LiteralPath '${escaped}' -File -Force | ` +
      `Where-Object { $_.Attributes -match 'Hidden' -or $_.Attributes -match 'System' } | ` +
      `Select-Object -ExpandProperty Name | ConvertTo-Json -Compress`
    const raw = execSync(`powershell -NonInteractive -Command "${ps}"`, {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim()
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
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
      stat = statSync(fullPath)
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
export function refreshUsbFileList(
  driveProvider: () => UsbDriveInfo | null = detectRemovableDrive,
  hiddenNamesProvider: (rootPath: string) => Set<string> = listHiddenOrSystemNames,
): UsbFileListResult {
  registry = new Map()

  const drive = driveProvider()
  if (!drive) return { present: false, driveLabel: null, files: [] }

  const hidden = hiddenNamesProvider(drive.rootPath)
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
export function getUsbStatus(driveProvider: () => UsbDriveInfo | null = detectRemovableDrive): UsbStatus {
  const drive = driveProvider()
  return drive ? { present: true, driveLabel: drive.label } : { present: false, driveLabel: null }
}

/**
 * 一次性消费：无论成功失败，safeId 立即从注册表移除，不可重放。
 * driveRoot 前缀校验兜底防止枚举与读取之间设备被换成另一块同盘符 U 盘。
 */
export function consumeUsbFile(safeId: string): ConsumedUsbFile | null {
  const entry = registry.get(safeId)
  if (!entry) return null
  registry.delete(safeId)

  if (Date.now() - entry.createdAt > SAFE_ID_TTL_MS) return null
  if (!entry.absolutePath.startsWith(entry.driveRoot)) return null
  if (!existsSync(entry.absolutePath)) return null

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
}
