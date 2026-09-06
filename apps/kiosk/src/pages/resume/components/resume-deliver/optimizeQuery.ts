import type { ResumeExportFormat } from '@ai-job-print/shared'
import {
  OPTIMIZE_FIXTURE_STATES,
  OPTIMIZE_STATES,
  TASK_ID_RE,
  parseExportFormat,
  type OptimizeViewState,
} from './constants'

export interface OptimizeQuery {
  requested: OptimizeViewState | null
  capture: boolean
  debug: boolean
  fallback: boolean
  taskId: string | null
  format: ResumeExportFormat
  exportHint: 'ready' | 'no-print' | 'failed' | null
}

export function parseOptimizeQuery(search: string): OptimizeQuery {
  const q = new URLSearchParams(search)
  const capture = q.get('capture') === '1'
  const debug = q.get('debug') === '1'
  let fallback = false
  const rawState = q.get('state')
  let requested: OptimizeViewState | null = null
  if (rawState) {
    if ((OPTIMIZE_STATES as readonly string[]).includes(rawState)) requested = rawState as OptimizeViewState
    else { requested = 'illegal'; fallback = true }
  }
  const rawTask = q.get('taskId')
  let taskId: string | null = null
  if (rawTask) {
    if (TASK_ID_RE.test(rawTask)) taskId = rawTask
    else { fallback = true; if (requested !== 'illegal') requested = requested ?? 'no-context' }
  }
  const parsedFormat = parseExportFormat(q.get('format'))
  let format: ResumeExportFormat = 'pdf'
  if (q.get('format')) {
    if (parsedFormat) format = parsedFormat
    else fallback = true
  }
  const rawExport = q.get('export')
  let exportHint: OptimizeQuery['exportHint'] = null
  if (rawExport === 'ready' || rawExport === 'no-print' || rawExport === 'failed') exportHint = rawExport
  else if (rawExport) fallback = true
  const fixture = requested ? OPTIMIZE_FIXTURE_STATES.has(requested) : false
  const needsTask = requested === 'loading' || requested === 'ready' || requested === 'empty'
  if (needsTask && !taskId && requested !== 'illegal') {
    requested = 'no-context'
    fallback = true
  }
  if (fixture && !(capture || debug)) {
    requested = 'no-context'
    fallback = true
  }
  return { requested, capture, debug, fallback, taskId, format, exportHint }
}

export function resolveOptimizeView(query: OptimizeQuery, live: {
  hasTask: boolean
  loading: boolean
  outage: boolean
  readError: boolean
  failed: boolean
  empty: boolean
  ready: boolean
}): { view: OptimizeViewState; synthetic: boolean; fallback: boolean } {
  if (query.requested === 'illegal') return { view: 'illegal', synthetic: false, fallback: true }
  if (query.requested && (query.capture || query.debug)) {
    return { view: query.requested, synthetic: true, fallback: query.fallback }
  }
  if (!live.hasTask) {
    return { view: 'no-context', synthetic: false, fallback: query.fallback }
  }
  if (live.outage) return { view: 'unavailable', synthetic: false, fallback: query.fallback }
  if (live.loading) return { view: 'loading', synthetic: false, fallback: query.fallback }
  if (live.readError) return { view: 'read-error', synthetic: false, fallback: query.fallback }
  if (live.failed) return { view: 'optimize-failed', synthetic: false, fallback: query.fallback }
  if (live.empty) return { view: 'empty', synthetic: false, fallback: query.fallback }
  if (live.ready) return { view: 'ready', synthetic: false, fallback: query.fallback }
  return { view: 'no-context', synthetic: false, fallback: query.fallback }
}
