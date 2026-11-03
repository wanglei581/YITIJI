import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../../src/services/localAgentProbe.ts', import.meta.url), 'utf8')
let id = 0
async function load(token) {
  const patched = source.replaceAll('import.meta.env', JSON.stringify({ VITE_TERMINAL_AGENT_BRIDGE_TOKEN: token }))
  const js = ts.transpileModule(patched, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  return import(`data:text/javascript,${encodeURIComponent(js)}#${id++}`)
}
globalThis.window = globalThis

test('未配置令牌不发请求；配置后只按只读请求的响应判断程序', async () => {
  let calls = 0
  globalThis.fetch = async (url, options) => {
    calls++
    assert.match(url, /\/local\/usb\/status$/)
    assert.equal(options.method, 'GET')
    assert.equal(options.headers['X-Local-Bridge-Token'], 'token')
    return { ok: true }
  }
  assert.equal(await (await load('')).probeLocalAgent(), 'unconfigured')
  assert.equal(calls, 0)
  const agent = await load('token')
  assert.equal(await agent.probeLocalAgent(), 'reachable')
  globalThis.fetch = async () => { throw new TypeError('refused') }
  assert.equal(await agent.probeLocalAgent(), 'unreachable')
  globalThis.fetch = async () => ({ ok: false })
  assert.equal(await agent.probeLocalAgent(), 'unreachable')
})

test('超时视为连不上，取消的旧请求不能覆盖新结果', async () => {
  const agent = await load('token')
  let finish
  globalThis.fetch = (_url, { signal }) => new Promise((resolve, reject) => {
    finish = resolve
    signal.addEventListener('abort', () => reject(new Error('aborted')))
  })
  const old = agent.probeLocalAgent()
  globalThis.fetch = async () => ({ ok: false })
  assert.equal(await agent.probeLocalAgent(), 'unreachable')
  finish({ ok: true })
  await old
  assert.equal(agent.localAgentSnapshot(), 'unreachable')
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout'))))
  assert.equal(await agent.probeLocalAgent(), 'unreachable')
})

test('状态页对三种网桥状态保留证据边界', async () => {
  const page = readFileSync(new URL('../../src/pages/placeholders/ErrorOfflinePage.tsx', import.meta.url), 'utf8')
  const start = page.indexOf('type Row =')
  const end = page.indexOf('const clock =', start)
  assert.ok(start >= 0 && end > start)
  const snippet = `type Tone = 'q' | 'ok' | 'warn' | 'bad'; type View = any; type CheckResult = any;
    const UNREAD_LABEL = '暂时读不到';
    const UNREAD = { verdict: [UNREAD_LABEL, 'warn'], scanVerdict: [UNREAD_LABEL, 'warn'] };
    ${page.slice(start, end)}\nexport { rowsFor, outcomeOf };`
  const js = ts.transpileModule(snippet, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  const { rowsFor, outcomeOf } = await import(`data:text/javascript,${encodeURIComponent(js)}`)
  const printer = { heartbeatOnline: true, verdict: ['这次读到可用', 'ok'], scanVerdict: ['这次读到可接收', 'ok'] }
  const rows = (agent) => rowsFor('partial', { printer, agent })
  assert.equal(rows('unreachable')[1].verdict[0], '这次连不上')
  assert.deepEqual(rows('unreachable').slice(2, 4).map((row) => row.verdict[0]), ['暂时读不到', '暂时读不到'])
  assert.equal(outcomeOf(rows('unreachable')), 'has-bad')
  assert.equal(outcomeOf(rows('reachable')), 'all-read')
  assert.equal(rows('unconfigured')[1].dep, '只看云端心跳')
  assert.equal(outcomeOf(rows('unconfigured')), 'all-read')
})
