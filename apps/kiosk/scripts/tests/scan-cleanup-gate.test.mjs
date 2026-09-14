/**
 * 清场收尾闸 —— **行为**测试（不是文本断言）。
 *
 * ## 它守的是什么
 *
 * 一句话：**服务端确认上一场扫描不可能再收到文件之前，这台机器不许换人。**
 *
 * 这条闸的每一个判据都只有跑起来才看得出真假，源码断言一条都证明不了：
 *   · 「没有扫描会话时一帧都不多等」—— 要看 `whenScanCleanupSettled` 是不是**同步**跑；
 *   · 「服务端没给结论就不放行」—— 要看 5xx / 断网之后 run 有没有被调用；
 *   · 「等得到头」—— 要看走到服务端给的那个有效期之后它有没有自己放行；
 *   · 「撤销带的是创建那一刻的身份」—— 要看真发出去那一发 DELETE 的 Authorization；
 *   · 「不泄露凭证」—— 要看 `scanCleanupStatus()` 序列化之后有没有那串明文。
 *
 * 所以下面每个 case 新装一份模块（模块级状态必须每次归零），时间与定时器都是假的
 * （`window.setTimeout` / `Date.now` 由 case 驱动），`fetch` 是一个会记账的假函数。
 * 断言的是它调了几次、每次带了什么、以及那颗「可以换人了」的回调有没有被调用。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (relativePath, fileName) => ts.transpileModule(
  readFileSync(join(root, relativePath), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName },
).outputText

const API_BASE_URL = '/api/v1'
const ORIGIN = 'http://127.0.0.1:4191'
const TERMINAL_ID = 'KSK-001'
/** 假时钟的起点。用一个固定值，断言里的「有效期」才好算。 */
const T0 = 1_800_000_000_000
const TEN_MINUTES = 10 * 60 * 1000

let seed = 0

/**
 * 装一份被测模块。
 *
 * 真的把 `scanSessionRevoke.ts` 一起装起来（不是替身）—— 这条闸的判据里有一半
 * 「服务端说了什么算确认」在那个文件里，用替身就等于把要测的东西自己写一遍。
 * 只有那两个 node 里装不起来的外部依赖走替身：`client`（会把 `import.meta.env`
 * 拖进来）和 `screensaver`（终端 id）。本机登记由 case 控制。
 *
 * @param {{
 *   session?: unknown,
 *   fetchImpl?: (url: string, init: unknown) => unknown,
 * }} options
 */
async function loadGate(options = {}) {
  seed += 1
  const key = `cleanup-${seed}`
  const calls = []
  globalThis.__cleanupBoxes = globalThis.__cleanupBoxes ?? new Map()
  globalThis.__cleanupBoxes.set(key, { session: options.session ?? null })

  const clientStub = toDataUrl(`export const API_BASE_URL = ${JSON.stringify(API_BASE_URL)}`)
  const screensaverStub = toDataUrl(`export function getTerminalId() { return ${JSON.stringify(TERMINAL_ID)} }`)
  const sessionStub = toDataUrl(`
export function readScanWorkbenchSession() {
  const box = globalThis.__cleanupBoxes.get(${JSON.stringify(key)})
  if (box.session instanceof Error) throw box.session
  return box.session ?? undefined
}
`)

  const revokeUrl = toDataUrl(
    `${transpile('src/pages/scan/scanSessionRevoke.ts', 'scanSessionRevoke.ts')}\n// instance ${seed}\n`
      .replaceAll("'../../services/api/client'", `'${clientStub}'`)
      .replaceAll("'../../services/api/screensaver'", `'${screensaverStub}'`)
      .replaceAll("'./scanWorkbenchSession'", `'${sessionStub}'`),
  )
  const modelUrl = toDataUrl(
    `${transpile('src/pages/scan/scanSettingsModel.ts', 'scanSettingsModel.ts')}\n// instance ${seed}\n`,
  )
  const gateCode = `${transpile('src/pages/scan/scanCleanupGate.ts', 'scanCleanupGate.ts')}\n// instance ${seed}\n`
    .replaceAll("'./scanSettingsModel'", `'${modelUrl}'`)
    .replaceAll("'./scanSessionRevoke'", `'${revokeUrl}'`)
    .replaceAll("'./scanWorkbenchSession'", `'${sessionStub}'`)

  // ── 假时钟 + 假定时器 ──────────────────────────────────────────────────────
  // 退避表、稳定重试、「等创建回话」的上限、自然过期，全都按时间判。真等下去
  // 一个 case 要跑十分钟，而且会跑成 flaky；这里让时间由 case 自己推。
  let now = T0
  let timerSeq = 0
  const timers = new Map()
  const unloadHandlers = []
  globalThis.window = {
    location: { origin: ORIGIN },
    setTimeout: (fn, ms) => {
      timerSeq += 1
      timers.set(timerSeq, { at: now + (Number(ms) || 0), fn })
      return timerSeq
    },
    clearTimeout: (id) => { timers.delete(id) },
    addEventListener: (type, handler) => {
      if (type === 'pagehide') unloadHandlers.push(handler)
    },
  }
  const realDateNow = Date.now
  Date.now = () => now

  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init })
    const impl = options.fetchImpl
    if (impl) return impl(String(url), init)
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  }

  const mod = await import(toDataUrl(gateCode))

  /** 把还在排队的 microtask 放干净（fetch 的 then 链、pump 的 finally）。 */
  const flush = async () => {
    for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  /** 把时间往前推 `ms`，沿途按到点顺序跑掉所有定时器。 */
  const advance = async (ms) => {
    const target = now + ms
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = Math.max(now, due[1].at)
      due[1].fn()
      await flush()
    }
    now = target
    await flush()
  }

  return {
    mod,
    calls,
    flush,
    advance,
    firePageHide: () => { for (const handler of unloadHandlers) handler() },
    setSession: (session) => { globalThis.__cleanupBoxes.get(key).session = session },
    restore: () => { Date.now = realDateNow },
  }
}

