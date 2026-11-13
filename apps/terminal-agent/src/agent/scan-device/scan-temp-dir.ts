/**
 * agent/scan-device/scan-temp-dir.ts — 屏上扫描的私有临时目录
 *
 * 屏上扫描出的 JPEG 页和合成的 PDF 只允许放在
 *   %ProgramData%\AIJobPrintAgent\scan-device\<taskId>\
 * （非 Windows 开发机降级到 os.tmpdir()，与 db.ts / task-runner.ts 的取根方式一致）。
 *
 * 权限：和现有扫描目录（scan-inbox）一样，靠安装器对 %ProgramData%\AIJobPrintAgent
 * 整棵树设下的「仅 SYSTEM + Administrators、关闭继承」ACL（install-production-agent.ps1
 * 的 Set-ProgramDataTreeAcl），终端程序以 LocalSystem 在其下新建的子目录继承它。
 * 这里不重复设 ACL，只在 Windows 上首次建根目录时核对一次「没有 SYSTEM / Administrators
 * 之外的主体拿到任何允许权限」，核对不过就拒绝建目录（失败关闭）。
 *
 * 清理：投递成功、失败、取消、切面板、清场都立即整目录删除；服务启动时清残留。
 * 删除前后写本地删除审计账本（scan_deletion_audit），账本只存 HMAC，不含路径、文件名、内容。
 * 审计写入失败不能阻止隐私删除（与 sweepUnclaimedDir 同一原则）。
 *
 * 本批（A1）只提供模块和单测，没有任何调用方；接线放在 A2。
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHmac } from 'crypto'
import { spawnSync } from 'child_process'
import { log, warn } from '../../logger'
import { COPY_DELETION_REASONS } from '../copy-device/copy-types'
import {
  beginScanDeletionAudit,
  finishScanDeletionAudit,
  getActiveDatabase,
  getOrCreateScanAuditHmacKey,
  type AgentDatabase,
} from '../db'

/** 任务号只允许这些字符：后端 ScanTask.id 是 cuid / uuid，都在范围内。 */
export const SCAN_TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const SCAN_CANCEL_FLAG_NAME = 'cancel.flag'
export const SCAN_RESULT_PDF_NAME = 'scan.pdf'
/** 扫描页文件名：page-001.jpg … page-999.jpg。 */
export const SCAN_PAGE_FILE_PATTERN = /^page-(\d{3})\.jpg$/

/** 删除审计里的原因码。上报白名单与这份列表同源，不要另抄一份。 */
export const SCAN_DEVICE_DELETION_REASONS = [
  'SCAN_DEVICE_DELIVERED',
  'SCAN_DEVICE_FAILED',
  'SCAN_DEVICE_ABORTED',
  'SCAN_DEVICE_SWITCHED_TO_PANEL',
  'SCAN_DEVICE_SESSION_CLEARED',
  'SCAN_DEVICE_STARTUP_RESIDUE',
  ...COPY_DELETION_REASONS,
] as const
export type ScanDeviceDeletionReason = (typeof SCAN_DEVICE_DELETION_REASONS)[number]

export type ScanTempDirErrorCode =
  | 'invalid_task_id'
  | 'invalid_page_index'
  | 'path_outside_root'
  | 'unsafe_directory'
  | 'acl_unsafe'

export class ScanTempDirError extends Error {
  constructor(readonly code: ScanTempDirErrorCode, message: string) {
    super(message)
    this.name = 'ScanTempDirError'
  }
}

export interface ScanTempAuditTicket {
  finish(outcome: { result: 'deleted'; deletedAt: string } | { result: 'delete_failed'; errorCode: string }): void
}

/** 删除审计的出口。默认实现写本地账本（createLedgerAuditPort），单测可注入假实现。 */
export interface ScanTempAuditPort {
  begin(taskId: string, reason: ScanDeviceDeletionReason, nowIso: string): ScanTempAuditTicket
}

export interface ScanTempDirHooks {
  /** 私有根目录，默认 getScanDeviceRoot()。 */
  root?: string
  audit?: ScanTempAuditPort
  now?: () => number
  /** 首次建根目录后的 ACL 核对。默认：Windows 上跑 PowerShell 核对，其它平台不做。 */
  assertDirectoryAcl?: (dir: string) => void
  /** 删整个目录。默认 fs.rmSync(dir, { recursive: true })，不跟随符号链接。 */
  removeDirectory?: (dir: string) => void
}

