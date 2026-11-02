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
const authStub = url('export const recheckTerminalSessionAfterLicensePause=async()=>{}; export const subscribeTerminalLicenseRenewalRejected=()=>{}; export const subscribeTerminalSession=()=>{}; export const terminalSessionState=()=>"ready"; export const wasTerminalLicenseRenewalRejected=()=>false')
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

test('未验签不改变状态；验过 inactive 进入 winding-down', () => {
  const winding = decide(gate.INITIAL_KIOSK_LICENSE_GATE, input(inactive))
  assert.equal(winding.mode, 'winding-down')
  assert.deepEqual(decide(winding, input(unknown)), winding)
  assert.deepEqual(decide({ ...winding, mode: 'paused' }, input(unknown)), { ...winding, mode: 'paused' })
})
test('到点、会话失败或结束使用进入 paused；验过 ok 回 normal', () => {
  const winding = decide(gate.INITIAL_KIOSK_LICENSE_GATE, input(inactive))
  for (const extra of [{ now: Date.parse(inactive.currentSessionEndsAt) }, { sessionState: 'failed' }, { useEnded: true }]) {
    const paused = decide(winding, input(null, extra))
    assert.equal(paused.mode, 'paused')
    assert.deepEqual(decide(paused, input(ok)), { mode: 'normal', endsAt: ok.currentSessionEndsAt, notice: ok.noticeLine })
  }
  assert.equal(decide(gate.INITIAL_KIOSK_LICENSE_GATE, input(null, { rejected: true })).mode, 'winding-down')
  const normal = decide(gate.INITIAL_KIOSK_LICENSE_GATE, input(ok))
  const rejected = decide(normal, input(null, { rejected: true }))
  assert.equal(decide(rejected, input(null, { now: Date.parse(ok.currentSessionEndsAt) })).mode, 'paused')
})

test('复查仅在暂停期间排队，离开停止，两次不少于五分钟', async () => {
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
    .replaceAll("from '../auth/kioskSensitiveSession'", `from '${stub('export function clearKioskSensitiveSession() {}\nexport function clearKioskSharedDeviceResidue() {}')}'`)
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
