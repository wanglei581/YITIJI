import type { PrintJobParams } from '@ai-job-print/shared'
import type { DocumentProcessTaskView, MaterialTaskKind, MaterialTaskStatus } from '../../services/api/materials'

const STORAGE_KEY = 'ai-job-print:current-print-material-check'

export interface PrintFileState {
  name: string
  size: string
  pages: number | null
  fileId?: string
  fileUrl?: string
  fileMd5?: string
}

export interface StoredMaterialTask {
  id: string
  kind: MaterialTaskKind
  status: MaterialTaskStatus
  accessToken?: string
  sourceFileId?: string
  resultFileId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  expiresAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface MaterialCheckSummary {
  inspectionTaskId: string
  normalizeTaskId?: string
  piiTaskId: string
  piiRedactTaskId?: string
  checkedAt: string
  findingCount: number
  redactedCount: number
  keptCount: number
  redaction?: {
    canRedact: boolean
    redactedFileId: string | null
    resultFileCreated: boolean
    message: string
  }
  mode: 'checked' | 'demo'
}

export interface PrintMaterialSession {
  file: PrintFileState
  inspectionTask?: StoredMaterialTask
  normalizeTask?: StoredMaterialTask
  piiTask?: StoredMaterialTask
  piiRedactTask?: StoredMaterialTask
  materialCheck?: MaterialCheckSummary
  printParams?: PrintJobParams
  updatedAt: string
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPrintFileState(value: unknown): value is PrintFileState {
  if (!isRecord(value)) return false
  return (
    typeof value['name'] === 'string' &&
    typeof value['size'] === 'string' &&
    (typeof value['pages'] === 'number' || value['pages'] === null)
  )
}

function isMaterialTaskKind(value: unknown): value is MaterialTaskKind {
  return (
    value === 'inspection' ||
    value === 'normalize_a4' ||
    value === 'pii_scan' ||
    value === 'pii_redact' ||
    value === 'bundle_render'
  )
}

function isMaterialTaskStatus(value: unknown): value is MaterialTaskStatus {
  return (
    value === 'pending' ||
    value === 'processing' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  )
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  return optionalString(value)
}

function sanitizeFile(file: PrintFileState): PrintFileState {
  return {
    name: sanitizeFileName(file.name),
    size: file.size,
    pages: file.pages,
    fileId: file.fileId,
    fileUrl: file.fileUrl,
    fileMd5: file.fileMd5,
  }
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (value) => {
      const [, domain] = value.split('@')
      return `${value.slice(0, 1)}***@${domain ?? '***'}`
    })
    .replace(/(?:\+?86[- ]?)?1[3-9]\d{9}/g, (value) => `${value.slice(0, 3)}****${value.slice(-4)}`)
    .replace(/\d{6}(?:19|20)\d{2}\d{2}\d{2}\d{3}[\dXx]/g, (value) => `${value.slice(0, 6)}********${value.slice(-4)}`)
}

function toStoredMaterialTask(task: DocumentProcessTaskView | StoredMaterialTask | undefined): StoredMaterialTask | undefined {
  if (!task || !isRecord(task)) return undefined
  if (!optionalString(task['id']) || !isMaterialTaskKind(task['kind']) || !isMaterialTaskStatus(task['status'])) {
    return undefined
  }
  return {
    id: task['id'],
    kind: task['kind'],
    status: task['status'],
    accessToken: optionalString(task['accessToken']),
    sourceFileId: optionalString(task['sourceFileId']),
    resultFileId: optionalNullableString(task['resultFileId']),
    errorCode: optionalNullableString(task['errorCode']),
    errorMessage: optionalNullableString(task['errorMessage']),
    expiresAt: optionalString(task['expiresAt']),
    createdAt: optionalString(task['createdAt']),
    updatedAt: optionalString(task['updatedAt']),
  }
}

function sanitizeSession(next: Omit<PrintMaterialSession, 'updatedAt'>): Omit<PrintMaterialSession, 'updatedAt'> {
  return {
    file: sanitizeFile(next.file),
    inspectionTask: toStoredMaterialTask(next.inspectionTask),
    normalizeTask: toStoredMaterialTask(next.normalizeTask),
    piiTask: toStoredMaterialTask(next.piiTask),
    piiRedactTask: toStoredMaterialTask(next.piiRedactTask),
    materialCheck: next.materialCheck,
    printParams: next.printParams,
  }
}

export function readPrintMaterialSession(): PrintMaterialSession | null {
  if (!isBrowserStorageAvailable()) return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || !isPrintFileState(parsed['file'])) return null
    return parsed as unknown as PrintMaterialSession
  } catch {
    return null
  }
}

export function savePrintMaterialSession(next: Omit<PrintMaterialSession, 'updatedAt'>): void {
  if (!isBrowserStorageAvailable()) return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...sanitizeSession(next), updatedAt: new Date().toISOString() }))
  } catch {
    // sessionStorage can be unavailable in restricted browser modes; the flow still works with route state.
  }
}

export function patchPrintMaterialSession(patch: Partial<Omit<PrintMaterialSession, 'updatedAt'>>): PrintMaterialSession | null {
  const current = readPrintMaterialSession()
  const file = patch.file ?? current?.file
  if (!file) return null
  const next: Omit<PrintMaterialSession, 'updatedAt'> = {
    ...(current ?? { file }),
    ...patch,
    file,
  }
  savePrintMaterialSession(next)
  return readPrintMaterialSession()
}

export function clearPrintMaterialSession(): void {
  if (!isBrowserStorageAvailable()) return
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
