import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const url = (s) => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`
const transpile = (path) => ts.transpileModule(readFileSync(join(root, path), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const react = url('export function useEffect() {}\nexport function useRef() {}\nexport function useState() {}\nexport function useSyncExternalStore() {}')
const authStub = url('export const lastTerminalRenewalAttemptAt=()=>null; export const setLicenseRenewalSuspended=()=>{}; export const recheckTerminalSessionAfterLicensePause=async()=>{}; export const subscribeTerminalLicenseRenewalRejected=()=>{}; export const subscribeTerminalSession=()=>{}; export const terminalSessionState=()=>"ready"; export const wasTerminalLicenseRenewalRejected=()=>false')
const profileStub = url('export const useKioskProfile=()=>null')
const gate = await import(url(transpile('src/services/kioskLicenseGate.ts')
  .replaceAll("from 'react'", `from '${react}'`)
  .replaceAll("from './api/kioskProfile'", `from '${profileStub}'`)
  .replaceAll("from './terminalAuth'", `from '${authStub}'`)))
const inactive = { licenseState: 'inactive', acceptsNewSessions: false, currentSessionEndsAt: '2026-01-01T00:30:00Z', noticeLine: '暂停' }
const ok = { ...inactive, licenseState: 'ok', acceptsNewSessions: true }
const unknown = { ...ok, licenseState: null }
const time = Date.parse('2026-01-01T00:00:00Z')
const input = (profile, extra = {}) => ({ profile, rejected: false, now: time, sessionState: 'ready', useEnded: false, ...extra })
const decide = gate.decideKioskLicenseGate

test('暂停记录跨重新加载，只有可信允许新会话才清除', () => {
  const store = new Map()
  globalThis.window = { localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) } }
  gate.persistLicenseGate({ ...gate.INITIAL_KIOSK_LICENSE_GATE, mode: 'paused' }, null)
  let restored = gate.loadInitialLicenseGate()
  assert.equal(restored.mode, 'paused')
  restored = decide(restored, input(unknown))
  gate.persistLicenseGate(restored, unknown)
  assert.equal(gate.loadInitialLicenseGate().mode, 'paused')
  restored = decide(restored, input(ok))
  gate.persistLicenseGate(restored, ok)
  assert.equal(gate.loadInitialLicenseGate().mode, 'normal')
})

test('不确定的暂停凭证必须按过期复查', () => {
  assert.equal(gate.licenseCredentialExpired(null, 'ready', time), true)
  assert.equal(gate.licenseCredentialExpired(inactive.currentSessionEndsAt, 'failed', time), true)
  assert.equal(gate.licenseCredentialExpired(inactive.currentSessionEndsAt, 'ready', time), false)
})

test('恢复的暂停状态复查时将空截止时间传成已过期', async () => {
  globalThis.__recheckTest = { jobs: [], options: null }
  globalThis.window = { localStorage: { getItem: () => '1', setItem: () => {}, removeItem: () => {} } }
  const savedSetTimeout = globalThis.setTimeout
  const savedClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = (fn, delay) => { globalThis.__recheckTest.jobs.push({ fn, delay }); return 1 }
  globalThis.clearTimeout = () => {}
  try {
    const reactHook = url(`export const useEffect=(fn)=>{fn()}; export const useRef=(value)=>({current:value});
      export const useState=(value)=>[typeof value==='function'?value():value,()=>{}]; export const useSyncExternalStore=(_sub,get)=>get();`)
    const authHook = url(`export const lastTerminalRenewalAttemptAt=()=>null; export const recheckTerminalSessionAfterLicensePause=async(options)=>{globalThis.__recheckTest.options=options};
      export const setLicenseRenewalSuspended=()=>{}; export const subscribeTerminalLicenseRenewalRejected=()=>{};
      export const subscribeTerminalSession=()=>{}; export const terminalSessionState=()=>"failed"; export const wasTerminalLicenseRenewalRejected=()=>false;`)
    const module = await import(url(transpile('src/services/kioskLicenseGate.ts')
      .replaceAll("from 'react'", `from '${reactHook}'`)
      .replaceAll("from './api/kioskProfile'", `from '${profileStub}'`)
      .replaceAll("from './terminalAuth'", `from '${authHook}'`) + '\n// restored paused hook'))
    assert.equal(module.useKioskLicenseGate(false).mode, 'paused')
    const job = globalThis.__recheckTest.jobs.find((item) => item.delay === 300_000)
    assert.ok(job)
    job.fn()
    assert.deepEqual(globalThis.__recheckTest.options, { credentialExpired: true })
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    globalThis.setTimeout = savedSetTimeout
    globalThis.clearTimeout = savedClearTimeout
  }
})

test('截止定时提前触发时按剩余时间补排', () => {
  let now = 0, callback, delay, fired = 0
  gate.scheduleLicenseDeadline(1000, () => { fired++ }, {
    now: () => now, set: (fn, ms) => { callback = fn; delay = ms; return 1 }, clear: () => {},
  })
  assert.equal(delay, 1000)
  now = 999; callback(); assert.equal(fired, 0); assert.equal(delay, 51)
  now = 1000; callback(); assert.equal(fired, 1)
})

test('清场实际调用通知订阅者', async () => {
  let source = transpile('src/auth/kioskSensitiveSession.ts')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';?/g, (_match, imports) => {
    const names = imports.split(',').map((part) => part.trim().split(/\s+as\s+/)[0]).filter(Boolean)
    return `import { ${imports} } from '${url(names.map((name) => `export const ${name} = () => {};`).join('\n'))}';`
  })
  const session = await import(url(source))
  let ended = false
  const unsubscribe = session.subscribeKioskSensitiveSessionClear(() => { ended = true })
  session.clearKioskSensitiveSession()
  assert.equal(ended, true)
  unsubscribe()
})

test('清场通知驱动 provider 的 useEnded', async () => {
  globalThis.__licenseTest = { ended: false, listener: null, seen: null, refs: [], index: 0 }
  const fakeReact = url(`
    export const createContext = () => ({ Provider: 'provider' });
    export const useContext = () => null;
    export const useState = () => [globalThis.__licenseTest.ended, (value) => { globalThis.__licenseTest.ended = value }];
    export const useRef = (value) => { const i = globalThis.__licenseTest.index++; return globalThis.__licenseTest.refs[i] ??= { current: value } };
    export const useEffect = (fn) => { fn() };
  `)
  globalThis.React = { createElement: () => null }
  const code = ts.transpileModule(readFileSync(join(root, 'src/layouts/KioskLicenseContext.tsx'), 'utf8'), {
    fileName: 'KioskLicenseContext.tsx', compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
    .replaceAll("from 'react'", `from '${fakeReact}'`)
    .replaceAll("from 'react-router-dom'", `from '${url("export const useLocation=()=>({pathname:'/'})")}'`)
    .replaceAll("from '../auth/kioskSensitiveSession'", `from '${url('export const subscribeKioskSensitiveSessionClear=(fn)=>{ globalThis.__licenseTest.listener=fn; return ()=>{} }')}'`)
    .replaceAll("from '../auth/useAuth'", `from '${url('export const useAuth=()=>({user:null,guestMode:false})')}'`)
    .replaceAll("from '../services/kioskLicenseGate'", `from '${url('export const INITIAL_KIOSK_LICENSE_GATE={}; export const loadStoredWindDown=()=>null; export const saveStoredWindDown=()=>{}; export const useKioskLicenseGate=(ended)=>{globalThis.__licenseTest.seen=ended; return {}}')}'`)
    .replaceAll("from './licenseWindDownRoutes'", `from '${url('export const windDownRoute=()=>null; export const isWindDownViewOnly=()=>false')}'`)
  const provider = await import(url(code))
  provider.KioskLicenseProvider({ children: null })
  assert.equal(globalThis.__licenseTest.seen, false)
  globalThis.__licenseTest.listener()
  globalThis.__licenseTest.index = 0
  provider.KioskLicenseProvider({ children: null })
  assert.equal(globalThis.__licenseTest.seen, true)
})

test('profile 并发三次共用一个请求', async () => {
  let resolveFetch, calls = 0
  globalThis.window = { sessionStorage: { getItem: () => null }, location: { origin: 'http://localhost' }, setTimeout, clearTimeout }
  globalThis.fetch = () => { calls++; return new Promise((resolve) => { resolveFetch = resolve }) }
  const module = await import(url(transpile('src/services/api/kioskProfile.ts')
    .replaceAll("from 'react'", `from '${url('export const createElement=()=>{}; export const useSyncExternalStore=()=>{}')}'`)
    .replaceAll("from '@ai-job-print/shared'", `from '${url("export const DEFAULT_BRANDING_FILING={}; export const DEFAULT_BRAND_MARK=''; export const DEFAULT_BRAND_NAME='' ")}'`)
    .replaceAll("from '../terminalAuth'", `from '${url('export const clearTerminalLicenseRenewalRejection=()=>{}; export const subscribeTerminalLicenseRenewalRejected=()=>{}; export const subscribeTerminalSession=()=>{}')}'`)
    .replaceAll("from './client'", `from '${url("export const API_BASE_URL='/api/v1'")}'`)
    .replaceAll("from './screensaver'", `from '${url("export const getTerminalId=()=> 't'; export const subscribeTerminalIdentity=()=>{}")}'`)))
  const requests = [module.refreshKioskProfile(), module.refreshKioskProfile(), module.refreshKioskProfile()]
  assert.equal(calls, 1)
  assert.equal(requests[0], requests[1])
  resolveFetch({ ok: false })
  await Promise.all(requests)
})

test('未验签不改变状态；验过 inactive 进入 winding-down', () => {
  const winding = decide(gate.INITIAL_KIOSK_LICENSE_GATE, input(inactive))
  assert.equal(winding.mode, 'winding-down')
  assert.deepEqual(decide(winding, input(unknown)), winding)
  assert.deepEqual(decide({ ...winding, mode: 'paused' }, input(unknown)), { ...winding, mode: 'paused' })
})
test('到点、会话失败或结束使用进入 paused；验过 ok 回 normal', () => {
  const winding = decide(gate.INITIAL_KIOSK_LICENSE_GATE, input(inactive))
  for (const extra of [{ now: Date.parse(inactive.currentSessionEndsAt) }, { sessionState: 'failed', rejected: true }, { useEnded: true }]) {
    const paused = decide(winding, input(null, extra))
    assert.equal(paused.mode, 'paused')
    assert.deepEqual(decide(paused, input(ok)), { mode: 'normal', endsAt: ok.currentSessionEndsAt, notice: ok.noticeLine })
  }
  assert.equal(decide(gate.INITIAL_KIOSK_LICENSE_GATE, input(null, { rejected: true })).mode, 'winding-down')
  const normal = decide(gate.INITIAL_KIOSK_LICENSE_GATE, input(ok))
  const rejected = decide(normal, input(null, { rejected: true }))
  assert.equal(decide(rejected, input(null, { now: Date.parse(ok.currentSessionEndsAt) })).mode, 'paused')
})

test('收尾中普通失败不暂停，授权拒绝的失败才暂停', () => {
  const winding = decide(gate.INITIAL_KIOSK_LICENSE_GATE, input(inactive))
  assert.equal(decide(winding, input(null, { sessionState: 'failed' })).mode, 'winding-down')
  assert.equal(decide(winding, input(null, { sessionState: 'failed', rejected: true })).mode, 'paused')
})

test('复查计时启动后排队，离开停止，两次不少于五分钟', async () => {
  let now = 0, nextId = 0
  const jobs = new Map(), calls = []
  const clock = { now: () => now, set: (fn, delay) => { const id = ++nextId; jobs.set(id, { fn, at: now + delay }); return id }, clear: (id) => jobs.delete(id) }
  const timer = gate.createLicenseRecheckTimer(async () => { calls.push(now) }, clock)
  async function advance(ms) {
    const target = now + ms
    for (;;) {
      const due = [...jobs.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!due || due[1].at > target) break
      jobs.delete(due[0]); now = due[1].at; due[1].fn()
      await new Promise((resolve) => setImmediate(resolve))
    }
    now = target
  }
  await advance(600_000); assert.equal(calls.length, 0)
  timer.start(); assert.equal([...jobs.values()][0].at, now + 300_000)
  await advance(299_999); assert.equal(calls.length, 0)
  await advance(1); assert.deepEqual(calls, [900_000])
  timer.stop(); await advance(100_000); assert.equal(jobs.size, 0)
  timer.start(); await advance(199_999); assert.equal(calls.length, 1)
  await advance(1); assert.deepEqual(calls, [900_000, 1_200_000])
  timer.stop(); await advance(600_000); assert.equal(calls.length, 2)
})

test('复查使用最近的外部或自身尝试，到点时重新检查外部尝试', async () => {
  let now = 600_000, external = now - 120_000, job = null
  const calls = []
  const timer = gate.createLicenseRecheckTimer(async () => { calls.push(now) }, {
    now: () => now, lastExternalAttempt: () => external,
    set: (fn, delay) => { job = { fn, at: now + delay }; return 1 }, clear: () => { job = null },
  })
  timer.start(); assert.equal(job.at, 780_000)
  external = 700_000; now = 780_000; job.fn(); assert.equal(calls.length, 0); assert.equal(job.at, 1_000_000)
  now = 1_000_000; job.fn(); await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, [1_000_000])
  external = 900_000; timer.stop(); timer.start(); assert.equal(job.at, 1_300_000)
  now = 1_299_999; job.fn(); assert.equal(calls.length, 1); assert.equal(job.at, 1_300_000)
  now = 1_300_000; job.fn(); await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, [1_000_000, 1_300_000]); timer.stop()
})

test('收尾不启动复查，暂停启动复查且两者均挂起例行续期', async () => {
  for (const mode of ['winding-down', 'paused']) {
    globalThis.__modeTest = { jobs: [], suspended: [] }
    const reactHook = url(`export const useEffect=(fn)=>{fn()}; export const useRef=(value)=>({current:value});
      export const useState=(value)=>[typeof value==='function'?{...value(),mode:'${mode}'}:value,()=>{}]; export const useSyncExternalStore=(_sub,get)=>get();`)
    const authHook = url(`export const lastTerminalRenewalAttemptAt=()=>null; export const recheckTerminalSessionAfterLicensePause=async()=>{};
      export const setLicenseRenewalSuspended=(v)=>globalThis.__modeTest.suspended.push(v); export const subscribeTerminalLicenseRenewalRejected=()=>{};
      export const subscribeTerminalSession=()=>{}; export const terminalSessionState=()=>"ready"; export const wasTerminalLicenseRenewalRejected=()=>false;`)
    const saved = globalThis.setTimeout
    globalThis.setTimeout = (fn, delay) => { globalThis.__modeTest.jobs.push({ fn, delay }); return 1 }
    try {
      const module = await import(url(transpile('src/services/kioskLicenseGate.ts')
        .replaceAll("from 'react'", `from '${reactHook}'`)
        .replaceAll("from './api/kioskProfile'", `from '${profileStub}'`)
        .replaceAll("from './terminalAuth'", `from '${authHook}'`) + `\n// ${mode}`))
      module.useKioskLicenseGate(false)
      assert.deepEqual(globalThis.__modeTest.suspended, [true])
      assert.equal(globalThis.__modeTest.jobs.filter((item) => item.delay === 300_000).length, mode === 'paused' ? 1 : 0)
    } finally { globalThis.setTimeout = saved }
  }
})