const liveSession = (overrides = {}) => ({
  stage: 'settings',
  scanType: 'resume',
  live: {
    scanTaskId: 'scan-1',
    controlToken: 'control-1',
    instructions: ['放好原件'],
    expiresAt: new Date(T0 + TEN_MINUTES).toISOString(),
    ...overrides,
  },
})

const jsonError = (status, code) => Promise.resolve({
  ok: false,
  status,
  json: () => Promise.resolve({ success: false, error: { code, message: '服务端原文不许上屏' } }),
})

const deletedIds = (calls) => calls.map(({ url }) => url.split('/').pop())
const authOf = (call) => call.init.headers.get('Authorization')

/** 一个只记「被调用过没有」的放行回调。清场链路把整页重载挂在它上面。 */
function handover() {
  let released = 0
  return { run: () => { released += 1 }, released: () => released }
}

test('没有扫描会话时，收尾一帧都不多等（同步放行，一个请求都不发）', async () => {
  const gate = await loadGate({ session: null })
  try {
    gate.mod.beginScanSessionCleanup('member-token')
    const exit = handover()
    gate.mod.whenScanCleanupSettled(exit.run)
    // 同步：不是「很快」，是这一行返回之前就已经跑过了。
    assert.equal(exit.released(), 1, '最常见的那条路径上多等一帧都是回归')
    assert.equal(gate.mod.scanCleanupHolding(), false)
    assert.equal(gate.mod.scanCleanupInProgress(), false)
    assert.deepEqual(gate.calls, [])
  } finally {
    gate.restore()
  }
})

test('服务端确认取消：发一次 DELETE，带的是正在失效的那个身份，然后才放行', async () => {
  const gate = await loadGate({ session: liveSession() })
  try {
    gate.mod.beginScanSessionCleanup('outgoing-member-token')
    const exit = handover()
    gate.mod.whenScanCleanupSettled(exit.run)
    assert.equal(exit.released(), 0, '回执还没到就放行 = 这条闸等于不存在')
    assert.equal(gate.mod.scanCleanupHolding(), true)

    await gate.flush()
    assert.deepEqual(deletedIds(gate.calls), ['scan-1'])
    assert.equal(gate.calls[0].init.method, 'DELETE')
    // 服务端 cancel() 按 endUserId 校验：带新身份（或不带）只会 403，旧任务原地存活。
    assert.equal(authOf(gate.calls[0]), 'Bearer outgoing-member-token')
    assert.equal(gate.calls[0].init.headers.get('X-Scan-Session-Control'), 'control-1')
    assert.equal(gate.calls[0].init.headers.get('X-Terminal-Id'), TERMINAL_ID)
    // 这条通道要的是回执，keepalive 反而更拿不到（它另有配额）。
    assert.notEqual(gate.calls[0].init.keepalive, true)
    assert.equal(exit.released(), 1)
    assert.equal(gate.mod.scanCleanupHolding(), false)
  } finally {
    gate.restore()
  }
})

