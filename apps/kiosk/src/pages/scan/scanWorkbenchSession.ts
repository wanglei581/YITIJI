import { isScanType, type ScanType } from './scanWorkbench'
import { parseScanStage, type ScanStage } from './scanWorkbenchModel'

export const SCAN_WORKBENCH_SESSION_KEY = 'ai-job-print:current-scan-workbench'

export interface ScanLiveState {
  scanTaskId: string
  controlToken: string
  instructions: string[]
  expiresAt: string
}

export interface ScanResultFile {
  fileId: string
  fileUrl: string
  name: string
  size: string
  pages: number | null
  format: string
  mimeType?: string
}

export type ScanOutcome = 'completed' | 'completed-no-file' | 'failed' | 'expired'

export interface ScanResultSnapshot {
  outcome: ScanOutcome
  success: boolean
  reason?: string
  file?: ScanResultFile
}

export interface ScanRetryExtras {
  source?: string
  pageMode?: string
  color?: string
  dpi?: number
}

export interface ScanWorkbenchSession {
  stage: ScanStage
  scanType?: ScanType
  extras?: ScanRetryExtras
  live?: ScanLiveState
  result?: ScanResultSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseLive(raw: unknown): ScanLiveState | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.scanTaskId !== 'string' || raw.scanTaskId.trim().length === 0) return undefined
  if (typeof raw.controlToken !== 'string' || raw.controlToken.trim().length === 0) return undefined
  if (typeof raw.expiresAt !== 'string' || !Number.isFinite(Date.parse(raw.expiresAt))) return undefined
  if (!Array.isArray(raw.instructions)) return undefined
  const instructions = raw.instructions.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  )
  return {
    scanTaskId: raw.scanTaskId,
    controlToken: raw.controlToken,
    instructions,
    expiresAt: raw.expiresAt,
  }
}

function parseResultFile(raw: unknown): ScanResultFile | undefined {
  if (!isRecord(raw) || typeof raw.fileId !== 'string' || typeof raw.fileUrl !== 'string') return undefined
  if (typeof raw.name !== 'string' || typeof raw.size !== 'string' || typeof raw.format !== 'string') return undefined
  return {
    fileId: raw.fileId,
    fileUrl: raw.fileUrl,
    name: raw.name,
    size: raw.size,
    pages: typeof raw.pages === 'number' ? raw.pages : null,
    format: raw.format,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : undefined,
  }
}

function parseResult(raw: unknown): ScanResultSnapshot | undefined {
  if (!isRecord(raw)) return undefined
  const outcome = raw.outcome
  if (
    outcome !== 'completed'
    && outcome !== 'completed-no-file'
    && outcome !== 'failed'
    && outcome !== 'expired'
  ) {
    return undefined
  }
  return {
    outcome,
    success: raw.success === true,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
    file: parseResultFile(raw.file),
  }
}

function parseExtras(raw: unknown): ScanRetryExtras | undefined {
  if (!isRecord(raw)) return undefined
  const extras: ScanRetryExtras = {}
  if (typeof raw.source === 'string') extras.source = raw.source
  if (typeof raw.pageMode === 'string') extras.pageMode = raw.pageMode
  if (typeof raw.color === 'string') extras.color = raw.color
  if (typeof raw.dpi === 'number') extras.dpi = raw.dpi
  return Object.keys(extras).length > 0 ? extras : undefined
}

export function readScanWorkbenchSession(): ScanWorkbenchSession | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null
    const raw = window.sessionStorage.getItem(SCAN_WORKBENCH_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return null
    const stage = parseScanStage(typeof parsed.stage === 'string' ? parsed.stage : null)
    if (!stage) return null
    return {
      stage,
      scanType: isScanType(parsed.scanType) ? parsed.scanType : undefined,
      extras: parseExtras(parsed.extras),
      live: parseLive(parsed.live),
      result: parseResult(parsed.result),
    }
  } catch {
    return null
  }
}

export function saveScanWorkbenchSession(session: ScanWorkbenchSession): void {
  try {
    window.sessionStorage.setItem(SCAN_WORKBENCH_SESSION_KEY, JSON.stringify(session))
  } catch {
    /* sessionStorage 不可用时不阻塞扫描 */
  }
}

export function patchScanWorkbenchSession(
  patch: Partial<ScanWorkbenchSession>,
): ScanWorkbenchSession {
  const current = readScanWorkbenchSession() ?? { stage: 'start' as const }
  const next: ScanWorkbenchSession = {
    stage: patch.stage ?? current.stage,
    scanType: 'scanType' in patch ? patch.scanType : current.scanType,
    extras: 'extras' in patch ? patch.extras : current.extras,
    live: 'live' in patch ? patch.live : current.live,
    result: 'result' in patch ? patch.result : current.result,
  }
  saveScanWorkbenchSession(next)
  return next
}

export function clearScanWorkbenchSession(): void {
  try {
    window.sessionStorage.removeItem(SCAN_WORKBENCH_SESSION_KEY)
  } catch {
    /* ignore */
  }
}

export function hasLiveScanSession(
  session: ScanWorkbenchSession | null,
  locationState?: { scanTaskId?: unknown; controlToken?: unknown } | null,
): boolean {
  if (session?.live?.scanTaskId && session.live.controlToken) return true
  return typeof locationState?.scanTaskId === 'string'
    && locationState.scanTaskId.length > 0
    && typeof locationState?.controlToken === 'string'
    && locationState.controlToken.length > 0
}

export function hasScanResult(
  session: ScanWorkbenchSession | null,
  locationState?: { outcome?: unknown; success?: unknown; file?: unknown; reason?: unknown } | null,
): boolean {
  if (session?.result) return true
  if (!locationState) return false
  if (typeof locationState.outcome === 'string') return true
  if (locationState.success === true || locationState.success === false) return true
  return Boolean(locationState.file) || typeof locationState.reason === 'string'
}