test('收尾和暂停都挂起例行续期，恢复正常后重启', async () => {
  globalThis.__gateEnv = { VITE_TERMINAL_AGENT_LOCAL_URL: '', VITE_TERMINAL_AGENT_BRIDGE_TOKEN: 'bridge', VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: '' }
  const store = new Map([['terminal_session_token_v1', 'old']]), timers = new Map()
  let nextId = 0, requests = 0
  globalThis.window = {
    sessionStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) },
    localStorage: { getItem: () => null }, location: { href: 'http://localhost/', origin: 'http://localhost' },
    setTimeout: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id }, clearTimeout: (id) => timers.delete(id),
  }
  globalThis.fetch = async () => { requests++; return { ok: true, json: async () => ({ sessionToken: 'new' }) } }
  const stub = (source) => url(source)
  const auth = await import(url(transpile('src/services/terminalAuth.ts')
    .replaceAll('import.meta.env', 'globalThis.__gateEnv')
    .replaceAll("from '../auth/kioskSensitiveSession'", `from '${stub('export function clearKioskSensitiveSession() {}\nexport function clearKioskSharedDeviceResidue() {}\nexport function kioskSensitiveSessionScope() { return "none" }')}'`)
    .replaceAll("from './terminalSessionRecovery'", `from '${stub(transpile('src/services/terminalSessionRecovery.ts') + '\n// recovery-1')}'`)
    .replaceAll("from './api/client'", `from '${stub("export const API_BASE_URL='/api/v1'; export const API_MODE='http'")}'`)
    .replaceAll("from './api/httpAdapter'", `from '${stub('export class ApiHttpError extends Error {}')}'`)
    .replaceAll("from './api/screensaver'", `from '${stub("export function getTerminalId() { return 'terminal' }")}'`)
    .replaceAll("from './api/throwHttpError'", `from '${stub('export async function readHttpError(response) { return response.json() }')}'`) + '\n// suspension test'))
  await auth.initializeTerminalSession()
  assert.equal([...timers.values()].filter((timer) => timer.ms === 600_000).length, 1)
  for (const mode of ['winding-down', 'paused']) {
    auth.setLicenseRenewalSuspended(true)
    assert.equal([...timers.values()].filter((timer) => timer.ms === 600_000).length, 0, mode)
    await auth.recheckTerminalSessionAfterLicensePause({ credentialExpired: false })
    assert.equal([...timers.values()].filter((timer) => timer.ms === 600_000).length, 0, mode)
    auth.setLicenseRenewalSuspended(false)
    assert.equal([...timers.values()].filter((timer) => timer.ms === 600_000).length, 1, mode)
  }
  assert.equal(requests, 3)
  const paths = []
  globalThis.fetch = async (input) => {
    const address = String(input); paths.push(address)
    if (address.includes('/refresh')) return { ok: false, status: 401, json: async () => ({ code: 'TERMINAL_SESSION_INVALID' }) }
    if (address.includes('/local/terminal-boot-ticket')) return { ok: true, json: async () => ({ data: { bootTicket: 'a'.repeat(32) } }) }
    return { ok: true, json: async () => ({ sessionToken: 'new' }) }
  }
  auth.setLicenseRenewalSuspended(true)
  await auth.recheckTerminalSessionAfterLicensePause({ credentialExpired: false })
  assert.equal(paths.length, 1)
  assert.ok(paths[0].includes('/refresh'))
  assert.equal(auth.terminalSessionState(), 'failed')
  await auth.recheckTerminalSessionAfterLicensePause({ credentialExpired: true })
  assert.equal(paths.length, 3)
  assert.ok(paths[1].includes('/local/terminal-boot-ticket'))
  assert.ok(paths[2].endsWith('/terminals/session-token'))
})

