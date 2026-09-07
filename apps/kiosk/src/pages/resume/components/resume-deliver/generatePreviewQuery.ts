import type { ResumeExportFormat } from '@ai-job-print/shared'
import {
  GENERATE_FIXTURE_STATES,
  GENERATE_PREVIEW_STATES,
  TASK_ID_RE,
  parseExportFormat,
  type GeneratePreviewViewState,
} from './constants'

export interface GeneratePreviewQuery {
  requested: GeneratePreviewViewState | null
  capture: boolean
  debug: boolean
  fallback: boolean
  taskId: string | null
  format: ResumeExportFormat
}

export function parseGeneratePreviewQuery(search: string): GeneratePreviewQuery {
  const q = new URLSearchParams(search)
  const capture = q.get('capture') === '1'
  const debug = q.get('debug') === '1'
  let fallback = false
  const rawState = q.get('state')
  let requested: GeneratePreviewViewState | null = null
  if (rawState) {
    if ((GENERATE_PREVIEW_STATES as readonly string[]).includes(rawState)) {
      requested = rawState as GeneratePreviewViewState
    } else {
      requested = 'illegal'
      fallback = true
    }
  }
  const rawTask = q.get('taskId')
  let taskId: string | null = null
  if (rawTask) {
    if (TASK_ID_RE.test(rawTask)) taskId = rawTask
    else fallback = true
  }
  const parsedFormat = parseExportFormat(q.get('format'))
  let format: ResumeExportFormat = 'pdf'
  if (q.get('format')) {
    if (parsedFormat) format = parsedFormat
    else fallback = true
  }
  const fixture = requested ? GENERATE_FIXTURE_STATES.has(requested) : false
  if (fixture && !(capture || debug)) {
    requested = taskId ? 'preview-no-result' : 'session-lost'
    fallback = true
  }
  return { requested, capture, debug, fallback, taskId, format }
}

export function resolveGeneratePreviewView(query: GeneratePreviewQuery, live: {
  restoring: boolean
  hasResult: boolean
  restoreFailed: boolean
  exporting: boolean
  exportError: boolean
  exportedReady: boolean
  exportedExpired: boolean
  printUnavailable: boolean
  hasHints: boolean
  editing: boolean
}): { view: GeneratePreviewViewState; synthetic: boolean; fallback: boolean } {
  if (query.requested === 'illegal') return { view: 'illegal', synthetic: false, fallback: true }
  if (query.requested && (query.capture || query.debug)) {
    return { view: query.requested, synthetic: true, fallback: query.fallback }
  }
  if (live.restoring) return { view: 'preview-loading', synthetic: false, fallback: query.fallback }
  if (!live.hasResult) {
    return {
      view: query.taskId ? 'preview-no-result' : 'session-lost',
      synthetic: false,
      fallback: query.fallback || live.restoreFailed,
    }
  }
  if (live.restoreFailed && !live.hasResult) return { view: 'preview-failed', synthetic: false, fallback: query.fallback }
  if (live.exporting) return { view: 'export-exporting', synthetic: false, fallback: query.fallback }
  if (live.exportError) return { view: 'export-failed', synthetic: false, fallback: query.fallback }
  if (live.exportedExpired) return { view: 'export-url-expired', synthetic: false, fallback: query.fallback }
  if (live.printUnavailable) return { view: 'export-print-unavailable', synthetic: false, fallback: query.fallback }
  if (live.exportedReady) return { view: 'export-ready', synthetic: false, fallback: query.fallback }
  if (live.editing) return { view: 'preview-editing', synthetic: false, fallback: query.fallback }
  if (live.hasHints) return { view: 'preview-hints', synthetic: false, fallback: query.fallback }
  return { view: 'preview-ready', synthetic: false, fallback: query.fallback }
}
