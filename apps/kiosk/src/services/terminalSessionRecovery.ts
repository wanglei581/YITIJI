/**
 * 本机会话判 failed 之后的后台恢复，以及「先压着、不当面清场」。
 *
 * 从 terminalAuth.ts 拆出来：恢复状态机放在这里，换票、续期、清场仍由 terminalAuth 做。
 * 本文件没有运行时 import。装载它的门禁只编译这一份，不需要再准备替身。
 *
 * 「压着」是上一轮的判断，不实时读清单。屏上的内容变了，下一轮（60–75 秒）才跟着变。
 */

export type RecoverySessionState = 'checking' | 'ready' | 'failed'
export type RecoveryClearScope = 'none' | 'print-only' | 'with-other'

export interface RecoveryRuntimeHost {
  apiMode: () => string
  getState: () => RecoverySessionState
  token: () => string | null
  refreshOnce: (timeoutMs: number) => Promise<void>
  reBootstrapFromLocalAgent: () => Promise<boolean>
  scheduleRefresh: () => void
  setReady: () => void
  sessionInvalid: (error: unknown) => boolean
  getRefreshInflight: () => Promise<void> | null
  setRefreshInflight: (next: Promise<void> | null) => void
  getInitInflight: () => Promise<void> | null
  notify: () => void
  invalidError: () => Error
  requestTimeoutMs: number
}

// 判 failed 之后后台每隔这么久再试一次。本机 Agent 的取票口每分钟限 6 次（看门狗与页面共用），一分钟一次不会挤占。
// 另加一段随机量：服务器重启时同一批机器会同时掉进 failed，不错开就会在同一秒一起回来敲门。
const RECOVERY_INTERVAL_MS = 60_000
const RECOVERY_JITTER_MS = 15_000

let host: RecoveryRuntimeHost | null = null
let recoveryTimer: number | null = null
// 这一页是带着引导票打开的，而那张票没换成：此后只许走「向本机 Agent 要新票」那条路恢复。
let bootExchangeUnsettled = false
// 被服务端明确判作废的那张会话票。票本身不删，只是不再拿同一张票去续。重建成功时清空。
let rejectedSessionToken: string | null = null
// 状态是否已经离开过最初那次 checking。只有离开过，才推迟「要新票」的那一步。
let hadSettledState = false
// 压着没恢复：要换新票才能恢复，但这台机器上还有这一位的别的内容。只在 failed 时对外为真。
let recoveryDeferred = false
// 上一次恢复清掉了什么。只能读一次。页面刚打开时的第一次换票不记。
let recoveryClearScope: RecoveryClearScope = 'none'
// 视图变化的通知代次。同一轮里多次变化只通知一次；进入新状态会把还没发出的那次作废。
let recoveryViewEpoch = 0

export function attachRecoveryRuntime(next: RecoveryRuntimeHost): void {
  host = next
}

function runtime(): RecoveryRuntimeHost {
  if (!host) throw new Error('本机会话恢复还没装上')
  return host
}

export function isBootExchangeUnsettled(): boolean {
  return bootExchangeUnsettled
}

export function markBootExchangeUnsettled(): void {
  bootExchangeUnsettled = true
}

/** 新引导票已经换成。旧票不再算作废，也不再禁止拿当前票续期。 */
export function markBootExchangeSettled(): void {
  bootExchangeUnsettled = false
  rejectedSessionToken = null
}

export function hadSettled(): boolean {
  return hadSettledState
}

/** 进入一个新状态。调用方先记这里，再改自己的 state，这样监听者读到的「压着」已经是新的。 */
export function noteStateEntered(next: RecoverySessionState): void {
  recoveryViewEpoch += 1
  if (next === 'ready') recoveryDeferred = false
  if (next !== 'checking') hadSettledState = true
}

function newTicketRequired(): boolean {
  const current = runtime().token()
  return bootExchangeUnsettled || !current || current === rejectedSessionToken
}

/**
 * 只读视图变了、状态没变时，用现在的状态再通知一遍。
 * 同一轮同步改动合并成一次；紧接着进入新状态会作废这次，避免重复通知。
 */
function touchRecoveryView(mutate: () => void): void {
  const api = runtime()
  const beforeDeferred = api.getState() === 'failed' && recoveryDeferred
  const beforeNeeds = api.getState() === 'failed' && newTicketRequired()
  const beforeScope = recoveryClearScope
  mutate()
  if (
    (api.getState() === 'failed' && recoveryDeferred) === beforeDeferred
    && (api.getState() === 'failed' && newTicketRequired()) === beforeNeeds
    && recoveryClearScope === beforeScope
  ) return
  const epoch = ++recoveryViewEpoch
  queueMicrotask(() => {
    if (epoch !== recoveryViewEpoch) return
    runtime().notify()
  })
}