test('服务端没给结论：不放行，退避重试，确认之后才把机器交出去', async () => {
  let attempt = 0
  const gate = await loadGate({
    session: liveSession(),
    fetchImpl: () => {
      attempt += 1
      return attempt === 1
        ? Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve(null) })
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
    },
  })
  try {
    gate.mod.beginScanSessionCleanup(null)
    const exit = handover()
    gate.mod.whenScanCleanupSettled(exit.run)
    await gate.flush()
    assert.equal(gate.calls.length, 1)
    assert.equal(exit.released(), 0, '5xx 不是「撤掉了」—— 放行就是拿一句服务端没说过的话换换人')
    assert.equal(gate.mod.scanCleanupStatus().lastOutcome, 'server-error')

    await gate.advance(900)
    assert.equal(gate.calls.length, 2)
    assert.equal(exit.released(), 1)
    assert.equal(gate.mod.scanCleanupStatus().lastOutcome, 'none')
  } finally {
    gate.restore()
  }
})

test('用户按「立即重试」只把下一次提前，不重置计数', async () => {
  const gate = await loadGate({
    session: liveSession(),
    fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
  })
  try {
    gate.mod.beginScanSessionCleanup(null)
    await gate.flush()
    assert.equal(gate.calls.length, 1)
    gate.mod.retryScanCleanupNow()
    await gate.flush()
    assert.equal(gate.calls.length, 2, '按了就该真的再发一次，不然那颗按钮是装饰')
    assert.equal(gate.mod.scanCleanupStatus().attempts, 2, '计数只增：屏上那句「已发出 N 次」不许说谎')
  } finally {
    gate.restore()
  }
})

test('一直连不上：全程不放行，直到走到服务端给的那个有效期', async () => {
  const gate = await loadGate({
    session: liveSession(),
    fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
  })
  try {
    gate.mod.beginScanSessionCleanup(null)
    const exit = handover()
    gate.mod.whenScanCleanupSettled(exit.run)
    await gate.flush()
    assert.equal(gate.mod.scanCleanupStatus().lastOutcome, 'unreachable')

    await gate.advance(60_000)
    assert.equal(exit.released(), 0, '断网不是「撤掉了」：这一分钟里机器一次都不许交出去')
    assert.ok(gate.calls.length >= 3, '这一分钟里应当一直在重试，而不是发一次就躺平')
    // 屏上那句倒计时用的就是这个值，它必须是服务端给的有效期，不是本机自己定的宽限。
    assert.equal(gate.mod.scanCleanupStatus().deadlineAt, T0 + TEN_MINUTES)

    const before = gate.calls.length
    // 走到服务端给的有效期之后：租约查询带 `expiresAt: { gt: now }`，这条任务
    // 从此签不出租约。这是确定的收口，所以放行；也不必再发请求。
    await gate.advance(TEN_MINUTES)
    assert.equal(exit.released(), 1, '等到自然过期仍不放行 = 一块永远黑着的屏，比它要防的问题更糟')
    assert.equal(gate.mod.scanCleanupHolding(), false)
    const afterExpiry = gate.calls.length
    await gate.advance(60_000)
    assert.equal(gate.calls.length, afterExpiry, '收口之后还在刷请求 = 这条闸自己没停')
    assert.ok(afterExpiry > before)
  } finally {
    gate.restore()
  }
})

test('403 之后摘掉身份再试一次（服务端为登出后留的那条路），只试一次', async () => {
  const gate = await loadGate({
    session: liveSession(),
    fetchImpl: () => jsonError(403, 'SCAN_TASK_FORBIDDEN'),
  })
  try {
    gate.mod.beginScanSessionCleanup('stale-member-token')
    const exit = handover()
    gate.mod.whenScanCleanupSettled(exit.run)
    await gate.flush()
    assert.equal(gate.calls.length, 2, '403 = 手里这份身份动不了它；摘掉身份那一次是服务端留的合法路')
    assert.equal(authOf(gate.calls[0]), 'Bearer stale-member-token')
    assert.equal(authOf(gate.calls[1]), null, '第二次必须不带 Authorization（服务端对无主任务只校验控制凭证）')
    assert.equal(exit.released(), 0, '403 说明它可能还是 waiting —— 一个都不许当成清干净了')
    assert.equal(gate.mod.scanCleanupStatus().lastOutcome, 'rejected')

    await gate.advance(900)
    assert.equal(gate.calls.length, 3, '继续重试')
    assert.equal(authOf(gate.calls[2]), null, '身份已经摘过了，不许再拿它试一遍')
  } finally {
    gate.restore()
  }
})

