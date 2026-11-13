import { clearKioskSensitiveSession, clearKioskSharedDeviceResidue, kioskSensitiveSessionScope, type KioskClearScope } from '../auth/kioskSensitiveSession'
import { API_BASE_URL, API_MODE } from './api/client'
import { ApiHttpError } from './api/httpAdapter'
import { getTerminalId } from './api/screensaver'
import { readHttpError } from './api/throwHttpError'
import { applyE2ERecoveryView, attachRecoveryRuntime, cancelRecovery, dropRecoveryHold, hadSettled, holdRecoveryForOtherContent, isBootExchangeUnsettled, markBootExchangeSettled, markBootExchangeUnsettled, noteRejectedToken, noteStateEntered, rememberRecoveryClearScope, scheduleRecovery } from './terminalSessionRecovery'
export { takeTerminalSessionRecoveryClearScope, terminalSessionRecoveryDeferred, terminalSessionRecoveryNeedsNewTicket } from './terminalSessionRecovery'

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
let licenseRenewalSuspended = (() => {
  try { return window.localStorage.getItem('kiosk_license_paused_v1') === '1' } catch { return false }
})()
let licenseRecheckActive = false
let lastRenewalAttemptAt: number | null = null
export function lastTerminalRenewalAttemptAt(): number | null { return lastRenewalAttemptAt }
const listeners = new Set<(next: TerminalSessionState) => void>()
let licenseRenewalRejected = false
const licenseRejectionListeners = new Set<() => void>()

export function wasTerminalLicenseRenewalRejected(): boolean { return licenseRenewalRejected }
export function clearTerminalLicenseRenewalRejection(): void { licenseRenewalRejected = false }
export function subscribeTerminalLicenseRenewalRejected(listener: () => void): () => void {
  licenseRejectionListeners.add(listener)
  return () => { licenseRejectionListeners.delete(listener) }
}

function recordLicenseRejection(error: unknown, keepSessionReady = false): boolean {
  if (!(error instanceof ApiHttpError && error.status === 403 && error.code === 'TERMINAL_LICENSE_INACTIVE')) return false
  licenseRenewalRejected = true
  if (keepSessionReady) setState('ready')
  licenseRejectionListeners.forEach((listener) => listener())
  return true
}

// failed 不再是终点：每次落到 failed 都排一次后台恢复，离开 failed 就撤掉。
// 放在这里而不是各个判死的分支里，是为了以后新增的判死分支不会漏排。
function setState(next: TerminalSessionState): void {
  noteStateEntered(next)
  state = next
  if (next === 'failed') {
    // 十分钟续期交给后台恢复接手：留着它会在恢复中途把状态翻回 checking，再跑一遍 60 秒重试窗口。
    if (refreshTimer !== null) { window.clearTimeout(refreshTimer); refreshTimer = null }
    // 授权暂停或刚被拒（403 TERMINAL_LICENSE_INACTIVE）时不排后台恢复：复查由授权闸门限频（≥5 分钟），
    // 每分钟一轮的恢复会把它打穿。暂停解除时由 setLicenseRenewalSuspended 补排。
    if (!licenseRenewalSuspended && !licenseRenewalRejected) scheduleRecovery()
  } else {
    cancelRecovery()
  }
  listeners.forEach((listener) => listener(next))
}

/**
 * 发请求时带的那张票：永远是 sessionStorage 里的**当前**票。
 *
 * 生产行为不变 —— 没有 E2E mock 时这就是「读 sessionStorage，读不到就没有票」。
 *
 * E2E 构建里 mock 票只补**初始**那一格：套件不走引导票交换，sessionStorage 起初是空的，
 * 没有它整个 http 套件第一次请求就没有票可带。但它到此为止 —— 真实续期一旦 saveToken，
 * 这里必须读到新票。此前 mock 排在最前面短路返回，于是无论 headers() 组在等待之前还是
 * 之后，发出去的都是同一个固定值：「等完换票再发请求」这件事在浏览器里根本观察不到，
 * 用例只能断言那个固定值，把顺序缺陷原样盖住。
 */
