/**
 * 简历按次付款接线边界单测（P2e-2b）：
 *   直接转译运行真实源码 src/pages/resume/useResumeTripCharge.ts、
 *   src/services/api/serviceOrders.ts、src/services/serviceTrip.ts 与
 *   src/pages/resume/ResumeReportPage.tsx，覆盖 3 项边界修复：
 *   1. retryUntil 到点实时重判：时钟跨过 retryUntil 自动触发精准定时器重算，
 *      phase 立即变为 retry_expired、alreadyPaidForOptimize 变为 false；
 *      含早醒重排、同步重渲染实时重判、换单/卸载清理定时器。
 *   2. refreshOrder() 与初始化查单请求代次 + 当前归属/单号双重隔离：
 *      旧用户查单在途切用户/清场/忘单/换单/卸载/后发先至，晚到成功与 404 响应均丢弃。
 *   3. HTTP 返回或路由带来的 providerName === 'mock' 演示报告隔离付款入口与价格说明：
 *      收费机器上 payLabel 与 optimizePriceNote 均为 null，真实 provider 照常收费。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const kioskRequire = createRequire(join(kioskRoot, 'package.json'))
const jsxRuntime = kioskRequire('react/jsx-runtime')

function readKiosk(rel) {
  return readFileSync(join(kioskRoot, rel), 'utf8')
}

function loadTsModule(rel, mocks = {}, globals = {}) {
  const source = readKiosk(rel)
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: rel,
  })
  const mod = { exports: {} }
  const localRequire = (id) => {
    if (id in mocks) return mocks[id]
    if (id === 'react/jsx-runtime') return jsxRuntime
    if (id.endsWith('.css')) return {}
    throw new Error(`UNMOCKED module "${id}" required from ${rel}`)
  }
  vm.runInNewContext(
    outputText,
    {
      exports: mod.exports,
      module: mod,
      require: localRequire,
      URLSearchParams,
      AbortController,
      console,
      ...globals,
    },
    { filename: rel },
  )
  return mod.exports
}

class FakeHttpError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

const errorCodeOf = (error) => (error && typeof error === 'object' && typeof error.code === 'string' ? error.code : null)

const serviceOrdersMod = loadTsModule('src/services/api/serviceOrders.ts', {
  '../terminalAuth': { terminalProtectedFetch: async () => { throw new Error('unused') } },
  './client': { API_BASE_URL: '/api/v1', API_MODE: 'http' },
  './httpAdapter': { ApiHttpError: FakeHttpError },
  './throwHttpError': { networkError: (e) => e, readHttpError: async () => ({ code: 'ERR', message: 'err' }) },
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 极简 React Hook + 可控虚拟时钟运行器。 */
function createHookHarness(initialNow = 100_000) {
  let now = initialNow
  let nextTimerId = 1
  const timers = new Map()
  const slots = []
  const cleanups = new Map()
  const pendingEffects = []
  let cursor = 0
  let rendering = false
  let dirty = false
  let mounted = true
  let renderFn = null
  let latest = null

  const depsChanged = (prev, next) =>
    !prev || !next || prev.length !== next.length || prev.some((v, i) => !Object.is(v, next[i]))

  const FakeDate = class extends Date {
    constructor(...args) {
      if (args.length === 0) super(now)
      else super(...args)
    }

    static now() {
      return now
    }
  }

  function fakeSetTimeout(fn, ms = 0) {
    const id = nextTimerId++
    timers.set(id, { id, fn, at: now + Math.max(0, Number(ms) || 0) })
    return id
  }

  function fakeClearTimeout(id) {
    timers.delete(id)
  }

  function runEffects() {
    while (pendingEffects.length > 0 && mounted) {
      const eff = pendingEffects.shift()
      const oldCleanup = cleanups.get(eff.idx)
      if (typeof oldCleanup === 'function') oldCleanup()
      const cleanup = eff.fn()
      if (typeof cleanup === 'function') cleanups.set(eff.idx, cleanup)
      else cleanups.delete(eff.idx)
    }
  }

  function render(fn = renderFn) {
    renderFn = fn
    if (!mounted) return latest
    if (rendering) {
      dirty = true
      return latest
    }
    rendering = true
    do {
      dirty = false
      cursor = 0
      latest = renderFn()
      runEffects()
    } while (dirty && mounted)
    rendering = false
    return latest
  }

  const react = {
    useState(initial) {
      const idx = cursor++
      if (!(idx in slots)) slots[idx] = typeof initial === 'function' ? initial() : initial
      const setState = (next) => {
        if (!mounted) return
        const value = typeof next === 'function' ? next(slots[idx]) : next
        if (!Object.is(value, slots[idx])) {
          slots[idx] = value
          if (!rendering) render()
          else dirty = true
        }
      }
      return [slots[idx], setState]
    },
    useRef(initial) {
      const idx = cursor++
      if (!(idx in slots)) slots[idx] = { current: initial }
      return slots[idx]
    },
    useMemo(factory, deps) {
      const idx = cursor++
      if (!slots[idx] || depsChanged(slots[idx].deps, deps)) {
        slots[idx] = { deps, value: factory() }
      }
      return slots[idx].value
    },
    useCallback(fn, deps) {
      return react.useMemo(() => fn, deps)
    },
    useEffect(fn, deps) {
      const idx = cursor++
      if (!slots[idx] || depsChanged(slots[idx].deps, deps)) {
        slots[idx] = { deps }
        pendingEffects.push({ idx, fn })
      }
    },
  }

  async function flush() {
    for (let i = 0; i < 16; i += 1) {
      await Promise.resolve()
      if (dirty && mounted) render()
    }
    return latest
  }

  async function advance(ms) {
    const target = now + ms
    while (true) {
      let earliest = null
      for (const timer of timers.values()) {
        if (timer.at <= target && (!earliest || timer.at < earliest.at || (timer.at === earliest.at && timer.id < earliest.id))) {
          earliest = timer
        }
      }
      if (!earliest) break
      now = earliest.at
      timers.delete(earliest.id)
      earliest.fn()
      await flush()
    }
    now = target
    await flush()
    return latest
  }

  /** 模拟浏览器定时器提前 1ms 唤醒。 */
  async function fireEarliestEarly(earlyByMs = 1) {
    let earliest = null
    for (const timer of timers.values()) {
      if (!earliest || timer.at < earliest.at) earliest = timer
    }
    assert.ok(earliest, '应存在待触发的定时器')
    now = Math.max(now, earliest.at - earlyByMs)
    timers.delete(earliest.id)
    earliest.fn()
    await flush()
    return latest
  }

  function jumpNowWithoutTimers(deltaMs) {
    now += deltaMs
  }

  function unmount() {
    mounted = false
    for (const cleanup of cleanups.values()) {
      if (typeof cleanup === 'function') cleanup()
    }
    cleanups.clear()
  }

  return {
    react,
    Date: FakeDate,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    render,
    flush,
    advance,
    fireEarliestEarly,
    jumpNowWithoutTimers,
    unmount,
    get now() { return now },
    get value() { return latest },
    get activeTimerCount() { return timers.size },
  }
}

