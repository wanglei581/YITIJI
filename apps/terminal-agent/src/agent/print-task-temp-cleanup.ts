/**
 * 开机清掉本 Agent 留在临时目录里的打印件。
 *
 * 只删临时目录的直接子项，且必须是普通文件：
 * - `task_<任务号>.<支持的扩展名>`：下载下来的打印原件
 * - `print_<任务号>_<uuid>.pdf` 或 `print_<uuid>.pdf`：图片转 PDF 的临时件
 *
 * 不看修改时间。调用方已经拿着单实例锁，不会有正在进行的下载或转换。
 * 不跟随符号链接，不进入子目录。名字对不上、清理失败都失败关闭。
 * 日志只记数量，不写文件名，也不写文件内容。
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { SUPPORTED_EXTENSIONS } from '../config'
import { log } from '../logger'

const TASK_TEMP_NAME = /^task_[A-Za-z0-9_-]{1,128}(\.[A-Za-z0-9]+)$/
// 与 image-to-pdf.ts buildImageTempPdfFileName 同一形状。uuid 是 8-4-4-4-12，
// 任务号只留 [A-Za-z0-9_-]。宽松的 print_*.pdf 会误删别人的文件。
const PRINT_IMAGE_TEMP_PDF_NAME =
  /^print_(?:[A-Za-z0-9_-]{1,128}_)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.pdf$/

export class PrintTaskTempCleanupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrintTaskTempCleanupError'
  }
}

export function getAgentPrintTempDir(): string {
  const base = process.env['PROGRAMDATA']
    ? path.join(process.env['PROGRAMDATA'], 'AIJobPrintAgent', 'temp')
    : path.join(os.tmpdir(), 'AIJobPrintAgent', 'temp')
  return base
}

export interface PrintTaskTempCleanupHooks {
  tempDir?: string
  lstatSync?: typeof fs.lstatSync
  readdirSync?: typeof fs.readdirSync
  unlinkSync?: typeof fs.unlinkSync
}

function isEligibleTaskTempName(name: string): boolean {
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false
  const match = TASK_TEMP_NAME.exec(name)
  if (!match) return false
  const ext = match[1]?.toLowerCase()
  return typeof ext === 'string' && SUPPORTED_EXTENSIONS.has(ext)
}

function isEligiblePrintImageTempName(name: string): boolean {
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false
  return PRINT_IMAGE_TEMP_PDF_NAME.test(name)
}

function isEligibleLeftoverName(name: string): boolean {
  return isEligibleTaskTempName(name) || isEligiblePrintImageTempName(name)
}

export function cleanupCrashLeftoverPrintTaskTemps(hooks: PrintTaskTempCleanupHooks = {}): void {
  const tempDir = hooks.tempDir ?? getAgentPrintTempDir()
  const lstatSync = hooks.lstatSync ?? fs.lstatSync
  const readdirSync = hooks.readdirSync ?? fs.readdirSync
  const unlinkSync = hooks.unlinkSync ?? fs.unlinkSync

  const resolvedTemp = path.resolve(tempDir)
  let dirStat: fs.Stats
  try {
    dirStat = lstatSync(resolvedTemp)
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new PrintTaskTempCleanupError('print task temp directory is not inspectable')
  }
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw new PrintTaskTempCleanupError('print task temp path is not a regular directory')
  }

  let names: string[]
  try {
    names = readdirSync(resolvedTemp)
  } catch {
    throw new PrintTaskTempCleanupError('print task temp directory listing failed')
  }

  let removed = 0
  for (const name of names) {
    if (!isEligibleLeftoverName(name)) continue

    const filePath = path.resolve(resolvedTemp, name)
    if (path.dirname(filePath) !== resolvedTemp || path.basename(filePath) !== name) continue

    let st: fs.Stats
    try {
      st = lstatSync(filePath)
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw new PrintTaskTempCleanupError('leftover print task temp file could not be inspected')
    }
    if (st.isSymbolicLink() || !st.isFile()) continue

    try {
      unlinkSync(filePath)
      removed += 1
    } catch {
      throw new PrintTaskTempCleanupError('leftover print task temp file could not be removed')
    }
  }

  if (removed > 0) {
    log(`print-temp-cleanup: removed leftover print task files (count=${removed})`)
  }
}