test('授权暂停时落到 failed 不排后台恢复，解除暂停后补排，再暂停就撤掉', async () => {
  // 2026-11-04 并入 #1570（failed 后每分钟一轮后台恢复）：暂停期间复查由授权闸门限频（≥5 分钟），
  // 后台恢复不能在暂停时自己每分钟去续期或换票。
  globalThis.__gateEnv = { VITE_TERMINAL_AGENT_LOCAL_URL: '', VITE_TERMINAL_AGENT_BRIDGE_TOKEN: 'bridge', VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: '' }
  const store = new Map([['terminal_session_token_v1', 'old']]), timers = new Map()
  let nextId = 0
  globalThis.window = {
    sessionStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) },
    localStorage: { getItem: () => null }, location: { href: 'http://localhost/', origin: 'http://localhost' },
    setTimeout: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id }, clearTimeout: (id) => timers.delete(id),
  }
  const paths = []
  globalThis.fetch = async (input) => {
    paths.push(String(input))
    return { ok: false, status: 401, json: async () => ({ code: 'TERMINAL_SESSION_INVALID' }) }
  }
  const stub = (source) => url(source)
  const auth = await import(url(transpile('src/services/terminalAuth.ts')
    .replaceAll('import.meta.env', 'globalThis.__gateEnv')
    .replaceAll("from '../auth/kioskSensitiveSession'", `from '${stub('export function clearKioskSensitiveSession() {}\nexport function clearKioskSharedDeviceResidue() {}\nexport function kioskSensitiveSessionScope() { return "none" }')}'`)
    .replaceAll("from './terminalSessionRecovery'", `from '${stub(transpile('src/services/terminalSessionRecovery.ts') + '\n// recovery-gating')}'`)
    .replaceAll("from './api/client'", `from '${stub("export const API_BASE_URL='/api/v1'; export const API_MODE='http'")}'`)
    .replaceAll("from './api/httpAdapter'", `from '${stub('export class ApiHttpError extends Error { constructor(code,message,status) { super(message); this.code=code; this.status=status } }')}'`)
    .replaceAll("from './api/screensaver'", `from '${stub("export function getTerminalId() { return 'terminal' }")}'`)
    .replaceAll("from './api/throwHttpError'", `from '${stub('export async function readHttpError(response) { return response.json() }')}'`) + '\n// recovery gating test'))
  // 后台恢复一轮的间隔是 60 秒加最多 15 秒抖动。
  const recoveryTimers = () => [...timers.values()].filter((timer) => timer.ms >= 60_000 && timer.ms < 75_000).length
  auth.setLicenseRenewalSuspended(true)
  await auth.recheckTerminalSessionAfterLicensePause({ credentialExpired: false })
  assert.equal(auth.terminalSessionState(), 'failed')
  assert.equal(paths.length, 1, '暂停复查只续一次，不另向本机要票')
  assert.equal(recoveryTimers(), 0, '暂停时落到 failed 不排后台恢复')
  auth.setLicenseRenewalSuspended(false)
  assert.equal(recoveryTimers(), 1, '解除暂停、仍是 failed 时补排一轮后台恢复')
  auth.setLicenseRenewalSuspended(true)
  assert.equal(recoveryTimers(), 0, '再次暂停时撤掉已排的后台恢复')
  assert.equal(paths.length, 1, '整个过程没有多发请求')
})