function makeOrder(nowMs, patch = {}) {
  return {
    id: 'order-A',
    serviceKey: 'resume_optimize',
    serviceName: 'AI 简历优化',
    status: 'paid',
    amountCents: 100,
    expiresAt: new Date(nowMs + 300_000).toISOString(),
    qrCodeContent: null,
    paidAt: new Date(nowMs - 10_000).toISOString(),
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
    ...patch,
  }
}

function chargedConfig(resumeCents = 100) {
  return {
    pricing: {
      isPublicSite: false,
      personalChargeEnabled: true,
      userChargeMode: 'user_pays',
      effective: {
        resume_optimize: resumeCents,
        mock_interview: 0,
        scan: 0,
        print_bw_page: 0,
        print_color_page: 0,
      },
    },
  }
}

function mountTripCharge({
  inspectOrder = true,
  initialNow = 100_000,
  currentUser = null,
  seedTrip = true,
  getOrder,
} = {}) {
  const h = createHookHarness(initialNow)
  const storage = new Map()
  const win = {
    sessionStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(String(k), String(v)) },
      removeItem: (k) => { storage.delete(k) },
    },
  }
  const trips = loadTsModule('src/services/serviceTrip.ts', {}, { window: win, Date: h.Date })
  let user = currentUser
  if (seedTrip) {
    trips.rememberServiceTrip(
      {
        serviceKey: 'resume_optimize',
        orderId: 'order-A',
        kioskSessionId: 'visit-A',
        owner: trips.serviceTripOwnerFor(user?.id),
      },
      h.now,
    )
  }
  const mod = loadTsModule(
    'src/pages/resume/useResumeTripCharge.ts',
    {
      react: h.react,
      '@ai-job-print/shared': {
        TERMINAL_CHARGE_SERVICE_KEYS: ['resume_optimize', 'mock_interview', 'scan', 'print_bw_page', 'print_color_page'],
      },
      '../../auth/useAuth': { useAuth: () => ({ user }) },
      '../../services/api/client': { API_MODE: 'http' },
      '../../services/api/screensaver': { subscribeTerminalIdentity: () => () => {} },
      '../../services/api/serviceOrders': { ...serviceOrdersMod, getServiceOrder: getOrder },
      '../../services/api/terminalConfig': {
        getTerminalId: () => 'KSK-001',
        peekCachedKioskTerminalConfig: () => chargedConfig(100),
        getCachedKioskTerminalConfig: async () => chargedConfig(100),
      },
      '../../services/api/userErrorMessage': { errorCodeOf },
      '../../services/serviceTrip': trips,
      '../pay/payServiceModel': {
        formatYuan: (cents) => `${(cents / 100).toFixed(2)} 元`,
        PAY_BACK: '自动退回原付款账户，到账时间以支付渠道为准',
      },
    },
    { Date: h.Date, setTimeout: h.setTimeout, clearTimeout: h.clearTimeout },
  )
  h.render(() => mod.useResumeTripCharge({ inspectOrder }))
  return {
    h,
    trips,
    mod,
    setUser(nextUser, { clear = true } = {}) {
      user = nextUser
      if (clear) trips.clearServiceTrips('login_handover')
      h.render()
    },
  }
}

