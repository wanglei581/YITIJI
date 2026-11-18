/**
 * 清场忘掉小青对话和作业内存：编译真模块跑。
 *
 * 锁住：只收 32 位小写十六进制、去重、只留最近 10 个；取走即清空；
 * 非 http 不发；小青有令牌发两次、没令牌发一次；作业凭据三种；
 * fetch 抛错不往外抛；503 会退避重试，最终失败不抛错、不卡住离场；每次都带 keepalive。
 * 页面还在时，离场要等这次清场（含重试）有结果；16 毫秒拆掉页面就只发出第一发，并记诊断。
 * 这是编译后的真模块加上模拟的页面生命周期，不是浏览器里点出来的。
 * 接线：读作业成功才登记、读失败不登记（编译 advisor.ts 真跑）；小青总结回了作业号也登记。
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

const HEX = (n) => n.toString(16).padStart(32, '0')
const ASSISTANT_URL = '/api/v1/assistant/sessions/forget'
const advisorUrl = (id) => `/api/v1/advisor/sessions/${encodeURIComponent(id)}/forget`

let seed = 0

async function loadForget() {
  seed += 1
  const calls = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init: { ...(init ?? {}) } })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ forgotten: 0 }) })
  }
  const clientUrl = toDataUrl(`
    export let API_MODE = 'http'
    export const API_BASE_URL = '/api/v1'
    export function setApiMode(next) { API_MODE = next }
    // ${seed}
  `)
  const buildMode = toDataUrl('export const ALLOW_FIXTURES = false\nexport const IS_E2E_BUILD = false\n')
  const model = `${transpile('src/pages/ai-plan/advisorArtifactModel.ts')}\n// ${seed}\n`
    .replaceAll("from '../../utils/buildMode'", `from '${buildMode}'`)
  const code = `${transpile('src/services/api/aiSessionForget.ts')}\n// ${seed}\n`
    .replaceAll("from './client'", `from '${clientUrl}'`)
    .replaceAll("from '../../pages/ai-plan/advisorArtifactModel'", `from '${toDataUrl(model)}'`)
  const mod = await import(toDataUrl(code))
  const client = await import(clientUrl)
  return {
    mod,
    calls,
    client,
    restore() { globalThis.fetch = previousFetch },
  }
}

function assistantCalls(calls) {
  return calls.filter((call) => call.url === ASSISTANT_URL)
}

function bodyOf(call) {
  return JSON.parse(call.init.body)
}

test('只收 32 位小写十六进制，去重，只留最近 10 个', async () => {
  const { mod, calls, restore } = await loadForget()
  try {
    mod.rememberAssistantSession('session-local')
    mod.rememberAssistantSession('mock-demo')
    mod.rememberAssistantSession('ABCDEF0123456789ABCDEF0123456789')
    mod.rememberAssistantSession(HEX(1).slice(0, 31))
    mod.rememberAssistantSession(`${HEX(1)} `)
    for (let n = 0; n < 11; n += 1) mod.rememberAssistantSession(HEX(n))
    mod.rememberAssistantSession(HEX(1))
    // 放在窗口填满之后。写在前面会被「只留 10 个」挤掉，放宽校验时断言仍是绿的。
    mod.rememberAssistantSession('ABCDEF0123456789ABCDEF0123456789')
    mod.rememberAssistantSession(HEX(1).slice(0, 31))
    mod.rememberAssistantSession('session-local')
    mod.forgetAiSessions(null)
    const sent = assistantCalls(calls)
    assert.equal(sent.length, 1)
    assert.deepEqual(bodyOf(sent[0]).sessionIds, [...Array.from({ length: 9 }, (_, index) => HEX(index + 2)), HEX(1)])
    assert.equal(sent[0].init.headers.Authorization, undefined)
  } finally {
    restore()
  }
})

test('取走即清空：第二次调用不再发', async () => {
  const { mod, calls, restore } = await loadForget()
  try {
    mod.rememberAssistantSession(HEX(3))
    mod.forgetAiSessions(null)
    mod.forgetAiSessions('member-token')
    assert.equal(assistantCalls(calls).length, 1)
  } finally {
    restore()
  }
})

test('API_MODE 不是 http 时不发，而且登记已经取走', async () => {
  const { mod, calls, client, restore } = await loadForget()
  try {
    client.setApiMode('mock')
    mod.rememberAssistantSession(HEX(4))
    mod.rememberAdvisorSession('advisor-job', { accessToken: 'anon-token' })
    mod.forgetAiSessions('member-token')
    assert.equal(calls.length, 0)
    client.setApiMode('http')
    mod.forgetAiSessions('member-token')
    assert.equal(calls.length, 0)
  } finally {
    restore()
  }
})

test('有会员令牌时小青发两次，先带 Bearer 再不带；没令牌只发一次', async () => {
  const withToken = await loadForget()
  try {
    withToken.mod.rememberAssistantSession(HEX(5))
    withToken.mod.forgetAiSessions('member-token')
    const sent = assistantCalls(withToken.calls)
    assert.equal(sent.length, 2)
    assert.equal(sent[0].init.headers.Authorization, 'Bearer member-token')
    assert.equal(sent[1].init.headers.Authorization, undefined)
    assert.deepEqual(bodyOf(sent[0]).sessionIds, [HEX(5)])
    assert.deepEqual(bodyOf(sent[1]).sessionIds, [HEX(5)])
    for (const call of sent) {
      assert.equal(call.init.method, 'POST')
      assert.equal(call.init.keepalive, true)
      assert.equal(call.init.credentials, 'include')
    }
  } finally {
    withToken.restore()
  }

  const guest = await loadForget()
  try {
    guest.mod.rememberAssistantSession(HEX(6))
    guest.mod.forgetAiSessions(null)
    const sent = assistantCalls(guest.calls)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].init.headers.Authorization, undefined)
    assert.equal(sent[0].init.keepalive, true)
    assert.deepEqual(bodyOf(sent[0]).sessionIds, [HEX(6)])
  } finally {
    guest.restore()
  }
})

test('作业凭据三种：只有会员、只有匿名令牌、什么都没有；两者都有时同一条请求带上', async () => {
  const { mod, calls, restore } = await loadForget()
  try {
    mod.rememberAdvisorSession('member-job')
    mod.forgetAiSessions('member-token')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, advisorUrl('member-job'))
    assert.equal(calls[0].init.headers.Authorization, 'Bearer member-token')
    assert.equal(calls[0].init.headers['x-advisor-access-token'], undefined)
    assert.equal(calls[0].init.body, undefined)
    assert.equal(calls[0].init.keepalive, true)

    mod.rememberAdvisorSession('anon-job', { accessToken: 'anon-token' })
    mod.forgetAiSessions(null)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].url, advisorUrl('anon-job'))
    assert.equal(calls[1].init.headers.Authorization, undefined)
    assert.equal(calls[1].init.headers['x-advisor-access-token'], 'anon-token')
    assert.equal(calls[1].init.keepalive, true)

    mod.rememberAdvisorSession('bare-job')
    mod.rememberAdvisorSession('bad id')
    mod.rememberAdvisorSession('')
    mod.forgetAiSessions(null)
    assert.equal(calls.length, 2)

    mod.rememberAdvisorSession('both-job', { accessToken: 'anon-token' })
    mod.forgetAiSessions('member-token')
    assert.equal(calls.length, 3)
    assert.equal(calls[2].url, advisorUrl('both-job'))
    assert.equal(calls[2].init.headers.Authorization, 'Bearer member-token')
    assert.equal(calls[2].init.headers['x-advisor-access-token'], 'anon-token')
    assert.equal(calls[2].init.keepalive, true)
  } finally {
    restore()
  }
})

test('作业号去重，只留最近 10 个，后一次没带令牌就沿用上次的', async () => {
  const { mod, calls, restore } = await loadForget()
  try {
    for (let n = 0; n < 11; n += 1) {
      mod.rememberAdvisorSession(`job-${n}`, { accessToken: `token-${n}` })
    }
    mod.rememberAdvisorSession('job-1')
    mod.forgetAiSessions(null)
    assert.equal(calls.length, 10)
    assert.deepEqual(calls.map((call) => call.url), [
      ...Array.from({ length: 9 }, (_, index) => advisorUrl(`job-${index + 2}`)),
      advisorUrl('job-1'),
    ])
    assert.equal(calls[9].init.headers['x-advisor-access-token'], 'token-1')
    assert.equal(calls.every((call) => call.init.keepalive === true), true)
  } finally {
    restore()
  }
})

test('没有登记时不发；fetch 同步抛错或拒绝都不往外抛', async () => {
  const { mod, calls, restore } = await loadForget()
  try {
    mod.forgetAiSessions('member-token')
    assert.equal(calls.length, 0)

    mod.rememberAssistantSession(HEX(7))
    mod.rememberAdvisorSession('throw-job', { accessToken: 'anon-token' })
    globalThis.fetch = () => { throw new Error('sync boom') }
    assert.doesNotThrow(() => mod.forgetAiSessions('member-token'))

    mod.rememberAssistantSession(HEX(8))
    globalThis.fetch = () => Promise.reject(new Error('async boom'))
    await assert.doesNotReject(async () => mod.forgetAiSessions(null))
  } finally {
    restore()
  }
})

test('503 时退避重试，最终失败不抛错、不卡住离场', async () => {
  const { mod, restore } = await loadForget()
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  const secret = '这段原话不许进诊断'
  const sessionId = HEX(21)
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return { ok: false, status: 503, json: async () => ({ message: secret }) }
  }
  try {
    mod.rememberAssistantSession(sessionId)
    const started = Date.now()
    assert.doesNotThrow(() => mod.forgetAiSessions(null))
    assert.ok(Date.now() - started < 100, '清场调用本身不能等回执')
    const deadline = Date.now() + 3_000
    while (calls < 3 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    assert.equal(calls, 3)
    const mine = warnings.filter((line) => line.includes('status=503'))
    assert.equal(mine.length, 1)
    assert.match(mine[0], /\[kiosk-clear\] forget_failed kind=assistant status=503 attempts=3/)
    assert.equal(mine[0].includes(secret), false)
    assert.equal(mine[0].includes(sessionId), false)
  } finally {
    console.warn = originalWarn
    restore()
  }
})

test('页面还在时等清场有结果再离场；页面先拆掉就停掉后续重试', async () => {
  const kept = await loadForget()
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  const secret = '离场原话不许进诊断'
  const sessionId = HEX(22)
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return { ok: false, status: 503, json: async () => ({ message: secret }) }
  }
  try {
    kept.mod.rememberAssistantSession(sessionId)
    const started = Date.now()
    kept.mod.forgetAiSessions(null)
    assert.ok(Date.now() - started < 100, '清场调用本身不能等回执')
    assert.equal(kept.mod.aiSessionForgetPending(), true, '重试还没跑完，离场不该当成已经结束')
    let left = false
    const leave = () => {
      assert.equal(kept.mod.aiSessionForgetPending(), false)
      left = true
      kept.mod.noteAiForgetPageGone()
    }
    await kept.mod.whenAiSessionsForgotten()
    leave()
    assert.equal(left, true)
    assert.equal(calls, 3, '页面留着时，三次请求都要发出去')
    const failed = warnings.filter((line) => line.includes('forget_failed'))
    assert.equal(failed.length, 1)
    assert.match(failed[0], /\[kiosk-clear\] forget_failed kind=assistant status=503 attempts=3/)
    assert.equal(warnings.some((line) => line.includes('已清') || line.includes(secret) || line.includes(sessionId)), false)
    assert.equal(warnings.some((line) => line.includes('forget_aborted')), false, '等完再拆页面，不算中途截断')
  } finally {
    console.warn = originalWarn
    kept.restore()
  }

  const torn = await loadForget()
  const tornWarnings = []
  console.warn = (...args) => { tornWarnings.push(args.map(String).join(' ')) }
  let tornCalls = 0
  globalThis.fetch = async () => {
    tornCalls += 1
    return { ok: false, status: 503, json: async () => ({}) }
  }
  try {
    torn.mod.rememberAssistantSession(HEX(23))
    torn.mod.forgetAiSessions(null)
    await new Promise((resolve) => setTimeout(resolve, 16))
    torn.mod.noteAiForgetPageGone()
    await torn.mod.whenAiSessionsForgotten()
    assert.equal(tornCalls, 1, '16 毫秒拆掉页面时，只来得及发出第一次请求')
    assert.equal(torn.mod.aiSessionForgetPending(), false)
    const aborted = tornWarnings.filter((line) => line.includes('forget_aborted'))
    assert.equal(aborted.length, 1)
    assert.match(aborted[0], /\[kiosk-clear\] forget_aborted reason=page_gone/)
    assert.equal(tornWarnings.some((line) => line.includes('已清') || line.includes('forget_failed')), false)
  } finally {
    console.warn = originalWarn
    torn.restore()
  }
})

test('请求一直不回来时，8 秒到点记诊断并放行，不说已清', { timeout: 15_000 }, async () => {
  const { mod, restore } = await loadForget()
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  let calls = 0
  globalThis.fetch = () => {
    calls += 1
    return new Promise(() => undefined)
  }
  try {
    mod.rememberAssistantSession(HEX(24))
    const started = Date.now()
    mod.forgetAiSessions(null)
    await mod.whenAiSessionsForgotten()
    const elapsed = Date.now() - started
    assert.ok(elapsed >= 7_500 && elapsed < 12_000, `到点应当接近 8 秒，实际 ${elapsed}`)
    assert.equal(calls, 1)
    const deadline = warnings.filter((line) => line.includes('forget_deadline'))
    assert.equal(deadline.length, 1)
    assert.match(deadline[0], /\[kiosk-clear\] forget_deadline kind=assistant attempts=/)
    assert.equal(warnings.some((line) => line.includes('已清')), false)
    assert.equal(mod.aiSessionForgetPending(), false)
  } finally {
    console.warn = originalWarn
    mod.noteAiForgetPageGone()
    restore()
  }
})

/**
 * 接线：读作业成功才登记（号 + 这次的凭据），读失败不登记。编译 advisor.ts 真跑，
 * 删掉 getAdvisorSession 里那一行登记、或挪到「读失败就抛」之前，这条就红。
 */
