/**
 * 付款屏节流/退避与到点核实边界单测（P2e-1c）：
 *   1. 直接转译运行 src/pages/pay/payPollGuard.ts（零运行时外部依赖）
 *   2. 直接转译运行 src/services/api/serviceOrders.ts（serviceOrderPhase 优先级）
 *   3. 直接转译运行 src/pages/pay/usePayServiceFlow.ts（可控时钟 + 极简 React Hook 夹具），覆盖：
 *      - 到点核实回 200 + pending + checking:true 不抢判 timeout、普通查单不误落 timeout、12s 后 paid 自动进 next；
 *      - 到点前 1 秒刚手动核实，到点自动核实推迟至 >= 10000ms，卸载清理延迟定时器；
 *      - lookup「再查一次」遇 429 + Retry-After: 15，15s 内连点 3 次发 0 请求且 rateLimited===true，过退避期恢复；
 *      - 到点核实遇 429 同走退避且自动续查；未过期普通查单 checking:false 立即复位 wait。
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

const guardCode = transpile('src/pages/pay/payPollGuard.ts')
assert.deepEqual([...guardCode.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]), [], 'payPollGuard.ts 必须保持零运行时依赖')
const guardUrl = toDataUrl(guardCode)
const guardMod = await import(guardUrl)

const serviceOrdersUrl = toDataUrl(
  transpile('src/services/api/serviceOrders.ts')
    .replaceAll("from '../terminalAuth'", `from '${toDataUrl('export async function terminalProtectedFetch() { throw new Error("unused") }')}'`)
    .replaceAll("from './client'", `from '${toDataUrl('export const API_BASE_URL = "/api/v1"; export const API_MODE = "http"')}'`)
    .replaceAll("from './httpAdapter'", `from '${toDataUrl('export class ApiHttpError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status } }')}'`)
    .replaceAll("from './throwHttpError'", `from '${toDataUrl('export function networkError(e) { return e }; export async function readHttpError() { return { code: "ERR", message: "err" } }')}'`),
)
const serviceOrdersMod = await import(serviceOrdersUrl)

function makeView(overrides = {}) {
  return {
    id: 'ord-p2e1c-1',
    serviceKey: 'resume_optimize',
    serviceName: 'AI 简历优化',
    status: 'pending',
    amountCents: 100,
    expiresAt: new Date(20_000).toISOString(),
    qrCodeContent: 'sandboxpay://qr?order=ord-p2e1c-1',
    paidAt: null,
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

test('G1 payPollGuard 统一约束 60s/28 次上限、10s refresh 间隔、postExpiry 续查与 429 退避', () => {
  const s = guardMod.createPayPollGuardState()
  guardMod.noteOrderAnchor(s, 0)

  // 刚建单 5 秒内：手动刷新只能发普通 GET，不能带 refresh=1
  assert.deepEqual(
    guardMod.planPollRequest(s, 5_000, { manual: true, provider: 'sandbox', postExpiryChecking: false }),
    { allowed: true, refresh: false },
  )
  // 满 10 秒：手动刷新可带 refresh=1
  assert.deepEqual(
    guardMod.planPollRequest(s, 10_000, { manual: true, provider: 'sandbox', postExpiryChecking: false }),
    { allowed: true, refresh: true },
  )
  guardMod.recordGetRequest(s, 10_000, true)

  // 刚核实完 1 秒：到点核实与 lookup 再查一次必须推迟 9000ms
  assert.deepEqual(
    guardMod.planRefreshOnlyRequest(s, 11_000),
    { allowed: false, reason: 'refresh_gap', waitMs: 9_000 },
  )
  // 满 10 秒后放行，且 postExpiryChecking 下即便是 sandbox 也允许自动带 refresh=1
  assert.deepEqual(guardMod.planRefreshOnlyRequest(s, 20_000), { allowed: true })
  assert.deepEqual(
    guardMod.planPollRequest(s, 20_000, { manual: false, provider: 'sandbox', postExpiryChecking: true }),
    { allowed: true, refresh: true },
  )

  // 429 Retry-After: 15s 退避优先于普通刷新冷却，过期后无头指数退避 20s
  const delay1 = guardMod.recordRateLimit(s, { status: 429, code: 'RATE_LIMITED', retryAfterMs: 15_000 }, 20_000)
  assert.equal(delay1, 15_000)
  assert.equal(guardMod.isRateLimitedError({ status: 429 }), true)
  assert.equal(guardMod.isRateLimitedError({ code: 'RECONCILE_TOO_FREQUENT' }), true)
  assert.deepEqual(
    guardMod.planRefreshOnlyRequest(s, 25_000),
    { allowed: false, reason: 'backoff', waitMs: 10_000 },
  )
  const delay2 = guardMod.recordRateLimit(s, { status: 429, code: 'RATE_LIMITED' }, 35_000)
  assert.equal(delay2, 20_000, '第 2 次连续 429 无 Retry-After 应指数退避至 20s')
  guardMod.recordGetSuccess(s)
  assert.equal(s.rateLimitHits, 0)
  assert.equal(s.backoffUntil, 0)

  // 60 秒窗口 28 次封顶：第 29 次被 cap 挡住，直到最早那条滚出 60 秒窗口
  const capped = guardMod.createPayPollGuardState()
  for (let i = 0; i < 28; i += 1) guardMod.recordGetRequest(capped, 100_000 + i * 1_000, false)
  const blocked = guardMod.planRefreshOnlyRequest(capped, 130_000)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.reason, 'cap')
  assert.equal(blocked.waitMs, 30_000)
  assert.deepEqual(guardMod.planRefreshOnlyRequest(capped, 160_000), { allowed: true })
})

test('G2 serviceOrderPhase 在 pending 下严格按 paymentFailed → checking → expiredLocally 判定', () => {
  const expiredChecking = makeView({ expiresAt: new Date(20_000).toISOString(), checking: true, paymentFailed: false })
  assert.equal(
    serviceOrdersMod.serviceOrderPhase(expiredChecking, 25_000),
    'checking',
    '服务端返回 200 + pending + checking:true 时绝不能被本地时钟抢判成 timed_out',
  )
  const expiredFailed = makeView({ expiresAt: new Date(20_000).toISOString(), checking: true, paymentFailed: true })
  assert.equal(serviceOrdersMod.serviceOrderPhase(expiredFailed, 25_000), 'not_paid', 'paymentFailed 优先级高于 checking')
  const expiredUnpaid = makeView({ expiresAt: new Date(20_000).toISOString(), checking: false, paymentFailed: false })
  assert.equal(serviceOrdersMod.serviceOrderPhase(expiredUnpaid, 25_000), 'timed_out', '已过期且 checking:false 才落 timed_out')
  assert.equal(serviceOrdersMod.serviceOrderPhase(expiredUnpaid, 15_000), 'awaiting', '未过期且 checking:false 为 awaiting')
})

/** 极简可控 React Hook + 虚拟时钟运行器，直接挂载真实 usePayServiceFlow 源码。 */
async function mountFlowHarness({ initialOrder, onGet, storedTrip = null }) {
  let now = 0
  let nextTimerId = 1
  const timers = new Map()
  const nav = []
  const requests = []
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
  let latest = null
  let unmounted = false

  function depsChanged(prev, next) {
    if (!prev || !next) return true
    if (prev.length !== next.length) return true
    for (let i = 0; i < prev.length; i += 1) if (!Object.is(prev[i], next[i])) return true
    return false
  }

  const reactStub = {
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

  const env = {
    react: reactStub,
    navigate: (to, opts) => nav.push({ to, opts, at: now }),
    getServiceOrder: async (orderId, kioskSessionId, options) => {
      const refresh = Boolean(options?.refresh)
      requests.push({ orderId, kioskSessionId, refresh, at: now })
      return onGet({ orderId, kioskSessionId, refresh, at: now, count: requests.length })
    },
    openServiceTripOrder: async () => ({
      trip: { serviceKey: 'resume_optimize', orderId: initialOrder.id, kioskSessionId: 'sess-1', owner: { kind: 'guest' }, savedAt: now },
      view: { ...initialOrder },
    }),
    storedTrip,
  }
  const envKey = `__P2E1C_ENV_${Math.random().toString(36).slice(2)}`
  globalThis[envKey] = env

  const modelUrl = toDataUrl(
    transpile('src/pages/pay/payServiceModel.ts')
      .replaceAll("from '../../copy/unattendedCopy'", `from '${toDataUrl('export const helpNeededLine = () => "联系客服"')}'`)
      .replaceAll("from '../../services/api/userErrorMessage'", `from '${toDataUrl('export const errorCodeOf = (e) => e?.code; export const userMessageOf = (_e, f) => f')}'`),
  )
  const flowSrc = transpile('src/pages/pay/usePayServiceFlow.ts')
    .replaceAll("from 'react'", `from '${toDataUrl(`const r = globalThis.${envKey}.react; export const { useCallback, useEffect, useRef, useState } = r;`)}'`)
    .replaceAll("from 'react-router-dom'", `from '${toDataUrl(`export const useNavigate = () => globalThis.${envKey}.navigate; export const useLocation = () => ({ pathname: '/pay/resume' });`)}'`)
    .replaceAll("from '../../auth/useAuth'", `from '${toDataUrl('export const useAuth = () => ({ user: null })')}'`)
    .replaceAll("from '../../contexts/KioskBusyContext'", `from '${toDataUrl('export const useBusyLock = () => {}')}'`)
    .replaceAll("from '../../services/api/client'", `from '${toDataUrl('export const API_MODE = "http"')}'`)
    .replaceAll(
      "from '../../services/api/serviceOrders'",
      `from '${toDataUrl(`export { serviceOrderExpiredLocally, serviceOrderPhase } from '${serviceOrdersUrl}'; export const getServiceOrder = (...a) => globalThis.${envKey}.getServiceOrder(...a);`)}'`,
    )
    .replaceAll("from '../../services/api/terminalConfig'", `from '${toDataUrl('export const getTerminalId = () => "term-1"; export const refreshKioskTerminalConfig = async () => ({ pricing: { effective: { resume_optimize: 100 } } })')}'`)
    .replaceAll("from '../../services/api/userErrorMessage'", `from '${toDataUrl('export const errorCodeOf = (e) => (e && typeof e === "object" ? e.code : undefined)')}'`)
    .replaceAll(
      "from '../../services/serviceTrip'",
      `from '${toDataUrl(`export const serviceTripOwnerFor = () => ({ kind: 'guest' }); export const readServiceTrip = () => globalThis.${envKey}.storedTrip; export const forgetServiceTrip = () => { globalThis.${envKey}.storedTrip = null };`)}'`,
    )
    .replaceAll(
      "from '../../services/serviceTripOrder'",
      `from '${toDataUrl(`export const keepServiceTripOrder = (t) => { globalThis.${envKey}.storedTrip = t }; export const openServiceTripOrder = (...a) => globalThis.${envKey}.openServiceTripOrder(...a); export const retireServiceTripOrder = async () => ({ ok: true, view: null });`)}'`,
    )
    .replaceAll("from './payPollGuard'", `from '${guardUrl}'`)
    .replaceAll("from './payServiceModel'", `from '${modelUrl}'`)
    .replaceAll(
      "from './useMiniappCreditFlow'",
      `from '${toDataUrl('export function useMiniappCreditFlow() { return { creditNotice: null, checkOwned: async () => false, onUseCredit: () => {} } }')}'`,
    )

  const { usePayServiceFlow } = await import(toDataUrl(`${flowSrc}\n// ${envKey}`))

  function render() {
    if (unmounted) return
    if (rendering) { dirty = true; return }
    rendering = true
    do {
      dirty = false
      cursor = 0
      latest = usePayServiceFlow('resume', { next: '/resume/optimize', back: '/resume/report' })
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
    for (let i = 0; i < 8; i += 1) {
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
    delete globalThis[envKey]
    Date.now = prevDateNow
    if (prevWin === undefined) delete globalThis.window
    else globalThis.window = prevWin
  }

  render()
  await advance(0)

  return {
    get flow() { return latest },
    get now() { return now },
    get activeTimerCount() { return timers.size },
    requests,
    nav,
    advance,
    flushMicrotasks,
    unmount,
    destroy,
  }
}

test('F1 到点核实回 200+pending+checking:true 不落 timeout，普通查单不误落，12 秒后 paid 自动进 next', async () => {
  const order = makeView({ expiresAt: new Date(20_000).toISOString() })
  let paid = false
  const h = await mountFlowHarness({
    initialOrder: order,
    onGet: async ({ refresh }) => {
      if (paid) return makeView({ ...order, status: 'paid', paidAt: new Date(32_000).toISOString(), checking: false })
      // 到点 refresh=1 返回 checking:true；中间普通查单返回 checking:false，绝不能被误判为 timeout
      return makeView({ ...order, checking: refresh })
    },
  })
  try {
    assert.equal(h.flow.screen, 'wait')
    await h.advance(20_000)
    assert.equal(h.flow.screen, 'check', '到点 refresh=1 返回 checking:true 必须留在 check 态')
    assert.equal(h.flow.checking, true)
    assert.equal(h.requests.filter((r) => r.refresh).length, 1)

    // 中间 9 秒普通查单返回 checking:false 仍留在 check 态，且继续查单
    const getsAt20 = h.requests.length
    await h.advance(9_000)
    assert.equal(h.flow.screen, 'check', '续查期间普通查单 checking:false 不得抢判 timeout')
    assert.ok(h.requests.length > getsAt20, 'checking:true 续查阶段轮询必须保持激活')

    // 第 12 秒（t=32000）服务端返回 paid → 自动进 ok 并 1.6s 后推进 targets.next
    paid = true
    await h.advance(3_000)
    assert.equal(h.flow.screen, 'ok')
    assert.equal(h.requests.filter((r) => r.refresh).length, 2, '续查第 12 秒应发出下一次 refresh=1')
    await h.advance(1_600)
    assert.deepEqual(h.nav.map((n) => n.to), ['/resume/optimize'])
  } finally {
    h.destroy()
  }
})

test('F2 到点前 1 秒刚手动核实，到点自动核实推迟到 >=10000ms，且卸载清理定时器', async () => {
  const order = makeView({ expiresAt: new Date(20_000).toISOString() })
  const h = await mountFlowHarness({
    initialOrder: order,
    onGet: async () => makeView({ ...order, checking: false }),
  })
  try {
    await h.advance(19_000)
    h.flow.onRefresh()
    await h.flushMicrotasks()
    assert.deepEqual(h.requests.filter((r) => r.refresh).map((r) => r.at), [19_000])

    // 到点（t=20000）绝不能在 1000ms 内发第二次 refresh=1
    await h.advance(1_000)
    assert.equal(h.flow.view, 'check')
    assert.deepEqual(h.requests.filter((r) => r.refresh).map((r) => r.at), [19_000], '距上次仅 1s 时不得立刻发到点 refresh=1')

    // 再过 8.9 秒（t=28900）仍未到 10s
    await h.advance(8_900)
    assert.deepEqual(h.requests.filter((r) => r.refresh).map((r) => r.at), [19_000])

    // 到达 t=29000（距上次正好 10000ms）发出到点核实并落 timeout
    await h.advance(100)
    const refreshTimes = h.requests.filter((r) => r.refresh).map((r) => r.at)
    assert.deepEqual(refreshTimes, [19_000, 29_000])
    assert.ok(refreshTimes[1] - refreshTimes[0] >= 10_000)
    assert.equal(h.flow.screen, 'timeout')
  } finally {
    h.destroy()
  }

  // 卸载清理定时器验证：推迟中的到点核实定时器在卸载后绝不再发请求
  const h2 = await mountFlowHarness({
    initialOrder: order,
    onGet: async () => makeView({ ...order, checking: false }),
  })
  try {
    await h2.advance(19_000)
    h2.flow.onRefresh()
    await h2.flushMicrotasks()
    await h2.advance(1_000)
    assert.equal(h2.requests.filter((r) => r.refresh).length, 1)
    h2.unmount()
    await h2.advance(15_000)
    assert.equal(h2.requests.filter((r) => r.refresh).length, 1, '卸载后必须清理到点延迟定时器')
  } finally {
    h2.destroy()
  }
})

test('F3 lookup 点「再查一次」遇 429+Retry-After:15，15 秒内连点 3 次发 0 次且 rateLimited===true，过期后恢复', async () => {
  const order = makeView({ expiresAt: new Date(20_000).toISOString() })
  let mode = '503'
  const storedTrip = { serviceKey: 'resume_optimize', orderId: order.id, kioskSessionId: 'sess-1', owner: { kind: 'guest' }, savedAt: 0 }
  const h = await mountFlowHarness({
    initialOrder: order,
    storedTrip,
    onGet: async () => {
      if (mode === '503') throw { status: 503, code: 'UPSTREAM_UNAVAILABLE' }
      if (mode === '429') throw { status: 429, code: 'RATE_LIMITED', retryAfterMs: 15_000 }
      return makeView({ ...order, status: 'paid', paidAt: new Date(25_000).toISOString() })
    },
  })
  try {
    // 进屏查旧单 503 → 落 lookup
    assert.equal(h.flow.screen, 'lookup')
    assert.equal(h.flow.rateLimited, false)

    // 第 1 次点「再查一次」撞 429 + Retry-After: 15（t=5000）
    await h.advance(5_000)
    mode = '429'
    h.flow.onRetry()
    await h.flushMicrotasks()
    assert.equal(h.flow.screen, 'lookup')
    assert.equal(h.flow.rateLimited, true, 'lookup 遇 429 必须置 rateLimited=true')
    const after429 = h.requests.filter((r) => r.refresh).length
    assert.equal(after429, 1)

    // 15 秒退避期内连点 3 次（含同刻、+4s、+10s）：发出 0 次新 refresh=1 且保持 rateLimited=true
    h.flow.onRetry()
    await h.advance(4_000)
    h.flow.onRetry()
    await h.advance(6_000)
    h.flow.onRetry()
    await h.flushMicrotasks()
    assert.equal(h.requests.filter((r) => r.refresh).length, after429, 'Retry-After 15 秒内连点 3 次必须发出 0 次新 refresh=1')
    assert.equal(h.flow.rateLimited, true)

    // 过 15 秒退避期（t=20000）再点：正常发出 refresh=1 并承接 paid
    mode = 'paid'
    await h.advance(5_000)
    h.flow.onRetry()
    await h.flushMicrotasks()
    assert.equal(h.requests.filter((r) => r.refresh).length, after429 + 1)
    assert.equal(h.flow.screen, 'ok')
    assert.equal(h.flow.rateLimited, false)
    await h.advance(1_600)
    assert.deepEqual(h.nav.map((n) => n.to), ['/resume/optimize'])
  } finally {
    h.destroy()
  }
})

test('F4 到点核实遇 429 走同一退避并自动续查；未过期普通查单 checking:false 仍立即复位 wait', async () => {
  const order = makeView({ expiresAt: new Date(20_000).toISOString() })
  let step = 'check_once'
  const h = await mountFlowHarness({
    initialOrder: order,
    onGet: async ({ refresh }) => {
      if (step === 'check_once') return makeView({ ...order, checking: refresh })
      if (step === 'expiry_429') throw { status: 429, code: 'RATE_LIMITED', retryAfterMs: 15_000 }
      return makeView({ ...order, status: 'paid', paidAt: new Date(35_000).toISOString() })
    },
  })
  try {
    // 未过期期间（t=10000）手动核实回 checking:true → check；下一拍普通查单回 checking:false → 立即复位 wait
    await h.advance(10_000)
    h.flow.onRefresh()
    await h.flushMicrotasks()
    assert.equal(h.flow.screen, 'check')
    assert.equal(h.flow.checking, true)
    await h.advance(3_000)
    assert.equal(h.flow.screen, 'wait', '未过期普通查单回 checking:false 必须立即复位 wait')
    assert.equal(h.flow.checking, false)

    // 到点（t=20000）发 refresh=1 撞 429 + Retry-After: 15 → 置 rateLimited=true、15 秒内不重发
    await h.advance(6_500)
    step = 'expiry_429'
    await h.advance(500)
    assert.equal(h.flow.view, 'check')
    assert.equal(h.flow.rateLimited, true)
    const afterExpiry429 = h.requests.filter((r) => r.refresh).length
    assert.equal(afterExpiry429, 2)
    await h.advance(14_000)
    assert.equal(h.requests.filter((r) => r.refresh).length, afterExpiry429, '到点核实 429 退避期内不得重发')

    // 满 15 秒自动重试拿到 paid → ok → next
    step = 'paid'
    await h.advance(1_000)
    assert.equal(h.requests.filter((r) => r.refresh).length, afterExpiry429 + 1)
    assert.equal(h.flow.screen, 'ok')
    assert.equal(h.flow.rateLimited, false)
    await h.advance(1_600)
    assert.deepEqual(h.nav.map((n) => n.to), ['/resume/optimize'])
  } finally {
    h.destroy()
  }
})

test('F5 切换用户（endUserId A→B）立即作废 A 的在途查权益与核销，晚到核销自动 /close 且不污染 B；同拍双击只发 1 次', async () => {
  const hooks = []
  let cursor = 0
  const cleanups = new Map()
  let pendingEffects = []
  let latest = null
  let unmounted = false
  let rendering = false
  let dirty = false
  let currentUserId = 'user-a'
  const nav = []
  const closedOrders = []
  const keptTrips = []
  let redeemCalls = 0
  let resolveCheckA
  let resolveRedeemA
  const timers = new Map()
  let nextTimerId = 1

  const react = {
    useState(init) {
      const idx = cursor++
      if (hooks.length <= idx) hooks.push(typeof init === 'function' ? init() : init)
      return [hooks[idx], (next) => {
        const val = typeof next === 'function' ? next(hooks[idx]) : next
        if (!Object.is(hooks[idx], val)) {
          hooks[idx] = val
          if (!rendering) render()
          else dirty = true
        }
      }]
    },
    useRef(init) {
      const idx = cursor++
      if (hooks.length <= idx) hooks.push({ current: init })
      return hooks[idx]
    },
    useCallback(fn, deps) {
      const idx = cursor++
      const prev = hooks[idx]
      if (!prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]))) {
        hooks[idx] = { fn, deps }
      }
      return hooks[idx].fn
    },
    useEffect(fn, deps) {
      const idx = cursor++
      const prev = hooks[idx]
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]))
      hooks[idx] = { deps }
      if (changed) pendingEffects.push({ idx, fn })
    },
  }

  const prevWindow = globalThis.window
  globalThis.window = {
    setTimeout(fn, delay = 0) {
      const id = nextTimerId++
      timers.set(id, { fn, delay })
      return id
    },
    clearTimeout(id) { timers.delete(id) },
    setInterval() { return 0 },
    clearInterval() {},
  }

  const envKey = `__P2D2B_SWITCH_${Math.random().toString(36).slice(2)}`
  const initialOrder = makeView({ id: 'svc-user-b-cash', expiresAt: new Date(Date.now() + 300_000).toISOString() })
  globalThis[envKey] = {
    react,
    navigate: (to, opts) => nav.push({ to, opts }),
    getUser: () => (currentUserId ? { id: currentUserId } : null),
    getToken: () => (currentUserId ? `tok-${currentUserId}` : null),
    closeServiceOrder: async (orderId, kioskSessionId) => {
      closedOrders.push({ orderId, kioskSessionId })
      return makeView({ id: orderId, status: 'refunded', provider: 'miniapp_credit', amountCents: 0 })
    },
    keepServiceTripOrder: (trip) => keptTrips.push(trip),
    openServiceTripOrder: async ({ endUserId }) => ({
      trip: { serviceKey: 'resume_optimize', orderId: `${initialOrder.id}-${endUserId}`, kioskSessionId: 'sess-b', owner: { kind: 'member', endUserId }, savedAt: 1000 },
      view: { ...initialOrder, id: `${initialOrder.id}-${endUserId}` },
    }),
    checkOwnedCreditForPayScreen: ({ endUserId }) => {
      if (endUserId === 'user-a') return new Promise((resolve) => { resolveCheckA = resolve })
      return Promise.resolve(false)
    },
    runMiniappCreditRedeem: ({ endUserId }) => {
      redeemCalls += 1
      return new Promise((resolve) => {
        resolveRedeemA = () => resolve({
          kind: 'redeemed',
          view: makeView({ id: `vpcord-${endUserId}`, provider: 'miniapp_credit', amountCents: 0, status: 'paid' }),
          trip: { serviceKey: 'resume_optimize', orderId: `vpcord-${endUserId}`, kioskSessionId: `sess-${endUserId}`, owner: { kind: 'member', endUserId }, savedAt: 1000 },
        })
      })
    },
  }

  const modelUrl = toDataUrl(
    transpile('src/pages/pay/payServiceModel.ts')
      .replaceAll("from '../../copy/unattendedCopy'", `from '${toDataUrl('export const helpNeededLine = () => "联系客服"')}'`)
      .replaceAll("from '../../services/api/userErrorMessage'", `from '${toDataUrl('export const errorCodeOf = (e) => e?.code; export const userMessageOf = (_e, f) => f')}'`),
  )
  const creditFlowUrl = toDataUrl(
    transpile('src/pages/pay/useMiniappCreditFlow.ts')
      .replaceAll("from 'react'", `from '${toDataUrl(`const r = globalThis.${envKey}.react; export const { useCallback, useEffect, useRef, useState } = r;`)}'`)
      .replaceAll("from '../../services/api/serviceOrders'", `from '${toDataUrl(`export const closeServiceOrder = (...a) => globalThis.${envKey}.closeServiceOrder(...a);`)}'`)
      .replaceAll("from '../../services/serviceTripOrder'", `from '${toDataUrl(`export const keepServiceTripOrder = (t) => globalThis.${envKey}.keepServiceTripOrder(t);`)}'`)
      .replaceAll("from './payCreditFlow'", `from '${toDataUrl(`export const checkOwnedCreditForPayScreen = (...a) => globalThis.${envKey}.checkOwnedCreditForPayScreen(...a); export const runMiniappCreditRedeem = (...a) => globalThis.${envKey}.runMiniappCreditRedeem(...a);`)}'`),
  )
  const flowSrc = transpile('src/pages/pay/usePayServiceFlow.ts')
    .replaceAll("from 'react'", `from '${toDataUrl(`const r = globalThis.${envKey}.react; export const { useCallback, useEffect, useRef, useState } = r;`)}'`)
    .replaceAll("from 'react-router-dom'", `from '${toDataUrl(`export const useNavigate = () => globalThis.${envKey}.navigate; export const useLocation = () => ({ pathname: '/pay/resume' });`)}'`)
    .replaceAll("from '../../auth/useAuth'", `from '${toDataUrl(`export const useAuth = () => ({ user: globalThis.${envKey}.getUser(), getToken: globalThis.${envKey}.getToken });`)}'`)
    .replaceAll("from '../../contexts/KioskBusyContext'", `from '${toDataUrl('export const useBusyLock = () => {}')}'`)
    .replaceAll("from '../../services/api/client'", `from '${toDataUrl('export const API_MODE = "http"')}'`)
    .replaceAll("from '../../services/api/serviceOrders'", `from '${toDataUrl(`export { serviceOrderExpiredLocally, serviceOrderPhase } from '${serviceOrdersUrl}'; export const getServiceOrder = async () => { throw new Error('unexpected') };`)}'`)
    .replaceAll("from '../../services/api/terminalConfig'", `from '${toDataUrl('export const getTerminalId = () => "term-1"; export const refreshKioskTerminalConfig = async () => ({ pricing: { effective: { resume_optimize: 100 } } })')}'`)
    .replaceAll("from '../../services/api/userErrorMessage'", `from '${toDataUrl('export const errorCodeOf = (e) => e?.code')}'`)
    .replaceAll("from '../../services/serviceTrip'", `from '${toDataUrl('export const serviceTripOwnerFor = (id) => (id ? { kind: "member", endUserId: id } : { kind: "guest" }); export const readServiceTrip = () => null; export const forgetServiceTrip = () => {};')}'`)
    .replaceAll("from '../../services/serviceTripOrder'", `from '${toDataUrl(`export const keepServiceTripOrder = (t) => globalThis.${envKey}.keepServiceTripOrder(t); export const openServiceTripOrder = (...a) => globalThis.${envKey}.openServiceTripOrder(...a); export const retireServiceTripOrder = async () => ({ ok: true, view: null });`)}'`)
    .replaceAll("from './payPollGuard'", `from '${guardUrl}'`)
    .replaceAll("from './payServiceModel'", `from '${modelUrl}'`)
    .replaceAll("from './useMiniappCreditFlow'", `from '${creditFlowUrl}'`)

  const { usePayServiceFlow } = await import(toDataUrl(`${flowSrc}\n// ${envKey}`))

  function render() {
    if (unmounted) return
    if (rendering) { dirty = true; return }
    rendering = true
    do {
      dirty = false
      cursor = 0
      latest = usePayServiceFlow('resume', { next: '/resume/optimize', back: '/resume/report' })
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
  async function flushAll() {
    for (let i = 0; i < 6; i += 1) {
      for (const [id, entry] of [...timers.entries()]) {
        if (entry.delay === 0) {
          timers.delete(id)
          entry.fn()
        }
      }
      await Promise.resolve()
      await Promise.resolve()
      if (dirty) render()
    }
  }

  try {
    // 场景 A：用户 A 查权益挂起时切换为用户 B → A 晚到 true 绝不把 B 置为 owned
    render()
    await flushAll()
    assert.equal(typeof resolveCheckA, 'function')
    currentUserId = 'user-b'
    render()
    await flushAll()
    resolveCheckA(true)
    await flushAll()
    assert.equal(latest.screen, 'wait', '用户 A 延迟返回的 owned 绝不能污染用户 B')
    assert.equal(keptTrips.every((t) => t.owner?.endUserId === 'user-b'), true)

    // 场景 B：切回用户 A 进入 owned，同一拍连点 2 次 onUseCredit 严格只发 1 次；在途切换为用户 B → A 晚到核销不存 trip、不跳 B、自动 /close 退回权益
    currentUserId = 'user-a'
    render()
    await flushAll()
    resolveCheckA(true)
    await flushAll()
    assert.equal(latest.screen, 'owned')

    keptTrips.length = 0
    latest.onUseCredit()
    latest.onUseCredit()
    assert.equal(redeemCalls, 1, '同一拍连续调用 onUseCredit 必须被同步锁拦成严格 1 次')

    currentUserId = 'user-b'
    render()
    await flushAll()
    resolveRedeemA()
    await flushAll()
    assert.equal(nav.length, 0, '用户 A 晚到核销绝不能替用户 B 跳转')
    assert.equal(keptTrips.some((t) => t.orderId === 'vpcord-user-a'), false, '用户 A 晚到核销绝不能写入 sessionStorage')
    assert.deepEqual(closedOrders, [{ orderId: 'vpcord-user-a', kioskSessionId: 'sess-user-a' }], '用户 A 晚到核销必须立即调 /close 退回权益')
  } finally {
    unmounted = true
    for (const fn of cleanups.values()) if (typeof fn === 'function') fn()
    globalThis.window = prevWindow
    delete globalThis[envKey]
  }
})
