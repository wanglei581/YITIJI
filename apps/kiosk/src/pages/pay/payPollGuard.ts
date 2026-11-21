// ============================================================
// 付款屏四条查单/核实路径共用的纯节流与退避状态机（零运行时外部依赖，便于单测）：
//   1. 常规轮询（pollOnce(false)）
//   2. 手动「刷新付款结果」（pollOnce(true)）
//   3. 到点自动核实（expiredLocally effect）
//   4. lookup / close_failed 的「再查一次」（onRetry）
//
// 统一守三条线：
//   · 60 秒窗口总 GET 封顶 PAY_GET_CAP_PER_MINUTE（28 次，留在服务端每台每分钟 30 次以内）；
//   · 相邻 refresh=1 核实间隔 ≥ PAY_REFRESH_GAP_MS（10 秒）；
//   · 遇到 429 / RATE_LIMITED / RECONCILE_TOO_FREQUENT 按 Retry-After 或 10s→60s 指数退避。
// ============================================================

export const PAY_POLL_MS = 3_000
export const PAY_REFRESH_GAP_MS = 10_000
export const PAY_AUTO_REFRESH_GAP_MS = 15_000
export const PAY_GET_CAP_PER_MINUTE = 28
export const PAY_GET_WINDOW_MS = 60_000
export const PAY_429_BACKOFF_BASE_MS = 10_000
export const PAY_429_BACKOFF_MAX_MS = 60_000
/** 稿：付款成功在屏上停 1.6 秒再进入下一步。 */
export const PAY_OK_ADVANCE_MS = 1_600

export interface PayPollGuardState {
  getLog: number[]
  /** 最近一次实际发出 refresh=1 核实的时刻；null 表示尚未发过 refresh=1。 */
  lastRefreshAt: number | null
  /** 当前单建单/载入时刻：用于约束常规与手动刷新在刚建单 10 秒内不带 refresh=1。 */
  orderAnchorAt: number | null
  rateLimitHits: number
  backoffUntil: number
}

export type PollPlan =
  | { allowed: false; reason: 'backoff' | 'cap'; waitMs: number; nextDelayMs: number }
  | { allowed: true; refresh: boolean }

export type RefreshOnlyPlan =
  | { allowed: false; reason: 'backoff' | 'refresh_gap' | 'cap'; waitMs: number }
  | { allowed: true }

export function createPayPollGuardState(): PayPollGuardState {
  return {
    getLog: [],
    lastRefreshAt: null,
    orderAnchorAt: null,
    rateLimitHits: 0,
    backoffUntil: 0,
  }
}

export function isRateLimitedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { status?: unknown; code?: unknown }
  if (record.status === 429) return true
  return record.code === 'RATE_LIMITED' || record.code === 'RECONCILE_TOO_FREQUENT'
}

export function retryAfterMsOfError(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('retryAfterMs' in error)) return null
  const value = (error as { retryAfterMs?: unknown }).retryAfterMs
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function pruneGetLog(state: PayPollGuardState, nowMs: number): number[] {
  const pruned = state.getLog.filter((at) => nowMs - at < PAY_GET_WINDOW_MS)
  state.getLog = pruned
  return pruned
}

function backoffWaitMs(state: PayPollGuardState, nowMs: number): number {
  return state.backoffUntil > nowMs ? state.backoffUntil - nowMs : 0
}

function capWaitMs(state: PayPollGuardState, nowMs: number): number {
  const log = pruneGetLog(state, nowMs)
  if (log.length < PAY_GET_CAP_PER_MINUTE) return 0
  const oldest = log[0] ?? nowMs
  return Math.max(1, oldest + PAY_GET_WINDOW_MS - nowMs)
}

export function noteOrderAnchor(state: PayPollGuardState, nowMs: number): void {
  state.orderAnchorAt = nowMs
}

export function initialPollDelayMs(state: PayPollGuardState, nowMs: number): number {
  const bWait = backoffWaitMs(state, nowMs)
  return bWait > 0 ? Math.max(PAY_POLL_MS, bWait) : PAY_POLL_MS
}

/** 路径 1 & 2：常规轮询与手动「刷新付款结果」的统一门禁与 refresh=1 判定。 */
export function planPollRequest(
  state: PayPollGuardState,
  nowMs: number,
  options: { manual: boolean; provider: string | null | undefined; postExpiryChecking: boolean },
): PollPlan {
  const bWait = backoffWaitMs(state, nowMs)
  if (bWait > 0) {
    return { allowed: false, reason: 'backoff', waitMs: bWait, nextDelayMs: Math.max(PAY_POLL_MS, bWait) }
  }
  const cWait = capWaitMs(state, nowMs)
  if (cWait > 0) {
    return { allowed: false, reason: 'cap', waitMs: cWait, nextDelayMs: Math.max(PAY_POLL_MS, cWait) }
  }
  const anchor = state.lastRefreshAt !== null && state.orderAnchorAt !== null
    ? Math.max(state.lastRefreshAt, state.orderAnchorAt)
    : (state.lastRefreshAt ?? state.orderAnchorAt)
  const sinceRefresh = anchor !== null ? nowMs - anchor : Number.POSITIVE_INFINITY
  const refresh = options.manual
    ? sinceRefresh >= PAY_REFRESH_GAP_MS
    : options.postExpiryChecking
      ? sinceRefresh >= PAY_REFRESH_GAP_MS
      : options.provider !== 'sandbox' && sinceRefresh >= PAY_AUTO_REFRESH_GAP_MS
  return { allowed: true, refresh }
}

/** 路径 3 & 4：到点自动核实与 lookup / close_failed 「再查一次」的统一 refresh=1 门禁。 */
export function planRefreshOnlyRequest(state: PayPollGuardState, nowMs: number): RefreshOnlyPlan {
  const bWait = backoffWaitMs(state, nowMs)
  const rWait = state.lastRefreshAt !== null ? Math.max(0, state.lastRefreshAt + PAY_REFRESH_GAP_MS - nowMs) : 0
  const cWait = capWaitMs(state, nowMs)
  const waitMs = Math.max(bWait, rWait, cWait)
  if (waitMs > 0) {
    const reason = bWait > 0 ? 'backoff' : cWait > 0 ? 'cap' : 'refresh_gap'
    return { allowed: false, reason, waitMs }
  }
  return { allowed: true }
}

export function recordGetRequest(state: PayPollGuardState, nowMs: number, refresh: boolean): void {
  const log = pruneGetLog(state, nowMs)
  log.push(nowMs)
  if (refresh) state.lastRefreshAt = nowMs
}

export function recordGetSuccess(state: PayPollGuardState): void {
  state.rateLimitHits = 0
  state.backoffUntil = 0
}

/** 四条路径共用的 429 / 频率受限退避记账，尊重服务端 Retry-After，返回本次退避毫秒数。 */
export function recordRateLimit(state: PayPollGuardState, error: unknown, nowMs: number): number {
  state.rateLimitHits += 1
  const headerMs = retryAfterMsOfError(error)
  const delayMs = headerMs !== null
    ? Math.min(PAY_429_BACKOFF_MAX_MS, Math.max(PAY_POLL_MS, headerMs))
    : Math.min(PAY_429_BACKOFF_MAX_MS, PAY_429_BACKOFF_BASE_MS * (2 ** (state.rateLimitHits - 1)))
  state.backoffUntil = nowMs + delayMs
  return delayMs
}