function token(): string | null {
  if (API_MODE !== 'http') return MOCK_TOKEN || 'mock-terminal-session-fixture'
  let stored: string | null = null
  try { stored = window.sessionStorage.getItem(STORAGE_KEY) } catch { stored = null }
  if (stored) return stored
  return HAS_E2E_MOCK_TOKEN ? MOCK_TOKEN : null
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

/**
 * 引导票已经换成新的终端会话。同一标签页里上一位的打印材料、简历、问卷、
 * 材料草稿、面试、扫描和收藏还在。清场只调用 kioskSensitiveSession 那一份清单。
 * 换引导票即清场：哪怕当时判出来什么都没有，清场函数照样调用。
 * 新令牌在清完之后写入：清单不含终端会话键；引导票在服务端已被一次性核销，
 * 清场若抛错也要把新令牌留下，否则这台机器既没有旧会话也换不回这张票。
 */
function clearSensitiveStateForNewTerminalSession(): void {
  clearKioskSensitiveSession()
  clearKioskSharedDeviceResidue()
}

/** 换票成功才返回。返回值是清场之前判出来的范围，调用方决定记不记。 */
async function exchangeBootTicket(bootTicket: string, timeoutMs: number): Promise<KioskClearScope> {
  lastRenewalAttemptAt = Date.now()
  const response = await fetchWithTimeout(url('/terminals/session-token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ bootTicket }),
  }, timeoutMs)
  if (!response.ok) {
    const error = await asHttpError(response)
    recordLicenseRejection(error)
    throw error
  }
  const payload = (await response.json()) as { sessionToken?: string }
  if (!payload.sessionToken) throw new ApiHttpError('TERMINAL_SESSION_INVALID', '这台机器的安全校验没通过', 401)
  const sessionToken = payload.sessionToken
  const clearScope = kioskSensitiveSessionScope()
  try {
    clearSensitiveStateForNewTerminalSession()
  } finally {
    saveToken(sessionToken)
  }
  licenseRenewalRejected = false
  return clearScope
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
  lastRenewalAttemptAt = Date.now()
  const response = await fetchWithTimeout(url('/terminals/session-token/refresh'), {
    method: 'POST', headers: headers({ Accept: 'application/json' }),
  }, timeoutMs)
  if (!response.ok) throw await asHttpError(response)
  const payload = (await response.json()) as { sessionToken?: string }
  if (!payload.sessionToken) throw new ApiHttpError('TERMINAL_SESSION_INVALID', '这台机器的安全校验没通过', 401)
  saveToken(payload.sessionToken)
}

async function asHttpError(response: Response): Promise<ApiHttpError> {
  const error = await readHttpError(response)
  return new ApiHttpError(error.code, error.message, response.status)
}

// 网络抖动 / 超时自动重试；502 / 503 / 504 不看错误码一律重试 —— 既包括服务端明确的
// 503 TERMINAL_SESSION_RETRYABLE（Redis 抖动），也包括后端重启那几十秒里网关回的错误页（没有业务错误码）。
// 2026-10-10 走查实测：开机换票那一下撞上一次不带错误码的 503，此前一次就判死，4 分半不恢复。
// TERMINAL_SESSION_INVALID 表示票已用过、令牌过期或终端被吊销，重试不会变好，立即 fail-closed。
// 引导票是读出即删的：网关超时而后端其实已经用掉它时，重发会得到作废，由调用方改向本机 Agent 要新票。
function transient(error: unknown): boolean {
  if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) return true
  if (!(error instanceof ApiHttpError)) return false
  return error.status === 502 || error.status === 503 || error.status === 504
}

function sessionInvalid(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 401 && error.code === 'TERMINAL_SESSION_INVALID'
}

let refreshInflight: Promise<void> | null = null

// 并发业务请求同时遇到 401 时共享同一次刷新，避免向 /session-token/refresh 涌入多次请求。
function retryRefresh(): Promise<void> {
  if (refreshInflight) return refreshInflight
  if (licenseRenewalSuspended && !licenseRecheckActive) return Promise.reject(new ApiHttpError('TERMINAL_LICENSE_INACTIVE', '', 403))
  if (licenseRenewalRejected) return Promise.reject(new ApiHttpError('TERMINAL_LICENSE_INACTIVE', '', 403))
  refreshInflight = retryRefreshOnce().finally(() => { refreshInflight = null })
  return refreshInflight
}

