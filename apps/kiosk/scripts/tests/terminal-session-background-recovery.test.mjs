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
import {
  load,
  TOKEN_KEY,
  AGENT_TICKET,
  BRIDGE_TOKEN,
  MINUTE,
  BOOT_PAGE,
  PLAIN_PAGE,
  json,
  gateway,
  invalid,
  session,
  agentTicket,
  flush,
} from './helpers/terminal-session-harness.mjs'

const realDateNow = Date.now
const realRandom = Math.random
test.afterEach(() => { Date.now = realDateNow; Math.random = realRandom })

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
    assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'none', '页面刚打开时的第一次换票不算「恢复清过场」')
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
  const statesAtFailure = page.states.length
  await page.advance(3 * MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.deepEqual(page.since(before).map((call) => call.kind), ['agent', 'agent', 'agent'], '每分钟一次，轮内不重试')
  // 从判 failed 那一刻记起，之后一次状态通知都不该有：翻成 checking 再翻回 failed 也算翻动。
  assert.deepEqual(page.states.slice(statesAtFailure), [], '后台恢复期间不把状态翻成 checking')

  serverUp = true
  const exchangesBefore = page.counts.exchange
  await page.advance(MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.counts.exchange, exchangesBefore + 1)
  assert.match(String(page.calls.at(-1).body), new RegExp(AGENT_TICKET), '换的是本机 Agent 给的新票')
  assert.equal(page.clears(), 1, '换引导票即清场这条没变')
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'print-only', '走新引导票恢复并清了场：页面要能知道')
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'none', '只能读一次')

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
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'none', '没清场的恢复不该让页面说「材料已清掉」')
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
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'print-only')
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
  const callsAtFailure = page.calls.length

  // 跨过原本的十分钟续期点（开机后第 10 分钟）。
  await page.advance(9 * MINUTE)
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.counts.refresh, refreshesAtFailure, '续期 401 时已记下作废票，后台不再拿同一张续')
  // 九分钟九轮：作废票已在按台计请求触发的那次续期里记下，后台每轮只向本机 Agent 要一次票。
  // 钉精确序列而不是下界：同一轮里连要两次票、或者某一轮又去续期，下界都挡不住。
  assert.deepEqual(
    page.since(callsAtFailure).map((call) => call.kind),
    Array.from({ length: 9 }, () => 'agent'),
    '每轮只向本机 Agent 要一次票',
  )
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

