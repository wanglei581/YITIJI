/**
 * 本机会话测试的装载工具。从 terminal-session-background-recovery.test.mjs 搬出，原有部分行为不变；
 * 另加了两个参数 scope、mockToken（见下）。
 * 时钟和定时器由测试推着走；node 装不起来的依赖换成替身。
 *
 * scope：不传时替身恒回 'print-only'（不推迟，清场范围仍能和「没记过」区分开）。
 * 传入函数则按调用次序由用例自己返回。mockToken 非空时走 E2E 构建。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (relativePath) => ts.transpileModule(
  readFileSync(join(root, relativePath), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: relativePath },
).outputText

export const TOKEN_KEY = 'terminal_session_token_v1'
export const BOOT_TICKET = 'ticket-from-the-watchdog-0123456789abcdef'
export const AGENT_TICKET = 'ticket-from-the-local-agent-0123456789abcdef'
export const BRIDGE_TOKEN = 'bridge-token-for-test'
const EXCHANGE = '/api/v1/terminals/session-token'
const REFRESH = '/api/v1/terminals/session-token/refresh'
const AGENT = '/local/terminal-boot-ticket'
export const MINUTE = 60_000

export const BOOT_PAGE = `http://127.0.0.1:5173/?boot_ticket=${BOOT_TICKET}`
export const PLAIN_PAGE = 'http://127.0.0.1:5173/'

export const flush = () => new Promise((resolve) => setImmediate(resolve))

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)) },
    removeItem: (key) => { map.delete(key) },
  }
}

export const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } })
/** 网关自己回的错误页：不是 JSON，没有业务错误码。 */
export const gateway = (status) => ({
  ok: false,
  status,
  json: async () => { throw new SyntaxError('Unexpected token < in JSON') },
  clone() { return this },
})
export const invalid = () => json(401, { error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } })
export const session = (value) => json(201, { sessionToken: value })
export const agentTicket = () => json(200, { data: { bootTicket: AGENT_TICKET } })

let seed = 0

/**
 * @param respond (kind, nth, call) => 应答；kind 是 'exchange' | 'refresh' | 'agent' | 'business'，nth 从 1 起。
 *   返回 'network' 表示连不上（fetch 抛 TypeError）。
 * @param scope 不传则恒为 'print-only'；函数则每次判断调用一次。
 * @param mockToken 非空则该构建带 VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN。
 */
export async function load({ pageUrl, bridgeToken, storedToken, respond, random = 0, scope, mockToken = '' }) {
  seed += 1
  const envName = `__sessionRecoveryEnv_${seed}`
  const clearName = `__sessionRecoveryClears_${seed}`
  const scopeName = `__sessionRecoveryScope_${seed}`
  globalThis[envName] = {
    VITE_TERMINAL_AGENT_LOCAL_URL: '',
    VITE_TERMINAL_AGENT_BRIDGE_TOKEN: bridgeToken,
    VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: mockToken,
  }
  globalThis[clearName] = 0
  globalThis[scopeName] = typeof scope === 'function' ? scope : () => (scope ?? 'print-only')

  let now = 1_760_000_000_000
  let nextTimerId = 1
  const timers = new Map()
  Date.now = () => now
  // 后台恢复的间隔带随机量；默认取 0，让「每分钟一次」能按整分钟断言。
  Math.random = () => random

  const storage = memoryStorage()
  if (storedToken) storage.setItem(TOKEN_KEY, storedToken)
  const location = new URL(pageUrl)
  const win = {
    sessionStorage: storage,
    get location() { return { href: location.href, origin: location.origin } },
    history: { state: null, replaceState(_state, _title, next) { location.href = new URL(String(next), location.origin).href } },
    setTimeout: (fn, ms) => { const id = nextTimerId++; timers.set(id, { at: now + ms, fn }); return id },
    clearTimeout: (id) => { timers.delete(id) },
  }
  globalThis.window = win

  const calls = []
  const counts = { exchange: 0, refresh: 0, agent: 0, business: 0 }
  globalThis.fetch = async (input, init) => {
    const target = new URL(String(input))
    const kind = target.pathname === AGENT ? 'agent'
      : target.pathname === REFRESH ? 'refresh'
        : target.pathname === EXCHANGE ? 'exchange'
          : 'business'
    counts[kind] += 1
    const call = { kind, at: now, sessionHeader: new Headers(init?.headers).get('x-terminal-session-token'), body: init?.body }
    calls.push(call)
    const answer = await respond(kind, counts[kind], call)
    if (answer === 'network') throw new TypeError('fetch failed')
    return answer
  }

  const authCode = `${transpile('src/services/terminalAuth.ts')}\n// ${seed}\n`
    .replaceAll('import.meta.env', `globalThis[${JSON.stringify(envName)}]`)
    .replaceAll("from './api/client'", `from '${toDataUrl("export const API_BASE_URL = '/api/v1'\nexport const API_MODE = 'http'\n")}'`)
    .replaceAll("from './api/httpAdapter'", `from '${toDataUrl(`
export class ApiHttpError extends Error {
  constructor(code, message, status) { super(message); this.name = 'ApiHttpError'; this.code = code; this.status = status }
}
`)}'`)
    .replaceAll("from './api/screensaver'", `from '${toDataUrl("export function getTerminalId() { return 'KSK-001' }\n")}'`)
    // 与真实的 readHttpError 同一口径：不是 JSON 就落到 UNKNOWN_ERROR，不抛。
    .replaceAll("from './api/throwHttpError'", `from '${toDataUrl(`
export async function readHttpError(response) {
  let code = 'UNKNOWN_ERROR'
  let message = '请求失败'
  try {
    const body = await response.json()
    if (typeof body?.error?.code === 'string') code = body.error.code
    if (typeof body?.error?.message === 'string') message = body.error.message
  } catch { /* 非 JSON */ }
  return { code, message }
}
`)}'`)
    .replaceAll("from '../auth/kioskSensitiveSession'", `from '${toDataUrl(`
export function clearKioskSensitiveSession() { globalThis[${JSON.stringify(clearName)}] += 1 }
export function clearKioskSharedDeviceResidue() {}
export function kioskSensitiveSessionScope() { return globalThis[${JSON.stringify(scopeName)}]() }
`)}'`)
  const mod = await import(toDataUrl(authCode))

  const states = []
  mod.subscribeTerminalSession((next) => { states.push(next) })

  /** 把时钟推到 target，到点的定时器按先后触发。 */
  async function advanceTo(target) {
    for (;;) {
      await flush()
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = due[1].at
      due[1].fn()
    }
    now = target
    await flush()
  }
  /** 推着时钟走，直到这个 Promise 出结果。 */
  async function settle(promise) {
    let done = false
    const tracked = promise.then((value) => { done = true; return value }, (error) => { done = true; throw error })
    tracked.catch(() => undefined)
    for (let guard = 0; guard < 500 && !done; guard += 1) {
      await flush()
      if (done) break
      const next = [...timers.values()].sort((a, b) => a.at - b.at)[0]
      if (!next) break
      await advanceTo(next.at)
    }
    return tracked
  }

  return {
    mod, storage, calls, counts, states, win,
    clears: () => globalThis[clearName],
    advance: (ms) => advanceTo(now + ms),
    settle,
    since: (index) => calls.slice(index),
  }
}