export interface ScanTempPurgeResult {
  status: 'absent' | 'deleted' | 'failed'
  /** 删除前目录里的直接子项个数。 */
  entryCount: number
  errorCode?: string
}

export function getScanDeviceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const base = env['PROGRAMDATA']
    ? path.join(env['PROGRAMDATA'], 'AIJobPrintAgent', 'scan-device')
    : path.join(os.tmpdir(), 'AIJobPrintAgent', 'scan-device')
  return base
}

export function assertScanTaskId(taskId: string): string {
  if (typeof taskId !== 'string' || !SCAN_TASK_ID_PATTERN.test(taskId)) {
    throw new ScanTempDirError('invalid_task_id', 'scan-temp-dir: 任务号格式不合法')
  }
  return taskId
}

export function scanPageFileName(index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > 999) {
    throw new ScanTempDirError('invalid_page_index', 'scan-temp-dir: 页序号越界')
  }
  return `page-${String(index).padStart(3, '0')}.jpg`
}

export function scanCancelFlagPath(taskDir: string, pathImpl: path.PlatformPath = path): string {
  return pathImpl.join(taskDir, SCAN_CANCEL_FLAG_NAME)
}

export function scanResultPdfPath(taskDir: string, pathImpl: path.PlatformPath = path): string {
  return pathImpl.join(taskDir, SCAN_RESULT_PDF_NAME)
}

export function scanTaskDirPath(taskId: string, root: string = getScanDeviceRoot()): string {
  return path.join(root, assertScanTaskId(taskId))
}

function samePath(a: string, b: string, pathImpl: path.PlatformPath): boolean {
  const left = pathImpl.resolve(a)
  const right = pathImpl.resolve(b)
  return pathImpl === path.win32 ? left.toLowerCase() === right.toLowerCase() : left === right
}

/**
 * 校验一个目录恰好是 <root>\<taskId>：直接位于私有根下、名字是合法任务号。
 * 路径穿越（..）、绝对路径跳出、多一层子目录、根本身，都会被拒。
 * pathImpl 可传 path.win32，让 Mac 上也能用 Windows 路径语义做单测。
 */
export function assertScanTaskDir(
  dir: string,
  root: string = getScanDeviceRoot(),
  pathImpl: path.PlatformPath = path,
): string {
  if (typeof dir !== 'string' || dir.includes('\0')) {
    throw new ScanTempDirError('path_outside_root', 'scan-temp-dir: 目录不在私有临时目录内')
  }
  const resolved = pathImpl.resolve(dir)
  const taskId = pathImpl.basename(resolved)
  if (!SCAN_TASK_ID_PATTERN.test(taskId) || !samePath(pathImpl.dirname(resolved), root, pathImpl)) {
    throw new ScanTempDirError('path_outside_root', 'scan-temp-dir: 目录不在私有临时目录内')
  }
  return taskId
}

/** 取消标记必须恰好是任务目录下的 cancel.flag。 */
export function assertScanCancelFlag(
  flagPath: string,
  taskDir: string,
  pathImpl: path.PlatformPath = path,
): void {
  if (typeof flagPath !== 'string' || !samePath(flagPath, scanCancelFlagPath(taskDir, pathImpl), pathImpl)) {
    throw new ScanTempDirError('path_outside_root', 'scan-temp-dir: 取消标记不在任务目录内')
  }
}

// ── Windows ACL 核对 ─────────────────────────────────────────────────────

/**
 * 路径从 stdin 传入，不进 PowerShell 解析器；脚本用 -EncodedCommand（UTF-16LE base64）传，
 * 不经过命令行引号转义。通过条件：目录不是重解析点，且所有「允许」权限的主体都只属于
 * SYSTEM（S-1-5-18）或 Administrators（S-1-5-32-544）。其它任何主体（Everyone、Users、
 * Authenticated Users、具体账户……）一律不通过。
 */