for (const [status, code, why] of [
  [404, 'SCAN_TASK_NOT_FOUND', '服务端那边根本没有这条任务'],
  [400, 'SCAN_TASK_ALREADY_COMPLETED', '已终态，租约只签 waiting'],
  [409, 'SCAN_TASK_CANCEL_CONFLICT', '已经不是 waiting/matched'],
]) {
  test(`服务端说「领不走了」也算确认：${status} ${code}（${why}）`, async () => {
    const gate = await loadGate({
      session: liveSession(),
      fetchImpl: () => jsonError(status, code),
    })
    try {
      gate.mod.beginScanSessionCleanup(null)
      const exit = handover()
      gate.mod.whenScanCleanupSettled(exit.run)
      await gate.flush()
      assert.equal(exit.released(), 1)
      assert.equal(gate.calls.length, 1, '已经确认过的结论不许再刷一次请求')
    } finally {
      gate.restore()
    }
  })
}

test('收尾期间一次投递确认都不许发；收完才放开', async () => {
  let resolveDelete
  const gate = await loadGate({
    session: liveSession(),
    fetchImpl: () => new Promise((resolve) => { resolveDelete = resolve }),
  })
  try {
    assert.equal(gate.mod.scanDeliveryAckBlocked(), false, '平时不该挡')
    gate.mod.beginScanSessionCleanup(null)
    await gate.flush()
    // ACK 成功那一刻服务端那条任务就变得可投递，而收尾的全部目的正是让它不可投递。
    assert.equal(gate.mod.scanDeliveryAckBlocked(), true)
    resolveDelete({ ok: true, status: 200, json: () => Promise.resolve({}) })
    await gate.flush()
    assert.equal(gate.mod.scanDeliveryAckBlocked(), false, '收完之后下一位建的新会话当然要确认得了')
  } finally {
    gate.restore()
  }
})

test('创建还在飞时被清场：按住等凭证落地，再用创建那一刻的身份把它撤掉', async () => {
  const gate = await loadGate({ session: null })
  try {
    let resolveCreate
    const creation = new Promise((resolve) => { resolveCreate = resolve })
    // 这一场是「创建时那位」发起的。清场之后 getToken() 已经空了 / 已经换人，
    // 现取只会 403 —— 所以身份必须在创建那一刻取好并交给这条闸。
    gate.mod.trackScanSessionCreation(creation, 'creator-token')
    gate.mod.beginScanSessionCleanup('someone-else-token')
    const exit = handover()
    gate.mod.whenScanCleanupSettled(exit.run)
    await gate.flush()
    assert.equal(exit.released(), 0, '本机登记里还没有 live，但那条 child 就要落地了')
    assert.deepEqual(gate.calls, [])

    resolveCreate({
      scanTaskId: 'scan-late',
      controlToken: 'control-late',
      expiresAt: new Date(T0 + TEN_MINUTES).toISOString(),
    })
    await gate.flush()
    assert.deepEqual(deletedIds(gate.calls), ['scan-late'])
    assert.equal(authOf(gate.calls[0]), 'Bearer creator-token', '现取身份只会 403：那条 child 就此谁都撤不掉')
    assert.equal(exit.released(), 1)
  } finally {
    gate.restore()
  }
})

test('创建一直不回话：等到上限就放行，期间一个 DELETE 都发不出来', async () => {
  const gate = await loadGate({ session: null })
  try {
    gate.mod.trackScanSessionCreation(new Promise(() => undefined), 'creator-token')
    gate.mod.beginScanSessionCleanup(null)
    const exit = handover()
    gate.mod.whenScanCleanupSettled(exit.run)
    await gate.flush()
    assert.equal(exit.released(), 0)

    await gate.advance(4_000)
    assert.equal(exit.released(), 0, '还没到上限就放行 = 白等了一半')
    await gate.advance(5_000)
    assert.equal(exit.released(), 1, '永远不回话的创建把机器锁死在清场屏上，比放行更糟')
    assert.deepEqual(gate.calls, [], '本机连它的 id 都不知道，没有任何可发的请求')
  } finally {
    gate.restore()
  }
})

test('没被清场的创建不会被撤：这条闸只管孤儿', async () => {
  const gate = await loadGate({ session: null })
  try {
    let resolveCreate
    const creation = new Promise((resolve) => { resolveCreate = resolve })
    gate.mod.trackScanSessionCreation(creation, 'creator-token')
    resolveCreate({
      scanTaskId: 'scan-ok',
      controlToken: 'control-ok',
      expiresAt: new Date(T0 + TEN_MINUTES).toISOString(),
    })
    await gate.flush()
    assert.deepEqual(gate.calls, [], '把用户正在用的那一场撤掉，比漏撤还糟')
    assert.equal(gate.mod.scanCleanupHolding(), false)
    assert.equal(gate.mod.scanCleanupInProgress(), false)
  } finally {
    gate.restore()
  }
})