test('B1 retryUntil 到点自动触发精准定时器重算，phase 立即切 retry_expired 且 alreadyPaidForOptimize=false', async () => {
  const start = 100_000
  const retryView = makeOrder(start, {
    attemptsUsed: 1,
    failureReason: 'optimize_failed',
    retryUntil: new Date(start + 500).toISOString(),
  })
  const env = mountTripCharge({
    initialNow: start,
    inspectOrder: true,
    getOrder: async () => retryView,
  })
  await env.h.flush()

  assert.equal(env.h.value.phase, 'retry_free')
  assert.equal(env.h.value.alreadyPaidForOptimize, true)
  assert.equal(env.h.value.canFreeRetry, true)
  assert.equal(env.h.value.refundablePaid, true)
  assert.equal(env.h.activeTimerCount, 1, '应为 retryUntil 装上精准到期定时器')

  // 499ms 时仍在窗口内
  await env.h.advance(499)
  assert.equal(env.h.value.phase, 'retry_free')
  assert.equal(env.h.value.alreadyPaidForOptimize, true)
  assert.equal(env.h.value.canFreeRetry, true)

  // 再走 1ms（不手动 render、不重新查单）：定时器自动触发重算
  await env.h.advance(1)
  assert.equal(env.h.value.phase, 'retry_expired')
  assert.equal(env.h.value.alreadyPaidForOptimize, false)
  assert.equal(env.h.value.canFreeRetry, false)
  assert.equal(env.h.value.refundablePaid, true, '重试过期仍由服务端原路退回')
  assert.equal(env.h.activeTimerCount, 0)

  env.h.unmount()
})

