import type { SignStampPosition, SignStampSize } from '@ai-job-print/shared'
import {
  FROM_WHITELIST,
  SIGN_STAMP_STATE_SET,
  type SignStampFrom,
  type SignStampStateId,
} from './constants'
import { statusCopy } from './signStampCopy'

export type CapStatus = 'loading' | 'ready' | 'disabled' | 'maintenance' | 'error'
export type DocStage = 'idle' | 'uploading' | 'phone' | 'inspecting'
export type StampStage = 'idle' | 'uploading' | 'phone'
export type ComposePhase =
  | 'idle'
  | 'composing'
  | 'rate-limited'
  | 'in-progress'
  | 'known-failed'
  | 'result-unknown'
  | 'retrying'
  | 'conflict'
  | 'recovered'
  | 'completed'
export type ViewMode = 'page' | 'width' | 'zoom'
export type PageShape = 'block' | 'pick' | 'work'

export interface PickedFile {
  fileId: string
  fileAccessUrl: string
  name: string
  size: string
}

export interface ComposeResult {
  fileId: string
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
  name: string
}

export interface SignStampQuery {
  requested: SignStampStateId | null
  capture: boolean
  from: SignStampFrom
  fromUnknown: boolean
}

export function parseSignStampQuery(search: string): SignStampQuery {
  const q = new URLSearchParams(search)
  const capture = q.get('capture') === '1' || q.get('debug') === '1'
  const rawFrom = q.get('from')
  let from: SignStampFrom = 'hub'
  let fromUnknown = false
  if (rawFrom) {
    if (rawFrom in FROM_WHITELIST) from = rawFrom as SignStampFrom
    else fromUnknown = true
  }
  let raw = q.get('state')
  if (raw === 'placing') raw = 'placement-default'
  const requested =
    raw && SIGN_STAMP_STATE_SET.has(raw) ? (raw as SignStampStateId) : null
  if (requested && !capture) {
    return { requested: null, capture: false, from, fromUnknown }
  }
  return { requested, capture, from, fromUnknown }
}

export function mapDocError(code: string | undefined): SignStampStateId | null {
  switch (code) {
    case 'SIGN_DOC_TYPE_UNSUPPORTED':
      return 'document-format-rejected'
    case 'SIGN_DOC_TOO_LARGE':
      return 'document-too-large'
    case 'SIGN_DOC_UNSUPPORTED':
      return 'document-corrupt'
    case 'SIGN_DOC_HAS_DIGITAL_SIGNATURE':
      return 'document-digital-signature'
    case 'SIGN_DOC_TOO_MANY_PAGES':
      return 'document-too-many-pages'
    case 'SIGN_SOURCE_NOT_FOUND':
      return 'document-source-expired'
    default:
      return null
  }
}

export function mapStampError(code: string | undefined): SignStampStateId | null {
  switch (code) {
    case 'SIGN_STAMP_TYPE_UNSUPPORTED':
      return 'stamp-format-rejected'
    case 'SIGN_STAMP_TOO_LARGE':
      return 'stamp-too-large'
    case 'SIGN_STAMP_UNSUPPORTED':
      return 'stamp-corrupt'
    case 'SIGN_SOURCE_NOT_FOUND':
      return 'stamp-source-expired'
    default:
      return null
  }
}

export function mapComposeError(
  code: string | undefined,
  status: number | undefined,
): ComposePhase {
  if (status === 429 || code === 'RATE_LIMITED') return 'rate-limited'
  if (code === 'SIGN_IN_PROGRESS') return 'in-progress'
  if (code === 'IDEMPOTENCY_KEY_REUSED') return 'conflict'
  if (code === 'SIGN_OUTPUT_TOO_LARGE') return 'known-failed'
  if (code === 'SIGN_PLACEMENT_INVALID') return 'known-failed'
  if (status === 0 || code === 'NETWORK_ERROR' || code === 'REQUEST_TIMEOUT') return 'result-unknown'
  if (status !== undefined && status >= 500) return 'result-unknown'
  return 'known-failed'
}

export interface LiveSnapshot {
  authReady: boolean
  loggedIn: boolean
  sessionExpired: boolean
  fromUnknown: boolean
  terminalId: string
  cap: CapStatus
  doc: PickedFile | null
  pages: number | null
  docStage: DocStage
  docErr: SignStampStateId | null
  docJustRead: boolean
  derived: boolean
  stamp: PickedFile | null
  stampStage: StampStage
  stampErr: SignStampStateId | null
  stampJustAdded: boolean
  page: number
  position: SignStampPosition
  size: SignStampSize
  placeErr: string | null
  authorized: boolean
  authReset: boolean
  phase: ComposePhase
  result: ComposeResult | null
  outErr: 'render' | 'expired' | null
  oversize: boolean
  viewMode: ViewMode
  viewPage: number
  zoom: number
  pan: 'br' | null
}

