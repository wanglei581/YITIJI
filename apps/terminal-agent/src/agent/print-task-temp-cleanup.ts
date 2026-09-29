/**
 * Remove crash leftovers of Agent-owned print downloads.
 *
 * Only `task_<taskId>.<supported-ext>` regular files directly inside the Agent
 * temp directory are eligible. Symlinks, subdirectories, and unrelated names
 * are left untouched. Filenames and file contents are never logged.
 *
 * Must run only after the single-instance lock is held so a live agent's
 * in-flight download is never deleted by a second starter.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { SUPPORTED_EXTENSIONS } from '../config'
import { log } from '../logger'

const TASK_TEMP_NAME = /^task_[A-Za-z0-9_-]{1,128}(\.[A-Za-z0-9]+)$/

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
    if (!isEligibleTaskTempName(name)) continue

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