test('B1b retryUntil 定时器早醒 1ms 重排、同步跨点重渲染实时重判，且卸载清理定时器', async () => {
  const start = 200_000
  const retryView = makeOrder(start, {
    attemptsUsed: 1,
    retryUntil: new Date(start + 500).toISOString(),
  })

  // 1) 早醒 1ms：重排并在真正到点时刻切换
  const env1 = mountTripCharge({ initialNow: start, getOrder: async () => retryView })
  await env1.h.flush()
  await env1.h.fireEarliestEarly(1)
  assert.equal(env1.h.value.phase, 'retry_free', '早醒 1ms 尚未到点，不得提前判过期')
  assert.equal(env1.h.activeTimerCount, 1, '早醒后应重排剩余 1ms 定时器')
  await env1.h.advance(1)
  assert.equal(env1.h.value.phase, 'retry_expired')
  assert.equal(env1.h.value.alreadyPaidForOptimize, false)
  env1.h.unmount()

  // 2) 不依赖定时器触发，仅推进 Date.now() 后重渲染也实时重判（不沿用旧 phase）
  const env2 = mountTripCharge({ initialNow: start, getOrder: async () => retryView })
  await env2.h.flush()
  assert.equal(env2.h.value.alreadyPaidForOptimize, true)
  env2.h.jumpNowWithoutTimers(600)
  env2.h.render()
  assert.equal(env2.h.value.phase, 'retry_expired')
  assert.equal(env2.h.value.alreadyPaidForOptimize, false)
  assert.equal(env2.h.value.canFreeRetry, false)
  // 卸载清理定时器
  env2.h.unmount()
  assert.equal(env2.h.activeTimerCount, 0, '卸载时必须清理到期定时器')
})