test('十分钟续期被服务端明确判作废：这一轮的重试窗口里同一张票只发一次，不照 2 / 5 / 10 / 20 秒重发', async () => {
  let revoked = false
  const page = await load({
    pageUrl: BOOT_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    respond: (kind, nth) => {
      if (!revoked) return kind === 'agent' ? agentTicket() : session(`session-${kind}-${nth}`)
      return kind === 'agent' ? 'network' : invalid()
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'ready')

  revoked = true
  const before = page.calls.length
  await page.advance(10 * MINUTE) // 十分钟续期到点
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.deepEqual(page.since(before).map((call) => call.kind), ['refresh', 'agent'], '作废的票只发一次，随后向本机 Agent 要一次新票')
  // 续期自己的 60 秒重试窗口走到头之前（后台恢复最早在第 60 秒），不该再有任何请求。
  await page.advance(MINUTE - 1)
  assert.deepEqual(page.since(before).map((call) => call.kind), ['refresh', 'agent'], '重试窗口内不重发同一张作废的票')
})

const CLAIM_URL = 'http://127.0.0.1:5173/api/v1/print-jobs/claim'
const drain = async () => { for (let turn = 0; turn < 10; turn += 1) await flush() }
const orFail = (promise, message) => Promise.race([promise, drain().then(() => { throw new Error(message) })])

/**
 * 摆出后台恢复在飞时状态离开 failed 的唯一一种交叉：标签页里没有会话票，后台恢复正向本机 Agent 要票，
 * 终端身份恢复回调此刻又来初始化一次（没有会话票时这条路把状态置成 checking，并且自己也去要一张票）。
 * 两次要票的应答都被按住，由用例决定谁先回来、回来的是什么。
 */
async function recoveryMeetsReinitialization() {
  let agentUp = false
  const agentGates = []
  const page = await load({
    pageUrl: PLAIN_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    respond: (kind, nth) => {
      if (kind === 'business') return json(200, {})
      if (kind === 'agent') {
        if (!agentUp) return 'network'
        return new Promise((resolve) => { agentGates.push((answer = agentTicket()) => resolve(answer)) })
      }
      return session(`session-${kind}-${nth}`)
    },
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.storage.getItem(TOKEN_KEY), null)

  agentUp = true
  await page.advance(MINUTE) // 后台恢复向本机 Agent 要票，应答被按住
  assert.equal(agentGates.length, 1)
  assert.equal(page.mod.terminalSessionState(), 'failed', '后台恢复自己不改状态')

  const statesBefore = page.states.length
  const init = page.mod.initializeTerminalSession()
  await drain()
  assert.equal(page.mod.terminalSessionState(), 'checking')
  assert.equal(agentGates.length, 2, '两边要的都是本机引导票')
  assert.equal(page.counts.refresh, 0, '没有会话票，谁也不该去续期')

  // 状态是 checking 且有一次换票在飞：下单类请求等它的结果，会话没换成之前一个字节都不发。
  let claimSettled = false
  const claim = page.mod.terminalProtectedFetch(CLAIM_URL, { method: 'POST' })
  claim.then(() => { claimSettled = true }, () => { claimSettled = true })
  await drain()
  assert.equal(claimSettled, false, '在飞的那一次出结果之前，下单类请求不该有结果')
  assert.equal(page.counts.business, 0, '没有会话就不能下单')

  return { page, agentGates, init, claim, statesBefore }
}

test('没有会话票、后台恢复在飞时身份恢复回调又来初始化一次：两边都只走「要新引导票」那条路，下单类请求等到会话真的换成才发出', async () => {
  const { page, agentGates, init, claim, statesBefore } = await recoveryMeetsReinitialization()

  agentGates[0]() // 后台恢复那一次先回来，换成了
  const response = await orFail(claim, '会话换成之后下单类请求没有发出')
  assert.equal(response.status, 200)
  assert.equal(page.calls.at(-1).kind, 'business')
  assert.equal(page.calls.at(-1).sessionHeader, page.storage.getItem(TOKEN_KEY), '发出去时带的是刚换成的会话票')
  assert.equal(page.mod.terminalSessionState(), 'ready')

  agentGates[1]() // 初始化那一次后回来：再换一张，同样清场
  await orFail(init, '初始化没有收尾')
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.counts.refresh, 0)
  assert.ok(page.counts.exchange >= 1)
  assert.equal(page.clears(), page.counts.exchange, '每换一次引导票都清一次场')
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'print-only', '清过场，页面要能知道')
  assert.ok(!page.states.slice(statesBefore).includes('failed'), '这次交叉里屏上不该闪回「没通过」')

  // 不留尾巴：之后十分钟里只有一次正常续期，没有后台恢复还在跑。
  const after = page.calls.length
  await page.advance(10 * MINUTE)
  assert.deepEqual(page.since(after).map((call) => call.kind), ['refresh'])
  assert.equal(page.mod.terminalSessionState(), 'ready')
})

test('同一种交叉里在飞的那一次没换成：等它的下单类请求照旧被拦，不因为状态是 checking 就放出去', async () => {
  const { page, agentGates, init, claim } = await recoveryMeetsReinitialization()

  agentGates[0](gateway(503)) // 后台恢复那一次没要到票；初始化那一次还按着，状态仍是 checking
  await assert.rejects(
    orFail(claim, '在飞的那一次失败之后，下单类请求没有收尾'),
    (error) => error.code === 'TERMINAL_SESSION_INVALID' && error.status === 401,
  )
  assert.equal(page.mod.terminalSessionState(), 'checking')
  assert.equal(page.counts.business, 0, '没有会话就不能下单：状态是 checking 不等于有会话')
  assert.equal(page.counts.exchange, 0)

  agentGates[1]() // 初始化那一次回来并换成：机器照样恢复，不会停在 checking
  await orFail(init, '初始化没有收尾')
  assert.equal(page.mod.terminalSessionState(), 'ready')
  const response = await page.mod.terminalProtectedFetch(CLAIM_URL, { method: 'POST' })
  assert.equal(response.status, 200)
  assert.equal(page.calls.at(-1).sessionHeader, page.storage.getItem(TOKEN_KEY))
})

test('同一种交叉里两边都没换成：回到 failed，后台恢复接着每分钟再试', async () => {
  const { page, agentGates, init, claim } = await recoveryMeetsReinitialization()

  agentGates[0](gateway(503))
  await assert.rejects(orFail(claim, '下单类请求没有收尾'), (error) => error.code === 'TERMINAL_SESSION_INVALID')
  agentGates[1](gateway(503))
  await orFail(init, '初始化没有收尾')
  assert.equal(page.mod.terminalSessionState(), 'failed')
  assert.equal(page.counts.business, 0)

  // 没有卡死：下一分钟后台恢复照常再向本机 Agent 要一次票。
  const before = agentGates.length
  await page.advance(MINUTE)
  assert.equal(agentGates.length, before + 1, '回到 failed 之后后台恢复必须接着排')
  agentGates.at(-1)()
  await drain()
  assert.equal(page.mod.terminalSessionState(), 'ready')
})

test('页面刚打开、没有网址票也没有会话票，直接向本机 Agent 要票换成：不算「恢复清过场」', async () => {
  const page = await load({
    pageUrl: PLAIN_PAGE,
    bridgeToken: BRIDGE_TOKEN,
    respond: (kind, nth) => (kind === 'agent' ? agentTicket() : session(`session-${kind}-${nth}`)),
  })
  await page.settle(page.mod.initializeTerminalSession())
  assert.equal(page.mod.terminalSessionState(), 'ready')
  assert.equal(page.counts.agent, 1)
  assert.equal(page.mod.takeTerminalSessionRecoveryClearScope(), 'none', '第一次换票时机器前没有人的材料可清，不该让页面说「材料已清掉」')
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
