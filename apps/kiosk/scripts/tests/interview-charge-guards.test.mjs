/**
 * 模拟面试按次付款前台守卫单测（P2e-3b）：
 * 直接转译执行真实 src/pages/interview/useInterviewCharge.ts、
 * src/pages/interview/session/useInterviewReportCharge.ts、
 * src/services/api/serviceOrders.ts 与 src/services/serviceTrip.ts，覆盖：
 *   - C1（②）：价目未就绪（priceReady=false）与初始查单未就绪（tripResolved=false）期间禁用且不删旧单、不导航付款屏；
 *   - C2（③）：handleStartError 跨用户切换与清场代次守卫，旧用户晚到响应一律丢弃、绝不覆盖新用户 paidTrip；
 *   - C3（④ iv-3）：iv-3 免费再试窗 retryUntil 精准到期自动撤掉「免费再试一次」切回收费入口，卸载清定时器；
 *   - C4（④+⑤ iv-run）：iv-run 免费再试窗 retryUntil 精准到期立即撤按钮、锁定报告入口并触发查单轮询展示真实退款态；
 *   - C5（⑤ iv-run）：refunding / refunded / refund_failed 及 409 SERVICE_RETRY_EXPIRED / SERVICE_ORDER_REFUNDED 均锁定报告入口；
 *   - C8（P2e-3c）：paidReportLocked=true 时到点自动封场保留停录音/停播报与封场屏，但严格拦截自动 requestReport / endInterviewAtDeadline。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (rel) => ts.transpileModule(readFileSync(join(kioskRoot, rel), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: rel,
}).outputText

const serviceOrdersUrl = toDataUrl(
  transpile('src/services/api/serviceOrders.ts')
    .replaceAll("from '../terminalAuth'", `from '${toDataUrl('export async function terminalProtectedFetch() { throw new Error("unused") }')}'`)
    .replaceAll("from './client'", `from '${toDataUrl('export const API_BASE_URL = "/api/v1"; export const API_MODE = "http"')}'`)
    .replaceAll("from './httpAdapter'", `from '${toDataUrl('export class ApiHttpError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status } }')}'`)
    .replaceAll("from './throwHttpError'", `from '${toDataUrl('export function networkError(e) { return e }; export async function readHttpError() { return { code: "ERR", message: "err" } }')}'`),
)

const payModelUrl = toDataUrl(
  transpile('src/pages/pay/payServiceModel.ts')
    .replaceAll("from '../../copy/unattendedCopy'", `from '${toDataUrl('export const helpNeededLine = () => "需要帮助？拨打服务电话"')}'`)
    .replaceAll("from '../../services/api/userErrorMessage'", `from '${toDataUrl('export const errorCodeOf = (e) => e?.code; export const userMessageOf = (_e, f) => f')}'`),
)

function makeDeferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function makeOrderView(overrides = {}) {
  return {
    id: 'ord-iv-1',
    serviceKey: 'mock_interview',
    serviceName: 'AI 模拟面试',
    status: 'paid',
    amountCents: 100,
    expiresAt: new Date(300_000).toISOString(),
    qrCodeContent: null,
    paidAt: new Date(1_000).toISOString(),
    refundReason: null,
    refundedAt: null,
    failureReason: null,
    retryUntil: null,
    attemptsUsed: 0,
    settledAt: null,
    closeReason: null,
    paymentFailed: false,
    checking: false,
    consumedAt: null,
    provider: 'sandbox',
    ...overrides,
  }
}

function createFakeRuntime(startNow = 1_000_000) {
  let now = startNow
  let nextTimerId = 1
  const timers = new Map()
  const storage = new Map()
  const prevWin = globalThis.window
  const prevDateNow = Date.now

  Date.now = () => now
  globalThis.window = {
    setTimeout(fn, ms = 0) {
      const id = nextTimerId++
      timers.set(id, { id, fn, at: now + Math.max(0, Number(ms) || 0), interval: null })
      return id
    },
    clearTimeout(id) { timers.delete(id) },
    setInterval(fn, ms = 0) {
      const id = nextTimerId++
      const period = Math.max(1, Number(ms) || 1)
      timers.set(id, { id, fn, at: now + period, interval: period })
      return id
    },
    clearInterval(id) { timers.delete(id) },
    sessionStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(String(k), String(v)) },
      removeItem: (k) => { storage.delete(k) },
    },
  }

  let cursor = 0
  const slots = []
  const pendingEffects = []
  const cleanups = new Map()
  let rendering = false
  let dirty = false
  let unmounted = false
  let runHook = () => null
  let latest = null

  function depsChanged(prev, next) {
    if (!prev || !next) return true
    if (prev.length !== next.length) return true
    for (let i = 0; i < prev.length; i += 1) if (!Object.is(prev[i], next[i])) return true
    return false
  }

  const react = {
    useState(init) {
      const idx = cursor++
      if (slots[idx] === undefined) slots[idx] = typeof init === 'function' ? init() : init
      const setState = (val) => {
        const next = typeof val === 'function' ? val(slots[idx]) : val
        if (!Object.is(next, slots[idx])) {
          slots[idx] = next
          scheduleRender()
        }
      }
      return [slots[idx], setState]
    },
    useRef(init) {
      const idx = cursor++
      if (slots[idx] === undefined) slots[idx] = { current: init }
      return slots[idx]
    },
    useCallback(fn, deps) {
      const idx = cursor++
      if (!slots[idx] || depsChanged(slots[idx].deps, deps)) slots[idx] = { fn, deps }
      return slots[idx].fn
    },
    useEffect(fn, deps) {
      const idx = cursor++
      if (!slots[idx] || depsChanged(slots[idx].deps, deps)) {
        slots[idx] = { deps }
        pendingEffects.push({ idx, fn })
      }
    },
  }

  function render() {
    if (unmounted) return
    if (rendering) { dirty = true; return }
    rendering = true
    do {
      dirty = false
      cursor = 0
      latest = runHook()
      while (pendingEffects.length > 0) {
        const eff = pendingEffects.shift()
        const oldCleanup = cleanups.get(eff.idx)
        if (typeof oldCleanup === 'function') oldCleanup()
        const cleanup = eff.fn()
        if (typeof cleanup === 'function') cleanups.set(eff.idx, cleanup)
        else cleanups.delete(eff.idx)
      }
    } while (dirty && !unmounted)
    rendering = false
  }

  function scheduleRender() {
    if (!rendering) render()
    else dirty = true
  }

  async function flushMicrotasks() {
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve()
      if (dirty) render()
    }
  }

  async function advance(ms) {
    const target = now + ms
    while (true) {
      let next = null
      for (const t of timers.values()) {
        if (t.at <= target && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t
      }
      if (!next) break
      now = next.at
      if (next.interval !== null) next.at = now + next.interval
      else timers.delete(next.id)
      next.fn()
      await flushMicrotasks()
    }
    now = target
    await flushMicrotasks()
  }

  function unmount() {
    unmounted = true
    for (const cleanup of cleanups.values()) if (typeof cleanup === 'function') cleanup()
    cleanups.clear()
  }

  function destroy() {
    unmount()
    timers.clear()
    Date.now = prevDateNow
    if (prevWin === undefined) delete globalThis.window
    else globalThis.window = prevWin
  }

  return {
    react,
    storage,
    setRunner(fn) { runHook = fn },
    get now() { return now },
    get activeTimerCount() { return timers.size },
    get latest() { return latest },
    render,
    flushMicrotasks,
    advance,
    unmount,
    destroy,
  }
}

async function mountSetupCharge(options) {
  const rt = createFakeRuntime()
  const nav = []
  const errors = []
  const autoStarts = []
  const beforePay = []
  let age14Calls = 0
  let currentProps = {
    step: 3,
    creating: false,
    controlMode: 'start',
    aiOutage: null,
    hasPendingSession: false,
    autoStartAfterPay: false,
    endUserId: null,
    ...options.props,
  }

  const serviceTripUrl = toDataUrl(`${transpile('src/services/serviceTrip.ts')}\n// ${Math.random()}`)
  const serviceTripMod = await import(serviceTripUrl)
  if (options.seedTrips) options.seedTrips(serviceTripMod)

  const envKey = `__P2E3B_SETUP_${Math.random().toString(36).slice(2)}`
  globalThis[envKey] = {
    react: rt.react,
    peekConfig: () => (options.peekConfig ? options.peekConfig() : null),
    getConfig: (tid) => (options.getConfig ? options.getConfig(tid) : Promise.resolve({ pricing: { effective: { mock_interview: 100 } } })),
    refreshConfig: (tid) => (options.refreshConfig ? options.refreshConfig(tid) : Promise.resolve({ pricing: { effective: { mock_interview: 100 } } })),
    getServiceOrder: (orderId, ks) => options.getServiceOrder(orderId, ks),
    ensureAge14: async () => { age14Calls += 1; if (options.ensureAge14) return options.ensureAge14() },
  }

  const hookSrc = transpile('src/pages/interview/useInterviewCharge.ts')
    .replaceAll("from 'react'", `from '${toDataUrl(`const r = globalThis.${envKey}.react; export const { useCallback, useEffect, useRef, useState } = r;`)}'`)
    .replaceAll("from '../../ai/aiDeclarationErrors'", `from '${toDataUrl('export const aiDeclarationDeclineMessage = () => null')}'`)
    .replaceAll("from '../../ai/aiDeclarationGate'", `from '${toDataUrl(`export const ensureAge14DeclaredForPay = (...a) => globalThis.${envKey}.ensureAge14(...a)`)}'`)
    .replaceAll("from '../../copy/unattendedCopy'", `from '${toDataUrl('export const helpNeededLine = () => "需要帮助？拨打服务电话"')}'`)
    .replaceAll("from '../../services/api/client'", `from '${toDataUrl('export const API_MODE = "http"')}'`)
    .replaceAll("from '../../services/api/interview'", `from '${toDataUrl('export class InterviewApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status } }')}'`)
    .replaceAll("from '../../services/api/serviceOrders'", `from '${toDataUrl(`export { serviceOrderHeaders, serviceOrderPhase } from '${serviceOrdersUrl}'; export const getServiceOrder = (...a) => globalThis.${envKey}.getServiceOrder(...a);`)}'`)
    .replaceAll("from '../../services/api/terminalConfig'", `from '${toDataUrl(`export const getTerminalId = () => "term-1"; export const peekCachedKioskTerminalConfig = () => globalThis.${envKey}.peekConfig(); export const getCachedKioskTerminalConfig = (...a) => globalThis.${envKey}.getConfig(...a); export const refreshKioskTerminalConfig = (...a) => globalThis.${envKey}.refreshConfig(...a);`)}'`)
    .replaceAll("from '../../services/api/userErrorMessage'", `from '${toDataUrl('export const errorCodeOf = (e) => (e && typeof e === "object" ? e.code : undefined); export const userMessageOf = (e, f) => (e && typeof e === "object" && e.message) || f')}'`)
    .replaceAll("from '../../services/serviceTrip'", `from '${serviceTripUrl}'`)
    .replaceAll("from '../pay/payServiceModel'", `from '${payModelUrl}'`)

  const { useInterviewCharge } = await import(toDataUrl(`${hookSrc}\n// ${envKey}`))
  rt.setRunner(() => useInterviewCharge({
    ...currentProps,
    getToken: () => null,
    navigate: (to) => nav.push(to),
    validateBasics: () => null,
    setError: (m) => errors.push(m),
    onBeforeNavigatePay: (auto) => beforePay.push(auto),
    onClearAutoStart: () => { currentProps = { ...currentProps, autoStartAfterPay: false } },
    onAutoStart: (trip) => autoStarts.push(trip),
  }))

  rt.render()
  await rt.flushMicrotasks()

  return {
    get state() { return rt.latest },
    get now() { return rt.now },
    get activeTimerCount() { return rt.activeTimerCount },
    get age14Calls() { return age14Calls },
    nav,
    errors,
    autoStarts,
    beforePay,
    serviceTripMod,
    rerender(patch) {
      currentProps = { ...currentProps, ...patch }
      rt.render()
    },
    flushMicrotasks: rt.flushMicrotasks,
    advance: rt.advance,
    unmount: rt.unmount,
    destroy() {
      rt.destroy()
      delete globalThis[envKey]
    },
  }
}

async function mountReportCharge(options) {
  const rt = createFakeRuntime()
  const serviceTripUrl = toDataUrl(`${transpile('src/services/serviceTrip.ts')}\n// ${Math.random()}`)
  const serviceTripMod = await import(serviceTripUrl)
  if (options.seedTrips) options.seedTrips(serviceTripMod)

  const getCalls = []
  const envKey = `__P2E3B_REPORT_${Math.random().toString(36).slice(2)}`
  globalThis[envKey] = {
    react: rt.react,
    getServiceOrder: async (orderId, ks) => {
      getCalls.push({ orderId, ks, at: rt.now })
      return options.getServiceOrder(orderId, ks, getCalls.length)
    },
  }

  const hookSrc = transpile('src/pages/interview/session/useInterviewReportCharge.ts')
    .replaceAll("from 'react'", `from '${toDataUrl(`const r = globalThis.${envKey}.react; export const { useCallback, useEffect, useRef, useState } = r;`)}'`)
    .replaceAll("from '../../../copy/unattendedCopy'", `from '${toDataUrl('export const helpNeededLine = () => "需要帮助？拨打服务电话"')}'`)
    .replaceAll("from '../../../services/api/client'", `from '${toDataUrl('export const API_MODE = "http"')}'`)
    .replaceAll("from '../../../services/api/serviceOrders'", `from '${toDataUrl(`export const getServiceOrder = (...a) => globalThis.${envKey}.getServiceOrder(...a);`)}'`)
    .replaceAll("from '../../../services/api/screensaver'", `from '${toDataUrl('export const getTerminalId = () => "term-1"')}'`)
    .replaceAll("from '../../../services/api/userErrorMessage'", `from '${toDataUrl('export const errorCodeOf = (e) => (e && typeof e === "object" ? e.code : undefined); export const userMessageOf = (e, f) => (e && typeof e === "object" && e.message) || f')}'`)
    .replaceAll("from '../../../services/serviceTrip'", `from '${serviceTripUrl}'`)
    .replaceAll("from '../../pay/payServiceModel'", `from '${payModelUrl}'`)

  const { useInterviewReportCharge } = await import(toDataUrl(`${hookSrc}\n// ${envKey}`))
  rt.setRunner(() => useInterviewReportCharge({
    sessionId: options.sessionId ?? 'iv-sess-1',
    storedLive: options.storedLive,
    endUserId: options.endUserId ?? null,
  }))

  rt.render()
  await rt.flushMicrotasks()

  return {
    get state() { return rt.latest },
    get now() { return rt.now },
    get activeTimerCount() { return rt.activeTimerCount },
    getCalls,
    serviceTripMod,
    flushMicrotasks: rt.flushMicrotasks,
    advance: rt.advance,
    unmount: rt.unmount,
    destroy() {
      rt.destroy()
      delete globalThis[envKey]
    },
  }
}

test('C1(②): 初始查单与价目未就绪前主按钮禁用且文案「正在确认费用」，startPay 早退且绝不删旧单或跳转付款屏', async () => {
  // 1a. 已有旧单但 getServiceOrder 尚未返回（tripResolved=false）
  const lookupDeferred = makeDeferred()
  const h1 = await mountSetupCharge({
    peekConfig: () => ({ pricing: { effective: { mock_interview: 100 } } }),
    getConfig: () => Promise.resolve({ pricing: { effective: { mock_interview: 100 } } }),
    getServiceOrder: () => lookupDeferred.promise,
    seedTrips: (st) => {
      st.rememberServiceTrip({ serviceKey: 'mock_interview', orderId: 'ORD-KEEP', kioskSessionId: 'KS-1' })
    },
  })
  try {
    assert.equal(h1.state.priceReady, true)
    assert.equal(h1.state.tripResolved, false, '查单未返回前 tripResolved 必须为 false')
    assert.equal(h1.state.chargeReady, false)
    assert.equal(h1.state.checkingPay, true, '查单未就绪期间主按钮必须置灰禁用')
    assert.equal(h1.state.needsPay, false)
    assert.equal(h1.state.primaryLabel('创建并开始练习'), '正在确认费用')

    await h1.state.startPay()
    assert.equal(h1.nav.length, 0, 'tripResolved=false 时绝不能导航 /pay/interview')
    assert.equal(h1.age14Calls, 0, 'tripResolved=false 时绝不能弹 14 岁确认')
    assert.equal(
      h1.serviceTripMod.readServiceTrip('mock_interview')?.orderId,
      'ORD-KEEP',
      'tripResolved=false 时绝不能 forgetServiceTrip 删掉旧单',
    )

    lookupDeferred.resolve(makeOrderView({ id: 'ORD-KEEP', status: 'paid', attemptsUsed: 0 }))
    await h1.flushMicrotasks()
    assert.equal(h1.state.tripResolved, true)
    assert.equal(h1.state.chargeReady, true)
    assert.equal(h1.state.checkingPay, false)
    assert.equal(h1.state.paidTrip?.orderId, 'ORD-KEEP')
  } finally {
    h1.destroy()
  }

  // 1b. 价目缓存冷启动未返回（priceReady=false）
  const priceDeferred = makeDeferred()
  const h2 = await mountSetupCharge({
    peekConfig: () => null,
    getConfig: () => priceDeferred.promise,
    getServiceOrder: () => Promise.resolve(makeOrderView()),
  })
  try {
    assert.equal(h2.state.priceReady, false, '价目未就绪前 priceReady 必须为 false')
    assert.equal(h2.state.chargeReady, false)
    assert.equal(h2.state.checkingPay, true, '价目未就绪期间主按钮必须置灰禁用')
    assert.equal(h2.state.primaryLabel('创建并开始练习'), '正在确认费用')
    await h2.state.startPay()
    assert.equal(h2.nav.length, 0, 'priceReady=false 时绝不能导航付款屏')
    assert.equal(h2.age14Calls, 0)

    priceDeferred.resolve({ pricing: { effective: { mock_interview: 100 } } })
    await h2.flushMicrotasks()
    assert.equal(h2.state.priceReady, true)
    assert.equal(h2.state.chargeReady, true)
    assert.equal(h2.state.checkingPay, false)
    assert.equal(h2.state.needsPay, true)
    assert.equal(h2.state.primaryLabel('创建并开始练习'), '付 1.00 元开始练')
  } finally {
    h2.destroy()
  }
})

test('C2(③): handleStartError 跨用户切换与清场代次守卫拦截晚到响应，绝不覆盖新用户 paidTrip', async () => {
  const lateOrderA = makeDeferred()
  let orderBView = makeOrderView({ id: 'ORD-B', status: 'paid', attemptsUsed: 0 })
  let initialResolvedA = false

  const h = await mountSetupCharge({
    props: { endUserId: 'user-A' },
    peekConfig: () => ({ pricing: { effective: { mock_interview: 100 } } }),
    getConfig: () => Promise.resolve({ pricing: { effective: { mock_interview: 100 } } }),
    seedTrips: (st) => {
      st.rememberServiceTrip({
        serviceKey: 'mock_interview',
        orderId: 'ORD-A',
        kioskSessionId: 'KS-A',
        owner: st.serviceTripOwnerFor('user-A'),
      })
    },
    getServiceOrder: (orderId) => {
      if (orderId === 'ORD-A') {
        if (!initialResolvedA) {
          initialResolvedA = true
          return Promise.resolve(makeOrderView({ id: 'ORD-A', status: 'paid', attemptsUsed: 0 }))
        }
        return lateOrderA.promise
      }
      return Promise.resolve(orderBView)
    },
  })

  try {
    assert.equal(h.state.paidTrip?.orderId, 'ORD-A')
    const handleStartErrorA = h.state.handleStartError
    const tripA = { orderId: 'ORD-A', kioskSessionId: 'KS-A', headers: { 'x-kiosk-session-id': 'KS-A', 'x-service-order-id': 'ORD-A' } }

    // 旧用户触发 handleStartError，异步查单在途
    const pendingCallbackA = handleStartErrorA(new Error('LLM_GENERATION_FAILED'), tripA)

    // 切换到新用户 user-B 并种下 user-B 的已付单 ORD-B
    h.serviceTripMod.rememberServiceTrip({
      serviceKey: 'mock_interview',
      orderId: 'ORD-B',
      kioskSessionId: 'KS-B',
      owner: h.serviceTripMod.serviceTripOwnerFor('user-B'),
    })
    h.rerender({ endUserId: 'user-B' })
    await h.flushMicrotasks()
    assert.equal(h.state.paidTrip?.orderId, 'ORD-B', '新用户必须解析到自己的 ORD-B')

    // 旧用户 user-A 的查单此时晚到（返回 retry_free）→ 必须整包丢弃，绝不覆盖 ORD-B
    lateOrderA.resolve(makeOrderView({
      id: 'ORD-A',
      status: 'paid',
      attemptsUsed: 1,
      retryUntil: new Date(h.now + 60_000).toISOString(),
    }))
    await pendingCallbackA
    await h.flushMicrotasks()
    assert.equal(h.state.paidTrip?.orderId, 'ORD-B', '旧用户晚到响应绝不能覆盖新用户的 paidTrip')
    assert.equal(h.state.isRetryFree, false)
    assert.equal(h.nav.length, 0)

    // 旧用户闭包再撞 402 → 代次过期直接丢弃，绝不删新单也不跳转付款屏
    await handleStartErrorA({ status: 402, code: 'SERVICE_PAYMENT_REQUIRED' }, tripA)
    await h.flushMicrotasks()
    assert.equal(h.nav.length, 0, '旧用户 402 回调不得触发导航')
    assert.equal(h.state.paidTrip?.orderId, 'ORD-B')

    // 清场事件广播后，即使同用户正在途中的 handleStartError 查单也不能回写 paidTrip
    const handleStartErrorB = h.state.handleStartError
    const tripB = { orderId: 'ORD-B', kioskSessionId: 'KS-B', headers: { 'x-kiosk-session-id': 'KS-B', 'x-service-order-id': 'ORD-B' } }
    const clearDeferred = makeDeferred()
    orderBView = clearDeferred.promise
    const pendingCallbackB = handleStartErrorB(new Error('LLM_GENERATION_FAILED'), tripB)
    h.serviceTripMod.clearServiceTrips('clear')
    await h.flushMicrotasks()
    assert.equal(h.state.paidTrip, null, '清场后必须清空当前 paidTrip')
    clearDeferred.resolve(makeOrderView({
      id: 'ORD-B',
      status: 'paid',
      attemptsUsed: 1,
      retryUntil: new Date(h.now + 60_000).toISOString(),
    }))
    await pendingCallbackB
    await h.flushMicrotasks()
    assert.equal(h.state.paidTrip, null, '清场后在途查单晚到绝不能复活 paidTrip')
    assert.equal(h.state.isRetryFree, false)
  } finally {
    h.destroy()
  }
})

test('C3(④ iv-3): 免费再试窗跨过 retryUntil 瞬间立即撤掉「免费再试一次」切回收费入口，卸载清定时器', async () => {
  const retryView = makeOrderView({
    id: 'ORD-RETRY-IV3',
    status: 'paid',
    attemptsUsed: 1,
    failureReason: '面试没开起来',
    retryUntil: new Date(1_010_000).toISOString(),
  })
  const h = await mountSetupCharge({
    peekConfig: () => ({ pricing: { effective: { mock_interview: 100 } } }),
    getConfig: () => Promise.resolve({ pricing: { effective: { mock_interview: 100 } } }),
    getServiceOrder: () => Promise.resolve(retryView),
    seedTrips: (st) => {
      st.rememberServiceTrip({ serviceKey: 'mock_interview', orderId: 'ORD-RETRY-IV3', kioskSessionId: 'KS-R3' })
    },
  })
  try {
    assert.equal(h.state.isRetryFree, true)
    assert.equal(h.state.paidTrip?.orderId, 'ORD-RETRY-IV3')
    assert.equal(h.state.needsPay, false)
    assert.equal(h.state.showChargeBar, false)
    assert.equal(h.state.primaryLabel('创建并开始练习'), '免费再试一次')

    await h.advance(9_999)
    assert.equal(h.state.isRetryFree, true, '到期前 1ms 仍应允许免费再试')

    await h.advance(1)
    assert.equal(h.state.isRetryFree, false, '跨过 retryUntil 瞬间必须立即撤掉免费再试')
    assert.equal(h.state.paidTrip, null)
    assert.equal(h.state.needsPay, true, '到期后必须切回收费入口')
    assert.equal(h.state.showChargeBar, true)
    assert.equal(h.state.primaryLabel('创建并开始练习'), '付 1.00 元开始练')
  } finally {
    h.destroy()
  }

  // 卸载清理定时器检查
  const hCleanup = await mountSetupCharge({
    peekConfig: () => ({ pricing: { effective: { mock_interview: 100 } } }),
    getConfig: () => Promise.resolve({ pricing: { effective: { mock_interview: 100 } } }),
    getServiceOrder: () => Promise.resolve(retryView),
    seedTrips: (st) => {
      st.rememberServiceTrip({ serviceKey: 'mock_interview', orderId: 'ORD-RETRY-IV3', kioskSessionId: 'KS-R3' })
    },
  })
  try {
    assert.ok(hCleanup.activeTimerCount > 0, '有效再试窗必须安装精准到期定时器')
    hCleanup.unmount()
    assert.equal(hCleanup.activeTimerCount, 0, '卸载后必须清理再试到期定时器')
  } finally {
    hCleanup.destroy()
  }
})

test('C4(④+⑤ iv-run): retryUntil 精准到期立即撤「免费再试一次」、锁定报告入口并查单轮询展示真实退款状态', async () => {
  let step = 0
  const h = await mountReportCharge({
    storedLive: { sessionId: 'iv-sess-1', paidOrderId: 'ORD-RUN-1', paidKioskSessionId: 'KS-RUN-1' },
    seedTrips: (st) => {
      st.rememberServiceTrip({ serviceKey: 'mock_interview', orderId: 'ORD-RUN-1', kioskSessionId: 'KS-RUN-1' })
    },
    getServiceOrder: async () => {
      step += 1
      if (step === 1) {
        return makeOrderView({
          id: 'ORD-RUN-1',
          status: 'consumed',
          settledAt: new Date(1_000_000).toISOString(),
          attemptsUsed: 1,
          failureReason: '报告没生成',
          retryUntil: new Date(1_010_000).toISOString(),
        })
      }
      if (step === 2) {
        return makeOrderView({
          id: 'ORD-RUN-1',
          status: 'refunding',
          refundReason: '免费再试已过期',
        })
      }
      return makeOrderView({
        id: 'ORD-RUN-1',
        status: 'refunded',
        refundReason: '免费再试已过期',
        refundedAt: new Date(1_013_000).toISOString(),
      })
    },
  })

  try {
    await h.state.onReportFailed()
    await h.flushMicrotasks()
    assert.equal(h.state.canFreeRetry, true)
    assert.equal(h.state.reportLocked, false)
    assert.ok(h.state.errorMessage?.includes('可以免费再试一次'))
    assert.equal(h.getCalls.length, 1)

    await h.advance(9_999)
    assert.equal(h.state.canFreeRetry, true)
    assert.equal(h.getCalls.length, 1)

    // 跨过 retryUntil 瞬间：立即撤掉「免费再试一次」、锁定报告入口并立即查单进入 refunding
    await h.advance(1)
    assert.equal(h.state.canFreeRetry, false, '跨过 retryUntil 瞬间必须立即撤掉免费再试')
    assert.equal(h.state.reportLocked, true, '过期后必须锁定报告入口禁止再调 end')
    assert.equal(h.getCalls.length, 2, '到期瞬间必须主动查单核实退款状态')
    assert.ok(h.state.errorMessage?.includes('钱在退回'))
    assert.ok(!h.state.errorMessage?.includes('已退'), 'refunding 阶段绝不能提前写已退')

    // 3 秒后轮询到 refunded → 展示已退回、忘记本趟服务单并停止轮询
    await h.advance(3_000)
    assert.equal(h.getCalls.length, 3)
    assert.equal(h.state.canFreeRetry, false)
    assert.equal(h.state.reportLocked, true)
    assert.ok(h.state.errorMessage?.includes('已退回'))
    assert.equal(h.serviceTripMod.readServiceTrip('mock_interview'), null)
    assert.equal(h.activeTimerCount, 0)

    // 退款锁定后 clearFailure 不得解除锁定
    h.state.clearFailure()
    await h.flushMicrotasks()
    assert.equal(h.state.reportLocked, true)
  } finally {
    h.destroy()
  }
})

test('C5(⑤ iv-run): refund_failed 与 409 SERVICE_ORDER_REFUNDED / SERVICE_RETRY_EXPIRED 均锁定报告入口，卸载清定时器', async () => {
  const h = await mountReportCharge({
    sessionId: 'iv-sess-2',
    storedLive: { sessionId: 'iv-sess-2', paidOrderId: 'ORD-RUN-2', paidKioskSessionId: 'KS-RUN-2' },
    getServiceOrder: async () => makeOrderView({
      id: 'ORD-RUN-2',
      status: 'refund_failed',
      refundReason: '报告没生成',
    }),
  })
  try {
    await h.state.onReportFailed({ code: 'SERVICE_ORDER_REFUNDED', message: '这一次已进入退款流程，不再继续生成练习报告' })
    await h.flushMicrotasks()
    assert.equal(h.state.canFreeRetry, false)
    assert.equal(h.state.reportLocked, true)
    assert.ok(h.state.errorMessage?.includes('需要帮助'))
    assert.ok(!h.state.errorMessage?.includes('已退'))
  } finally {
    h.destroy()
  }

  // 无本地 paidTrip 但服务端回 409 SERVICE_RETRY_EXPIRED 同样必须锁定报告入口
  const hNoTrip = await mountReportCharge({
    sessionId: 'iv-sess-none',
    storedLive: undefined,
    getServiceOrder: async () => { throw new Error('should not be called') },
  })
  try {
    const handled = await hNoTrip.state.onReportFailed({
      code: 'SERVICE_RETRY_EXPIRED',
      message: '免费再试时间已过，这一次的费用会自动退回原付款账户，到账时间以支付渠道为准',
    })
    await hNoTrip.flushMicrotasks()
    assert.equal(handled, true)
    assert.equal(hNoTrip.state.canFreeRetry, false)
    assert.equal(hNoTrip.state.reportLocked, true)
  } finally {
    hNoTrip.destroy()
  }

  // 有效再试窗卸载清理定时器
  const hUnmount = await mountReportCharge({
    sessionId: 'iv-sess-3',
    storedLive: { sessionId: 'iv-sess-3', paidOrderId: 'ORD-RUN-3', paidKioskSessionId: 'KS-RUN-3' },
    getServiceOrder: async () => makeOrderView({
      id: 'ORD-RUN-3',
      status: 'consumed',
      settledAt: new Date(1_000_000).toISOString(),
      retryUntil: new Date(1_060_000).toISOString(),
    }),
  })
  try {
    await hUnmount.state.onReportFailed()
    await hUnmount.flushMicrotasks()
    assert.ok(hUnmount.activeTimerCount > 0)
    hUnmount.unmount()
    assert.equal(hUnmount.activeTimerCount, 0, '卸载后必须清理 iv-run 再试到期定时器')
  } finally {
    hUnmount.destroy()
  }
})

async function mountDeadlineSeal(options) {
  const rt = createFakeRuntime()
  let endCalls = 0
  let cancelCalls = 0
  let stopPlaybackCalls = 0
  let phases = []
  let currentProps = {
    state: { sessionId: 'locked-session', durationMin: 3, deadlineAtLocalMs: 1_001_000 },
    live: undefined,
    phase: 'done_suggest',
    omitPrintAnswers: false,
    answersRecorded: true,
    paidReportLocked: true,
    paidReportError: '这一次已进入退款流程，不再继续生成练习报告',
    paidReportRetryFree: false,
    ...options,
  }
  const recorderRef = { current: { cancel: () => { cancelCalls += 1 } } }
  const recordTimerRef = { current: null }
  const recordStartedAtRef = { current: null }
  const pendingAnswerRef = { current: null }

  const envKey = `__P2E3C_DEADLINE_${Math.random().toString(36).slice(2)}`
  globalThis[envKey] = {
    react: rt.react,
    end: async (...a) => { endCalls += 1; return options.onEnd ? options.onEnd(...a) : 'reported' },
  }
  const jsxUrl = toDataUrl('export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = Symbol("Fragment");')
  const deadlineUrl = toDataUrl(transpile('src/pages/interview/session/interviewDeadline.ts'))
  const hookSrc = ts.transpileModule(
    readFileSync(join(kioskRoot, 'src/pages/interview/session/useInterviewDeadlineSeal.tsx'), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: 'src/pages/interview/session/useInterviewDeadlineSeal.tsx',
    },
  ).outputText
    .replaceAll('from "react/jsx-runtime"', `from '${jsxUrl}'`)
    .replaceAll("from 'react/jsx-runtime'", `from '${jsxUrl}'`)
    .replaceAll("from 'react'", `from '${toDataUrl(`const r = globalThis.${envKey}.react; export const { useEffect, useRef, useState } = r;`)}'`)
    .replaceAll("from '../../../services/api/interview'", `from '${toDataUrl('export const getInterviewSession = () => Promise.reject(new Error("offline timing"))')}'`)
    .replaceAll("from '../../../services/api/client'", `from '${toDataUrl('export const API_MODE = "http"')}'`)
    .replaceAll("from './InterviewTimeUp'", `from '${toDataUrl('export const InterviewTimeUp = function InterviewTimeUp() { return null }')}'`)
    .replaceAll("from './interviewTurnActions'", `from '${toDataUrl(`export const endInterviewAtDeadline = (...a) => globalThis.${envKey}.end(...a)`)}'`)
    .replaceAll("from './interviewDeadline'", `from '${deadlineUrl}'`)

  const { useInterviewDeadlineSeal } = await import(toDataUrl(`${hookSrc}\n// ${envKey}`))
  const noop = () => {}
  rt.setRunner(() => useInterviewDeadlineSeal({
    ...currentProps,
    getToken: () => null,
    access: {},
    navigate: noop,
    recorderRef,
    recordTimerRef,
    recordStartedAtRef,
    pendingAnswerRef,
    stopPlayback: () => { stopPlaybackCalls += 1 },
    setDraft: noop,
    setVoice: noop,
    setRecordSec: noop,
    setPhase: (p) => { phases.push(p) },
    setAssistantDown: noop,
  }))
  rt.render()
  await rt.flushMicrotasks()

  return {
    get state() { return rt.latest },
    get endCalls() { return endCalls },
    get cancelCalls() { return cancelCalls },
    get stopPlaybackCalls() { return stopPlaybackCalls },
    get phases() { return phases },
    rerender(patch) {
      currentProps = { ...currentProps, ...patch }
      rt.render()
    },
    advance: rt.advance,
    flushMicrotasks: rt.flushMicrotasks,
    destroy() {
      rt.destroy()
      delete globalThis[envKey]
    },
  }
}

test('C8(P2e-3c): paidReportLocked=true 时到点自动封场保留停录音/停播报与封场屏，严禁触发 endInterviewAtDeadline', async () => {
  // 8a: 初始即锁定（退款/再试过期），1 秒后到点自动封场
  const locked = await mountDeadlineSeal({
    paidReportLocked: true,
    answersRecorded: true,
    paidReportError: '这一次已进入退款流程，不再继续生成练习报告',
  })
  try {
    assert.equal(locked.endCalls, 0)
    assert.equal(locked.state.sealedRef.current, false)
    assert.equal(locked.state.timeUpScreen, null)

    await locked.advance(1_000)
    assert.equal(locked.state.sealedRef.current, true, '到点必须正常封场')
    assert.equal(locked.cancelCalls, 1, '到点必须取消录音')
    assert.equal(locked.stopPlaybackCalls, 1, '到点必须停止播报')
    assert.equal(locked.endCalls, 0, 'paidReportLocked=true 时到点绝不能自动调 endInterviewAtDeadline')
    assert.ok(locked.state.timeUpScreen, '到点封场必须切到 InterviewTimeUp 封场屏')
    assert.equal(locked.state.timeUpScreen.props.variant, 'report-failed')
    assert.equal(locked.state.timeUpScreen.props.paidReportLocked, true)
    assert.equal(locked.phases.includes('finishing'), false)

    // 即便手动误触封场屏 onRetry 也不得请求生成报告
    locked.state.timeUpScreen.props.onRetry()
    await locked.flushMicrotasks()
    assert.equal(locked.endCalls, 0)
  } finally {
    locked.destroy()
  }

  // 8b: 运行途中由未锁定切换为 paidReportLocked=true 后到点 → 同样严格拦截
  const lateLocked = await mountDeadlineSeal({
    paidReportLocked: false,
    answersRecorded: true,
    paidReportError: null,
  })
  try {
    await lateLocked.advance(500)
    lateLocked.rerender({ paidReportLocked: true, paidReportError: '免费再试时间已过，费用会自动退回原付款账户' })
    await lateLocked.advance(500)
    assert.equal(lateLocked.state.sealedRef.current, true)
    assert.equal(lateLocked.endCalls, 0, '运行途中变为锁定后，到点封场绝不能自动请求报告')
    assert.ok(lateLocked.state.timeUpScreen)
    assert.equal(lateLocked.state.timeUpScreen.props.variant, 'report-failed')
  } finally {
    lateLocked.destroy()
  }

  // 8c: 正向对照：未锁定（paidReportLocked=false）到点仍正常触发一次 endInterviewAtDeadline
  const unlocked = await mountDeadlineSeal({
    paidReportLocked: false,
    answersRecorded: true,
    paidReportError: null,
  })
  try {
    await unlocked.advance(1_000)
    assert.equal(unlocked.state.sealedRef.current, true)
    assert.equal(unlocked.endCalls, 1, '未锁定时到点必须正常调用一次 endInterviewAtDeadline')
  } finally {
    unlocked.destroy()
  }
})