test('授权复查清除被拒标记并实际再走续期', async () => {
  const stub = (s) => url(s)
  const env = { VITE_TERMINAL_AGENT_LOCAL_URL: '', VITE_TERMINAL_AGENT_BRIDGE_TOKEN: '', VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: '' }
  globalThis.__gateEnv = env
  const store = new Map([['terminal_session_token_v1', 'old']])
  globalThis.window = { sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, location: { href: 'http://localhost/', origin: 'http://localhost' }, setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); id.unref(); return id }, clearTimeout }
  let requests = 0
  globalThis.fetch = async () => { requests++; return requests === 1
    ? { ok: false, status: 403, json: async () => ({ code: 'TERMINAL_LICENSE_INACTIVE' }) }
    : { ok: true, json: async () => ({ sessionToken: 'new' }) } }
  const auth = await import(url(transpile('src/services/terminalAuth.ts')
    .replaceAll('import.meta.env', 'globalThis.__gateEnv')
    .replaceAll("from '../auth/kioskSensitiveSession'", `from '${stub('export function clearKioskSensitiveSession() {}\nexport function clearKioskSharedDeviceResidue() {}\nexport function kioskSensitiveSessionScope() { return "none" }')}'`)
    .replaceAll("from './terminalSessionRecovery'", `from '${stub(transpile('src/services/terminalSessionRecovery.ts') + '\n// recovery-2')}'`)
    .replaceAll("from './api/client'", `from '${stub("export const API_BASE_URL='/api/v1'; export const API_MODE='http'")}'`)
    .replaceAll("from './api/httpAdapter'", `from '${stub('export class ApiHttpError extends Error { constructor(code,message,status) { super(message); this.code=code; this.status=status } }')}'`)
    .replaceAll("from './api/screensaver'", `from '${stub("export function getTerminalId() { return 'terminal' }")}'`)
    .replaceAll("from './api/throwHttpError'", `from '${stub("export async function readHttpError(response) { return response.json() }")}'`)))
  await auth.initializeTerminalSession()
  assert.equal(auth.wasTerminalLicenseRenewalRejected(), true)
  assert.equal(store.get('terminal_session_token_v1'), 'old')
  await auth.recheckTerminalSessionAfterLicensePause()
  assert.equal(auth.wasTerminalLicenseRenewalRejected(), false)
  assert.equal(auth.terminalSessionState(), 'ready')
  assert.equal(store.get('terminal_session_token_v1'), 'new')
  assert.equal(requests, 2)
})

