/**
 * 清场忘掉小青对话和作业内存：编译真模块跑。
 *
 * 锁住：只收 32 位小写十六进制、去重、只留最近 10 个；取走即清空；
 * 非 http 不发；小青有令牌发两次、没令牌发一次；作业凭据三种；
 * fetch 抛错不往外抛；每次都带 keepalive。
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

test('接线：小青总结回了作业号也登记（aiHttpAdapter 的 summarizeAssistantSession）', () => {
  const src = readFileSync(join(root, 'src/services/api/aiHttpAdapter.ts'), 'utf8')
  const start = src.indexOf('async summarizeAssistantSession(')
  assert.ok(start >= 0, '找不到 summarizeAssistantSession')
  const end = src.indexOf('\n  },', start)
  assert.ok(end > start, '找不到 summarizeAssistantSession 的结尾')
  assert.match(src.slice(start, end), /rememberAdvisorSession\(res\.advisorSessionId\)/)
})
