import fs from 'node:fs'
import type {
  ScanInputCandidateClassification,
  ScanInputCandidateSnapshot,
  ScanInputHealth,
} from '../types'

function health(
  status: ScanInputHealth['status'],
  reason: ScanInputHealth['reason'],
): ScanInputHealth {
  return { status, reason }
}

/**
 * Inspect only the configured directory itself. This deliberately does not
 * enumerate entries or follow a link, so an ambiguous input stays disabled.
 */
export function inspectScanInputFolder(
  scanWatchFolder?: string,
): ScanInputHealth {
  const folder = scanWatchFolder?.trim()
  if (!folder) return health('unconfigured', 'not_configured')

  if (process.platform === 'win32') {
    return health('degraded', 'reparse_point_unverifiable')
  }

  try {
    const metadata = fs.lstatSync(folder)
    if (metadata.isSymbolicLink()) return health('degraded', 'reparse_point')
    if (!metadata.isDirectory()) return health('degraded', 'not_directory')
  } catch {
    return health('degraded', 'unavailable')
  }

  try {
    fs.accessSync(folder, fs.constants.R_OK | fs.constants.X_OK)
  } catch {
    return health('degraded', 'not_readable')
  }

  return health('ready', 'ready')
}

/** Classify caller-supplied metadata without inspecting the filesystem. */
export function classifyScanInputCandidate(
  snapshot: ScanInputCandidateSnapshot,
): ScanInputCandidateClassification {
  if (snapshot.nodeKind === 'symbolic_link') return 'rejected_symbolic_link'
  if (snapshot.nodeKind !== 'file') return 'rejected_non_regular_file'
  if (!snapshot.name.toLowerCase().endsWith('.pdf')) return 'rejected_non_pdf'
  return 'accepted'
}

/** Compare two caller-supplied snapshots without waiting or performing IO. */
export function isStableScanInputCandidate(
  before: ScanInputCandidateSnapshot,
  after: ScanInputCandidateSnapshot,
): boolean {
  return before.name === after.name
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.nodeKind === after.nodeKind
}