test('换票被授权拒绝时通知闸门，复查可恢复', async () => {
  for (const scenario of ['expired', 'no-token', 'url-ticket']) {
    globalThis.__gateEnv = { VITE_TERMINAL_AGENT_LOCAL_URL: '', VITE_TERMINAL_AGENT_BRIDGE_TOKEN: 'bridge', VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: '' }
    const store = new Map(scenario === 'expired' ? [['terminal_session_token_v1', 'old']] : [])
    const bootTicket = 'a'.repeat(32)
    globalThis.window = {
      sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
      location: { href: `http://localhost/${scenario === 'url-ticket' ? `?boot_ticket=${bootTicket}` : ''}`, origin: 'http://localhost' },
      history: { state: null, replaceState: () => {} },
      setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); id.unref(); return id }, clearTimeout,
    }
    let allow = false, notifications = 0
    globalThis.fetch = async (input) => {
      const address = String(input)
      if (address.includes('/local/terminal-boot-ticket')) return { ok: true, json: async () => ({ data: { bootTicket } }) }
      if (address.includes('/refresh')) return { ok: false, status: 401, json: async () => ({ code: 'TERMINAL_SESSION_INVALID' }) }
      return allow ? { ok: true, json: async () => ({ sessionToken: 'new' }) }
        : { ok: false, status: 403, json: async () => ({ code: 'TERMINAL_LICENSE_INACTIVE' }) }
    }
    const stub = (s) => url(s)
    const auth = await import(url(transpile('src/services/terminalAuth.ts')
      .replaceAll('import.meta.env', 'globalThis.__gateEnv')
      .replaceAll("from '../auth/kioskSensitiveSession'", `from '${stub('export function clearKioskSensitiveSession() {}\nexport function clearKioskSharedDeviceResidue() {}\nexport function kioskSensitiveSessionScope() { return "none" }')}'`)
      .replaceAll("from './terminalSessionRecovery'", `from '${stub(transpile('src/services/terminalSessionRecovery.ts') + '\n// recovery-3')}'`)
      .replaceAll("from './api/client'", `from '${stub("export const API_BASE_URL='/api/v1'; export const API_MODE='http'")}'`)
      .replaceAll("from './api/httpAdapter'", `from '${stub('export class ApiHttpError extends Error { constructor(code,message,status) { super(message); this.code=code; this.status=status } }')}'`)
      .replaceAll("from './api/screensaver'", `from '${stub("export function getTerminalId() { return 'terminal' }")}'`)
      .replaceAll("from './api/throwHttpError'", `from '${stub('export async function readHttpError(response) { return response.json() }')}'`) + `\n// ${scenario}`))
    auth.subscribeTerminalLicenseRenewalRejected(() => { notifications++; assert.equal(auth.wasTerminalLicenseRenewalRejected(), true) })
    await auth.initializeTerminalSession()
    assert.equal(auth.wasTerminalLicenseRenewalRejected(), true, scenario)
    assert.equal(notifications, 1, scenario)
    assert.equal(auth.terminalSessionState(), 'failed', scenario)
    assert.equal(decide(gate.INITIAL_KIOSK_LICENSE_GATE, input(null, { rejected: true, sessionState: 'failed' })).mode, 'paused')
    allow = true
    window.location.href = 'http://localhost/'
    await auth.recheckTerminalSessionAfterLicensePause({ credentialExpired: true })
    assert.equal(auth.wasTerminalLicenseRenewalRejected(), false, scenario)
    assert.equal(auth.terminalSessionState(), 'ready', scenario)
    assert.equal(store.get('terminal_session_token_v1'), 'new', scenario)
  }
})