async function loadAdvisorApi(response) {
  seed += 1
  const key = `__advisorForgetProbe${seed}`
  const probe = { response, remembered: [] }
  globalThis[key] = probe
  const stub = (code) => toDataUrl(`${code}\n// ${seed}\n`)
  const ref = `globalThis[${JSON.stringify(key)}]`
  const code = `${transpile('src/services/api/advisor.ts')}\n// ${seed}\n`
    .replaceAll("from '../terminalAuth'", `from '${stub(`export async function terminalAttributedFetch() { return ${ref}.response }`)}'`)
    .replaceAll("from './aiSessionForget'", `from '${stub(`export function rememberAdvisorSession(...args) { ${ref}.remembered.push(args) }`)}'`)
    .replaceAll("from './client'", `from '${stub("export const API_BASE_URL = '/api/v1'\nexport const API_MODE = 'http'")}'`)
    .replaceAll("from './httpAdapter'", `from '${stub('export class ApiHttpError extends Error {}')}'`)
    .replaceAll("from './throwHttpError'", `from '${stub("export const networkError = (err) => err\nexport async function throwHttpError() { throw new Error('读取失败') }")}'`)
  const mod = await import(toDataUrl(code))
  return { mod, probe, restore() { delete globalThis[key] } }
}

test('读作业成功才登记作业号和这次的凭据；读失败不登记', async () => {
  const ok = await loadAdvisorApi({ ok: true, status: 200, json: async () => ({ id: 'clsessionread0000000000001' }) })
  try {
    await ok.mod.getAdvisorSession('clsessionread0000000000001', { accessToken: 'anon-access-7f3a' })
    assert.deepEqual(ok.probe.remembered, [['clsessionread0000000000001', { accessToken: 'anon-access-7f3a' }]])
  } finally {
    ok.restore()
  }
  const bad = await loadAdvisorApi({ ok: false, status: 404, json: async () => ({}) })
  try {
    await assert.rejects(bad.mod.getAdvisorSession('clsessionread0000000000002', { accessToken: 'anon-access-7f3a' }))
    assert.deepEqual(bad.probe.remembered, [], '读失败不许登记')
  } finally {
    bad.restore()
  }
})

