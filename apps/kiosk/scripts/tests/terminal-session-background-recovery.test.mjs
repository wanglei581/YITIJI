/**
 * 本机会话判 failed 之后自己恢复 —— 行为测试。
 *
 * 真跑 terminalAuth.ts（只把 node 装不起来的依赖换成替身），时钟和定时器由测试推着走。
 * 钉两件事：
 *   · 恢复能力：网关 502 / 503 / 504 算可重试；判 failed 后每分钟再试一次，服务器回来就自己变回 ready。
 *   · 没放宽的边界：failed 期间打印放行类请求照旧在发出之前被拦；恢复期间状态不翻成 checking；
 *     普通浏览器（没有桥接令牌、没有会话票）永远换不到；带引导票打开而没换成的页不拿旧会话票续期。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (relativePath) => ts.transpileModule(
  readFileSync(join(root, relativePath), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: relativePath },
).outputText

const TOKEN_KEY = 'terminal_session_token_v1'
const BOOT_TICKET = 'ticket-from-the-watchdog-0123456789abcdef'
const AGENT_TICKET = 'ticket-from-the-local-agent-0123456789abcdef'
const BRIDGE_TOKEN = 'bridge-token-for-test'
const EXCHANGE = '/api/v1/terminals/session-token'
const REFRESH = '/api/v1/terminals/session-token/refresh'
const AGENT = '/local/terminal-boot-ticket'
const MINUTE = 60_000

const realDateNow = Date.now
const realRandom = Math.random
const flush = () => new Promise((resolve) => setImmediate(resolve))

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)) },
    removeItem: (key) => { map.delete(key) },
  }
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } })
/** 网关自己回的错误页：不是 JSON，没有业务错误码。 */
const gateway = (status) => ({
  ok: false,
  status,
  json: async () => { throw new SyntaxError('Unexpected token < in JSON') },
  clone() { return this },
})
const invalid = () => json(401, { error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } })
const session = (value) => json(201, { sessionToken: value })
const agentTicket = () => json(200, { data: { bootTicket: AGENT_TICKET } })

let seed = 0

/**
 * @param respond (kind, nth, call) => 应答；kind 是 'exchange' | 'refresh' | 'agent' | 'business'，nth 从 1 起。
 *   返回 'network' 表示连不上（fetch 抛 TypeError）。
 */
async function load({ pageUrl, bridgeToken, storedToken, respond, random = 0 }) {
  seed += 1
  const envName = `__sessionRecoveryEnv_${seed}`
  const clearName = `__sessionRecoveryClears_${seed}`
  globalThis[envName] = {
    VITE_TERMINAL_AGENT_LOCAL_URL: '',
    VITE_TERMINAL_AGENT_BRIDGE_TOKEN: bridgeToken,
    VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: '',
  }
  globalThis[clearName] = 0

  let now = 1_760_000_000_000
  let nextTimerId = 1
  const timers = new Map()
  Date.now = () => now
  // 后台恢复的间隔带随机量；默认取 0，让「每分钟一次」能按整分钟断言。
  Math.random = () => random

  const storage = memoryStorage()
  if (storedToken) storage.setItem(TOKEN_KEY, storedToken)
  const location = new URL(pageUrl)
  globalThis.window = {
    sessionStorage: storage,
    get location() { return { href: location.href, origin: location.origin } },
    history: { state: null, replaceState(_state, _title, next) { location.href = new URL(String(next), location.origin).href } },
    setTimeout: (fn, ms) => { const id = nextTimerId++; timers.set(id, { at: now + ms, fn }); return id },
    clearTimeout: (id) => { timers.delete(id) },
  }

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
    mod, storage, calls, counts, states,
    clears: () => globalThis[clearName],
    advance: (ms) => advanceTo(now + ms),
    settle,
    since: (index) => calls.slice(index),
  }
}

test.afterEach(() => { Date.now = realDateNow; Math.random = realRandom })

const BOOT_PAGE = `http://127.0.0.1:5173/?boot_ticket=${BOOT_TICKET}`
const PLAIN_PAGE = 'http://127.0.0.1:5173/'