/** 只记收到作废的那一张，而且它还是当前票才记。空转的初始错误传 null，不算。 */
export function noteRejectedToken(invalidToken: string | null): void {
  if (!invalidToken || runtime().token() !== invalidToken) return
  const rejected = invalidToken
  touchRecoveryView(() => { rejectedSessionToken = rejected })
}

// 原票只是暂时续不上时停住但不标：下一轮先拿原票续，续上不清场。
export function holdRecoveryForOtherContent(): void {
  if (!newTicketRequired()) return
  touchRecoveryView(() => { recoveryDeferred = true })
}

export function dropRecoveryHold(): void {
  touchRecoveryView(() => { recoveryDeferred = false })
}

/** 清掉了什么以换票那一刻、清场之前的判断为准。页面刚打开那一次（hadSettledState 为假）不记。 */
export function rememberRecoveryClearScope(hadSettledState: boolean, clearedScope: RecoveryClearScope): void {
  if (hadSettledState) recoveryClearScope = clearedScope
}

export function terminalSessionRecoveryDeferred(): boolean {
  return runtime().getState() === 'failed' && recoveryDeferred
}

export function terminalSessionRecoveryNeedsNewTicket(): boolean {
  return runtime().getState() === 'failed' && newTicketRequired()
}

/** 上一次恢复清掉了什么。只能读一次：读完自己复位成 'none'。不参与任何放行判断。 */
export function takeTerminalSessionRecoveryClearScope(): RecoveryClearScope {
  const scope = recoveryClearScope
  recoveryClearScope = 'none'
  return scope
}

/**
 * failed 之后的后台恢复。每轮只试一次。要新票时如果还有这一位的别的内容，这一轮不取票、不换票。
 * 自己不改状态：在飞时仍是 failed，下单闸门照旧立即拦。
 */
export function scheduleRecovery(): void {
  const api = runtime()
  if (api.apiMode() !== 'http') return
  if (recoveryTimer !== null) window.clearTimeout(recoveryTimer)
  recoveryTimer = window.setTimeout(() => {
    recoveryTimer = null
    void recoverInBackground()
  }, RECOVERY_INTERVAL_MS + Math.floor(Math.random() * RECOVERY_JITTER_MS))
}

export function cancelRecovery(): void {
  if (recoveryTimer === null) return
  window.clearTimeout(recoveryTimer)
  recoveryTimer = null
}

async function recoverInBackground(): Promise<void> {
  const api = runtime()
  if (api.getState() !== 'failed') return
  // 别的换票正在飞：让它先出结果，本轮只往后排。
  if (api.getRefreshInflight() || api.getInitInflight()) { scheduleRecovery(); return }
  // 与续期共用同一把锁，避免并发出第二个续期请求。状态仍是 failed，下单闸门不等这一次。
  const attempt = recoverOnce().then((recovered) => {
    if (!recovered) throw api.invalidError()
  })
  api.setRefreshInflight(attempt.finally(() => { api.setRefreshInflight(null) }))
  try {
    await api.getRefreshInflight()
  } catch {
    if (api.getState() === 'failed') scheduleRecovery()
  }
}

/** 试一次。成功返回 true 并已置为 ready、重排续期。 */
async function recoverOnce(): Promise<boolean> {
  const api = runtime()
  const sessionInvalid = api.sessionInvalid
  const current = api.token()
  if (!bootExchangeUnsettled && current && current !== rejectedSessionToken) {
    try {
      await api.refreshOnce(api.requestTimeoutMs)
      api.setReady()
      api.scheduleRefresh()
      return true
    } catch (error) {
      // 会话票多半还有效，只是服务器还没回来：等下一轮，别急着换新会话把这一位的材料清掉。
      // 只有服务端明确说这张票作废了，才往下走「要新引导票」那条路。
      if (!sessionInvalid(error)) return false
      touchRecoveryView(() => { rejectedSessionToken = current })
    }
  }
  return api.reBootstrapFromLocalAgent()
}

/** 只在带了模拟会话票的构建里调用。不改会话状态、不发请求。 */
export function applyE2ERecoveryView(view: {
  deferred?: boolean
  needsNewTicket?: boolean
  clearScope?: RecoveryClearScope
}): void {
  const api = runtime()
  if (view.deferred !== undefined) recoveryDeferred = view.deferred
  if (view.needsNewTicket !== undefined) {
    // 为真：把当前票记进作废票。为假：移出。没有票或带引导票没换成时，读值仍由那两条决定。
    rejectedSessionToken = view.needsNewTicket ? api.token() : null
  }
  if (view.clearScope !== undefined) recoveryClearScope = view.clearScope
  recoveryViewEpoch += 1
  api.notify()
}