test('B2 refreshOrder 在途切用户/清场/换单/并发乱序/晚到 404 均不得污染新状态', async () => {
  const start = 300_000

  // 1) 旧用户 refreshOrder 在途 → 切新会员并清场 → 晚到 retry_free 响应必须丢弃
  const pending1 = deferred()
  const env1 = mountTripCharge({ initialNow: start, inspectOrder: false, getOrder: () => pending1.promise })
  await env1.h.flush()
  const inflight1 = env1.h.value.refreshOrder()
  env1.setUser({ id: 'member-B' }, { clear: true })
  await env1.h.flush()
  assert.equal(env1.h.value.trip, null)
  pending1.resolve(makeOrder(start, { attemptsUsed: 1, retryUntil: new Date(start + 600_000).toISOString() }))
  const res1 = await inflight1
  await env1.h.flush()
  assert.equal(res1, null)
  assert.equal(env1.h.value.trip, null)
  assert.equal(env1.h.value.order, null)
  assert.equal(env1.h.value.phase, null)
  assert.equal(env1.h.value.alreadyPaidForOptimize, false)
  assert.equal(env1.h.value.canFreeRetry, false)
  assert.equal(env1.h.value.refundablePaid, false)
  assert.equal(env1.h.value.checkingOrder, false)
  env1.h.unmount()

  // 2) 同用户 refreshOrder 在途 → 触发隐私清场 clearServiceTrips('clear') → 晚到响应必须丢弃
  const pending2 = deferred()
  const env2 = mountTripCharge({ initialNow: start, inspectOrder: false, getOrder: () => pending2.promise })
  await env2.h.flush()
  const inflight2 = env2.h.value.refreshOrder()
  env2.trips.clearServiceTrips('clear')
  await env2.h.flush()
  pending2.resolve(makeOrder(start, { status: 'paid', attemptsUsed: 0 }))
  assert.equal(await inflight2, null)
  await env2.h.flush()
  assert.equal(env2.h.value.trip, null)
  assert.equal(env2.h.value.order, null)
  assert.equal(env2.h.value.alreadyPaidForOptimize, false)
  assert.equal(env2.h.value.refundablePaid, false)
  env2.h.unmount()

  // 3) 同用户 refreshOrder 在途 → 本地未发清场事件但换成了新单 order-B → 旧单 order-A 晚到响应必须因单号核验丢弃
  const pending3 = deferred()
  const env3 = mountTripCharge({ initialNow: start, inspectOrder: false, getOrder: () => pending3.promise })
  await env3.h.flush()
  const inflight3 = env3.h.value.refreshOrder()
  env3.trips.rememberServiceTrip(
    { serviceKey: 'resume_optimize', orderId: 'order-B', kioskSessionId: 'visit-B', owner: { kind: 'guest' } },
    start + 10,
  )
  pending3.resolve(makeOrder(start, { id: 'order-A', status: 'paid', attemptsUsed: 0 }))
  assert.equal(await inflight3, null)
  await env3.h.flush()
  assert.equal(env3.h.value.order, null)
  assert.equal(env3.h.value.alreadyPaidForOptimize, false)
  env3.h.unmount()

  // 4) 同用户两次并发 refreshOrder：后发先至（retry_expired），先发晚到（paid）不得覆盖新结果
  const reqSlow = deferred()
  const reqFast = deferred()
  let callIndex = 0
  const env4 = mountTripCharge({
    initialNow: start,
    inspectOrder: false,
    getOrder: () => (++callIndex === 1 ? reqSlow.promise : reqFast.promise),
  })
  await env4.h.flush()
  const slowP = env4.h.value.refreshOrder()
  const fastP = env4.h.value.refreshOrder()
  reqFast.resolve(makeOrder(start, { attemptsUsed: 1, retryUntil: new Date(start - 1_000).toISOString() }))
  await fastP
  await env4.h.flush()
  assert.equal(env4.h.value.phase, 'retry_expired')
  reqSlow.resolve(makeOrder(start, { status: 'paid', attemptsUsed: 0 }))
  assert.equal(await slowP, null)
  await env4.h.flush()
  assert.equal(env4.h.value.phase, 'retry_expired', '旧代次晚到 paid 不得覆盖新代次 retry_expired')
  assert.equal(env4.h.value.alreadyPaidForOptimize, false)
  env4.h.unmount()

  // 5) 旧用户 refreshOrder 晚到 404 SERVICE_ORDER_NOT_FOUND：不得抹掉新用户的已记单号
  const reqOld404 = deferred()
  const env5 = mountTripCharge({
    initialNow: start,
    inspectOrder: false,
    getOrder: async (orderId) => (orderId === 'order-A' ? reqOld404.promise : makeOrder(start, { id: 'order-B' })),
  })
  await env5.h.flush()
  const old404 = env5.h.value.refreshOrder()
  env5.setUser({ id: 'member-B' }, { clear: true })
  env5.trips.rememberServiceTrip(
    { serviceKey: 'resume_optimize', orderId: 'order-B', kioskSessionId: 'visit-B', owner: env5.trips.serviceTripOwnerFor('member-B') },
    start + 20,
  )
  await env5.h.value.refreshOrder()
  await env5.h.flush()
  assert.equal(env5.h.value.trip?.orderId, 'order-B')
  assert.equal(env5.h.value.alreadyPaidForOptimize, true)
  reqOld404.reject({ code: 'SERVICE_ORDER_NOT_FOUND' })
  assert.equal(await old404, null)
  await env5.h.flush()
  assert.equal(env5.h.value.trip?.orderId, 'order-B', '旧单晚到 404 不得清空新用户 trip')
  assert.equal(env5.h.value.alreadyPaidForOptimize, true)
  env5.h.unmount()

  // 6) inspectOrder=true 初始化查单在途切用户 → 晚到响应丢弃
  const initPending = deferred()
  const env6 = mountTripCharge({ initialNow: start, inspectOrder: true, getOrder: () => initPending.promise })
  await env6.h.flush()
  assert.equal(env6.h.value.checkingOrder, true)
  env6.setUser({ id: 'member-C' }, { clear: true })
  await env6.h.flush()
  initPending.resolve(makeOrder(start, { status: 'paid', attemptsUsed: 0 }))
  await env6.h.flush()
  assert.equal(env6.h.value.trip, null)
  assert.equal(env6.h.value.order, null)
  assert.equal(env6.h.value.alreadyPaidForOptimize, false)
  assert.equal(env6.h.value.checkingOrder, false)
  env6.h.unmount()
})

function findElementProps(node, targetType) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findElementProps(item, targetType)
      if (hit) return hit
    }
    return null
  }
  if (node.type === targetType) return node.props ?? null
  return findElementProps(node.props?.children, targetType)
}

