import { API_BASE_URL, API_MODE } from './api/client'
import { ApiHttpError } from './api/httpAdapter'
import { getTerminalId } from './api/screensaver'
import { readHttpError } from './api/throwHttpError'

const STORAGE_KEY = 'terminal_session_token_v1'
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000]
const RETRY_WINDOW_MS = 60_000
const REQUEST_TIMEOUT_MS = 4_000
// 本地 Agent 桥接：会话票失效后由页面自行重新引导用（与看门狗取票同一来源、同一端点）。
const LOCAL_AGENT_BASE_URL = ((import.meta.env['VITE_TERMINAL_AGENT_LOCAL_URL'] ?? '').trim() || 'http://127.0.0.1:9527').replace(/\/+$/, '')
const LOCAL_BRIDGE_TOKEN = (import.meta.env['VITE_TERMINAL_AGENT_BRIDGE_TOKEN'] ?? '').trim()
const LOCAL_TICKET_TIMEOUT_MS = 4_000
const BOOT_TICKET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
// 仅 Playwright 浏览器套件（API 被路由 mock）设置；生产 / deploy 构建禁止出现该变量（verify-runtime-terminal-identity 断言）。
const MOCK_TOKEN = (import.meta.env['VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN'] ?? 'mock-terminal-session-fixture').trim()
const HAS_E2E_MOCK_TOKEN = Boolean(import.meta.env['VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN']?.trim())

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

/**
 * 向本机 Agent 桥接要一张新的引导票。
 *
 * 存在的理由：会话票过期或被吊销后，`/session-token/refresh` 会 401，而 401 按设计
 * 不重试（重试不会变好）。此前页面到此就永久停在 failed —— 引导票**只从 URL 读一次**，
 * 而 URL 上的票是看门狗启动浏览器时塞的。于是一体机只能靠看门狗重启浏览器才恢复，
 * 期间用户看到的是「终端安全校验失败」且按钮全灰。
 * 2026-09-08 生产实测：17:10:57 刷新 401 之后页面再没恢复，直到看门狗介入。
 *
 * 这里让页面自己走看门狗走的那条路（同一端点、同一信任来源），不降低安全性：
 * 桥接令牌未配置（例如在普通浏览器里打开）时直接放弃，仍然 fail-closed。
 */
async function requestLocalBootTicket(): Promise<string | null> {
  if (!LOCAL_BRIDGE_TOKEN) return null
  try {
    const response = await fetchWithTimeout(`${LOCAL_AGENT_BASE_URL}/local/terminal-boot-ticket`, {
      method: 'POST',
      headers: { 'X-Local-Bridge-Token': LOCAL_BRIDGE_TOKEN, Accept: 'application/json' },
      cache: 'no-store',
    }, LOCAL_TICKET_TIMEOUT_MS)
    if (!response.ok) return null
    const payload = (await response.json()) as { data?: { bootTicket?: string } }
    const ticket = payload.data?.bootTicket
    return typeof ticket === 'string' && BOOT_TICKET_PATTERN.test(ticket) ? ticket : null
  } catch {
    return null
  }
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
  // 刷新走不通了（票被吊销 / 过期，重试无益）。在放弃之前，向本机 Agent 要一张新引导票
  // 重新建会话 —— 这是看门狗重启浏览器时走的同一条路，页面自己走一遍就不必等浏览器重启。
  // 桥接令牌未配置（普通浏览器打开）时 requestLocalBootTicket 返回 null，此处仍然 fail-closed。
  if (await reBootstrapFromLocalAgent()) return

  setState('failed')
  throw lastError
}

/** 用本机 Agent 的新引导票重建会话。成功返回 true 并已置为 ready。 */
async function reBootstrapFromLocalAgent(): Promise<boolean> {
  const ticket = await requestLocalBootTicket()
  if (!ticket) return false
  try {
    await exchangeBootTicket(ticket, REQUEST_TIMEOUT_MS)
  } catch {
    return false
  }
  setState('ready')
  scheduleRefresh()
  return true
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
  if (API_MODE !== 'http' || HAS_E2E_MOCK_TOKEN) { setState('ready'); return }
  const bootTicket = cleanBootTicketFromUrl()
  if (bootTicket) {
    setState('checking')
    await retryBootTicketExchange(bootTicket)
    return
  }
  // 没有 URL 引导票时：先用存量会话票续期；连存量票都没有（例如浏览器被单独重开、
  // sessionStorage 已清）就直接向本机 Agent 取票，而不是立刻判失败。
  if (!token()) {
    setState('checking')
    if (await reBootstrapFromLocalAgent()) return
    setState('failed')
    return
  }
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