const ACL_CHECK_SCRIPT = [
  '$ErrorActionPreference = \'Stop\'',
  '$path = [Console]::In.ReadLine()',
  '$item = Get-Item -LiteralPath $path -Force',
  'if (-not $item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { exit 1 }',
  '$acl = Get-Acl -LiteralPath $path',
  '$allowed = @(\'S-1-5-18\', \'S-1-5-32-544\')',
  '$sids = @($acl.Access | Where-Object { $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow } | ForEach-Object { if ($_.IdentityReference -is [System.Security.Principal.SecurityIdentifier]) { $_.IdentityReference.Value } else { ([System.Security.Principal.NTAccount]$_.IdentityReference).Translate([System.Security.Principal.SecurityIdentifier]).Value } })',
  '$extra = @($sids | Where-Object { $allowed -notcontains $_ })',
  'if ($extra.Count -gt 0) { exit 1 }',
  'Write-Output \'ok\'',
].join('\n')

export function assertWindowsDirectoryAcl(dir: string): void {
  if (process.platform !== 'win32') return
  const encoded = Buffer.from(ACL_CHECK_SCRIPT, 'utf16le').toString('base64')
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    input: dir,
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  })
  if (result.error || result.status !== 0 || String(result.stdout).trim() !== 'ok') {
    throw new ScanTempDirError('acl_unsafe', 'scan-temp-dir: 私有扫描目录的访问权限不是仅 SYSTEM 与管理员，拒绝使用')
  }
}

// ── 建目录 ───────────────────────────────────────────────────────────────

let verifiedRoot: string | undefined

function isRealDirectory(dir: string): boolean {
  const meta = fs.lstatSync(dir)
  return meta.isDirectory() && !meta.isSymbolicLink()
}

function ensureRoot(hooks: ScanTempDirHooks): string {
  const root = hooks.root ?? getScanDeviceRoot()
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  if (!isRealDirectory(root)) {
    throw new ScanTempDirError('unsafe_directory', 'scan-temp-dir: 私有根目录不是普通目录')
  }
  if (verifiedRoot !== root) {
    ;(hooks.assertDirectoryAcl ?? assertWindowsDirectoryAcl)(root)
    verifiedRoot = root
  }
  return root
}

/** 单测用：忘掉已核对过的根目录，让下一次建目录重新核对 ACL。 */
export function resetScanTempDirStateForTest(): void {
  verifiedRoot = undefined
}

/**
 * 建 <root>\<taskId>。同一任务号重复调用返回同一个目录（幂等，已有内容原样保留）。
 * 返回目录的绝对路径。
 */
