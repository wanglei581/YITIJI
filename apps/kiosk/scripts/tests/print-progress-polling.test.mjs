/**
 * N-2：进度页把「读不到状态」和「打印失败」分开。
 * 跑 printProgressPolling.ts 的真实源码，不在测试里另抄一份判断。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePath = join(kioskRoot, 'src/pages/print/printProgressPolling.ts')
const source = readFileSync(sourcePath, 'utf8')

function transpile(absolutePath) {
  const out = ts.transpileModule(readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
  assert.deepEqual(leftover, [], `${absolutePath} 还有运行时依赖：${leftover.join(', ')}`)
  return `data:text/javascript;base64,${Buffer.from(out).toString('base64')}`
}

const polling = await import(transpile(sourcePath))

const TEN_MIN = 10 * 60 * 1000

test('间隔与 10 分钟上限是固定常量', () => {
  assert.equal(polling.POLL_INTERVAL_MS, 3000)
  assert.equal(polling.POLL_INTERVAL_MAX_MS, 10_000)
  assert.ok(polling.POLL_INTERVAL_MS <= polling.POLL_INTERVAL_MAX_MS)
  assert.equal(polling.UNREADABLE_UNCONFIRMED_MS, TEN_MIN)
})

test('断网文案不把读不到说成打印失败，也不出现重新打印或工作人员', () => {
  assert.equal(polling.STATUS_READ_ERROR_TEXT, '暂时无法读取状态')
  assert.equal(polling.OFFLINE_TITLE, '网络中断，打印可能仍在进行，请先看出纸口')
  assert.equal(polling.OFFLINE_DETAIL, '网络恢复后会自动更新这里的状态')
  assert.equal(
    polling.UNCONFIRMED_COPY,
    '这台机器暂时连不上网络，没法确认这单打完了没有。请先看出纸口；没出纸的，网络恢复后在『我的 → 打印订单』查看这单。',
  )
  assert.doesNotMatch(source, /工作人员/)
  assert.doesNotMatch(source, /重新打印|再印一份|重新下单/)
  assert.doesNotMatch(`${polling.OFFLINE_TITLE}${polling.OFFLINE_DETAIL}${polling.UNCONFIRMED_COPY}`, /打印失败|打印没有完成/)
})

test('网络错误、超时、4xx、5xx 都只是读不到；200 不是查询失败', () => {
  assert.equal(polling.isUnreadablePollError(new TypeError('Failed to fetch')), true)
  assert.equal(polling.isUnreadablePollError(null), true)
  assert.equal(polling.isUnreadablePollError({ status: 0 }), true)
  assert.equal(polling.isUnreadablePollError({ status: 408 }), true)
  assert.equal(polling.isUnreadablePollError({ status: 404 }), true)
  assert.equal(polling.isUnreadablePollError({ status: 429 }), true)
  assert.equal(polling.isUnreadablePollError({ status: 500 }), true)
  assert.equal(polling.isUnreadablePollError({ status: 503 }), true)
  assert.equal(polling.isUnreadablePollError({ status: 200 }), false)
  assert.equal(polling.isUnreadablePollError({ status: 204 }), false)
})

test('读不到不产生打印终态；刚好 10 分钟仍是断网，超过才是结果未确认', () => {
  const started = polling.createPollLinkState(1_000)
  assert.deepEqual(started, { phase: 'live', consecutiveUnreadable: 0, lastReadableAtMs: 1_000 })

  const atLimit = polling.reducePollLink(started, { kind: 'unreadable' }, 1_000 + TEN_MIN)
  assert.equal(atLimit.terminal, null)
  assert.equal(atLimit.state.phase, 'offline')
  assert.equal(atLimit.state.consecutiveUnreadable, 1)
  assert.equal(atLimit.state.lastReadableAtMs, 1_000)

  const over = polling.reducePollLink(atLimit.state, { kind: 'unreadable' }, 1_000 + TEN_MIN + 1)
  assert.equal(over.terminal, null)
  assert.equal(over.state.phase, 'unconfirmed')
  assert.equal(over.state.consecutiveUnreadable, 2)
  assert.equal(over.state.lastReadableAtMs, 1_000)
  assert.deepEqual(started, { phase: 'live', consecutiveUnreadable: 0, lastReadableAtMs: 1_000 })
})

test('只有服务端 completed / failed / cancelled / abandoned 才是终态，读到后清掉断网', () => {
  const offline = polling.reducePollLink(
    polling.createPollLinkState(0),
    { kind: 'unreadable' },
    TEN_MIN + 5,
  ).state
  assert.equal(offline.phase, 'unconfirmed')

  for (const status of ['pending', 'claimed', 'printing']) {
    const next = polling.reducePollLink(offline, { kind: 'readable', status }, 9_000)
    assert.equal(next.terminal, null, status)
    assert.equal(next.state.phase, 'live', status)
    assert.equal(next.state.consecutiveUnreadable, 0, status)
    assert.equal(next.state.lastReadableAtMs, 9_000, status)
  }

  const completed = polling.reducePollLink(offline, { kind: 'readable', status: 'completed' }, 9_000)
  assert.equal(completed.terminal, 'success')
  assert.equal(completed.state.phase, 'live')

  for (const status of ['failed', 'cancelled', 'abandoned']) {
    const next = polling.reducePollLink(offline, { kind: 'readable', status }, 9_000)
    assert.equal(next.terminal, 'failure', status)
    assert.equal(next.state.phase, 'live', status)
    assert.equal(next.state.lastReadableAtMs, 9_000, status)
  }
})

test('忙碌锁：断网、结果未确认都持锁（放锁会被过期的隐私截止立刻清场），模拟路径不看断网相位', () => {
  const base = {
    useRealApi: true,
    failed: false,
    timedOut: false,
    resultUnconfirmed: false,
    isSim: false,
    simDone: false,
  }
  assert.equal(polling.holdsPrintBusyLock(base), true)
  assert.equal(polling.holdsPrintBusyLock({ ...base, resultUnconfirmed: true }), true)
  assert.equal(polling.holdsPrintBusyLock({ ...base, failed: true }), false)
  assert.equal(polling.holdsPrintBusyLock({ ...base, timedOut: true }), false)
  assert.equal(polling.holdsPrintBusyLock({ ...base, useRealApi: false }), false)

  const sim = { ...base, useRealApi: false, isSim: true }
  assert.equal(polling.holdsPrintBusyLock(sim), true)
  assert.equal(polling.holdsPrintBusyLock({ ...sim, resultUnconfirmed: true }), true)
  assert.equal(polling.holdsPrintBusyLock({ ...sim, simDone: true }), false)
  assert.equal(polling.holdsPrintBusyLock({ ...sim, failed: true }), false)
})
