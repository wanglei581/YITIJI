/**
 * 服务人次上报（KioskSession 契约 v1）—— 上报器单元测试。
 *
 * 写法照 print-handoff.test.mjs：把真实的 src/services/api/kioskSession.ts 转译成 ESM 直接跑，
 * 发请求、时间、编号、等待都由测试注入，不在测试里另抄一份逻辑。
 *
 *   R1  首页误触不 start；进入服务页才 start，开始时间取第一次触摸
 *   R2  start → 同大类不重复 → 新大类 heartbeat → 5 分钟后同大类再 heartbeat → 有操作时按间隔补报
 *   R3  清场 end：同一周期编号、原因照传；随后换新编号，下一次进入服务页 start 新周期
 *   R4  heartbeat 回 404：按原编号补 start
 *   R5  end 回 404：补 start 再 end
 *   R6  失败静默：抛错 / 5xx 只再试 1 次；400 / 429 不重试；全程不抛、不拒绝
 *   R7  关闭时（演示模式、测试构建）一个请求都不发
 *   R8  待机屏：屏保上不计；唤醒那一刻作为新周期开始时间
 *   R9  请求体只含契约字段，不带路径、手机号、会员号、文件名
 *   R10 大类与结束原因白名单与服务端源码逐字一致；路径归类抽样
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const repoRoot = join(kioskRoot, '../..')

const src = readFileSync(join(kioskRoot, 'src/services/api/kioskSession.ts'), 'utf8')
const out = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'kioskSession.ts',
}).outputText
assert.deepEqual([...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]), [], 'kioskSession.ts 必须保持零运行时依赖')
const mod = await import(`data:text/javascript;base64,${Buffer.from(out).toString('base64')}`)
const { createKioskVisitReporter, categoryForPath, KIOSK_VISIT_CATEGORIES, KIOSK_VISIT_END_REASONS, KIOSK_VISIT_HEARTBEAT_MS } = mod

const MIN = 60_000
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** 可控的注入：时钟、编号、应答脚本、记录的请求。 */
function harness({ respond = () => 200, enabled = true, startAt = Date.UTC(2026, 8, 29, 2, 0, 0) } = {}) {
  let now = startAt
  let n = 0
  const calls = []
  const sleeps = []
  const deps = {
    now: () => now,
    uuid: () => {
      n += 1
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    },
    sleep: async (ms) => { sleeps.push(ms) },
    send: async (endpoint, body) => {
      calls.push({ endpoint, body: { ...body } })
      return respond(endpoint, body, calls.length)
    },
  }
  const reporter = createKioskVisitReporter(deps, enabled)
  return {
    reporter,
    calls,
    sleeps,
    advance: (ms) => { now += ms },
    at: () => now,
    iso: (ms) => new Date(ms).toISOString(),
  }
}

test('R1 首页误触不 start；进入服务页才 start，开始时间取第一次触摸', async () => {
  const h = harness()
  h.reporter.enterPath('/')
  h.advance(40 * MIN) // 清场后空等 40 分钟
  const touchAt = h.at()
  h.reporter.noteActivity()
  h.advance(2_000)
  h.reporter.noteActivity() // 第二次触摸不改开始时间
  h.reporter.enterPath('/')
  await h.reporter.settle()
  assert.equal(h.calls.length, 0, '只在首页点来点去不算一次使用')

  h.advance(3_000)
  h.reporter.enterPath('/print-scan')
  await h.reporter.settle()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].endpoint, 'start')
  assert.equal(h.calls[0].body.category, 'print')
  assert.equal(h.calls[0].body.wokeAt, h.iso(touchAt), '开始时间是第一次触摸，不是清场那一刻')
  assert.match(h.calls[0].body.clientSessionId, UUID_V4)
})

test('R2 start → 同大类不重复 → 新大类 heartbeat → 5 分钟后同大类再报 → 有操作时按间隔补报', async () => {
  const h = harness()
  h.reporter.enterPath('/print-scan')
  h.reporter.enterPath('/print/desk')
  h.reporter.enterPath('/print/confirm')
  await h.reporter.settle()
  assert.deepEqual(h.calls.map((c) => c.endpoint), ['start'], '同一大类内翻页不发 heartbeat')
  const id = h.calls[0].body.clientSessionId

  h.advance(MIN)
  h.reporter.enterPath('/resume/source')
  await h.reporter.settle()
  assert.deepEqual(h.calls[1], { endpoint: 'heartbeat', body: { clientSessionId: id, category: 'resume' } })

  h.advance(MIN)
  h.reporter.enterPath('/print/desk')
  await h.reporter.settle()
  assert.equal(h.calls.length, 2, 'print 五分钟内已报过')

  h.advance(KIOSK_VISIT_HEARTBEAT_MS)
  h.reporter.enterPath('/print/cashier')
  await h.reporter.settle()
  assert.deepEqual(h.calls[2], { endpoint: 'heartbeat', body: { clientSessionId: id, category: 'print' } })

  // 同一页里一直在操作：五分钟内的触摸不补报，满五分钟补一次不带大类的 heartbeat。
  h.advance(MIN)
  h.reporter.noteActivity()
  await h.reporter.settle()
  assert.equal(h.calls.length, 3)
  h.advance(KIOSK_VISIT_HEARTBEAT_MS)
  h.reporter.noteActivity()
  h.reporter.noteActivity()
  await h.reporter.settle()
  assert.deepEqual(h.calls[3], { endpoint: 'heartbeat', body: { clientSessionId: id } })
  assert.equal(h.calls.length, 4, '同一刻的多次触摸只补报一次')
})

