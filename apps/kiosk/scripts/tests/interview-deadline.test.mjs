import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
function loadSource(source) {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(js)}`)
}
const deadline = await loadSource(readFileSync(join(kioskRoot, 'src/pages/interview/session/interviewDeadline.ts'), 'utf8'))
const localNow = Date.parse('2026-10-10T00:00:00.000Z')
const serverTiming = {
  startedAt: '2026-10-10T00:00:30.000Z',
  serverNow: '2026-10-10T00:00:30.000Z',
  deadlineAt: '2026-10-10T00:03:20.000Z',
  timeUp: false,
}

test('剩余秒数向上取整，到点及过点都为零', () => {
  for (const [delta, expected] of [[0, 0], [1, 1], [1000, 1], [1001, 2], [-1, 0], [-1001, 0]]) {
    assert.equal(deadline.remainingSecAt(localNow + delta, localNow), expected)
  }
  assert.equal(deadline.INTERVIEW_DEADLINE_WARN_SEC, 60)
})

test('服务端快或慢三十秒，都用服务端剩余时长换算', () => {
  assert.equal(deadline.deadlineFromServerTiming(serverTiming, localNow), localNow + 170_000)
  assert.equal(deadline.deadlineFromServerTiming({
    ...serverTiming, startedAt: '2026-10-09T23:59:30.000Z',
    serverNow: '2026-10-09T23:59:30.000Z', deadlineAt: '2026-10-10T00:02:20.000Z',
  }, localNow), localNow + 170_000)
})

test('时间缺失、解析失败或截止早于开场时，不校准', () => {
  for (const patch of [
    { deadlineAt: null }, { serverNow: null }, { deadlineAt: '坏时间' },
    { serverNow: '' }, { startedAt: '坏时间' }, { startedAt: '2026-10-10T00:04:00.000Z' },
  ]) assert.equal(deadline.deadlineFromServerTiming({ ...serverTiming, ...patch }, localNow), null)
  assert.equal(deadline.deadlineFromServerTiming({ ...serverTiming, startedAt: null }, localNow), localNow + 170_000)
  assert.equal(deadline.deadlineFromServerTiming({ ...serverTiming, serverNow: '2026-10-10T00:04:00.000Z' }, localNow), localNow - 40_000)
})

test('任意返回值均可安全读取，timeUp 只认 true', () => {
  const empty = { startedAt: null, deadlineAt: null, serverNow: null, timeUp: false }
  for (const raw of [null, undefined, '时间', {}, { startedAt: 1, deadlineAt: false, serverNow: {}, timeUp: 'true' }]) {
    assert.deepEqual(deadline.readInterviewTiming(raw), empty)
  }
  for (const timeUp of [false, 1, 'true', null, undefined]) {
    assert.equal(deadline.readInterviewTiming({ timeUp }).timeUp, false)
  }
  assert.equal(deadline.readInterviewTiming({ timeUp: true }).timeUp, true)
  // 旧草案里叫 closed 的字段不认：约定只有 timeUp。
  assert.equal(deadline.readInterviewTiming({ closed: true }).timeUp, false)
  assert.deepEqual(deadline.readInterviewTiming(serverTiming), serverTiming)
})

test('本机开场支持三种时长，无效时长按五分钟', () => {
  for (const duration of [3, 5, 8]) assert.equal(deadline.deadlineFromLocalStart(duration, localNow), localNow + duration * 60_000)
  for (const duration of [NaN, 0, -1, Infinity]) assert.equal(deadline.deadlineFromLocalStart(duration, localNow), localNow + 300_000)
})

test('旧剩余秒数可迁移，零秒不会重新开场', () => {
  assert.equal(deadline.deadlineFromLegacyRemaining(115, localNow), localNow + 115_000)
  for (const seconds of [0, -1, NaN, Infinity]) assert.equal(deadline.deadlineFromLegacyRemaining(seconds, localNow), localNow)
})

test('parseLive 只保留有限正数截止时刻和合法来源', async () => {
  const source = readFileSync(join(kioskRoot, 'src/pages/interview/interviewWorkbenchSession.ts'), 'utf8')
  const ast = ts.createSourceFile('session.ts', source, ts.ScriptTarget.Latest, true)
  // 抽实际解析函数，防止测试另写一份解析规则后自证通过。
  const functions = ast.statements.filter((statement) => ts.isFunctionDeclaration(statement)
    && ['isRecord', 'parseLive'].includes(statement.name?.text))
  assert.equal(functions.length, 2)
  const { parseLive } = await loadSource(`${functions.map((fn) => fn.getText(ast)).join('\n')}\nexport { parseLive }`)
  for (const value of [-1, 0, '123', Infinity, NaN, undefined]) {
    assert.equal(parseLive({ sessionId: 'same', deadlineAtLocalMs: value }).deadlineAtLocalMs, undefined)
  }
  assert.equal(parseLive({ sessionId: 'same', deadlineAtLocalMs: localNow }).deadlineAtLocalMs, localNow)
  for (const source of ['server', 'local']) assert.equal(parseLive({ sessionId: 'same', deadlineSource: source }).deadlineSource, source)
  for (const source of ['other', true, undefined]) assert.equal(parseLive({ sessionId: 'same', deadlineSource: source }).deadlineSource, undefined)
  assert.equal(parseLive({ sessionId: 'same', remainingSec: 115 }).remainingSec, 115)
})