test('半残响应（连有效期都没带）不按住，只发一次尽力而为', async () => {
  const gate = await loadGate({ session: null })
  try {
    let resolveCreate
    const creation = new Promise((resolve) => { resolveCreate = resolve })
    gate.mod.trackScanSessionCreation(creation, 'creator-token')
    gate.mod.beginScanSessionCleanup(null)
    const exit = handover()
    gate.mod.whenScanCleanupSettled(exit.run)
    resolveCreate({ scanTaskId: 'scan-half', controlToken: 'control-half' })
    await gate.flush()
    // 没有截止时刻就没有收敛依据：按住会变成一块永远不放行的黑屏。
    assert.equal(exit.released(), 1)
    assert.deepEqual(deletedIds(gate.calls), ['scan-half'], '不按住不等于不撤')
    assert.equal(gate.calls[0].init.keepalive, true, '这一支走的是原来那条 fire-and-forget 通道')
  } finally {
    gate.restore()
  }
})

test('已经有结果快照 / 已经过期的登记：不入队、不发请求、同步放行', async () => {
  const done = {
    ...liveSession(),
    result: { outcome: 'completed', success: true },
  }
  const gate = await loadGate({ session: done })
  try {
    gate.mod.beginScanSessionCleanup(null)
    const exit = handover()
    gate.mod.whenScanCleanupSettled(exit.run)
    assert.equal(exit.released(), 1)
    assert.deepEqual(gate.calls, [], '结果快照 = 服务端已给终态，再 DELETE 只是噪音')

    gate.setSession(liveSession({ expiresAt: new Date(T0 - 1_000).toISOString() }))
    gate.mod.beginScanSessionCleanup(null)
    const second = handover()
    gate.mod.whenScanCleanupSettled(second.run)
    assert.equal(second.released(), 1)
    assert.deepEqual(gate.calls, [], '已过期的任务服务端签不出租约，撤它只会拿回 404 / 400')
  } finally {
    gate.restore()
  }
})

test('文档真的要走了：pagehide 上补一发 keepalive，仍然带创建时那个身份', async () => {
  const gate = await loadGate({
    session: liveSession(),
    fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
  })
  try {
    gate.mod.beginScanSessionCleanup('outgoing-member-token')
    await gate.flush()
    const before = gate.calls.length
    gate.firePageHide()
    await gate.flush()
    const beacon = gate.calls[before]
    assert.ok(beacon, '这一刻没有任何界面能再等回执，keepalive 是唯一还有机会送达的形式')
    assert.equal(beacon.init.keepalive, true)
    assert.equal(authOf(beacon), 'Bearer outgoing-member-token')
  } finally {
    gate.restore()
  }
})

test('对外暴露的状态里没有任何凭证、任务编号或服务端原文', async () => {
  const gate = await loadGate({
    session: liveSession(),
    fetchImpl: () => jsonError(500, 'SOME_INTERNAL_CODE'),
  })
  try {
    gate.mod.beginScanSessionCleanup('outgoing-member-token')
    await gate.flush()
    // 27 寸竖屏摆在人才市场大厅：站在旁边的人和使用者看到的是同一块屏。
    const serialized = JSON.stringify(gate.mod.scanCleanupStatus())
    for (const secret of [
      'control-1',
      'outgoing-member-token',
      'scan-1',
      'SOME_INTERNAL_CODE',
      '服务端原文不许上屏',
    ]) {
      assert.ok(!serialized.includes(secret), `清场屏的状态里不许出现 ${secret}`)
    }
    // 屏上那句进度只用得到这三样，它们都不是敏感信息。
    assert.equal(gate.mod.scanCleanupStatus().holding, true)
    assert.equal(gate.mod.scanCleanupStatus().attempts, 1)
    assert.equal(gate.mod.scanCleanupStatus().lastOutcome, 'server-error')
  } finally {
    gate.restore()
  }
})

test('同一场被清两次（屏保页一次、logout 里再一次）只发一次 DELETE', async () => {
  const gate = await loadGate({ session: liveSession() })
  try {
    gate.mod.beginScanSessionCleanup('outgoing-member-token')
    // 第二次调用时本机登记已经被 clearScanWorkbenchSession 抹掉了。
    gate.setSession(null)
    gate.mod.beginScanSessionCleanup(null)
    await gate.flush()
    assert.deepEqual(deletedIds(gate.calls), ['scan-1'])
    assert.equal(authOf(gate.calls[0]), 'Bearer outgoing-member-token', '第二次那个空身份不许把第一次顶掉')
  } finally {
    gate.restore()
  }
})
