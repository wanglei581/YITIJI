/**
 * 恢复时不悄悄清场：要换新票、而这台机器上还有这一位的别的内容，就先压着。
 *
 * 替身里的 kioskSensitiveSessionScope 由用例控制，可以按调用次数依次返回。
 * 默认不传时替身回 print-only，本文件每个用例都自己传入。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  load,
  TOKEN_KEY,
  BRIDGE_TOKEN,
  MINUTE,
  BOOT_PAGE,
  PLAIN_PAGE,
  json,
  gateway,
  invalid,
  session,
  agentTicket,
} from './helpers/terminal-session-harness.mjs'

const realDateNow = Date.now
const realRandom = Math.random
test.afterEach(() => { Date.now = realDateNow; Math.random = realRandom })

const STORED = 'occupant-session-token'
const CLAIM = 'http://127.0.0.1:5173/api/v1/print-jobs/claim'

/** 存量票续上、再把服务器按停，停在 failed，票还没被判作废。scope 由 mode 决定。 */
async function readyThenOutage(readScope) {
  let mode = 'up'
  const page = await load({
    pageUrl: PLAIN_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    storedToken: STORED,
    scope: () => readScope(mode),
    respond: (kind, nth) => {
      if (mode === 'down') return gateway(503)
      if (mode === 'revoked') {
        if (kind === 'refresh') return invalid()
        if (kind === 'agent') return agentTicket()
        return session(`session-${kind}-${nth}`)
      }
      return kind === 'agent' ? agentTicket() : session(`session-${kind}-${nth}`)
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.clears(), 0, '拿原票续上的不清场')
  mode = 'down'
  await page.advance(10 * MINUTE)
  await page.advance(MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), false)
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), false)
  return {
    page,
    revoke() { mode = 'revoked' },
  }
}

test('后台恢复、原票被判作废、清单 with-other：不取票不换票，等变成 none 才清一次', async () => {
  let phase = 'settle'
  const { page, revoke } = await readyThenOutage(() => (phase === 'defer' ? 'with-other' : 'none'))
  revoke()
  phase = 'defer'
  const agents = page.counts.agent
  const exchanges = page.counts.exchange
  await page.advance(MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.counts.agent, agents, '有别的内容就不向本机 Agent 取票')
  assert.equal(page.counts.exchange, exchanges, '不换票')
  assert.equal(page.clears(), 0)
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), true)
  assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), true)

  const refreshes = page.counts.refresh
  await page.advance(MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.counts.agent, agents, '下一轮仍是 with-other，照旧不取票')
  assert.equal(page.counts.exchange, exchanges)
  assert.equal(page.counts.refresh, refreshes, '作废票已记下，这一轮不再续')
  assert.equal(page.clears(), 0)

  phase = 'release'
  await page.advance(MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.counts.agent, agents + 1)
  assert.equal(page.counts.exchange, exchanges + 1)
  assert.equal(page.clears(), 1)
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), false)
  assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), false)
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'none')
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'none')
})

test('后台恢复、原票被判作废、清单 print-only：当轮取票换票，记下 print-only', async () => {
  let phase = 'settle'
  const { page, revoke } = await readyThenOutage(() => (phase === 'print' ? 'print-only' : 'none'))
  revoke()
  phase = 'print'
  const clears = page.clears()
  await page.advance(MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.clears(), clears + 1)
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), false)
  assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), false)
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'print-only')
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'none')
})

test('清掉了什么要在清场之前判：清完清单就空了，照样报 print-only', async () => {
  let phase = 'settle'
  let clearsAtStart = Infinity
  let pageRef = null
  // 替身照真实清单的样子：清场一发生就是空的。清场之后才判的话只会读到 none。
  const { page, revoke } = await readyThenOutage(() => {
    if (phase !== 'print') return 'none'
    return pageRef.clears() > clearsAtStart ? 'none' : 'print-only'
  })
  pageRef = page
  revoke()
  clearsAtStart = page.clears()
  phase = 'print'
  await page.advance(MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.clears(), clearsAtStart + 1)
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'print-only')
})

test('十分钟续期回 401 作废、清单 with-other：当场不取票，后台第一轮不再续这张票', async () => {
  let arm = false
  const page = await load({
    pageUrl: PLAIN_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    storedToken: STORED,
    scope: () => (arm ? 'with-other' : 'none'),
    respond: (kind, nth) => {
      if (!arm) return kind === 'agent' ? agentTicket() : session(`session-${kind}-${nth}`)
      return kind === 'agent' ? agentTicket() : invalid()
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'ready')
  arm = true
  const before = page.calls.length
  await page.advance(10 * MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.deepEqual(page.since(before).map((call) => call.kind), ['refresh'], '当场不向本机 Agent 取票')
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), true)
  assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), true, '不用等后台第一轮')
  const refreshes = page.counts.refresh
  const agents = page.counts.agent
  await page.advance(MINUTE)
  assert.equal(page.counts.refresh, refreshes, '后台第一轮不再拿这张作废票续期')
  assert.equal(page.counts.agent, agents)
  assert.equal(page.mod.terminalSessionState(), 'failed')
})