test('接线：重载前等清场结果，拆页时停下还在睡的重试', () => {
  const guard = readFileSync(join(root, 'src/auth/KioskPrivacyGuard.tsx'), 'utf8')
  const hold = readFileSync(join(root, 'src/auth/useKioskClearHold.ts'), 'utf8')
  const pushStart = guard.indexOf('function pushSanitizedDestination')
  const pushEnd = guard.indexOf('function scheduleSanitizedDestination')
  const push = guard.slice(pushStart, pushEnd)
  assert.match(push, /noteAiForgetPageGone\(\)[\s\S]*?window\.location\.reload\(\)/)
  assert.match(push, /noteAiForgetPageGone\(\)[\s\S]*?window\.location\.replace\(destination\.path\)/)
  assert.match(hold, /if \(!aiSessionForgetPending\(\)\) \{\s*run\(\)/)
  assert.match(hold, /whenAiSessionsForgotten\(\)\.then/)
})

async function loadSessionClear() {
  seed += 1
  const hosting = toDataUrl(`export function isRecruitmentRoute() { return false }\n// ${seed}`)
  const forget = toDataUrl(`export function rememberAssistantSession() {}\n// ${seed}`)
  const scenes = `${transpile('src/pages/assistant/advisorScenes.ts')}\n// ${seed}\n`
    .replaceAll("from '../../hooks/useRecruitmentHosting'", `from '${hosting}'`)
    .replaceAll("from '../../services/api/aiSessionForget'", `from '${forget}'`)
  const clear = `${transpile('src/pages/assistant/assistantSessionClear.ts')}\n// ${seed}\n`
    .replaceAll("from './advisorScenes'", `from '${toDataUrl(scenes)}'`)
  return import(toDataUrl(clear))
}

test('清场时小青页换掉会话号，页面不卸载也不再送上一位的号', async () => {
  const page = readFileSync(join(root, 'src/pages/assistant/AssistantPage.tsx'), 'utf8')
  const start = page.indexOf('subscribeKioskSensitiveSessionClear')
  assert.ok(start > 0, '小青页没有订阅清场')
  const effect = page.slice(start, page.indexOf('}, [])', start))
  assert.match(effect, /applyAssistantSessionClear\(\s*requestTokenRef,\s*sessionIdRef,/)
  assert.match(effect, /setMessages\(\[WELCOME\]\)/)
  assert.match(effect, /setInput\(''\)/)
  assert.doesNotMatch(effect, /requestTokenRef\.current \+= 1/)
  assert.doesNotMatch(effect, /sessionIdRef\.current = newSessionId\(\)/)

  const { applyAssistantSessionClear } = await loadSessionClear()
  const sessionIdRef = { current: 'a'.repeat(32) }
  const requestTokenRef = { current: 2 }
  let screen = '旧对话'
  applyAssistantSessionClear(requestTokenRef, sessionIdRef, () => { screen = '欢迎' })
  assert.equal(requestTokenRef.current, 3)
  assert.match(sessionIdRef.current, /^[0-9a-f]{32}$/)
  assert.notEqual(sessionIdRef.current, 'a'.repeat(32))
  assert.equal(screen, '欢迎')

  const exports = {}
  const sensitiveSrc = ts.transpileModule(
    readFileSync(join(root, 'src/auth/kioskSensitiveSession.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: 'kioskSensitiveSession.ts' },
  ).outputText
  const requireSensitive = (name) => {
    if (name === 'react') return { useEffect: () => undefined, useState: (initial) => [initial, () => undefined] }
    if (name === '../services/assistantDraft') {
      return { clearAssistantDraft() {}, clearAssistantPolicyContext() {}, ASSISTANT_DRAFT_KEY: 'draft', ASSISTANT_POLICY_KEY: 'policy' }
    }
    return new Proxy({}, { get: () => () => undefined })
  }
  new Function('exports', 'require', sensitiveSrc)(exports, requireSensitive)
  const sessionIdRef2 = { current: 'c'.repeat(32) }
  const requestTokenRef2 = { current: 2 }
  let screen2 = '旧对话'
  const stop = exports.subscribeKioskSensitiveSessionClear(() => {
    applyAssistantSessionClear(requestTokenRef2, sessionIdRef2, () => { screen2 = '欢迎' })
  })
  exports.clearKioskSensitiveSession()
  assert.equal(requestTokenRef2.current, 3)
  assert.match(sessionIdRef2.current, /^[0-9a-f]{32}$/)
  assert.notEqual(sessionIdRef2.current, 'c'.repeat(32))
  assert.notEqual(sessionIdRef2.current, sessionIdRef.current)
  assert.equal(screen2, '欢迎')
  const held = sessionIdRef2.current
  stop()
  exports.clearKioskSensitiveSession()
  assert.equal(sessionIdRef2.current, held, '退订之后不再换号')
})

test('接线：小青总结回了作业号也登记（aiHttpAdapter 的 summarizeAssistantSession）', () => {
  const src = readFileSync(join(root, 'src/services/api/aiHttpAdapter.ts'), 'utf8')
  const start = src.indexOf('async summarizeAssistantSession(')
  assert.ok(start >= 0, '找不到 summarizeAssistantSession')
  const end = src.indexOf('\n  },', start)
  assert.ok(end > start, '找不到 summarizeAssistantSession 的结尾')
  assert.match(src.slice(start, end), /rememberAdvisorSession\(res\.advisorSessionId\)/)
})
