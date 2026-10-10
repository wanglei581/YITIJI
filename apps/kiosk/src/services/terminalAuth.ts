import { clearKioskSensitiveSession, clearKioskSharedDeviceResidue } from '../auth/kioskSensitiveSession'
import { API_BASE_URL, API_MODE } from './api/client'
import { ApiHttpError } from './api/httpAdapter'
import { getTerminalId } from './api/screensaver'
import { readHttpError } from './api/throwHttpError'

const STORAGE_KEY = 'terminal_session_token_v1'
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000]
const RETRY_WINDOW_MS = 60_000
const REQUEST_TIMEOUT_MS = 4_000
// 判 failed 之后后台每隔这么久再试一次。本机 Agent 的取票口每分钟限 6 次（看门狗与页面共用），一分钟一次不会挤占。
// 另加一段随机量：服务器重启时同一批机器会同时掉进 failed，不错开就会在同一秒一起回来敲门。
const RECOVERY_INTERVAL_MS = 60_000
const RECOVERY_JITTER_MS = 15_000
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
let recoveryTimer: number | null = null
// 这一页是带着引导票打开的，而那张票没换成：此后只许走「向本机 Agent 要新票」那条路恢复
// （那条路换票即清场），任何一条路都不拿标签页里可能留着的旧会话票续期（见 retryRefreshOnce、recoverOnce）。
// 置真之后能回到 ready 的只剩 reBootstrapFromLocalAgent，它成功时归零。
let bootExchangeUnsettled = false
// 后台恢复时被服务端明确判作废的那张会话票。票本身不删（终端停用期间读配置还要带它），
// 只是后台恢复不再拿同一张票每分钟去续一次。
let rejectedSessionToken: string | null = null
const listeners = new Set<(next: TerminalSessionState) => void>()

