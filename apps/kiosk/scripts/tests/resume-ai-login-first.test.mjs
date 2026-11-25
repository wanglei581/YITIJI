import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// 后台开着「用 AI 前先登录」（终端配置 ai.loginGate = before_generate）时，
// 游客在改简历的来源页先去现有登录页，登录后回到同一步再选来源、传文件；开关关着照旧。
const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relative) => readFileSync(join(kioskRoot, relative), 'utf8')

function load(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  new Function('exports', 'require', output)(exports, (name) => {
    if (!(name in dependencies)) throw new Error(`意外依赖 ${name}`)
    return dependencies[name]
  })
  return exports
}

/** 不起 React：useState 直接取初值，useEffect 立刻执行，记下每次 setState。 */
function loadGateReader({ terminalId, peeked, fetched }) {
  const calls = { peekMaxAge: [], fetched: 0, set: [] }
  const react = {
    useState: (init) => [typeof init === 'function' ? init() : init, (value) => calls.set.push(value)],
    useEffect: (effect) => { effect() },
  }
  const terminalConfig = {
    getTerminalId: () => terminalId,
    peekCachedKioskTerminalConfig: (_id, maxAge) => { calls.peekMaxAge.push(maxAge); return peeked },
    getCachedKioskTerminalConfig: () => { calls.fetched += 1; return fetched },
  }
  const reader = load('src/hooks/useKioskAiLoginGate.ts', {
    react,
    '../services/api/terminalConfig': terminalConfig,
  })
  return { reader, calls }
}

const config = (ai) => ({ configVersion: 'resume-login-first', refreshIntervalMs: 300000, serverTime: '2026-11-26T02:00:00.000Z', ...(ai === undefined ? {} : { ai }) })
const gateOn = config({ loginGate: 'before_generate', declarationEnforced: false, paused: false })

const { reader } = loadGateReader({ terminalId: '', peeked: null, fetched: Promise.resolve(null) })
const { kioskAiLoginGateOf, guestMustLoginBeforeAi } = reader
const { resolveLoginReturnTo } = load('src/pages/auth/loginGateModel.ts')
const { isSafeInternalPath } = load('src/auth/returnPath.ts')
const sourcePage = read('src/pages/resume/ResumeSourcePage.tsx')

test('开关要求「使用 AI 前登录」时，游客在选来源、传文件之前就去登录，登录后回到同一步', () => {
  const gate = kioskAiLoginGateOf(gateOn)
  assert.equal(gate, 'before_generate')
  assert.equal(guestMustLoginBeforeAi(gate, false), true)

  // 来源页把当前路径（含意图）交给登录页；登录页按它回来，诊断 / 优化不会被改掉。
  for (const from of ['/resume/source?intent=diagnose', '/resume/source?intent=optimize', '/resume/source']) {
    assert.deepEqual(resolveLoginReturnTo(from, null, isSafeInternalPath), { returnTo: from, fromRejected: false }, from)
  }

  const redirect = sourcePage.indexOf('<Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />')
  assert.ok(redirect > 0, '来源页转去现有登录页，带上当前路径和意图，并替换掉这一条历史')
  assert.match(sourcePage, /if \(guestMustLoginBeforeAi\(aiLoginGate, isLoggedIn\) && !aiDown\) \{\s*return <Navigate to="\/login"/)
  // 在画出来源卡、二维码、上传框之前就转走：转走发生在页面主体之前。
  assert.ok(redirect < sourcePage.indexOf('<ResumeTouchPage'), '转去登录发生在画出页面主体之前')
  assert.ok(redirect < sourcePage.indexOf('<ResumeSourceWhere'), '转去登录发生在来源卡、上传之前')
})

test('开关关着、只要求导出前登录、没读到配置时，游客照旧留在来源页', () => {
  for (const sample of [
    config({ loginGate: 'off', declarationEnforced: false, paused: false }),
    config({ loginGate: 'before_export', declarationEnforced: false, paused: false }),
    config(undefined),
    config(null),
    config({ loginGate: 'BEFORE_GENERATE' }),
    config({ loginGate: true }),
    null,
    'before_generate',
  ]) {
    assert.equal(guestMustLoginBeforeAi(kioskAiLoginGateOf(sample), false), false, JSON.stringify(sample))
  }
  assert.equal(kioskAiLoginGateOf(config({ loginGate: 'off' })), 'off')
  assert.equal(kioskAiLoginGateOf(config({ loginGate: 'before_export' })), 'before_export')
  assert.equal(kioskAiLoginGateOf(config(undefined)), 'unknown')
})

test('已经登录的人不再被送去登录；小青停用那一屏只走打印原件，不拦', () => {
  assert.equal(guestMustLoginBeforeAi('before_generate', true), false)
  assert.match(sourcePage, /guestMustLoginBeforeAi\(aiLoginGate, isLoggedIn\) && !aiDown/)
})

test('首屏用本页已有的那份配置，挂载后再读一次；没有终端身份时按没读到处理', async () => {
  const fetched = Promise.resolve(config({ loginGate: 'off', declarationEnforced: false, paused: false }))
  const live = loadGateReader({ terminalId: 'KSK-001', peeked: gateOn, fetched })
  assert.equal(live.reader.useKioskAiLoginGate(), 'before_generate')
  assert.deepEqual(live.calls.peekMaxAge, [Number.POSITIVE_INFINITY])
  assert.equal(live.calls.fetched, 1)
  await fetched
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(live.calls.set, ['off'])

  const none = loadGateReader({ terminalId: '', peeked: gateOn, fetched })
  assert.equal(none.reader.useKioskAiLoginGate(), 'unknown')
  assert.equal(none.calls.fetched, 0)
})
