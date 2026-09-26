/**
 * Minimal, credential-free startup state for local operator diagnosis.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AgentStartupErrorCode } from './config-manager'

export type StartupDiagnosticCode =
  | AgentStartupErrorCode
  | 'DUPLICATE_INSTANCE'
  | 'INSTANCE_LOCK_UNAVAILABLE'

const LOCK_REASONS = new Set([
  'duplicate',
  'stale_lock_requires_operator',
  'lock_path_not_regular_file',
  'lock_pid_unproven',
  'lock_publication_failed',
  'acquire_attempts_exhausted',
  'lock_unavailable',
])

const LOCK_PATH_KINDS = new Set([
  'missing',
  'regular_file',
  'directory',
  'symlink',
  'not_regular',
  'unavailable',
])

export interface StartupLockDiagnosticDetails {
  reason: string
  pathPresent: boolean
  pathKind: 'missing' | 'regular_file' | 'directory' | 'symlink' | 'not_regular' | 'unavailable'
  pidParsed: boolean
}

export interface StartupDiagnostic {
  schemaVersion: 1
  recordedAt: string
  state: 'ready' | 'failed'
  code: StartupDiagnosticCode
  lock?: StartupLockDiagnosticDetails
}

function sanitizeLockDetails(details: StartupLockDiagnosticDetails): StartupLockDiagnosticDetails {
  return {
    reason: LOCK_REASONS.has(details.reason) ? details.reason : 'lock_unavailable',
    pathPresent: details.pathPresent === true,
    pathKind: LOCK_PATH_KINDS.has(details.pathKind) ? details.pathKind : 'unavailable',
    pidParsed: details.pidParsed === true,
  }
}

export function getStartupDiagnosticPath(): string {
  const base = process.env['PROGRAMDATA']
    ? path.join(process.env['PROGRAMDATA'], 'AIJobPrintAgent')
    : path.join(os.tmpdir(), 'AIJobPrintAgent')
  return path.join(base, 'last-startup-diagnostic.json')
}

function writeTextAtomically(filePath: string, text: string): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
  let fd: number | undefined
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600)
    fs.writeFileSync(fd, text, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(tempPath, filePath)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    fs.rmSync(tempPath, { force: true })
  }
}

export function writeStartupDiagnostic(
  filePath: string,
  code: StartupDiagnosticCode,
  details?: StartupLockDiagnosticDetails,
): void {
  const record: StartupDiagnostic = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    state: code === 'AGENT_READY' ? 'ready' : 'failed',
    code,
  }
  if (details) {
    record.lock = sanitizeLockDetails(details)
  }
  writeTextAtomically(filePath, `${JSON.stringify(record, null, 2)}\n`)
}

export function writeStartupDiagnosticSafely(
  code: StartupDiagnosticCode,
  options?: {
    filePath?: string
    writer?: (filePath: string, code: StartupDiagnosticCode) => void
    onFailure?: () => void
    details?: StartupLockDiagnosticDetails
  },
): boolean {
  const filePath = options?.filePath ?? getStartupDiagnosticPath()
  try {
    if (options?.writer) {
      options.writer(filePath, code)
    } else {
      writeStartupDiagnostic(filePath, code, options?.details)
    }
    return true
  } catch {
    try {
      options?.onFailure?.()
    } catch {
      // Diagnostic side effects must never change the fail-closed caller.
    }
    return false
  }
}

export function readStartupDiagnostic(filePath = getStartupDiagnosticPath()): StartupDiagnostic | null {
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as StartupDiagnostic
}