async function retryRefreshOnce(): Promise<void> {
  setState('checking')
  const startedAt = Date.now()
  let lastError: unknown = new ApiHttpError('TERMINAL_SESSION_INVALID', '这台机器的安全校验没通过', 401)
  let invalidToken: string | null = null
  // 带引导票打开而没换成的页不拿旧会话票续期，直接走下面「要新引导票」那条路（换票即清场）。
  const bootExchangeUnsettled = isBootExchangeUnsettled()
  // 授权暂停时只试一次、不等不重试（复查由授权闸门限频）。
  for (const delay of bootExchangeUnsettled ? [] : licenseRenewalSuspended ? [0] : [0, ...RETRY_DELAYS_MS]) {
    if (delay > 0) {
      if (licenseRenewalSuspended) break
      if (Date.now() + delay - startedAt > RETRY_WINDOW_MS) break
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay))
      if (licenseRenewalSuspended) break
    }
    // 这一次续期带的就是这张票（refreshOnce 同步读当前票，中间没有 await）。
    const attemptToken = token()
    try {
      const remainingMs = startedAt + RETRY_WINDOW_MS - Date.now()
      if (remainingMs <= 0) break
      await refreshOnce(Math.min(REQUEST_TIMEOUT_MS, remainingMs))
      setState('ready')
      scheduleRefresh()
      return
    } catch (error) {
      lastError = error
      if (recordLicenseRejection(error, true)) {
        throw error
      }
      if (sessionInvalid(error)) invalidToken = attemptToken
      if (!transient(error)) break
    }
  }
  // 服务端明确作废的那一张票记下来。只记收到作废的那一张，而且它还是当前票才记。
  // 空转的那条初始错误（带引导票没换成、循环一次都没跑）不算。
  noteRejectedToken(invalidToken)
  // 刷新走不通了（票被吊销 / 过期，或暂时连不上）。在放弃之前，向本机 Agent 要一张新引导票
  // 重新建会话 —— 这是看门狗重启浏览器时走的同一条路，页面自己走一遍就不必等浏览器重启。
  // 上面还有这一位的别的内容时，reBootstrapFromLocalAgent 自己会停住，不取票。
  // 桥接令牌未配置（普通浏览器打开）时 requestLocalBootTicket 返回 null，此处仍然 fail-closed。
  // 暂停复查的续期若遭 401，留到下次复查再换票，避免两次请求不足五分钟。
  // 正常模式的例行续期和业务 401 重试不受复查限频约束。
  if (!licenseRenewalSuspended && await reBootstrapFromLocalAgent()) return

  setState('failed')
  throw lastError
}

/**
 * 用本机 Agent 的新引导票重建会话。成功返回 true 并已置为 ready。
 *
 * 推迟只发生在这里，四个调用点都经过这个函数，不在调用点上各判一次。
 * 页面刚打开（还没离开过最初那次 checking）不判。已经 settled 且还有别的内容：取票前停一次，
 * 取到票、换票前再停一次（取票最长 4 秒，这期间人可能开始填东西）。停住时不换票。
 * 停住时只有确实要换新票才标「压着」；原票只是暂时续不上不标，下一轮先拿原票续。
 */
async function reBootstrapFromLocalAgent(): Promise<boolean> {
  const hadSettledState = hadSettled()
  if (hadSettledState && kioskSensitiveSessionScope() === 'with-other') {
    holdRecoveryForOtherContent()
    return false
  }
  // 重建真的往下走：不再是「压着等他结束」。取票期间人又填了别的，下面还会再停一次。
  dropRecoveryHold()
  const ticket = await requestLocalBootTicket()
  if (!ticket) return false
  if (hadSettledState && kioskSensitiveSessionScope() === 'with-other') {
    holdRecoveryForOtherContent()
    return false
  }
  let clearedScope: KioskClearScope = 'none'
  try {
    clearedScope = await exchangeBootTicket(ticket, REQUEST_TIMEOUT_MS)
  } catch {
    return false
  }
  markBootExchangeSettled()
  // 清掉了什么以换票那一刻、清场之前的判断为准。页面刚打开那一次不算。
  rememberRecoveryClearScope(hadSettledState, clearedScope)
  setState('ready')
  scheduleRefresh()
  return true
}