test('R3 清场 end：同一周期编号、原因照传；之后换新编号开始新周期', async () => {
  const h = harness()
  h.reporter.enterPath('/scan')
  await h.reporter.settle()
  const first = h.calls[0].body.clientSessionId
  h.advance(3 * MIN)
  const endAt = h.at()
  h.reporter.end('idle_timeout')
  await h.reporter.settle()
  assert.deepEqual(h.calls[1], {
    endpoint: 'end',
    body: { clientSessionId: first, endedAt: h.iso(endAt), endReason: 'idle_timeout' },
  })
  const next = h.reporter.snapshot()
  assert.notEqual(next.clientSessionId, first, '清场之后必须换新周期编号')
  assert.equal(next.started, false)

  // 再次清场（新周期没开始过）：什么都不发。
  h.reporter.end('privacy_clear')
  await h.reporter.settle()
  assert.equal(h.calls.length, 2)

  h.advance(MIN)
  const touchAt = h.at()
  h.reporter.noteActivity()
  h.reporter.enterPath('/interview')
  await h.reporter.settle()
  assert.equal(h.calls[2].endpoint, 'start')
  assert.notEqual(h.calls[2].body.clientSessionId, first)
  assert.equal(h.calls[2].body.wokeAt, h.iso(touchAt))
  assert.equal(h.calls[2].body.category, 'interview')
})

test('R4 heartbeat 回 404：按原编号补 start（start 幂等）', async () => {
  const h = harness({ respond: (endpoint) => (endpoint === 'heartbeat' ? 404 : 200) })
  const touchAt = h.at()
  h.reporter.noteActivity()
  h.reporter.enterPath('/assistant')
  h.advance(MIN)
  h.reporter.enterPath('/policy-service')
  await h.reporter.settle()
  const id = h.calls[0].body.clientSessionId
  assert.deepEqual(h.calls.map((c) => c.endpoint), ['start', 'heartbeat', 'start'])
  assert.deepEqual(h.calls[2].body, { clientSessionId: id, wokeAt: h.iso(touchAt), category: 'policy' })
})

test('R5 end 回 404：补 start 再 end', async () => {
  let endCalls = 0
  const h = harness({
    respond: (endpoint) => {
      if (endpoint !== 'end') return 200
      endCalls += 1
      return endCalls === 1 ? 404 : 200
    },
  })
  h.reporter.enterPath('/login')
  h.advance(MIN)
  h.reporter.end('user_exit')
  await h.reporter.settle()
  assert.deepEqual(h.calls.map((c) => c.endpoint), ['start', 'end', 'start', 'end'])
  const id = h.calls[0].body.clientSessionId
  for (const c of h.calls) assert.equal(c.body.clientSessionId, id)
  assert.equal(h.calls[3].body.endReason, 'user_exit')
})

test('R6 失败静默：抛错 / 5xx 只再试 1 次；400 / 429 不重试；不抛不拒绝', async () => {
  for (const [label, respond, expectedCalls, expectedSleeps] of [
    ['连不上', () => { throw new TypeError('Failed to fetch') }, 2, 1],
    ['服务 503', () => 503, 2, 1],
    ['本机未就绪（-1）', () => -1, 1, 0],
    ['400', () => 400, 1, 0],
    ['429 限流', () => 429, 1, 0],
  ]) {
    const h = harness({ respond })
    assert.doesNotThrow(() => h.reporter.enterPath('/print-scan'), label)
    await assert.doesNotReject(h.reporter.settle(), label)
    assert.equal(h.calls.length, expectedCalls, `${label}：请求次数`)
    assert.equal(h.sleeps.length, expectedSleeps, `${label}：重试前等待次数`)
    assert.doesNotThrow(() => h.reporter.end('privacy_clear'), label)
    await assert.doesNotReject(h.reporter.settle(), label)
  }
  // 第二次成功：只重试一次就收手。
  let attempt = 0
  const h = harness({ respond: () => { attempt += 1; return attempt === 1 ? 502 : 200 } })
  h.reporter.enterPath('/scan')
  await h.reporter.settle()
  assert.equal(h.calls.length, 2)
  assert.deepEqual(h.calls[0], h.calls[1], '重试发的是同一份请求体')
})

