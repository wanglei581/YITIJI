/**
 * 开机清掉早期开发留在 Agent 数据目录里、且不在日志滚动范围内的已知遗留。
 *
 * 数据根与 getAgentPrintTempDir 同源：Windows 为 %ProgramData%\AIJobPrintAgent，
 * 其它平台为系统临时目录下的同名目录。只删这个根里写死的精确相对路径，不用通配符，
 * 也不遍历根目录。每一项只做 lstat：不存在就跳过；是符号链接或联接点就不删，记一次跳过。
 * scan-test-backup 确认是普通目录后才逐项递归。递归时每一项先 lstat，
 * 是符号链接或联接点（Windows 联接点在 lstat 上显示为 symbolic link）就只删链接本身，不进入。
 *
 * 删除失败不阻止启动，计入跳过。日志只记删了几项、字节数、跳过几项，不记文件名。
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { log } from '../logger'

export const KNOWN_LEGACY_RESIDUE_ENTRIES: readonly (readonly string[])[] = [
  // KSK-001 早期调试日志，约 48 MB，2026-06-09 后未再写入，不在日志滚动范围内。
  ['agent-debug.log'],
  // KSK-001 早期标准输出日志，约 38 MB，2026-06-02 后未再写入，不在日志滚动范围内。
  ['agent-out.log'],
  // KSK-001 的 logs\AIJobPrintTerminalSetup.exe：0.4.8 旧安装包，约 43 MB，未签名。
  ['logs', 'AIJobPrintTerminalSetup.exe'],
  // KSK-001 上 2026-09-10 的扫描测试备份 scan-test-backup\，可能含个人信息。整个目录递归删除。
  ['scan-test-backup'],
]

const SCAN_TEST_BACKUP = 'scan-test-backup'

export function getAgentDataDir(): string {
  return process.env['PROGRAMDATA']
    ? path.join(process.env['PROGRAMDATA'], 'AIJobPrintAgent')
    : path.join(os.tmpdir(), 'AIJobPrintAgent')
}

export interface LegacyResidueCleanupHooks {
  dataDir?: string
  entries?: readonly (readonly string[])[]
  lstatSync?: typeof fs.lstatSync
  readdirSync?: (directory: fs.PathLike) => string[]
  unlinkSync?: typeof fs.unlinkSync
  rmdirSync?: typeof fs.rmdirSync
}

export interface LegacyResidueCleanupResult {
  removed: number
  bytes: number
  skipped: number
}

interface CleanupIo {
  lstatSync: typeof fs.lstatSync
  readdirSync: (directory: fs.PathLike) => string[]
  unlinkSync: typeof fs.unlinkSync
  rmdirSync: typeof fs.rmdirSync
}

function staysInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return false
  return true
}

function resolveResiduePath(root: string, segments: readonly string[]): string | null {
  if (segments.length === 0) return null
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment.includes('/') ||
      segment.includes('\\') ||
      segment.includes('\0') ||
      segment.includes('*') ||
      segment.includes('?')
    ) {
      return null
    }
  }
  const resolved = path.resolve(root, ...segments)
  if (!staysInsideRoot(root, resolved)) return null
  return resolved
}

function removeLinkItself(
  linkPath: string,
  unlinkSync: typeof fs.unlinkSync,
  rmdirSync: typeof fs.rmdirSync,
): void {
  try {
    unlinkSync(linkPath)
  } catch {
    // Windows 目录联接点有时 unlink 会 EPERM。不带 recursive 的 rmdir 只拆联接点本身。
    rmdirSync(linkPath)
  }
}

function removeRegularDirectory(dir: string, root: string, io: CleanupIo): { bytes: number; ok: boolean } {
  let names: string[]
  try {
    names = io.readdirSync(dir)
  } catch {
    return { bytes: 0, ok: false }
  }
  let bytes = 0
  let ok = true
  for (const name of names) {
    const child = path.resolve(dir, name)
    if (!staysInsideRoot(root, child) || path.dirname(child) !== dir) {
      ok = false
      continue
    }
    let st: fs.Stats
    try {
      st = io.lstatSync(child)
    } catch {
      ok = false
      continue
    }
    // 先看符号链接。联接点在 lstat 上可能同时像目录，先进目录就会跟出去。
    if (st.isSymbolicLink()) {
      try {
        removeLinkItself(child, io.unlinkSync, io.rmdirSync)
      } catch {
        ok = false
      }
      continue
    }
    if (st.isDirectory()) {
      const nested = removeRegularDirectory(child, root, io)
      bytes += nested.bytes
      if (!nested.ok) {
        ok = false
        continue
      }
      try {
        io.rmdirSync(child)
      } catch {
        ok = false
      }
      continue
    }
    if (st.isFile()) {
      try {
        io.unlinkSync(child)
        bytes += st.size
      } catch {
        ok = false
      }
      continue
    }
    ok = false
  }
  return { bytes, ok }
}

type EntryKind =
  | { kind: 'missing' }
  | { kind: 'skip' }
  | { kind: 'file'; fullPath: string; size: number }
  | { kind: 'dir'; fullPath: string }

function inspectEntry(root: string, segments: readonly string[], lstatSync: typeof fs.lstatSync): EntryKind {
  const fullPath = resolveResiduePath(root, segments)
  if (!fullPath) return { kind: 'skip' }
  let cursor = root
  for (let i = 0; i < segments.length; i += 1) {
    cursor = path.resolve(cursor, segments[i] ?? '')
    if (!staysInsideRoot(root, cursor)) return { kind: 'skip' }
    let st: fs.Stats
    try {
      st = lstatSync(cursor)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
      return { kind: 'skip' }
    }
    if (st.isSymbolicLink()) return { kind: 'skip' }
    const last = i === segments.length - 1
    if (!last) {
      if (!st.isDirectory()) return { kind: 'skip' }
      continue
    }
    const isBackupDir = segments.length === 1 && segments[0] === SCAN_TEST_BACKUP
    if (isBackupDir) {
      if (!st.isDirectory()) return { kind: 'skip' }
      return { kind: 'dir', fullPath: cursor }
    }
    if (!st.isFile()) return { kind: 'skip' }
    return { kind: 'file', fullPath: cursor, size: st.size }
  }
  return { kind: 'skip' }
}

function writeSummary(result: LegacyResidueCleanupResult): void {
  if (result.removed === 0 && result.skipped === 0) return
  log(`legacy-residue-cleanup: removed=${result.removed} bytes=${result.bytes} skipped=${result.skipped}`)
}

export function cleanupKnownLegacyResidue(hooks: LegacyResidueCleanupHooks = {}): LegacyResidueCleanupResult {
  const dataDir = path.resolve(hooks.dataDir ?? getAgentDataDir())
  const io: CleanupIo = {
    lstatSync: hooks.lstatSync ?? fs.lstatSync,
    readdirSync: hooks.readdirSync ?? ((directory) => fs.readdirSync(directory)),
    unlinkSync: hooks.unlinkSync ?? fs.unlinkSync,
    rmdirSync: hooks.rmdirSync ?? fs.rmdirSync,
  }
  const entries = hooks.entries ?? KNOWN_LEGACY_RESIDUE_ENTRIES
  const result: LegacyResidueCleanupResult = { removed: 0, bytes: 0, skipped: 0 }

  let rootStat: fs.Stats
  try {
    rootStat = io.lstatSync(dataDir)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result
    result.skipped += entries.length
    writeSummary(result)
    return result
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    result.skipped += entries.length
    writeSummary(result)
    return result
  }

  for (const segments of entries) {
    const found = inspectEntry(dataDir, segments, io.lstatSync)
    if (found.kind === 'missing') continue
    if (found.kind === 'skip') {
      result.skipped += 1
      continue
    }
    if (found.kind === 'file') {
      try {
        io.unlinkSync(found.fullPath)
        result.removed += 1
        result.bytes += found.size
      } catch {
        result.skipped += 1
      }
      continue
    }
    const nested = removeRegularDirectory(found.fullPath, dataDir, io)
    result.bytes += nested.bytes
    let removedDir = nested.ok
    if (nested.ok) {
      try {
        io.rmdirSync(found.fullPath)
      } catch {
        removedDir = false
      }
    }
    if (removedDir) result.removed += 1
    else result.skipped += 1
  }

  writeSummary(result)
  return result
}
