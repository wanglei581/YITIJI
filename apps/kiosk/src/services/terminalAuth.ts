import { API_BASE_URL, API_MODE } from './api/client'
import { ApiHttpError } from './api/httpAdapter'
import { getTerminalId } from './api/screensaver'
import { readHttpError } from './api/throwHttpError'

const STORAGE_KEY = 'terminal_session_token_v1'
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000]
const RETRY_WINDOW_MS = 60_000
const REQUEST_TIMEOUT_MS = 4_000
// mock 模式（非 http）不走终端票据，用固定占位令牌。E2E 用例在 http 模式下由夹具往 sessionStorage 注入令牌并应答刷新端点。
const MOCK_TOKEN = 'mock-terminal-session-fixture'

export type TerminalSessionState = 'checking' | 'ready' | 'failed'

let state: TerminalSessionState = API_MODE === 'http' ? 'checking' : 'ready'
let refreshTimer: number | null = null
const listeners = new Set<(next: TerminalSessionState) => void>()

function setState(next: TerminalSessionState): void {
  state = next
  listeners.forEach((listener) => listener(next))
}

function token(): string | null {
  if (API_MODE !== 'http') return MOCK_TOKEN
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

// 只有网络抖动 / 超时 / 服务端明确的 503 TERMINAL_SESSION_RETRYABLE（Redis 抖动）才自动重试；
// 401 TERMINAL_SESSION_INVALID 表示票已用过、令牌过期或终端被吊销，重试不会变好，立即 fail-closed。
function transient(error: unknown): boolean {
  if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) return true
  return error instanceof ApiHttpError && error.status === 503 && error.code === 'TERMINAL_SESSION_RETRYABLE'
}

function sessionInvalid(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 401 && error.code === 'TERMINAL_SESSION_INVALID'
}

let refreshInflight: Promise<void> | null = null

// 并发业务请求同时遇到 401 时共享同一次刷新，避免向 /session-token/refresh 涌入多次请求。
function retryRefresh(): Promise<void> {
  if (refreshInflight) return refreshInflight
  refreshInflight = retryRefreshOnce().finally(() => { refreshInflight = null })
  return refreshInflight
}

async function retryRefreshOnce(): Promise<void> {
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
      if (!transient(error)) break
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

let initInflight: Promise<void> | null = null

// 身份恢复回调可能在换票尚未完成时再次调用；此时 URL 里的票已被抹掉，
// 若不合并会把状态误置为 failed。进行中的初始化直接复用同一个 Promise。
export function initializeTerminalSession(): Promise<void> {
  if (initInflight) return initInflight
  initInflight = initializeTerminalSessionOnce().finally(() => { initInflight = null })
  return initInflight
}

async function initializeTerminalSessionOnce(): Promise<void> {
  if (API_MODE !== 'http') { setState('ready'); return }
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
      if (!transient(error)) break
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
  // 业务请求 401 只触发一次会话刷新（刷新本身只对网络抖动 / 503 重试）；其它错误原样交给调用方。
  if (!sessionInvalid(error)) return response
  await retryRefresh()
  response = await fetch(input, { ...init, headers: headers(init.headers) })
  return response
}