async function renderReportWithProvider({ httpProviderName, stateProviderName, search = '' }) {
  const h = createHookHarness(400_000)
  const dockCalls = []
  const TakeawayStub = () => null
  const ResumeTouchPageStub = ({ children }) => children
  const sampleReport = {
    sections: [{ key: 'objective', label: '求职目标', score: 6, maxScore: 10, summary: '缺少明确岗位' }],
    suggestions: ['写明目标岗位'],
    contentBlocks: [{ key: 'summary', title: '个人简介', lines: ['内容运营方向'] }],
    issues: [{ id: 'I1', dim: 'objective', title: '求职目标', evidence: [], impact: '缺少目标', fixIt: '写明岗位' }],
  }
  const realModel = loadTsModule(
    'src/pages/resume/resume-report-model.ts',
    {
      '../../utils/buildMode': { ALLOW_FIXTURES: true },
      '@ai-job-print/shared': { RESUME_CONTENT_BLOCKS: [], RESUME_SCORING_DIMENSIONS: [] },
    },
    { Date: h.Date },
  )
  const routeState = stateProviderName
    ? { taskId: 'task-demo-1', accessToken: 'tok-1', providerName: stateProviderName, report: sampleReport, targetContext: { targetJob: '运营' } }
    : { taskId: 'task-demo-1', accessToken: 'tok-1' }

  const getToken = () => null
  const navigate = () => {}
  const locationObj = { pathname: '/resume/report', search, state: routeState }
  const authValue = { getToken }
  const supportValue = { servicePhone: '' }
  const licenseValue = { mode: 'active' }
  const startPrint = () => {}
  const tripChargeValue = {
    resumePriceCents: 100,
    machineCharged: true,
    trip: null,
    headers: undefined,
    order: null,
    phase: null,
    checkingOrder: false,
    alreadyPaidForOptimize: false,
    canFreeRetry: false,
    refundablePaid: false,
    refreshOrder: async () => null,
  }

  const mod = loadTsModule(
    'src/pages/resume/ResumeReportPage.tsx',
    {
      react: h.react,
      'react-router-dom': {
        useNavigate: () => navigate,
        useLocation: () => locationObj,
      },
      '@ai-job-print/shared': {
        AI_LABEL_COPY: { RESUME_DIAGNOSIS: 'AI 生成诊断' },
        COMPLIANCE_COPY: {
          KIOSK_RESUME_DEMO_NOTICE: '演示报告提示',
          KIOSK_RESUME_REPORT_DISCLAIMER: '免责声明',
          KIOSK_RESUME_NO_SEND_ENTERPRISE: '不发企业',
        },
      },
      '../../layouts/KioskLicenseContext': {
        useKioskLicense: () => licenseValue,
        useWindDownViewOnly: () => false,
      },
      '../../layouts/LicenseLock': { LicenseLock: ({ children }) => children },
      '../../copy/unattendedCopy': { LICENSE_NO_NEW_TASK_REASON: '仅查看' },
      '../../auth/useAuth': { useAuth: () => authValue },
      '../../hooks/useSupportContact': { useSupportContact: () => supportValue },
      '../../services/api': {
        getResumeRecord: async () => ({
          taskId: 'task-demo-1',
          status: 'completed',
          providerName: httpProviderName,
          report: sampleReport,
          targetContext: { targetJob: '运营' },
        }),
      },
      '../../ai': { isAiOutage: () => false },
      '../../components/PdfCanvasPreview': { checkPdfOpeningPassword: async () => false },
      '../print/components/printPreviewKind': {
        ENCRYPTED_PDF_BLOCK_COPY: '加密',
        inspectionSignalsEncrypted: () => false,
        previewKindForFile: () => 'other',
      },
      '../print/usePrintHandoff': { useStartPrintHandoff: () => startPrint },
      './resumeUserCopy': { resumeUserReason: (s, fallback) => s ?? fallback },
      './touch/ResumeTouchPage': { ResumeTouchPage: ResumeTouchPageStub },
      '../../components/qingxu/touch/QxTouchIcon': { QxTouchIcon: () => null },
      './components/ResumeDiagnosisFailExits': { ResumeDiagnosisFailExits: () => null },
      './aiResumeSession': { readAiResumeSession: () => null, saveAiResumeSession: () => {} },
      '../pay/payServiceModel': { payServicePath: () => '/pay/resume?next=optimize&back=report' },
      './useResumeTripCharge': {
        diagnosisPayButtonLabel: (cents) => `付 ${(cents / 100).toFixed(2)} 元并开始`,
        diagnosisPriceNote: (cents) => `这一次 ${(cents / 100).toFixed(2)} 元。诊断免费，付好了才开始改。`,
        useResumeTripCharge: () => tripChargeValue,
      },
      './resume-report-model': realModel,
      './resume-report-fixture': { fixtureReport: () => sampleReport },
      './components/resume-report/ResumeReportStates': { ResumeReportStates: () => null },
      './components/resume-report/ResumeReportBody': { EmptyReportBody: () => null, ResumeReportBody: () => null },
      './components/resume-report/ResumeReportActions': {
        useReportDockPrimary: (args) => {
          dockCalls.push(args)
          return { label: args.payLabel ?? '查看优化建议', onClick: () => {} }
        },
      },
      './components/resume-report/ResumeReportTakeaway': { ResumeReportTakeaway: TakeawayStub },
    },
    { Date: h.Date, setTimeout: h.setTimeout, clearTimeout: h.clearTimeout },
  )

  h.render(() => mod.ResumeReportPage())
  await h.flush()
  const tree = h.value
  const lastDock = dockCalls[dockCalls.length - 1]
  const takeawayProps = findElementProps(tree, TakeawayStub)
  h.unmount()
  return { lastDock, takeawayProps }
}