test('取票之后、换票之前清单变成 with-other：放弃这张票，不换票', async () => {
  const answers = ['none', 'with-other']
  let nth = 0
  let arm = false
  const page = await load({
    pageUrl: PLAIN_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    storedToken: STORED,
    scope: () => (arm ? answers[Math.min(nth++, answers.length - 1)] : 'none'),
    respond: (kind, n) => {
      if (!arm) return kind === 'agent' ? agentTicket() : session(`session-${kind}-${n}`)
      if (kind === 'refresh') return invalid()
      if (kind === 'agent') return agentTicket()
      return session(`session-${kind}-${n}`)
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  arm = true
  await page.advance(10 * MINUTE)
  assert.equal(page.counts.exchange, 0, '换票请求 0 次')
  assert.equal(page.clears(), 0)
  assert.equal(page.counts.agent, 1, '票已经取到，换之前才停')
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), true)
  assert.equal(nth, 2)
})

test('换票那一刻判出来的才算数：前两次 print-only，清场前 with-other', async () => {
  const answers = ['print-only', 'print-only', 'with-other']
  let nth = 0
  let arm = false
  const page = await load({
    pageUrl: PLAIN_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    storedToken: STORED,
    scope: () => (arm ? answers[Math.min(nth++, answers.length - 1)] : 'none'),
    respond: (kind, n) => {
      if (!arm) return kind === 'agent' ? agentTicket() : session(`session-${kind}-${n}`)
      if (kind === 'refresh') return invalid()
      if (kind === 'agent') return agentTicket()
      return session(`session-${kind}-${n}`)
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  arm = true
  await page.advance(10 * MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.clears(), 1)
  assert.equal(nth, 3, '取票前、换票前、清场前各判一次')
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'with-other')
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'none')
})

test('页面刚打开、清单 with-other：照旧换票清场，不算恢复', async () => {
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    scope: () => 'with-other',
    respond: (kind, nth) => (kind === 'agent' ? agentTicket() : session(`session-${kind}-${nth}`)),
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.counts.exchange, 1)
  assert.equal(page.counts.agent, 0)
  assert.equal(page.clears(), 1)
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), false)
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'none')
})

test('网址票没换成后向 Agent 要票，清单 with-other：照旧换票，不推迟', async () => {
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    scope: () => 'with-other',
    respond: (kind, nth) => {
      if (kind === 'agent') return agentTicket()
      if (kind === 'exchange' && nth === 1) return invalid()
      return session(`session-${kind}-${nth}`)
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.counts.agent, 1)
  assert.equal(page.counts.exchange, 2)
  assert.equal(page.clears(), 1)
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), false)
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'none')
})

for (const outage of ['503', 'timeout']) {
  test(`服务器暂时回不来（${outage === 'timeout' ? '续期超时' : '续期 503'}）：不要新票、不压着，回来后拿原票续上`, async () => {
    let serverUp = true
    const page = await load({
      pageUrl: PLAIN_PAGE,
      bridgeToken: BRIDGE_TOKEN,
      storedToken: STORED,
      scope: () => 'none',
      respond: (kind, nth) => {
        if (!serverUp) return outage === 'timeout' ? 'network' : gateway(503)
        return kind === 'agent' ? agentTicket() : session(`session-${kind}-${nth}`)
      },
    })
    await page.settle(page.mod.initializeTerminalSession())
    assert.equal(page.mod.terminalSessionState(), 'ready')
    const tokenBefore = page.storage.getItem(TOKEN_KEY)
    serverUp = false
    await page.advance(10 * MINUTE)
    await page.advance(MINUTE)
    assert.equal(page.mod.terminalSessionState(), 'failed')
    assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), false)
    assert.equal(page.mod.terminalSessionRecoveryDeferred(), false)
    assert.equal(page.clears(), 0)
    serverUp = true
    await page.advance(MINUTE)
    assert.equal(page.mod.terminalSessionState(), 'ready')
    assert.equal(page.clears(), 0, '拿原票续上，不清场')
    assert.notEqual(page.storage.getItem(TOKEN_KEY), tokenBefore)
    assert.equal(page.mod.terminalSessionRecoveryDeferred(), false)
    assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), false)
  })
}

