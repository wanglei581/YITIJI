/**
 * 扫描按次付款边界运行态回归（P2e-4b）：
 * 直接转译并执行真实的 useScanSessionCreate.ts / ScanDeviceSettingsPage.tsx /
 * useScanDeviceStart.ts / useScanPayGate.ts，覆盖 4 项边界收口：
 * 1. 面板设置页直达/刷新：建会话前前置付款核验，收费未付绝不发 POST /scan/sessions 直接跳付款屏；
 * 2. 屏上设置页价目/查单加载中（pay.loading === true）：主按钮禁用且点击守卫拦住抢跑；
 * 3. 402 / SERVICE_* 回跳付款屏：绝不重装自动启动位，同单至多自动续接一次，不可复用旧单先忘单；
 * 4. 旧已结案单（consumed + settledAt）：新一趟查单当场清旧 trip、结果页按任务归属核对绝不串旧金额。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const kioskRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const scanDir = join(kioskRoot, 'src/pages/scan')

class ApiHttpError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

const noop = () => {}
const pending = () => new Promise(noop)
const tick = () => new Promise((r) => setImmediate(r))
const NOW = Date.now()

function makeOrder(extra = {}) {
  return {
    id: 'old-order-137',
    serviceKey: 'scan',
    serviceName: '扫描',
    status: 'paid',
    amountCents: 137,
    expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
    qrCodeContent: null,
    paidAt: new Date(NOW - 30_000).toISOString(),
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
    ...extra,
  }
}

function makeHookRuntime() {
  const cells = []
  let idx = 0
  const effects = []
  return {
    reset() { idx = 0 },
    effects,
    react: {
      useState(init) {
        const k = idx++
        if (!(k in cells)) cells[k] = typeof init === 'function' ? init() : init
        return [cells[k], (v) => { cells[k] = typeof v === 'function' ? v(cells[k]) : v }]
      },
      useRef(init) {
        const k = idx++
        if (!(k in cells)) cells[k] = { current: init }
        return cells[k]
      },
      useCallback(fn) {
        idx++
        return fn
      },
      useEffect(fn, deps) {
        const k = idx++
        const prev = cells[k]
        if (!prev || !deps || deps.some((v, i) => v !== prev[i])) {
          cells[k] = deps
          effects.push(fn)
        }
      },
      useSyncExternalStore(_sub, get) {
        return get()
      },
    },
  }
}

function createLoader(overrides = {}, context = {}) {
  const cache = new Map()
  return function load(filePath) {
    const abs = resolve(filePath)
    if (cache.has(abs)) return cache.get(abs)
    const mod = { exports: {} }
    cache.set(abs, mod.exports)
    const js = ts.transpileModule(readFileSync(abs, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: abs,
    }).outputText
    const req = (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name]
      if (name.endsWith('.css')) return {}
      if (name.includes('httpAdapter')) return { ApiHttpError }
      if (name.includes('userErrorMessage')) return { errorCodeOf: (e) => e?.code, userMessageOf: (_e, fb) => fb }
      if (name.includes('terminalAuth')) return { terminalProtectedFetch: pending }
      if (name.endsWith('/client') || name === './client') return { API_MODE: 'http', API_BASE_URL: '/api/v1' }
      if (name.includes('throwHttpError')) return { networkError: (e) => e, readHttpError: pending }
      if (name.startsWith('.')) {
        let target = resolve(dirname(abs), name)
        if (!extname(target)) target += existsSync(`${target}.ts`) ? '.ts' : '.tsx'
        return load(target)
      }
      throw new Error(`unmocked module ${name} from ${abs}`)
    }
    vm.runInNewContext(
      `(function(require,module,exports){${js}\n})`,
      { console, Date, Promise, URLSearchParams, Set, Map, WeakMap, setTimeout, clearTimeout, window: { setTimeout, clearTimeout }, ...context },
      { filename: abs },
    )(req, mod, mod.exports)
    cache.set(abs, mod.exports)
    return mod.exports
  }
}

const orders = createLoader()(join(kioskRoot, 'src/services/api/serviceOrders.ts'))
const payModel = createLoader()(join(scanDir, 'scanPayModel.ts'))

test('1. 面板路径直达设置页：未付收费机先过前置付款闸门，0 次 createScanSession 直接跳付款屏', async () => {
  const rt = makeHookRuntime()
  const calls = []
  const nav = []
  const forgotten = []
  let currentTrip = null
  const config = { pricing: { personalChargeEnabled: true, userChargeMode: 'user_pays', isPublicSite: false, effective: { scan: 100 } } }
  const refs = {}
  for (const name of [
    'confirmedRef', 'createdIdRef', 'controlTokenRef', 'restoredFromStorageRef', 'rescanIntentRef',
    'skipCreateRef', 'sessionPromiseRef', 'createGenerationRef', 'createTokenRef', 'ackRequestedForRef',
    'unmountedRef', 'terminalFailClosedRef', 'creationAbandonedRef',
  ]) {
    refs[name] = { current: name === 'sessionPromiseRef' ? null : false }
  }
  const input = new Proxy(
    { ...refs, scanType: 'document', terminalSession: 'ready', onGoStage: noop },
    { get: (t, k) => (k in t ? t[k] : String(k).startsWith('set') ? noop : false) },
  )

  const base = {
    react: rt.react,
    'react-router-dom': { useNavigate: () => (to) => nav.push(to) },
    '../../auth/useAuth': { useAuth: () => ({ getToken: () => null, user: null }) },
    '../../auth/kioskSensitiveSession': { subscribeKioskSensitiveSessionClear: noop },
    '../../services/api/screensaver': { getTerminalId: () => 'KSK-001' },
    '../../services/api/terminalConfig': {
      getTerminalId: () => 'KSK-001',
      peekCachedKioskTerminalConfig: () => null,
      getCachedKioskTerminalConfig: async () => config,
    },
    '../../services/api/serviceOrders': { ...orders, getServiceOrder: async () => makeOrder({ status: 'consumed', settledAt: new Date(NOW).toISOString(), attemptsUsed: 1 }) },
    '../../services/serviceTrip': {
      onServiceTripsCleared: noop,
      readServiceTrip: () => currentTrip,
      serviceTripOwnerFor: () => ({ kind: 'guest' }),
      forgetServiceTrip: (_k, id) => { forgotten.push(id); currentTrip = null },
    },
    '../../services/api/scanTasks': { createScanSession: (...args) => { calls.push(args); return pending() } },
    './scanCleanupGate': { scanCleanupInProgress: () => false, trackScanSessionCreation: noop },
    './scanSettingsModel': { liveSessionStillValid: () => false },
    './scanRescanRecovery': { isRescanRefusedByServer: () => false, classifyCreateFailure: () => ({ failure: {} }) },
    './scanShownText': { scanShownText: (x) => x },
    './scanWorkbenchSession': {
      scanLifecycleGeneration: () => 1,
      takeScanRescanAuthority: () => null,
      readScanWorkbenchSession: () => null,
      restoreScanRescanAuthority: () => false,
      discardTakenScanRescanAuthority: noop,
    },
  }
  const load = createLoader(base)
  const mod = load(join(scanDir, 'useScanSessionCreate.ts'))

  const render = () => {
    rt.reset()
    mod.useScanSessionCreate(input)
    rt.effects.splice(0).forEach((fn) => fn())
  }
  // 首次加载价目中：0 次 create，0 次跳转
  render()
  assert.equal(calls.length, 0)
  assert.equal(nav.length, 0)
  // 价目返回 100 分、无已付单：仍 0 次 create，直接跳 /pay/scan?next=settings&back=how
  await tick()
  render()
  assert.equal(calls.length, 0, '收费未付直达设置页绝不得发 createScanSession')
  assert.equal(nav[0], '/pay/scan?next=settings&back=how')

  // 带旧已结案单直达设置页：先忘旧单、0 次 create、跳付款屏
  const rt2 = makeHookRuntime()
  currentTrip = { serviceKey: 'scan', orderId: 'old-settled-1', kioskSessionId: 'old-sess' }
  const nav2 = []
  const mod2 = createLoader({ ...base, react: rt2.react, 'react-router-dom': { useNavigate: () => (to) => nav2.push(to) } })(join(scanDir, 'useScanSessionCreate.ts'))
  const render2 = () => { rt2.reset(); mod2.useScanSessionCreate(input); rt2.effects.splice(0).forEach((fn) => fn()) }
  render2()
  await tick()
  render2()
  assert.equal(calls.length, 0)
  assert.deepEqual(forgotten, ['old-settled-1'])
  assert.equal(nav2[0], '/pay/scan?next=settings&back=how')
})

test('2. 屏上扫描价目/查单加载中：主按钮禁用且点击守卫拦住抢跑，加载完区分收费与免费', () => {
  const jsx = (type, props) => ({ type, props })
  function renderDevicePage(pay) {
    let started = 0
    const nav = []
    const m = createLoader({
      react: { useState: (v) => [typeof v === 'function' ? v() : v, noop], useCallback: (f) => f, useEffect: noop },
      'react/jsx-runtime': { jsx, jsxs: jsx },
      'react-router-dom': { useNavigate: () => (to) => nav.push(to) },
      '../../auth/useAuth': { useAuth: () => ({ getToken: () => null, user: null }) },
      '../../components/qingxu/touch/QxTouchIcon': { QxTouchIcon: noop },
      '../../hooks/useTerminalDeviceStatus': { useLocalScanProbe: () => ({ phase: 'done', freshReady: true }) },
      './ScanGuideArt': {},
      './scanProbeCopy': { scanReadyChipText: () => '' },
      './ScanWorkbenchChrome': { ScanWorkbenchShell: noop },
      './scanWorkbenchSession': { readScanWorkbenchSession: () => ({ material: 'document', scanType: 'document' }), patchScanWorkbenchSession: noop },
      './useScanDeviceCapability': { useScanDeviceCapability: () => ({ loading: false, allowed: true }) },
      './scanDeviceRecovery': {},
      './useScanDeviceStart': { useScanDeviceStartState: () => ({ phase: 'idle', locked: false }), beginDeviceScan: () => { started += 1 } },
      './useScanPayGate': {
        useScanPayState: () => pay,
        armScanDeviceAutoStartAfterPay: noop,
        clearScanDeviceAutoStartAfterPay: noop,
        forgetEndedScanTrip: noop,
        useScanDevicePayResume: noop,
      },
    })(join(scanDir, 'ScanDeviceSettingsPage.tsx'))
    const page = m.ScanDeviceSettingsPage({ onGoStage: noop })
    return { primary: page.props.dock.primary, nav, starts: () => started }
  }

  // 加载中：禁用、不显示「开始扫描」、强行触发 onClick 也 0 次建会话
  const loadingView = renderDevicePage({ loading: true, chargeCents: null, trip: null, order: null, needsPayment: false, readyToCreate: false })
  assert.equal(loadingView.primary.disabled, true)
  assert.notEqual(loadingView.primary.label, '开始扫描')
  loadingView.primary.onClick()
  assert.equal(loadingView.starts(), 0, '加载期间强行触发 onClick 也必须守卫拦截')
  assert.equal(loadingView.nav.length, 0)

  // 加载完且读不到价 / 免费：恢复可点「开始扫描」
  const freeView = renderDevicePage({ loading: false, chargeCents: null, trip: null, order: null, needsPayment: false, readyToCreate: true })
  assert.equal(freeView.primary.disabled, false)
  assert.equal(freeView.primary.label, '开始扫描')

  // 加载完且收费未付：显示「付 1.00 元开始扫描」
  const chargedView = renderDevicePage({ loading: false, chargeCents: 100, trip: null, order: null, needsPayment: true, readyToCreate: false })
  assert.equal(chargedView.primary.disabled, false)
  assert.equal(chargedView.primary.label, '付 1.00 元开始扫描')
})

test('3. 402 持续拒单 + 查单持续 paid：1 次点击最多发 1 次创建、绝不重装自动启动循环；不可复用错误码先忘单', async () => {
  const rt = makeHookRuntime()
  const nav = []
  const calls = []
  const forgotten = []
  const trip = { serviceKey: 'scan', orderId: 'paid-loop-1', kioskSessionId: 'visit-loop-1' }
  const paid = makeOrder({ id: 'paid-loop-1' })
  const jsx = (type, props) => ({ type, props })
  const session = { material: 'document', scanType: 'document' }
  let rejectCode = 'SERVICE_PAYMENT_REQUIRED'

  const base = {
    react: rt.react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-router-dom': { useNavigate: () => (to) => nav.push(to) },
    '../../auth/useAuth': { useAuth: () => ({ getToken: () => null, user: null }) },
    '../../auth/kioskSensitiveSession': { subscribeKioskSensitiveSessionClear: noop },
    '../../services/serviceTrip': {
      onServiceTripsCleared: noop,
      readServiceTrip: () => trip,
      serviceTripOwnerFor: () => ({ kind: 'guest' }),
      forgetServiceTrip: (_k, id) => forgotten.push(id),
    },
    '../../services/api/terminalConfig': { getTerminalId: () => 'KSK-001' },
    '../../services/api/screensaver': { getTerminalId: () => 'KSK-001' },
    './scanWorkbenchSession': {
      scanLifecycleGeneration: () => 1,
      readScanWorkbenchSession: () => session,
      patchScanWorkbenchSession: (p) => Object.assign(session, p),
    },
    '../../services/api/scanTasks': {
      createScanSession: (...a) => {
        calls.push(a)
        return Promise.reject(new ApiHttpError(rejectCode, 'pay required', 402))
      },
    },
    '../../services/scan/localScanApi': {},
    './scanDeliveryAck': {},
    './scanSessionRevoke': {},
    './scanDeviceEpoch': {},
    '../../components/qingxu/touch/QxTouchIcon': {},
    '../../hooks/useTerminalDeviceStatus': { useLocalScanProbe: () => ({ phase: 'done', freshReady: true }) },
    './ScanGuideArt': {},
    './scanProbeCopy': { scanReadyChipText: () => '' },
    './ScanWorkbenchChrome': {},
    './useScanDeviceCapability': { useScanDeviceCapability: () => ({ loading: false, allowed: true }) },
    './scanDeviceRecovery': {},
  }
  const gate = createLoader(base)(join(scanDir, 'useScanPayGate.ts'))
  const actualGate = {
    ...gate,
    useScanPayState: () => ({ loading: false, chargeCents: 100, trip, order: paid, needsPayment: false, readyToCreate: true }),
  }
  const start = createLoader({ ...base, './useScanPayGate': actualGate })(join(scanDir, 'useScanDeviceStart.ts'))
  const page = createLoader({ ...base, './useScanPayGate': actualGate, './useScanDeviceStart': start })(join(scanDir, 'ScanDeviceSettingsPage.tsx'))

  const render = () => {
    rt.reset()
    const p = page.ScanDeviceSettingsPage({ onGoStage: noop })
    rt.effects.splice(0).forEach((fn) => fn())
    return p
  }
  const p = render()
  p.props.dock.primary.onClick()
  await tick()
  for (let i = 0; i < 4; i += 1) {
    render()
    await tick()
  }
  assert.equal(calls.length, 1, '1 次点击后 402 回跳绝不重装自动启动循环')
  assert.equal(nav.length, 1)
  assert.equal(gate.isScanDeviceAutoStartArmed(), false)

  // 同单号即使再次手动武装也不允许自动续接第二次
  gate.armScanDeviceAutoStartAfterPay()
  assert.equal(gate.consumeScanDeviceAutoStartAfterPay('paid-loop-1'), false)

  // 不可复用错误码（SERVICE_ORDER_EXPIRED 等）必须先忘旧单
  rejectCode = 'SERVICE_ORDER_EXPIRED'
  start.beginDeviceScan({ material: 'document', choice: { source: 'feeder', colorMode: 'gray' }, memberToken: null, onGoStage: noop, onNeedPay: noop })
  await tick()
  assert.deepEqual(forgotten, ['paid-loop-1'])
})

test('4. 旧已结案单（consumed+settledAt）在新一趟被自动清掉，且未绑定结果页绝不展示旧实付金额', async () => {
  let generation = 1
  const oldSettled = makeOrder({ id: 'old-settled-137', status: 'consumed', amountCents: 137, attemptsUsed: 1, settledAt: new Date(NOW).toISOString() })
  let storedTrip = { serviceKey: 'scan', orderId: oldSettled.id, kioskSessionId: 'old-visit', owner: { kind: 'guest' }, savedAt: NOW }
  const forgotten = []
  const rt = makeHookRuntime()

  const gate = createLoader({
    react: rt.react,
    '../../auth/useAuth': { useAuth: () => ({ user: null }) },
    '../../auth/kioskSensitiveSession': { subscribeKioskSensitiveSessionClear: noop },
    '../../services/api/serviceOrders': { ...orders, getServiceOrder: async () => oldSettled },
    '../../services/api/terminalConfig': {
      getTerminalId: () => 'KSK-001',
      peekCachedKioskTerminalConfig: () => ({ pricing: { personalChargeEnabled: true, userChargeMode: 'user_pays', isPublicSite: false, effective: { scan: 137 } } }),
      getCachedKioskTerminalConfig: async () => ({ pricing: { personalChargeEnabled: true, userChargeMode: 'user_pays', isPublicSite: false, effective: { scan: 137 } } }),
    },
    '../../services/serviceTrip': {
      onServiceTripsCleared: noop,
      readServiceTrip: () => storedTrip,
      serviceTripOwnerFor: () => ({ kind: 'guest' }),
      forgetServiceTrip: (_k, id) => { forgotten.push(id); storedTrip = null },
    },
    './scanWorkbenchSession': { scanLifecycleGeneration: () => generation },
  })(join(scanDir, 'useScanPayGate.ts'))

  // 场景 A：当前这趟任务 task-1 确实是用 old-settled-137 建的 → 即使已 settled 仍显示 137 分
  gate.recordScanTaskOrder('task-1', oldSettled.id)
  rt.reset()
  gate.useScanTripOrder({ taskId: 'task-1' })
  rt.effects.splice(0).forEach((fn) => fn())
  await tick()
  rt.reset()
  const ownedResult = gate.useScanTripOrder({ taskId: 'task-1' })
  assert.equal(payModel.scanPaidAmountCentsForDone(ownedResult.order), 137)

  // 场景 B：用户绕过显式出口离开（代次推进到 2），新一趟未付结果页查单 → 绝不展示旧金额且清旧单
  generation = 2
  const rt2 = makeHookRuntime()
  const gate2 = createLoader({
    react: rt2.react,
    '../../auth/useAuth': { useAuth: () => ({ user: null }) },
    '../../auth/kioskSensitiveSession': { subscribeKioskSensitiveSessionClear: noop },
    '../../services/api/serviceOrders': { ...orders, getServiceOrder: async () => oldSettled },
    '../../services/api/terminalConfig': { getTerminalId: () => 'KSK-001' },
    '../../services/serviceTrip': {
      onServiceTripsCleared: noop,
      readServiceTrip: () => storedTrip,
      serviceTripOwnerFor: () => ({ kind: 'guest' }),
      forgetServiceTrip: (_k, id) => { forgotten.push(id); storedTrip = null },
    },
    './scanWorkbenchSession': { scanLifecycleGeneration: () => generation },
  })(join(scanDir, 'useScanPayGate.ts'))
  rt2.reset()
  gate2.useScanTripOrder()
  rt2.effects.splice(0).forEach((fn) => fn())
  await tick()
  rt2.reset()
  const staleResult = gate2.useScanTripOrder()
  assert.equal(staleResult.order, null, '跨代次旧已结案单绝不得透给新结果页')
  assert.equal(payModel.scanPaidAmountCentsForDone(staleResult.order), null)
  assert.deepEqual(forgotten, [oldSettled.id])

  // 场景 C：新一趟进入 useScanPayState 时残留旧已结案单 → 立即忘掉旧单并切 needsPayment=true
  storedTrip = { serviceKey: 'scan', orderId: oldSettled.id, kioskSessionId: 'old-visit', owner: { kind: 'guest' }, savedAt: NOW }
  const rt3 = makeHookRuntime()
  const gate3 = createLoader({
    react: rt3.react,
    '../../auth/useAuth': { useAuth: () => ({ user: null }) },
    '../../auth/kioskSensitiveSession': { subscribeKioskSensitiveSessionClear: noop },
    '../../services/api/serviceOrders': { ...orders, getServiceOrder: async () => oldSettled },
    '../../services/api/terminalConfig': {
      getTerminalId: () => 'KSK-001',
      peekCachedKioskTerminalConfig: () => ({ pricing: { personalChargeEnabled: true, userChargeMode: 'user_pays', isPublicSite: false, effective: { scan: 137 } } }),
      getCachedKioskTerminalConfig: async () => ({ pricing: { personalChargeEnabled: true, userChargeMode: 'user_pays', isPublicSite: false, effective: { scan: 137 } } }),
    },
    '../../services/serviceTrip': {
      onServiceTripsCleared: noop,
      readServiceTrip: () => storedTrip,
      serviceTripOwnerFor: () => ({ kind: 'guest' }),
      forgetServiceTrip: (_k, id) => { forgotten.push(id); storedTrip = null },
    },
    './scanWorkbenchSession': { scanLifecycleGeneration: () => generation },
  })(join(scanDir, 'useScanPayGate.ts'))
  rt3.reset()
  gate3.useScanPayState()
  rt3.effects.splice(0).forEach((fn) => fn())
  await tick()
  rt3.reset()
  const newTripPay = gate3.useScanPayState()
  assert.equal(storedTrip, null, '新一趟查单见到 consumed+settledAt 旧单必须立刻清掉本地 trip')
  assert.equal(newTripPay.needsPayment, true)
})