for (const status of [502, 503, 504]) {
  test(`开机换票撞上一次网关 ${status}：自己重试，不判死`, async () => {
    const page = await load({
      pageUrl: BOOT_PAGE,
      bridgeToken: BRIDGE_TOKEN,
      respond: (kind, nth) => (kind === 'exchange' && nth === 1 ? gateway(status) : session('session-after-retry')),
    })
    await page.settle(page.mod.initializeTerminalSession())
    assert.equal(page.mod.terminalSessionState(), 'ready')
    assert.equal(page.counts.exchange, 2, '同一张引导票重发一次')
    assert.equal(page.counts.agent, 0, '重试成功就不必向本机 Agent 要新票')
    assert.equal(page.storage.getItem(TOKEN_KEY), 'session-after-retry')
    assert.ok(!page.states.includes('failed'), '屏上不该闪过一次「没通过」')
  })
}

test('开机换票整窗口都失败：先 failed，服务器回来后一分钟内自己恢复，并接着排十分钟续期', async () => {
  let serverUp = false
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    respond: (kind, nth) => {
      if (!serverUp) return kind === 'agent' ? gateway(503) : gateway(502)
      if (kind === 'agent') return agentTicket()
      return session(`session-${kind}-${nth}`)
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.ok(page.counts.exchange >= 2, '窗口内对网关 502 重试过')
  assert.equal(page.counts.agent, 1, '判死之前向本机 Agent 要过一次新票')

  // 服务器还没回来：每分钟只向本机 Agent 要一次，状态一直是 failed。
  const before = page.calls.length
  await page.advance(3 * MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.deepEqual(page.since(before).map((call) => call.kind), ['agent', 'agent', 'agent'], '每分钟一次，轮内不重试')
  assert.ok(!page.states.slice(page.states.lastIndexOf('failed')).includes('checking'), '后台恢复期间不把状态翻成 checking')

  serverUp = true
  const exchangesBefore = page.counts.exchange
  await page.advance(MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.counts.exchange, exchangesBefore + 1)
  assert.match(String(page.calls.at(-1).body), new RegExp(AGENT_TICKET), '换的是本机 Agent 给的新票')
  assert.equal(page.clears(), 1, '换引导票即清场这条没变')

  // 恢复后不再有后台恢复在跑；十分钟后正常续期。
  const afterRecovery = page.calls.length
  await page.advance(9 * MINUTE)
  assert.equal(page.since(afterRecovery).length, 0, '恢复成功后后台恢复必须停下')
  await page.advance(MINUTE)
  assert.deepEqual(page.since(afterRecovery).map((call) => call.kind), ['refresh'])
  assert.equal(page.mod.terminalSessionState(), 'ready')
})

test('十分钟续期撞上服务器重启：failed 期间下单类请求照旧被拦；服务器回来后拿原会话票续上，不清场', async () => {
  let serverUp = true
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    respond: (kind, nth) => {
      if (kind === 'business') return json(200, { ok: true })
      if (!serverUp) return kind === 'agent' ? gateway(503) : gateway(502)
      if (kind === 'agent') return agentTicket()
      return session(`session-${kind}-${nth}`)
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.clears(), 1)
  const tokenBeforeOutage = page.storage.getItem(TOKEN_KEY)

  serverUp = false
  await page.advance(10 * MINUTE)
  await page.advance(MINUTE) // 续期自己的 60 秒重试窗口走完
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.storage.getItem(TOKEN_KEY), tokenBeforeOutage, '没换成就不动原来的票')

  // 没有会话就不能下单：请求在发出之前被拦，也不因此触发任何换票。
  const beforeBusiness = page.calls.length
  await assert.rejects(
    page.mod.terminalProtectedFetch('http://127.0.0.1:5173/api/v1/print-jobs/claim', { method: 'POST' }),
    (error) => error.code === 'TERMINAL_SESSION_INVALID' && error.status === 401,
  )
  assert.equal(page.since(beforeBusiness).length, 0, 'failed 时业务请求不出网')

  // 服务器仍没回来的那几轮：只拿原票试续期，不去要新引导票（要来就得清场）。
  const beforeTicks = page.calls.length
  await page.advance(2 * MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  const duringOutage = page.since(beforeTicks)
  assert.ok(duringOutage.length >= 1 && duringOutage.every((call) => call.kind === 'refresh'), JSON.stringify(duringOutage.map((call) => call.kind)))
  assert.ok(duringOutage.every((call) => call.sessionHeader === tokenBeforeOutage))

  serverUp = true
  await page.advance(MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.clears(), 1, '用原会话票续上的，这一位办到一半的材料不该被清')
  assert.notEqual(page.storage.getItem(TOKEN_KEY), tokenBeforeOutage)

  const response = await page.mod.terminalProtectedFetch('http://127.0.0.1:5173/api/v1/print-jobs/claim', { method: 'POST' })
  assert.equal(response.status, 200)
  assert.equal(page.calls.at(-1).sessionHeader, page.storage.getItem(TOKEN_KEY), '恢复后发出去的是新票')

  // 续上之后十分钟续期要接着排，否则三十分钟后会话票到期又掉回 failed。
  const afterRecovery = page.calls.length
  await page.advance(10 * MINUTE)
  assert.deepEqual(page.since(afterRecovery).map((call) => call.kind), ['refresh'])
  assert.equal(page.mod.terminalSessionState(), 'ready')
})

test('后台续期被服务端明确判作废：改向本机 Agent 要新票，换成即清场', async () => {
  let phase = 'healthy'
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    respond: (kind, nth) => {
      if (phase === 'healthy') return kind === 'agent' ? agentTicket() : session(`session-${kind}-${nth}`)
      if (phase === 'revoked-agent-down') return kind === 'agent' ? 'network' : invalid()
      // 会话票作废了，但本机 Agent 能拿到新引导票
      if (kind === 'refresh') return invalid()
      return kind === 'agent' ? agentTicket() : session(`session-${kind}-${nth}`)
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  phase = 'revoked-agent-down'
  await page.advance(10 * MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')

  phase = 'revoked-agent-up'
  const clearsBefore = page.clears()
  await page.advance(MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.clears(), clearsBefore + 1)
})

test('普通浏览器（没有桥接令牌、没有会话票）：永远 failed，后台恢复不出网', async () => {
  const page = await load({
    pageUrl: PLAIN_PAGE,
    bridgeToken: '',
    respond: () => session('must-never-be-issued'),
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'failed')
  await page.advance(5 * MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.calls.length, 0, '没有凭据来源就不该发任何换票请求')
  assert.equal(page.storage.getItem(TOKEN_KEY), null)
})

test('带引导票打开而没换成的页：后台恢复不拿标签页里的旧会话票续期', async () => {
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    storedToken: 'previous-occupant-terminal-session',
    respond: (kind) => {
      if (kind === 'exchange') return invalid()
      if (kind === 'agent') return 'network'
      return session('refreshed-with-the-old-token')
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'failed')
  const before = page.calls.length
  await page.advance(3 * MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.deepEqual(page.since(before).map((call) => call.kind), ['agent', 'agent', 'agent'], '只许走「要新引导票」那条路（换票即清场）')
  assert.equal(page.counts.refresh, 0)

  // 终端身份恢复回调会再初始化一次：这条路同样不许拿旧会话票续期。
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.counts.refresh, 0, '身份恢复回调不得绕开「换引导票即清场」')
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.clears(), 0)
  assert.equal(page.storage.getItem(TOKEN_KEY), 'previous-occupant-terminal-session')
})

test('明确作废的引导票不重发同一张（重发不会变好），只向本机 Agent 要一次新票', async () => {
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    respond: (kind) => (kind === 'agent' ? 'network' : invalid()),
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.counts.exchange, 1, '作废的票不在重试窗口里重发')
  assert.equal(page.counts.agent, 1)
})

test('网关 504 而后端其实已经用掉引导票：重发得到作废，改用本机 Agent 的新票换成', async () => {
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    respond: (kind, nth) => {
      if (kind === 'agent') return agentTicket()
      if (kind === 'exchange' && nth === 1) return gateway(504)
      if (kind === 'exchange' && nth === 2) return invalid()
      return session(`session-${kind}-${nth}`)
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.counts.exchange, 3)
  assert.match(String(page.calls.at(-1).body), new RegExp(AGENT_TICKET))
  assert.ok(!page.states.includes('failed'))
})

test('被判作废的会话票不每分钟重发；续期定时器交给后台恢复，不再把状态翻回 checking', async () => {
  let revoked = false
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    respond: (kind, nth) => {
      if (!revoked) return kind === 'agent' ? agentTicket() : kind === 'business' ? json(200, {}) : session(`session-${kind}-${nth}`)
      if (kind === 'agent') return 'network'
      return invalid()
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  // 开机后第 3 分钟终端被停用：一次按台计的请求吃到「会话无效」，续期与要新票都不成，落到 failed。
  await page.advance(3 * MINUTE)
  revoked = true
  const response = await page.settle(page.mod.terminalAttributedFetch('http://127.0.0.1:5173/api/v1/ai/ask', { method: 'POST' }))
  assert.equal(response.status, 401)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  const deadToken = page.storage.getItem(TOKEN_KEY)
  const refreshesAtFailure = page.counts.refresh
  const statesAtFailure = page.states.length

  // 跨过原本的十分钟续期点（开机后第 10 分钟）。
  await page.advance(9 * MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.counts.refresh, refreshesAtFailure + 1, '同一张已判作废的票，后台只再确认一次')
  assert.ok(page.counts.agent >= 9, `之后每分钟只向本机 Agent 要票：${page.counts.agent}`)
  assert.deepEqual(page.states.slice(statesAtFailure), [], 'failed 期间状态不该再翻动（残留的续期定时器会把它翻成 checking）')
  assert.equal(page.storage.getItem(TOKEN_KEY), deadToken, '票本身不删：停用期间读配置还要带它')
})

test('后台恢复在飞时别处又要续期：等同一次，不并发出第二个续期请求', async () => {
  let serverUp = true
  let releaseRefresh
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    respond: (kind, nth) => {
      if (kind === 'business') return nth === 1 ? invalid() : json(200, {})
      if (!serverUp) return kind === 'agent' ? 'network' : gateway(502)
      if (kind === 'refresh' && releaseRefresh === undefined) {
        return new Promise((resolve) => { releaseRefresh = () => resolve(session('session-after-shared-recovery')) })
      }
      return kind === 'agent' ? agentTicket() : session(`session-${kind}-${nth}`)
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  serverUp = false
  await page.advance(11 * MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')

  serverUp = true
  const refreshesBefore = page.counts.refresh
  await page.advance(MINUTE) // 后台恢复发出续期，应答被测试按住
  assert.equal(page.counts.refresh, refreshesBefore + 1)
  assert.equal(page.mod.terminalSessionState(), 'failed', '恢复在飞时状态仍是 failed')

  // 这时一次按台计的请求吃到「会话无效」，按老规矩要触发一次续期。
  const attributed = page.mod.terminalAttributedFetch('http://127.0.0.1:5173/api/v1/ai/ask', { method: 'POST' })
  await flush(); await flush()
  assert.equal(page.counts.refresh, refreshesBefore + 1, '不该再发第二个续期请求')
  // 下单类请求不等后台恢复：照旧立即被拦。
  await assert.rejects(
    page.mod.terminalProtectedFetch('http://127.0.0.1:5173/api/v1/print-jobs/claim', { method: 'POST' }),
    (error) => error.code === 'TERMINAL_SESSION_INVALID',
  )

  releaseRefresh()
  const response = await attributed
  assert.equal(response.status, 200, '恢复成功后那次请求带新票重放')
  assert.equal(page.calls.at(-1).sessionHeader, 'session-after-shared-recovery')
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.counts.refresh, refreshesBefore + 1)
})

test('后台恢复的间隔带随机量：同一批机器不在同一秒回来', async () => {
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    random: 0.999,
    respond: (kind) => (kind === 'agent' ? 'network' : gateway(502)),
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'failed')
  const before = page.calls.length
  await page.advance(MINUTE + 10_000)
  assert.equal(page.since(before).length, 0, '随机量取到上限时，70 秒内还不该动')
  await page.advance(5_000)
  assert.deepEqual(page.since(before).map((call) => call.kind), ['agent'])
})