// failed 不再是终点：每次落到 failed 都排一次后台恢复，离开 failed 就撤掉。
// 放在这里而不是各个判死的分支里，是为了以后新增的判死分支不会漏排。
function setState(next: TerminalSessionState): void {
  state = next
  if (next === 'failed') {
    // 十分钟续期交给后台恢复接手：留着它会在恢复中途把状态翻回 checking，再跑一遍 60 秒重试窗口。
    if (refreshTimer !== null) { window.clearTimeout(refreshTimer); refreshTimer = null }
    scheduleRecovery()
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
 * 新令牌在清完之后写入：清单不含终端会话键；引导票在服务端已被一次性核销，
 * 清场若抛错也要把新令牌留下，否则这台机器既没有旧会话也换不回这张票。
 */
function clearSensitiveStateForNewTerminalSession(): void {
  clearKioskSensitiveSession()
  clearKioskSharedDeviceResidue()
}

async function exchangeBootTicket(bootTicket: string, timeoutMs: number): Promise<void> {
  const response = await fetchWithTimeout(url('/terminals/session-token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ bootTicket }),
  }, timeoutMs)
  if (!response.ok) throw await asHttpError(response)
  const payload = (await response.json()) as { sessionToken?: string }
  if (!payload.sessionToken) throw new ApiHttpError('TERMINAL_SESSION_INVALID', '这台机器的安全校验没通过', 401)
  const sessionToken = payload.sessionToken
  try {
    clearSensitiveStateForNewTerminalSession()
  } finally {
    saveToken(sessionToken)
  }
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
// 引导票是读出即删的：网关超时而后端其实已经用掉它时，重发会得到「作废」，由调用方改向本机 Agent 要新票。
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
  refreshInflight = retryRefreshOnce().finally(() => { refreshInflight = null })
  return refreshInflight
}

async function retryRefreshOnce(): Promise<void> {
  setState('checking')
  const startedAt = Date.now()
  let lastError: unknown = new ApiHttpError('TERMINAL_SESSION_INVALID', '这台机器的安全校验没通过', 401)
  // 带引导票打开而没换成的页不拿旧会话票续期，直接走下面「要新引导票」那条路（换票即清场）。
  for (const delay of bootExchangeUnsettled ? [] : [0, ...RETRY_DELAYS_MS]) {
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
  bootExchangeUnsettled = false
  rejectedSessionToken = null
  setState('ready')
  scheduleRefresh()
  return true
}

function scheduleRefresh(): void {
  if (API_MODE !== 'http') return
  if (refreshTimer !== null) window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(() => { void retryRefresh().catch(() => undefined) }, 10 * 60_000)
}

/**
 * failed 之后的后台恢复。
 *
 * 存在的理由：此前判 failed 就是终点 —— 开机换票与十分钟续期两条路失败后都不再排下一次，
 * 状态是 failed 时打印放行类请求又在发出之前就被闸门拦下（见 awaitReadySessionOrFailClosed），
 * 于是没有任何东西会再去换票。服务器每重启一次（例如每次发布），只要正好撞上某台机器的
 * 开机换票或续期，这台机器就一直打不了，直到有人重开浏览器；而现场没有人。
 *
 * 不放宽的三条：
 *   · 恢复期间 state 一直是 failed。没有会话就不能下单这条不变，闸门照旧立即拦；
 *     也不把屏幕在「校验中 / 没通过」之间每分钟来回翻一次。
 *   · 恢复只走已有的两条路：拿当前会话票续期，或向本机 Agent 要新引导票再换（换票即清场）。
 *     没有新的凭据来源，普通浏览器里（没有桥接令牌、没有会话票）什么都换不到，仍然 failed。
 *   · 每轮只试一次，不在轮内重试；服务器没回来就等下一轮。
 *
 * 一直试下去、不设上限，是有意的：终端被后台停用后又恢复、服务器停了半天又回来，
 * 现场都没有人去重开浏览器。每台机器每分钟至多一次续期或一次取票。
 */
function scheduleRecovery(): void {
  if (API_MODE !== 'http') return
  if (recoveryTimer !== null) window.clearTimeout(recoveryTimer)
  recoveryTimer = window.setTimeout(() => {
    recoveryTimer = null
    void recoverInBackground()
  }, RECOVERY_INTERVAL_MS + Math.floor(Math.random() * RECOVERY_JITTER_MS))
}

function cancelRecovery(): void {
  if (recoveryTimer === null) return
  window.clearTimeout(recoveryTimer)
  recoveryTimer = null
}

async function recoverInBackground(): Promise<void> {
  if (state !== 'failed') return
  // 别的换票正在飞（身份恢复回调重新初始化、按台计请求触发的续期）：让它先出结果，本轮只往后排。
  if (refreshInflight || initInflight) { scheduleRecovery(); return }
  // 与 retryRefresh 共用同一把锁：恢复在飞时别处再要续期，等的是这一次，不会并发出第二个续期请求。
  // 状态此刻是 failed 而不是 checking，所以下单类请求的闸门不会等它（见 awaitReadySessionOrFailClosed）。
  const attempt = recoverOnce().then((recovered) => {
    if (!recovered) throw new ApiHttpError('TERMINAL_SESSION_INVALID', '这台机器的安全校验没通过', 401)
  })
  refreshInflight = attempt.finally(() => { refreshInflight = null })
  try {
    await refreshInflight
  } catch {
    if (state === 'failed') scheduleRecovery()
  }
}

/** 试一次。成功返回 true 并已置为 ready、重排续期。 */
async function recoverOnce(): Promise<boolean> {
  const current = token()
  if (!bootExchangeUnsettled && current && current !== rejectedSessionToken) {
    try {
      await refreshOnce(REQUEST_TIMEOUT_MS)
      setState('ready')
      scheduleRefresh()
      return true
    } catch (error) {
      // 会话票多半还有效，只是服务器还没回来或暂时答不了：等下一轮，别急着换新会话把这一位的材料清掉。
      // 只有服务端明确说这张票作废了，才往下走「要新引导票」那条路。
      if (!sessionInvalid(error)) return false
      rejectedSessionToken = current
    }
  }
  return reBootstrapFromLocalAgent()
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
  // URL 上那张票只有 60 秒、只能用一次，到这里已经指望不上。与续期那条路一样，判死之前
  // 先向本机 Agent 要一张新票；还不行才 failed，之后由后台恢复每分钟再要一次。
  bootExchangeUnsettled = true
  if (await reBootstrapFromLocalAgent()) return
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
 * 「终端安全校验失败，请联系现场工作人员」—— 票其实好好的，只是正在换。让用户去找
 * 工作人员、或者以为自己的到机码作废了，都是这一句话造成的。
 *
 * 边界三条，一条都不放宽：
 *   · 只等「checking 且确有在飞续期」。启动引导（checking 但没有 refreshInflight）
 *     与 failed 仍然立即失败：前者没有可等的结果，后者已经判过死
 *     （failed 之后的后台恢复成功会把状态改回 ready，但本函数不等它）。
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
 * 使用声明在应用启动时注册。本文件不新增 import：终端会话门禁按固定的替身表
 * 编译它，多一个运行时依赖就会让那道门禁无法判定。
 */
let aiDeclarationBridge: AiDeclarationBridge | null = null

export function registerAiDeclarationBridge(bridge: AiDeclarationBridge | null): void {
  aiDeclarationBridge = bridge
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
  // 业务请求 401 只触发一次会话刷新（刷新本身只对网络抖动 / 503 重试）；其它错误原样交给调用方。
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
    return replay ?? response
  }
  const inflight = state === 'checking' ? refreshInflight : null
  if (inflight) {
    try { await inflight } catch { /* 续期失败不拦本次请求，照当前能拿到的票发 */ }
  }
  const response = await fetch(input, { ...init, headers: headers(init.headers) })
  const replay = await replayDeclaration(input, init, response, declarationRetried, sendAgain)
  if (replay) return replay
  if (response.status !== 401) return response
  if (!sessionInvalid(await asHttpError(response.clone()))) return response
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
// 从来没被跑过（缺陷正是长在这段里）。这里只暴露两个动作：发起一次**真实**续期（与定时器
// 调的是同一个 retryRefresh），和读一眼当前状态。它不放宽任何判定 —— 状态仍由真实代码写、
// 票仍由真实代码读发，用例能控制的只是续期应答回来的时机。
export interface TerminalSessionE2EHooks {
  /** 发起一次真实续期，等价于十分钟定时器那一次。 */
  startRefresh: () => void
  /** 只读当前会话状态。 */
  state: () => TerminalSessionState
}

if (HAS_E2E_MOCK_TOKEN) {
  // typeof window 守卫：发码封装（memberAuthApi）也引本模块，node 里打包它的单测没有 window。
  const host = (typeof window === 'undefined' ? {} : window) as unknown as { __terminalSessionE2E?: TerminalSessionE2EHooks }
  host.__terminalSessionE2E = {
    startRefresh: () => { void retryRefresh().catch(() => undefined) },
    state: () => state,
  }
}
