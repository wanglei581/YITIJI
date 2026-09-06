import { API_BASE_URL, API_MODE } from './api/client'
import { ApiHttpError } from './api/httpAdapter'
import { getTerminalId } from './api/screensaver'
import { readHttpError } from './api/throwHttpError'

const STORAGE_KEY = 'terminal_session_token_v1'
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000]
const RETRY_WINDOW_MS = 60_000
const REQUEST_TIMEOUT_MS = 4_000
const MOCK_TOKEN = (import.meta.env['E2E_MOCK_TERMINAL_SESSION_TOKEN'] ?? 'mock-terminal-session-fixture').trim()
const HAS_E2E_MOCK_TOKEN = Boolean(import.meta.env['E2E_MOCK_TERMINAL_SESSION_TOKEN']?.trim())

export type TerminalSessionState = 'checking' | 'ready' | 'failed'

let state: TerminalSessionState = API_MODE === 'http' && !HAS_E2E_MOCK_TOKEN ? 'checking' : 'ready'
let refreshTimer: number | null = null
const listeners = new Set<(next: TerminalSessionState) => void>()

function setState(next: TerminalSessionState): void {
  state = next
  listeners.forEach((listener) => listener(next))
}

function token(): string | null {
  if (API_MODE !== 'http' || HAS_E2E_MOCK_TOKEN) return MOCK_TOKEN || 'mock-terminal-session-fixture'
  try { return window.sessionStorage.getItem(STORAGE_KEY) } catch { return null }
}

function saveToken(value: string): void { window.sessionStorage.setItem(STORAGE_KEY, value) }

function cleanBootTicketFromUrl(): string | null {
  const current = new URL(window.location.href)
  const ticket = current.searchParams.get('boot_ticket')
  if (!ticket) return null
  current.searchParams.delete('boot_ticket')
  window.history.replaceState(window.history.state, '', `${current.pathname}${current.search}${current.hash}`)
  return ticket
}

function url(path: string): string { return new URL(`${API_BASE_URL}${path}`, window.location.origin).toString() }

function headers(input?: HeadersInit): Headers {
  const result = new Headers(input)
  const terminalId = getTerminalId()
  const sessionToken = token()
  if (terminalId) result.set('x-terminal-id', terminalId)
  if (sessionToken) result.set('x-terminal-session-token', sessionToken)
  return result
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeout)
  }
}

async function exchangeBootTicket(bootTicket: string, timeoutMs: number): Promise<void> {
  const response = await fetchWithTimeout(url('/terminals/session-token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ bootTicket }),
  }, timeoutMs)
  if (!response.ok) throw await asHttpError(response)
  const payload = (await response.json()) as { sessionToken?: string }
  if (!payload.sessionToken) throw new ApiHttpError('TERMINAL_SESSION_INVALID', '终端安全会话无效', 401)
  saveToken(payload.sessionToken)
}

async function refreshOnce(timeoutMs: number): Promise<void> {
  const response = await fetchWithTimeout(url('/terminals/session-token/refresh'), {
    method: 'POST', headers: headers({ Accept: 'application/json' }),
  }, timeoutMs)
  if (!response.ok) throw await asHttpError(response)
  const payload = (await response.json()) as { sessionToken?: string }
  if (!payload.sessionToken) throw new ApiHttpError('TERMINAL_SESSION_INVALID', '终端安全会话无效', 401)
  saveToken(payload.sessionToken)
}

async function asHttpError(response: Response): Promise<ApiHttpError> {
  const error = await readHttpError(response)
  return new ApiHttpError(error.code, error.message, response.status)
}

function retryable(error: unknown): boolean {
  if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) return true
  return error instanceof ApiHttpError && (
    (error.status === 401 && error.code === 'TERMINAL_SESSION_INVALID') ||
    (error.status === 503 && error.code === 'TERMINAL_SESSION_RETRYABLE')
  )
}

async function retryRefresh(): Promise<void> {
  setState('checking')
  const startedAt = Date.now()
  let lastError: unknown = new ApiHttpError('TERMINAL_SESSION_INVALID', '终端安全会话无效', 401)
  for (const delay of [0, ...RETRY_DELAYS_MS]) {
    if (delay > 0) {
      if (Date.now() + delay - startedAt > RETRY_WINDOW_MS) break
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay))
    }
    try {
      const remainingMs = startedAt + RETRY_WINDOW_MS - Date.now()
      if (remainingMs <= 0) break
      await refreshOnce(Math.min(REQUEST_TIMEOUT_MS, remainingMs))
      setState('ready')
      scheduleRefresh()
      return
    } catch (error) {
      lastError = error
      if (!retryable(error)) break
    }
  }
  setState('failed')
  throw lastError
}

function scheduleRefresh(): void {
  if (API_MODE !== 'http') return
  if (refreshTimer !== null) window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(() => { void retryRefresh().catch(() => undefined) }, 10 * 60_000)
}

export async function initializeTerminalSession(): Promise<void> {
  if (API_MODE !== 'http' || HAS_E2E_MOCK_TOKEN) { setState('ready'); return }
  const bootTicket = cleanBootTicketFromUrl()
  if (bootTicket) {
    setState('checking')
    await retryBootTicketExchange(bootTicket)
    return
  }
  if (!token()) { setState('failed'); return }
  try { await retryRefresh() } catch { /* state remains fail-closed */ }
}

async function retryBootTicketExchange(bootTicket: string): Promise<void> {
  const startedAt = Date.now()
  for (const delay of [0, ...RETRY_DELAYS_MS]) {
    if (delay > 0) {
      if (Date.now() + delay - startedAt > RETRY_WINDOW_MS) break
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay))
    }
    try {
      const remainingMs = startedAt + RETRY_WINDOW_MS - Date.now()
      if (remainingMs <= 0) break
      await exchangeBootTicket(bootTicket, Math.min(REQUEST_TIMEOUT_MS, remainingMs))
      setState('ready')
      scheduleRefresh()
      return
    } catch (error) {
      if (!retryable(error)) break
    }
  }
  setState('failed')
}

export function terminalSessionState(): TerminalSessionState { return state }

export function subscribeTerminalSession(listener: (next: TerminalSessionState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function terminalProtectedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (state !== 'ready') throw new ApiHttpError('TERMINAL_SESSION_INVALID', '终端安全会话无效', 401)
  let response = await fetch(input, { ...init, headers: headers(init.headers) })
  if (response.ok) return response
  const error = await asHttpError(response.clone())
  if (!retryable(error)) return response
  await retryRefresh()
  response = await fetch(input, { ...init, headers: headers(init.headers) })
  return response
}