test('B3 HTTP 返回或路由传入 providerName=mock 演示报告在收费机器上必须隔离付款入口与收费说明', async () => {
  // 1) HTTP 返回 providerName === 'mock'（isFixture=false）：正常报告态但无付款按钮、无价格说明
  const httpMock = await renderReportWithProvider({ httpProviderName: 'mock' })
  assert.equal(httpMock.lastDock?.viewState, 'report')
  assert.equal(httpMock.lastDock?.canOptimize, true)
  assert.equal(httpMock.lastDock?.payLabel, null, 'HTTP 返回 providerName=mock 时不得展示付款按钮')
  assert.ok(httpMock.takeawayProps, '应实际渲染 ResumeReportTakeaway')
  assert.equal(httpMock.takeawayProps.optimizePriceNote, null, 'HTTP 返回 providerName=mock 时不得展示收费说明')

  // 2) 路由状态传入 providerName === 'mock'（isFixture=false）：同样无付款按钮、无价格说明
  const stateMock = await renderReportWithProvider({ stateProviderName: 'mock' })
  assert.equal(stateMock.lastDock?.viewState, 'report')
  assert.equal(stateMock.lastDock?.canOptimize, true)
  assert.equal(stateMock.lastDock?.payLabel, null, '路由传入 providerName=mock 时不得展示付款按钮')
  assert.ok(stateMock.takeawayProps)
  assert.equal(stateMock.takeawayProps.optimizePriceNote, null, '路由传入 providerName=mock 时不得展示收费说明')

  // 3) 对照组：真实模型 providerName === 'deepseek' 正常展示付款按钮与价格说明
  const realProvider = await renderReportWithProvider({ httpProviderName: 'deepseek' })
  assert.equal(realProvider.lastDock?.viewState, 'report')
  assert.equal(realProvider.lastDock?.canOptimize, true)
  assert.equal(realProvider.lastDock?.payLabel, '付 1.00 元并开始')
  assert.ok(realProvider.takeawayProps)
  assert.match(String(realProvider.takeawayProps.optimizePriceNote ?? ''), /这一次 1\.00 元/)

  // 4) capture 合成演示（isFixture=true）同样隔离付款入口与价格说明
  const fixtureCase = await renderReportWithProvider({ httpProviderName: 'deepseek', search: '?capture=1&state=report' })
  assert.equal(fixtureCase.lastDock?.viewState, 'report')
  assert.equal(fixtureCase.lastDock?.canOptimize, true)
  assert.equal(fixtureCase.lastDock?.payLabel, null)
  assert.ok(fixtureCase.takeawayProps)
  assert.equal(fixtureCase.takeawayProps.optimizePriceNote, null)
})
