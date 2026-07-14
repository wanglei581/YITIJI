/**
 * Minimal, credential-free startup state for local operator diagnosis.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AgentStartupErrorCode } from './config-manager'

export interface StartupDiagnostic {
  schemaVersion: 1
  recordedAt: string
  state: 'ready' | 'failed'
  code: AgentStartupErrorCode
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

export function writeStartupDiagnostic(filePath: string, code: AgentStartupErrorCode): void {
  const record: StartupDiagnostic = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    state: code === 'AGENT_READY' ? 'ready' : 'failed',
    code,
  }
  writeTextAtomically(filePath, `${JSON.stringify(record, null, 2)}\n`)
}

export function writeStartupDiagnosticSafely(
  code: AgentStartupErrorCode,
  options?: {
    filePath?: string
    writer?: (filePath: string, code: AgentStartupErrorCode) => void
    onFailure?: () => void
  },
): boolean {
  const filePath = options?.filePath ?? getStartupDiagnosticPath()
  const writer = options?.writer ?? writeStartupDiagnostic
  try {
    writer(filePath, code)
    return true
  } catch {
    options?.onFailure?.()
    return false
  }
}

export function readStartupDiagnostic(filePath = getStartupDiagnosticPath()): StartupDiagnostic | null {
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as StartupDiagnostic
}