export function deriveLiveState(s: LiveSnapshot): SignStampStateId {
  if (!s.authReady) return 'auth-unknown'
  if (s.sessionExpired) return 'login-expired'
  if (!s.loggedIn) return 'login-required'
  if (s.fromUnknown) return 'return-source-unknown'
  if (!s.terminalId) return 'terminal-missing'
  if (s.cap === 'loading') return 'capability-loading'
  if (s.cap === 'disabled') return 'capability-disabled'
  if (s.cap === 'maintenance') return 'capability-maintenance'
  if (s.cap === 'error') return 'capability-error'
  if (s.docErr) return s.docErr
  if (s.docStage === 'uploading') return 'document-local-uploading'
  if (s.docStage === 'phone') return 'document-phone-entry'
  if (s.docStage === 'inspecting') return 'document-inspecting'
  if (!s.doc) return 'pick-document'
  if (s.stampErr) return s.stampErr
  if (s.stampStage === 'uploading') return 'stamp-local-uploading'
  if (s.stampStage === 'phone') return 'stamp-phone-entry'
  if (s.derived && !s.stamp) return 'add-another-ready'
  if (!s.stamp) return s.docJustRead ? 'document-ready' : 'pick-stamp'
  if (s.phase === 'composing') return 'composing'
  if (s.phase === 'rate-limited') return 'rate-limited'
  if (s.phase === 'in-progress') return 'conversion-in-progress'
  if (s.phase === 'known-failed') return s.oversize ? 'output-too-large' : 'known-failed'
  if (s.phase === 'result-unknown') return 'result-unknown'
  if (s.phase === 'retrying') return 'retrying-same-request'
  if (s.phase === 'conflict') return 'idempotency-conflict'
  if (s.phase === 'recovered' && s.result) return 'recovered-completed'
  if (s.phase === 'completed' && s.result) {
    if (s.outErr === 'expired') return 'output-expired'
    if (s.outErr === 'render') return 'output-preview-failed'
    if (s.viewPage === s.result.pages && s.result.pages > 1) return 'output-preview-last'
    if (s.viewPage === 2) return 'output-preview-page2'
    if (s.viewMode === 'zoom') return 'output-preview-zoomed'
    return 'completed'
  }
  if (s.stampJustAdded) return 'stamp-ready'
  if (s.placeErr) return 'placement-invalid-page'
  if (s.authReset && !s.authorized) return 'authorization-required'
  if (s.viewMode === 'width') return 'preview-fit-width'
  if (s.viewMode === 'zoom' && s.pan) return 'preview-panned-corner'
  if (s.viewMode === 'zoom') return 'preview-zoomed'
  if (s.page === 2) return 'placement-page2'
  if (s.pages && s.page === s.pages && s.pages > 1) return 'placement-last-page'
  if (s.position === 'top-left' && s.size === 'small') return 'placement-top-left-small'
  if (s.position === 'center' && s.size === 'medium') return 'placement-center-medium'
  if (s.position === 'bottom-right' && s.size === 'large') return 'placement-bottom-right-large'
  if (s.authorized) return 'ready-to-compose'
  if (s.viewMode === 'page' && s.page !== 1) return 'preview-fit-page'
  return 'placement-default'
}

export function shapeOf(state: SignStampStateId): PageShape {
  if (GATE_STATES.has(state)) return 'block'
  if (PICK_DOC_STATES.has(state) || PICK_STAMP_STATES.has(state)) return 'pick'
  return 'work'
}

export function pickPhaseOf(state: SignStampStateId): 'doc' | 'stamp' | null {
  if (PICK_DOC_STATES.has(state)) return 'doc'
  if (PICK_STAMP_STATES.has(state)) return 'stamp'
  return null
}

const GATE_STATES = new Set<SignStampStateId>([
  'auth-unknown',
  'login-required',
  'login-expired',
  'context-missing',
  'terminal-missing',
  'capability-loading',
  'capability-disabled',
  'capability-maintenance',
  'capability-error',
  'return-source-unknown',
])

const PICK_DOC_STATES = new Set<SignStampStateId>([
  'pick-document',
  'document-local-uploading',
  'document-phone-entry',
  'document-inspecting',
  'document-format-rejected',
  'document-too-large',
  'document-encrypted',
  'document-corrupt',
  'document-digital-signature',
  'document-too-many-pages',
  'document-source-expired',
  'document-source-forbidden',
])

const PICK_STAMP_STATES = new Set<SignStampStateId>([
  'pick-stamp',
  'document-ready',
  'stamp-local-uploading',
  'stamp-phone-entry',
  'stamp-format-rejected',
  'stamp-too-large',
  'stamp-pixels-too-large',
  'stamp-corrupt',
  'stamp-encoding-unsupported',
  'stamp-source-expired',
  'add-another-ready',
])

export const GATE_STATES_SET = GATE_STATES

export type { StatusCopy } from './signStampCopy'
export { statusCopy, fixtureLive } from './signStampCopy'

export function isLockedPhase(phase: ComposePhase): boolean {
  return phase === 'composing' || phase === 'retrying' || phase === 'result-unknown'
}

export function pillOf(
  state: SignStampStateId,
  live: LiveSnapshot,
): { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string } {
  if (GATE_STATES.has(state)) {
    const copy = statusCopy(state, live)
    const tone = copy.kind === 'error' ? 'bad' : copy.kind === 'info' ? 'unknown' : 'warn'
    return { tone, label: copy.title }
  }
  if (live.docErr || live.stampErr) return { tone: 'warn', label: '这一份没被接收' }
  if (live.phase === 'composing' || live.phase === 'retrying') {
    return { tone: 'unknown', label: '正在生成 · 无进度回传' }
  }
  if (live.phase === 'result-unknown') return { tone: 'warn', label: '结果未确认' }
  if (live.phase === 'known-failed' || live.phase === 'conflict') return { tone: 'bad', label: '这一次未生成' }
  if (live.phase === 'rate-limited' || live.phase === 'in-progress') {
    return { tone: 'warn', label: '暂不受理 · 可稍后重试' }
  }
  if (live.phase === 'completed' || live.phase === 'recovered') {
    return { tone: live.outErr ? 'warn' : 'ok', label: live.outErr ? '已生成 · 预览受限' : '派生 PDF 已生成' }
  }
  if (!live.doc) return { tone: 'unknown', label: '第 1 步 · 选 PDF' }
  if (!live.stamp) return { tone: 'unknown', label: '第 2 步 · 传签名图' }
  if (!live.authorized) return { tone: 'warn', label: '第 3 步 · 需确认授权' }
  return { tone: 'unknown', label: '第 4 步 · 可以生成' }
}