function scheduleRefresh(): void {
  if (API_MODE !== 'http') return
  if (refreshTimer !== null) window.clearTimeout(refreshTimer)
  refreshTimer = null
  if (licenseRenewalSuspended) return
  refreshTimer = window.setTimeout(() => { void retryRefresh().catch(() => undefined) }, 10 * 60_000)
}

export function setLicenseRenewalSuspended(suspended: boolean): void {
  if (licenseRenewalSuspended === suspended) return
  licenseRenewalSuspended = suspended
  if (refreshTimer !== null) window.clearTimeout(refreshTimer)
  refreshTimer = null
  if (suspended) cancelRecovery()
  if (!suspended && state === 'ready') scheduleRefresh()
  else if (!suspended && state === 'checking') void initializeTerminalSession()
  else if (!suspended && state === 'failed' && !licenseRenewalRejected) scheduleRecovery()
}

let initInflight: Promise<void> | null = null

// 身份恢复回调可能在换票尚未完成时再次调用；此时 URL 里的票已被抹掉，
// 若不合并会把状态误置为 failed。进行中的初始化直接复用同一个 Promise。
export function initializeTerminalSession(): Promise<void> {
  if (initInflight) return initInflight
  if (licenseRenewalSuspended && !licenseRecheckActive) return Promise.resolve()
  initInflight = initializeTerminalSessionOnce().finally(() => { initInflight = null })
  return initInflight
}

/** 只在授权暂停时调用的低频复查；由授权闸门负责限频。 */
export function recheckTerminalSessionAfterLicensePause({ credentialExpired }: { credentialExpired: boolean } = { credentialExpired: false }): Promise<void> {
  clearTerminalLicenseRenewalRejection()
  // 凭证已过期：清掉过期票，初始化就会走「没有存量票 → 向本机 Agent 重新取票」，而不是拿过期票去续期。
  if (credentialExpired) { try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { /* storage unavailable */ } }
  licenseRecheckActive = true
  return initializeTerminalSession().finally(() => { licenseRecheckActive = false })
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
  for (const delay of licenseRenewalSuspended ? [0] : [0, ...RETRY_DELAYS_MS]) {
    if (delay > 0) {
      if (licenseRenewalSuspended) break
      if (Date.now() + delay - startedAt > RETRY_WINDOW_MS) break
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay))
      if (licenseRenewalSuspended) break
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
  // URL 上那张票只有 60 秒、只能用一次，到这里已经指望不上。与续期那条路一样，判死之前
  // 先向本机 Agent 要一张新票；还不行才 failed，之后由后台恢复每分钟再要一次。
  markBootExchangeUnsettled()
  // 授权暂停或被拒时不另取新票（会再撞一次 403，且绕过复查限频）。
  if (!licenseRenewalSuspended && !licenseRenewalRejected && await reBootstrapFromLocalAgent()) return
  setState('failed')
}

export function terminalSessionState(): TerminalSessionState { return state }