test('收尾缺少截止时间时固定三十分钟兜底，到点暂停', () => {
  const noDeadline = { ...inactive, currentSessionEndsAt: null }
  const first = decide(gate.INITIAL_KIOSK_LICENSE_GATE, input(noDeadline))
  assert.equal(first.endsAt, new Date(time + gate.LICENSE_UNKNOWN_DEADLINE_GRACE_MS).toISOString())
  const repeated = decide(first, input(noDeadline, { now: time + 100_000 }))
  assert.equal(repeated.endsAt, first.endsAt)
  assert.equal(decide(repeated, input(null, { now: Date.parse(first.endsAt) - 1 })).mode, 'winding-down')
  assert.equal(decide(repeated, input(noDeadline, { now: Date.parse(first.endsAt) })).mode, 'paused')
  const recovered = decide(first, input(ok))
  assert.equal(decide(recovered, input(noDeadline, { now: time + 200_000 })).endsAt, new Date(time + 200_000 + gate.LICENSE_UNKNOWN_DEADLINE_GRACE_MS).toISOString())
})

test('路由登记覆盖路由表且收尾判定保持服务边界', async () => {
  const routes = await import(url(transpile('src/layouts/licenseWindDownRoutes.ts')))
  const source = ts.createSourceFile('routes.tsx', readFileSync(join(root, 'src/routes/index.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declared = new Set()
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'path' && ts.isStringLiteral(node.initializer)) {
      const path = node.initializer.text
      declared.add(path === '*' || path.startsWith('/') ? path : `/${path}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const registered = routes.WIND_DOWN_ROUTES.map((route) => route.path)
  assert.equal(new Set(registered).size, registered.length)
  assert.deepEqual([...declared].sort(), registered.sort())
  assert.equal(routes.windDownAllows('/login', 'mine'), true)
  assert.equal(routes.windDownAllows('/resume/report', 'mine'), true)
  assert.equal(routes.windDownAllows('/resume/source', 'resume'), true)
  assert.equal(routes.windDownAllows('/resume/source', 'mine'), false)
  assert.equal(routes.windDownAllows('/unknown', 'unknown'), false)
  assert.equal(routes.windDownAllows('/job-fairs/checkin', 'mine'), false)
  // 面试工作台：查看报告与历史报告按结果页放行，设置与作答仍按办理页拦。
  assert.equal(routes.windDownAllows('/interview', 'mine', '?stage=report&sessionId=s1'), true)
  assert.equal(routes.windDownAllows('/interview', 'mine', '?stage=reports'), true)
  assert.equal(routes.windDownAllows('/interview', 'mine', '?stage=setup'), false)
  assert.equal(routes.windDownAllows('/interview', 'mine', ''), false)
  assert.equal(routes.windDownAllows('/interview', 'interview', '?stage=setup'), true)
  let service = routes.nextWindDownService('normal', 'winding-down', null, '/resume/report')
  assert.equal(service, 'resume')
  service = routes.nextWindDownService('winding-down', 'winding-down', service, '/me/resumes')
  assert.equal(service, 'resume')
  assert.equal(routes.nextWindDownService('winding-down', 'normal', service, '/'), null)
  assert.equal(routes.nextWindDownService('normal', 'winding-down', null, '/me/resumes'), 'mine')
  assert.equal(routes.nextWindDownService('normal', 'winding-down', null, '/unknown'), null)
})

test('收尾记录刷新恢复、真实截止覆盖兜底、可信恢复清除', () => {
  const store = new Map()
  window.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
  const first = decide(gate.INITIAL_KIOSK_LICENSE_GATE, input(null, { rejected: true }))
  assert.equal(first.endsAt, new Date(time + 30 * 60_000).toISOString())
  gate.saveStoredWindDown({ service: 'convert', endsAt: first.endsAt })
  const restored = gate.loadInitialLicenseGate()
  assert.equal(restored.mode, 'winding-down')
  assert.equal(gate.loadStoredWindDown().service, 'convert')
  const repeated = decide(restored, input(null, { rejected: true, now: time + 60_000 }))
  assert.equal(repeated.endsAt, first.endsAt)
  const real = decide(repeated, input({ ...inactive, currentSessionEndsAt: '2026-01-01T00:45:00Z' }))
  gate.persistLicenseGate(real, inactive)
  assert.equal(gate.loadStoredWindDown().endsAt, real.endsAt)
  gate.persistLicenseGate(decide(real, input(unknown)), unknown)
  assert.equal(gate.loadStoredWindDown().service, 'convert')
  gate.persistLicenseGate(decide(real, input(ok)), ok)
  assert.equal(gate.loadStoredWindDown(), null)
  assert.equal(gate.loadInitialLicenseGate().mode, 'normal')
})

test('Provider 收尾时记服务，刷新后不按新地址重认', async () => {
  const map = new Map()
  globalThis.window = { localStorage: { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) } }
  globalThis.__providerTest = { refs: [], index: 0, mode: 'normal', path: '/print-scan/convert', value: null }
  const fakeReact = url(`export const createContext=()=>({Provider:'provider'}); export const useContext=()=>globalThis.__providerTest.value;
    export const useState=()=>[false,()=>{}]; export const useEffect=(fn)=>fn();
    export const useRef=(v)=>{const t=globalThis.__providerTest; const i=t.index++; return t.refs[i] ??= {current:v}};`)
  globalThis.React = { createElement: (_component, props) => { globalThis.__providerTest.value = props.value; return null } }
  const code = ts.transpileModule(readFileSync(join(root, 'src/layouts/KioskLicenseContext.tsx'), 'utf8'), {
    fileName: 'KioskLicenseContext.tsx', compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
    .replaceAll("from 'react'", `from '${fakeReact}'`)
    .replaceAll("from 'react-router-dom'", `from '${url('export const useLocation=()=>({pathname:globalThis.__providerTest.path})')}'`)
    .replaceAll("from '../auth/kioskSensitiveSession'", `from '${url('export const subscribeKioskSensitiveSessionClear=()=>()=>{}')}'`)
    .replaceAll("from '../auth/useAuth'", `from '${url('export const useAuth=()=>({user:null,guestMode:false})')}'`)
    .replaceAll("from '../services/kioskLicenseGate'", `from '${url('export const INITIAL_KIOSK_LICENSE_GATE={mode:"normal",endsAt:null,notice:null}; export const loadStoredWindDown=()=>JSON.parse(window.localStorage.getItem("test") || "null"); export const saveStoredWindDown=(v)=>window.localStorage.setItem("test",JSON.stringify(v)); export const useKioskLicenseGate=()=>({mode:globalThis.__providerTest.mode,endsAt:"2026-01-01T00:30:00Z",notice:null})')}'`)
    .replaceAll("from './licenseWindDownRoutes'", `from '${url(transpile('src/layouts/licenseWindDownRoutes.ts'))}'`)
  const provider = await import(url(code))
  const render = () => { globalThis.__providerTest.index = 0; provider.KioskLicenseProvider({ children: null }) }
  render()
  globalThis.__providerTest.mode = 'winding-down'; render()
  assert.equal(globalThis.__providerTest.value.windDownService, 'convert')
  globalThis.__providerTest.refs = []; globalThis.__providerTest.path = '/resume/source'; render()
  assert.equal(globalThis.__providerTest.value.windDownService, 'convert')
  assert.equal(provider.useWindDownViewOnly('resume'), true)
  assert.equal(provider.useWindDownViewOnly('convert'), false)
})

test('按服务只读、交接来源及重定向分类', async () => {
  const routes = await import(url(transpile('src/layouts/licenseWindDownRoutes.ts')))
  assert.equal(routes.isWindDownViewOnly('winding-down', 'convert', 'resume'), true)
  assert.equal(routes.isWindDownViewOnly('winding-down', 'convert', 'convert'), false)
  assert.equal(routes.isWindDownViewOnly('normal', null, 'convert'), false)
  assert.equal(routes.windDownAllows('/print/confirm', 'convert', '', 'convert'), true)
  assert.equal(routes.windDownAllows('/print/confirm', 'convert', '', 'mine'), false)
  assert.equal(routes.windDownAllows('/print/confirm', 'mine', '', 'mine'), false)
  assert.equal(routes.windDownAllows('/resume/source', 'convert', '', 'convert'), false)
  for (const path of ['/interview/report', '/interview/reports']) assert.equal(routes.windDownAllows(path, 'mine'), true)
  for (const path of ['/interview/setup', '/interview/session', '/interview/tips']) assert.equal(routes.windDownAllows(path, 'mine'), false)
  for (const [path, service] of [['/print/scan-convert', 'convert'], ['/print/scan-sign', 'sign'], ['/print/material-check', 'print'], ['/print/preview', 'print'], ['/print/params', 'print'], ['/resume', 'resume'], ['/resume/upload', 'resume'], ['/resume/export', 'resume'], ['/scan/start', 'scan'], ['/scan/settings', 'scan'], ['/scan/progress', 'scan'], ['/scan/result', 'scan']]) {
    assert.equal(routes.windDownRoute(path).service, service, path)
    assert.equal(routes.windDownRoute(path).kind, 'work', path)
  }
  for (const path of ['/print/scan-feature', '/jobs/online-platforms']) assert.equal(routes.windDownRoute(path).kind, 'always', path)
})

test('交接来源只认当前有效编号，不带文件或用户资料', async () => {
  const map = new Map()
  window.sessionStorage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) }
  const session = url(transpile('src/pages/print/printMaterialSession.ts'))
  const policy = url(transpile('src/pages/print/printHandoffPolicy.ts'))
  const copy = url(transpile('src/copy/unattendedCopy.ts'))
  const handoff = await import(url(transpile('src/pages/print/printHandoff.ts')
    .replaceAll("from './printMaterialSession'", `from '${session}'`)
    .replaceAll("from './printHandoffPolicy'", `from '${policy}'`)
    .replaceAll("from '../../copy/unattendedCopy'", `from '${copy}'`)))
  const owner = { kind: 'guest' }
  const result = handoff.beginPrintHandoff({ origin: 'upload', file: { name: 'private.pdf', fileId: 'private-id', fileUrl: '/api/v1/files/private-id/content', size: '1 KB' } }, owner)
  assert.equal(result.ok, true)
  handoff.recordPrintHandoffService(result, 'convert')
  assert.deepEqual(JSON.parse(map.get('kiosk_print_handoff_service_v1')), { contextId: result.context.contextId, service: 'convert' })
  assert.equal(handoff.readPrintHandoffService(owner), 'convert')
  const next = handoff.beginPrintHandoff({ origin: 'upload', file: { name: 'other.pdf', fileId: 'other', fileUrl: '/api/v1/files/other/content', size: '1 KB' } }, owner)
  assert.equal(next.ok, true)
  assert.equal(handoff.readPrintHandoffService(owner), null)
  handoff.recordPrintHandoffService(next, 'mine')
  assert.equal(handoff.readPrintHandoffService(owner), 'mine')
})