export function createScanTaskDir(taskId: string, hooks: ScanTempDirHooks = {}): string {
  assertScanTaskId(taskId)
  const root = ensureRoot(hooks)
  const dir = path.join(root, taskId)
  try {
    fs.mkdirSync(dir, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  if (!isRealDirectory(dir)) {
    throw new ScanTempDirError('unsafe_directory', 'scan-temp-dir: 任务目录不是普通目录')
  }
  return dir
}

// ── 删除与审计 ───────────────────────────────────────────────────────────

/** 默认审计出口：写 db.ts 的本地删除账本，标识符是每安装密钥的 HMAC。 */
export function createLedgerAuditPort(db: AgentDatabase = getActiveDatabase()): ScanTempAuditPort | undefined {
  if (!db) return undefined
  return {
    begin(taskId, reason, nowIso) {
      const key = Buffer.from(getOrCreateScanAuditHmacKey(db), 'hex')
      const identifierHash = createHmac('sha256', key).update(`scan-device-task-v1\0${taskId}`).digest('hex')
      const eventId = createHmac('sha256', key)
        .update(`scan-device-delete-v1\0${identifierHash}\0${reason}`)
        .digest('hex')
      beginScanDeletionAudit(db, { eventId, reasonCode: reason, identifierHash }, nowIso)
      return {
        finish(outcome) {
          finishScanDeletionAudit(db, eventId, outcome)
        },
      }
    },
  }
}

function errorCodeOf(error: unknown, fallback: string): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code.toUpperCase() : fallback
}

/**
 * 立即删除整个任务目录，并写删除审计。目录不存在返回 absent（不写审计，没东西可删）。
 * 永不抛出：删除失败返回 failed 与错误码，调用方可稍后重试或交给启动时清残留。
 */
export function purgeScanTaskDir(
  taskId: string,
  reason: ScanDeviceDeletionReason,
  hooks: ScanTempDirHooks = {},
): ScanTempPurgeResult {
  assertScanTaskId(taskId)
  const root = hooks.root ?? getScanDeviceRoot()
  const dir = path.join(root, taskId)
  const now = hooks.now ?? Date.now

  let entryCount = 0
  try {
    const meta = fs.lstatSync(dir)
    // 符号链接只当链接本身处理（rmSync 不跟随），不读它指向的目录。
    if (meta.isDirectory() && !meta.isSymbolicLink()) entryCount = fs.readdirSync(dir).length
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'absent', entryCount: 0 }
    // 读不了不代表删不了：照样走删除，entryCount 记 0。
  }

  const label = taskId
  let ticket: ScanTempAuditTicket | undefined
  const audit = hooks.audit ?? createLedgerAuditPort()
  if (audit) {
    try {
      ticket = audit.begin(taskId, reason, new Date(now()).toISOString())
    } catch (auditError) {
      warn(`scan-temp-dir: failed to persist deletion intent; proceeding with deletion — task=${label}: ${errorCodeOf(auditError, 'AUDIT_WRITE_FAILED')}`)
    }
  } else {
    warn(`scan-temp-dir: deletion audit unavailable; proceeding with deletion — task=${label}`)
  }

  try {
    ;(hooks.removeDirectory ?? ((target: string) => fs.rmSync(target, { recursive: true })))(dir)
    if (fs.existsSync(dir)) throw Object.assign(new Error('still present'), { code: 'STILL_PRESENT' })
  } catch (deleteError) {
    const errorCode = errorCodeOf(deleteError, 'DELETE_FAILED')
    try {
      ticket?.finish({ result: 'delete_failed', errorCode })
    } catch (auditError) {
      warn(`scan-temp-dir: delete and audit result update both failed — task=${label}: ${errorCodeOf(auditError, 'AUDIT_WRITE_FAILED')}`)
    }
    warn(`scan-temp-dir: failed to delete scan task directory — task=${label} code=${errorCode}`)
    return { status: 'failed', entryCount, errorCode }
  }

  try {
    ticket?.finish({ result: 'deleted', deletedAt: new Date(now()).toISOString() })
  } catch (auditError) {
    warn(`scan-temp-dir: deletion succeeded but audit result update failed — task=${label}: ${errorCodeOf(auditError, 'AUDIT_WRITE_FAILED')}`)
  }
  log(`scan-temp-dir: deleted scan task directory — task=${label} entries=${entryCount} reason=${reason}`)
  return { status: 'deleted', entryCount }
}

/**
 * 服务启动时清残留：私有根下所有任务目录（及不该出现的零散文件）一律删除。
 * 调用方已持有单实例锁，没有正在进行的扫描。不进入符号链接。
 */
export function sweepScanDeviceResidue(
  hooks: ScanTempDirHooks = {},
): { removedTaskDirs: number; removedOther: number; failed: number } {
  const root = hooks.root ?? getScanDeviceRoot()
  const stats = { removedTaskDirs: 0, removedOther: 0, failed: 0 }
  let names: string[]
  try {
    names = fs.readdirSync(root)
  } catch {
    return stats
  }
  for (const name of names) {
    const full = path.join(root, name)
    let meta: fs.Stats
    try {
      meta = fs.lstatSync(full)
    } catch {
      continue
    }
    if (meta.isDirectory() && !meta.isSymbolicLink() && SCAN_TASK_ID_PATTERN.test(name)) {
      const result = purgeScanTaskDir(name, 'SCAN_DEVICE_STARTUP_RESIDUE', hooks)
      if (result.status === 'deleted') stats.removedTaskDirs += 1
      else if (result.status === 'failed') stats.failed += 1
      continue
    }
    try {
      fs.rmSync(full, { recursive: true, force: true })
      stats.removedOther += 1
    } catch {
      stats.failed += 1
    }
  }
  if (stats.removedTaskDirs + stats.removedOther + stats.failed > 0) {
    log(
      `scan-temp-dir: startup residue sweep — taskDirs=${stats.removedTaskDirs} other=${stats.removedOther} failed=${stats.failed}`,
    )
  }
  return stats
}