test('R7 关闭时一个请求都不发', async () => {
  const h = harness({ enabled: false })
  h.reporter.noteActivity()
  h.reporter.enterPath('/print-scan')
  h.advance(10 * MIN)
  h.reporter.enterPath('/scan')
  h.reporter.noteActivity()
  h.reporter.end('idle_timeout')
  await h.reporter.settle()
  assert.equal(h.calls.length, 0)
})

test('R8 待机屏上不计；唤醒那一刻是新周期的开始时间', async () => {
  const h = harness()
  h.reporter.enterPath('/print-scan')
  h.reporter.end('idle_timeout') // 进屏保前的清场
  h.reporter.enterPath('/screensaver')
  h.advance(30 * MIN)
  h.reporter.noteActivity() // 屏保上的触摸由屏保页处理成唤醒，本身不算开始
  h.advance(1_000)
  const wakeAt = h.at()
  h.reporter.enterPath('/') // 唤醒回首页
  h.advance(5_000)
  h.reporter.noteActivity()
  h.reporter.enterPath('/resume/career-plan')
  await h.reporter.settle()
  assert.deepEqual(h.calls.map((c) => c.endpoint), ['start', 'end', 'start'])
  assert.equal(h.calls[2].body.wokeAt, h.iso(wakeAt))
  assert.equal(h.calls[2].body.category, 'career')
})

test('R9 请求体只含契约字段', async () => {
  const h = harness({ respond: (endpoint, _b, i) => (endpoint === 'heartbeat' && i === 2 ? 404 : 200) })
  h.reporter.enterPath('/me/print-orders')
  h.advance(MIN)
  h.reporter.enterPath('/print/pickup-claim')
  h.advance(KIOSK_VISIT_HEARTBEAT_MS)
  h.reporter.noteActivity()
  h.reporter.end('handover')
  await h.reporter.settle()
  const allowed = {
    start: ['category', 'clientSessionId', 'wokeAt'],
    heartbeat: ['category', 'clientSessionId'],
    end: ['clientSessionId', 'endReason', 'endedAt'],
  }
  for (const c of h.calls) {
    for (const key of Object.keys(c.body)) assert.ok(allowed[c.endpoint].includes(key), `${c.endpoint} 带了契约外字段 ${key}`)
    const text = JSON.stringify(c.body)
    assert.ok(!text.includes('/'), `${c.endpoint} 请求体里出现了路径：${text}`)
  }
})

test('R10 白名单与服务端源码一致；路径归类抽样', () => {
  const serverTypes = readFileSync(join(repoRoot, 'services/api/src/kiosk-session/kiosk-session.types.ts'), 'utf8')
  const sf = ts.createSourceFile('t.ts', serverTypes, ts.ScriptTarget.ES2022, true)
  const arrays = {}
  sf.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return
    for (const decl of node.declarationList.declarations) {
      let init = decl.initializer
      if (init && ts.isAsExpression(init)) init = init.expression
      if (init && ts.isArrayLiteralExpression(init)) {
        arrays[decl.name.getText(sf)] = init.elements.filter(ts.isStringLiteralLike).map((e) => e.text)
      }
    }
  })
  assert.deepEqual([...KIOSK_VISIT_CATEGORIES], arrays.KIOSK_SERVICE_CATEGORIES)
  assert.deepEqual([...KIOSK_VISIT_END_REASONS], arrays.KIOSK_SESSION_END_REASONS)

  const cases = {
    '/': null,
    '/screensaver': null,
    '/session-timeout': null,
    '/legal/privacy': null,
    '/print-scan': 'print',
    '/print/pickup-claim': 'print',
    '/upload/phone': 'print',
    '/scan': 'scan',
    '/resume/source': 'resume',
    '/resume/career-plan': 'career',
    '/resume/self-assessment/intro': 'career',
    '/interview': 'interview',
    '/assistant': 'assistant',
    '/policy-service': 'policy',
    '/official-channels': 'official_channel',
    '/login': 'member',
    '/member/qr-login': 'member',
    '/profile': 'member',
    '/me/print-orders': 'member',
    '/me/feedback': 'help',
    '/help': 'help',
    '/toolbox': 'other',
    '/printer-not-a-route': 'other',
  }
  for (const [path, want] of Object.entries(cases)) assert.equal(categoryForPath(path), want, path)
  for (const path of Object.keys(cases)) {
    const got = categoryForPath(path)
    if (got !== null) assert.ok(KIOSK_VISIT_CATEGORIES.includes(got), `${path} 归到了白名单外的 ${got}`)
  }
})