export function subscribeTerminalSession(listener: (next: TerminalSessionState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * 业务请求的会话闸门：等在飞的那一次续期，等不出 ready 就 fail-closed。
 *
 * 防的是一个只有一两秒宽的窗口：健康的一体机每十分钟续一次会话票，续期期间 state
 * 被真实地置成 checking。此前只要用户恰好在这一两秒里按下「到机认领」，或者付款成功
 * 触发 Order-only 释放，请求就当场抛 TERMINAL_SESSION_INVALID，屏幕上写
 * 「终端安全校验失败」并让用户去找现场的人 —— 票其实好好的，只是正在换。让用户去求助、
 * 或者以为自己的到机码作废了，都是这一句话造成的。
 *
 * 边界三条，一条都不放宽：
 *   · 只等「checking 且确有在飞续期」。启动引导（checking 但没有 refreshInflight）
 *     与 failed 仍然立即失败：前者没有可等的结果，后者已经判过死
 *     （failed 之后后台那一轮成功会把状态改回 ready，但 state 还是 failed 时本函数不等它）。
 *   · 自己绝不发起续期。等的永远是别人已经在飞的那个 Promise，因此并发业务请求
 *     仍然只对应一次 /session-token/refresh。
 *   · 等失败不降级：统一抛 TERMINAL_SESSION_INVALID，不把续期的原始错误（可能是
 *     TypeError）甩给调用方 —— 那会让收银页显示「网络连接失败」，把一次安全失败
 *     说成网络问题；更不会拿刚被换掉的旧票把业务请求发出去。
 *
 * 不会死锁：只有 terminalProtectedFetch 调它，而续期自身走 fetchWithTimeout 直连、
 * 不经过本函数，因此不存在「续期等自己」的重入。
 */
async function awaitReadySessionOrFailClosed(): Promise<void> {
  // 这两个值必须在同一个同步段里读完：await 之后 refreshInflight 已被 retryRefresh
  // 的 finally 清空，再读就成 null 了。
  const inflight = state === 'checking' ? refreshInflight : null
  if (inflight) {
    try {
      await inflight
    } catch {
      /* 失败原因不外传，落到下面统一 fail-closed */
    }
  }
  if (state !== 'ready') throw new ApiHttpError('TERMINAL_SESSION_INVALID', '这台机器的安全校验没通过', 401)
}

export interface TerminalProtectedFetchInit extends RequestInit {
  /**
   * 调用方页面还在不在。卸载（用户离开，或隐私清场把 children 换成遮罩）时 abort。
   * 不传给 fetch：已经发出的 claim / release 不取消，服务端该落的照落。
   * 它只拦住还没发出的第一次，以及 401 之后那一次重放。
   */
  staleSignal?: AbortSignal
}

function withoutStaleSignal(init: TerminalProtectedFetchInit): RequestInit {
  const requestInit: RequestInit & { staleSignal?: AbortSignal } = { ...init }
  delete requestInit.staleSignal
  return requestInit
}

interface AiDeclarationPrepared {
  input: RequestInfo | URL
  init: RequestInit
}

interface AiDeclarationBridge {
  prepare: (input: RequestInfo | URL, init: RequestInit) => Promise<AiDeclarationPrepared>
  recover: (
    input: RequestInfo | URL,
    init: RequestInit,
    response: Response,
  ) => Promise<AiDeclarationPrepared | null>
}

/**
 * 使用声明在应用启动时注册。本文件不 import 声明模块：终端会话门禁按固定的替身表
 * 编译它，多一个运行时依赖就会让那道门禁无法判定。
 */
let aiDeclarationBridge: AiDeclarationBridge | null = null

export function registerAiDeclarationBridge(bridge: AiDeclarationBridge | null): void {
  aiDeclarationBridge = bridge
}

/**
 * 游客用 AI 被要求先登录（401 AI_LOGIN_REQUIRED）时报一声，由启动时登记的观察者转给全局登录提示。
 * 只报不改：响应原样交还调用方，页面照旧按错误码出字。本文件不 import 提示模块，理由同上。
 */
let aiLoginRequiredObserver: (() => void) | null = null

export function registerAiLoginRequiredObserver(observer: (() => void) | null): void {
  aiLoginRequiredObserver = observer
}

function reportAiLoginRequired(error: ApiHttpError): void {
  if (error.status === 401 && error.code === 'AI_LOGIN_REQUIRED') aiLoginRequiredObserver?.()
}

async function replayDeclaration(
  input: RequestInfo | URL,
  init: RequestInit,
  response: Response,
  retried: boolean,
  again: (nextInput: RequestInfo | URL, nextInit: RequestInit) => Promise<Response>,
): Promise<Response | null> {
  if (retried || !aiDeclarationBridge || response.status !== 403) return null
  const next = await aiDeclarationBridge.recover(input, init, response.clone())
  if (!next) return null
  return again(next.input, next.init)
}

export async function terminalProtectedFetch(
  input: RequestInfo | URL,
  init: TerminalProtectedFetchInit = {},
  declarationRetried = false,
): Promise<Response> {
  const staleSignal = init.staleSignal
  // 续期在飞就等它出结果。headers() 排在等待**之后**，因此发出去的一定是等完之后的
  // 那张票（续期成功时新票已写进 sessionStorage），不会是刚被换掉的旧票。
  // 等待期间人走了就不要再把这一单发出去：那时站在机器前的可能已是下一位。
  if (staleSignal?.aborted) throw new DOMException('请求已取消', 'AbortError')
  if (state !== 'ready') await awaitReadySessionOrFailClosed()
  if (staleSignal?.aborted) throw new DOMException('请求已取消', 'AbortError')
  if (!declarationRetried && aiDeclarationBridge) {
    const prepared = await aiDeclarationBridge.prepare(input, withoutStaleSignal(init))
    input = prepared.input
    init = { ...prepared.init, staleSignal }
  }
  const requestInit = withoutStaleSignal(init)
  let response = await fetch(input, { ...requestInit, headers: headers(init.headers) })
  const replay = await replayDeclaration(
    input,
    requestInit,
    response,
    declarationRetried,
    (nextInput, nextInit) => terminalProtectedFetch(nextInput, { ...nextInit, staleSignal }, true),
  )
  if (replay) return replay
  if (response.ok) return response
  const error = await asHttpError(response.clone())
  reportAiLoginRequired(error)
  // 业务请求 401 只触发一次会话刷新（刷新本身只对网络抖动与 502 / 503 / 504 重试）；其它错误原样交给调用方。
  if (!sessionInvalid(error)) return response
  await retryRefresh()
  // 刷新最长可达 60 秒。人已离页或本机已清场时不重放：原 401 的 body 还没被读过
  // （上面读的是 clone），调用方的错误分支仍能解析，只是不该再替上一位发一单。
  if (staleSignal?.aborted) return response
  response = await fetch(input, { ...requestInit, headers: headers(init.headers) })
  const replayAfterRefresh = await replayDeclaration(
    input,
    requestInit,
    response,
    declarationRetried,
    (nextInput, nextInit) => terminalProtectedFetch(nextInput, { ...nextInit, staleSignal }, true),
  )
  return replayAfterRefresh ?? response
}

/**
 * 「按台计」请求：AI 调用与会员发码用。与 terminalProtectedFetch 共用同一份取头（headers()）
 * 与同一次换票（retryRefresh），区别只在**不 fail-closed**。
 *
 * 为什么不能直接用 terminalProtectedFetch：它守的是打印放行、到机认领这类「没有已验签终端就
 * 必须失败」的请求；会话不在 ready 时直接抛 TERMINAL_SESSION_INVALID。AI 与发码不一样 ——
 *   · 服务端只拿终端身份记账、按台限额（AI 每日额度、短信每台每日上限），不拿它放行；
 *   · 手机上打开的扫码确认页、桌面浏览器里没有终端身份，照旧要能发码、能用 AI；
 *   · AI 是加速器不是前置条件：终端会话一时换不出票，AI 也不能因此从屏幕上消失。
 *
 * 规则三条：
 *   1. 本机没有终端身份（getTerminalId() 为空）：原样 fetch，一个终端头都不加（与改动前一致）。
 *   2. 有终端身份：续期在飞就先等它（不自己发起、失败不外抛），再用 headers() 带上
 *      x-terminal-id + x-terminal-session-token 发出；取头在等待之后，发的一定是当前那张票。
 *   3. 服务端回 401 TERMINAL_SESSION_INVALID：走与 terminalProtectedFetch 同一次换票（并发共享），
 *      换成功且调用方没取消才重放一次；换不出来就把原 401 交还调用方，由页面按错误码处理。
 */
export async function terminalAttributedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  declarationRetried = false,
): Promise<Response> {
  if (!declarationRetried && aiDeclarationBridge) {
    const prepared = await aiDeclarationBridge.prepare(input, init)
    input = prepared.input
    init = prepared.init
  }
  const sendAgain = (nextInput: RequestInfo | URL, nextInit: RequestInit) =>
    terminalAttributedFetch(nextInput, nextInit, true)
  if (!getTerminalId()) {
    const response = await fetch(input, init)
    const replay = await replayDeclaration(input, init, response, declarationRetried, sendAgain)
    const settled = replay ?? response
    if (settled.status === 401) reportAiLoginRequired(await asHttpError(settled.clone()))
    return settled
  }
  const inflight = state === 'checking' ? refreshInflight : null
  if (inflight) {
    try { await inflight } catch { /* 续期失败不拦本次请求，照当前能拿到的票发 */ }
  }
  const response = await fetch(input, { ...init, headers: headers(init.headers) })
  const replay = await replayDeclaration(input, init, response, declarationRetried, sendAgain)
  if (replay) return replay
  if (response.status !== 401) return response
  const unauthorized = await asHttpError(response.clone())
  reportAiLoginRequired(unauthorized)
  if (!sessionInvalid(unauthorized)) return response
  try {
    await retryRefresh()
  } catch {
    return response
  }
  if (init.signal?.aborted) return response
  const refreshed = await fetch(input, { ...init, headers: headers(init.headers) })
  const replayAfterRefresh = await replayDeclaration(input, init, refreshed, declarationRetried, sendAgain)
  return replayAfterRefresh ?? refreshed
}

// ── E2E 测试缝：只在设置了 mock 会话票的构建里挂出 ──────────────────────────
// 生产 / deploy 构建绝不设置 VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN（deploy.yml 那条由
// verify-runtime-terminal-identity 钉死），所以这段在生产包里永远不会执行。
//
// 存在的理由：E2E 构建里会话恒为 ready，而真实的「续期在飞」只由十分钟定时器触发 ——
// 浏览器用例既等不到它，也没有别的入口进到 checking 窗口，于是上面那段等待逻辑在浏览器里
// 从来没被跑过（缺陷正是长在这段里）。这里暴露三个动作：发起一次**真实**续期（与定时器
// 调的是同一个 retryRefresh）、读一眼当前状态，以及把三样只读恢复视图置成给定值。
// 它不放宽任何判定 —— 状态仍由真实代码写、票仍由真实代码读发；setRecoveryView 不改会话状态、不发请求。
export interface TerminalSessionE2EHooks {
  /** 发起一次真实续期，等价于十分钟定时器那一次。 */
  startRefresh: () => void
  /** 只读当前会话状态。 */
  state: () => TerminalSessionState
  /** 把三样只读值置成给定值并通知订阅者。不改会话状态、不发请求；状态仍由 startRefresh 加路由应答驱动。 */
  setRecoveryView: (view: { deferred?: boolean; needsNewTicket?: boolean; clearScope?: KioskClearScope }) => void
}

if (HAS_E2E_MOCK_TOKEN) {
  // typeof window 守卫：发码封装（memberAuthApi）也引本模块，node 里打包它的单测没有 window。
  const host = (typeof window === 'undefined' ? {} : window) as unknown as { __terminalSessionE2E?: TerminalSessionE2EHooks }
  host.__terminalSessionE2E = {
    startRefresh: () => { void retryRefresh().catch(() => undefined) },
    state: () => state,
    setRecoveryView: (view) => { applyE2ERecoveryView(view) },
  }
}

attachRecoveryRuntime({
  apiMode: () => API_MODE,
  getState: () => state,
  token,
  refreshOnce,
  reBootstrapFromLocalAgent,
  scheduleRefresh,
  setReady: () => { setState('ready') },
  sessionInvalid,
  getRefreshInflight: () => refreshInflight,
  setRefreshInflight: (next) => { refreshInflight = next },
  getInitInflight: () => initInflight,
  notify: () => { listeners.forEach((listener) => listener(state)) },
  invalidError: () => new ApiHttpError('TERMINAL_SESSION_INVALID', '这台机器的安全校验没通过', 401),
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
})