test('服务器暂时回不来、清单 with-other：不取票，也不标压着；回来后拿原票续上', async () => {
  let serverUp = true
  const page = await load({
    pageUrl: PLAIN_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    storedToken: STORED,
    scope: () => 'with-other',
    respond: (kind, nth) => {
      // 本机 Agent 不跟服务器一起停，照常给票：取票数为 0 才说明是被判断拦下的，不是取不到。
      if (kind === 'agent') return agentTicket()
      if (!serverUp) return gateway(503)
      return session(`session-${kind}-${nth}`)
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'ready')
  const agents = page.counts.agent
  const exchanges = page.counts.exchange
  serverUp = false
  await page.advance(10 * MINUTE)
  await page.advance(MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.counts.agent, agents, '有别的内容，不向本机 Agent 取票')
  assert.equal(page.counts.exchange, exchanges)
  assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), false)
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), false, '原票没被判作废，不算压着：页面不该叫人先结束使用')
  assert.equal(page.clears(), 0)
  serverUp = true
  await page.advance(MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.clears(), 0, '拿原票续上，不清场')
  assert.equal(page.counts.agent, agents)
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), false)
})

test('带引导票没换成、标签页里没有票：要换新票', async () => {
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    scope: () => 'with-other',
    respond: (kind) => (kind === 'agent' ? 'network' : invalid()),
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.storage.getItem(TOKEN_KEY), null)
  assert.equal(page.counts.refresh, 0)
  assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), true)
})

test('压着从假变真、状态没变时多通知一次；恢复成功后收到 ready，两个值回假', async () => {
  let mode = 'down'
  const page = await load({
    pageUrl: PLAIN_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    scope: () => (mode === 'hold' ? 'with-other' : 'none'),
    respond: (kind, nth) => {
      if (kind === 'agent') return mode === 'up' ? agentTicket() : 'network'
      return session(`session-${kind}-${nth}`)
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.storage.getItem(TOKEN_KEY), null)
  assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), true)
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), false)

  mode = 'hold'
  const atDefer = page.states.length
  const agents = page.counts.agent
  await page.advance(MINUTE)
  assert.deepEqual(page.states.slice(atDefer), ['failed'], '状态没变，订阅者多收到一次同样的状态')
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), true)
  assert.equal(page.counts.agent, agents, '压着的这一轮不取票')

  mode = 'up'
  const atRelease = page.states.length
  await page.advance(MINUTE)
  assert.deepEqual(page.states.slice(atRelease), ['failed', 'ready'])
  assert.equal(page.states.at(-1), 'ready')
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), false)
  assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), false)
})

test('E2E 缝：mock 构建能置三样只读值并通知，状态不变；没设 mock 则没有这道缝', async () => {
  const page = await load({
    pageUrl: PLAIN_PAGE,
    bridgeToken: '',
    mockToken: 'e2e-mock-session',
    respond: () => invalid(),
  })
  assert.equal(page.mod.terminalSessionState(), 'ready')
  const hooks = page.win.__terminalSessionE2E
  assert.equal(typeof hooks?.setRecoveryView, 'function')
  assert.equal(hooks.state(), 'ready')

  for (const clearScope of ['none', 'print-only', 'with-other']) {
    const before = page.states.length
    const calls = page.calls.length
    hooks.setRecoveryView({ clearScope })
    assert.equal(page.mod.terminalSessionState(), 'ready', '置只读值不改会话状态')
    assert.equal(page.calls.length, calls, '不发请求')
    assert.equal(page.states.length, before + 1)
    assert.equal(page.states.at(-1), 'ready')
    assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), clearScope)
    assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'none')
  }

  hooks.startRefresh()
  await page.advance(0)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  const failedAt = page.states.length
  hooks.setRecoveryView({ deferred: true })
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), true)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.states.at(-1), 'failed')
  hooks.setRecoveryView({ deferred: false })
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), false)
  hooks.setRecoveryView({ needsNewTicket: false })
  assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), false)
  hooks.setRecoveryView({ needsNewTicket: true })
  assert.equal(page.mod.terminalSessionRecoveryNeedsNewTicket(), true)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.ok(page.states.length > failedAt)
  assert.ok(page.states.slice(failedAt).every((next) => next === 'failed'))

  const bare = await load({
    pageUrl: PLAIN_PAGE,
    bridgeToken: '',
    mockToken: '',
    respond: () => session('must-not-matter'),
  })
  assert.equal(bare.win.__terminalSessionE2E, undefined)
})

test('压着期间下单类请求照旧在发出之前被拦', async () => {
  let arm = false
  const page = await load({
    pageUrl: PLAIN_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    storedToken: STORED,
    scope: () => (arm ? 'with-other' : 'none'),
    respond: (kind, nth) => {
      if (kind === 'business') return json(200, { ok: true })
      if (!arm) return kind === 'agent' ? agentTicket() : session(`session-${kind}-${nth}`)
      return kind === 'agent' ? agentTicket() : invalid()
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  arm = true
  await page.advance(10 * MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.mod.terminalSessionRecoveryDeferred(), true)
  const before = page.calls.length
  await assert.rejects(
    page.mod.terminalProtectedFetch(CLAIM, { method: 'POST' }),
    (error) => error.code === 'TERMINAL_SESSION_INVALID' && error.status === 401,
  )
  assert.equal(page.since(before).length, 0)
  assert.equal(page.counts.business, 0)
})
