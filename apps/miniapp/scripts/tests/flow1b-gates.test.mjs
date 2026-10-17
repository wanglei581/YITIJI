/**
 * FLOW1b-1b 全站登录闸门（v3）：page-guard 的 gateMember / retryMemberGate / gateMemberAction，
 * 以及各页接入后的行为。用户给的 7 条验收条件逐条对应：
 *   1 恢复中 → onHide → onShow 有确定出口；2 恢复中 → 返回 / onUnload 之后什么都不做；
 *   3 断网失败只认手动重试；4 换号后旧响应丢弃；5 「恢复中」必有出口；6 单飞不吞新的前台回调；7 不重复触发原动作。
 * auth / api 是替身：只描述「现在是否登录、是否可恢复、恢复结果何时回来」。会话层本身在 session-generation 与
 * flow1b-storage-faults 里真跑。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const GUARD_FILE = path.join(MINIAPP, 'utils/page-guard.js')
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
/** 看门狗：防护被变异摘掉后，动作可能去等一个永远不来的恢复结果——不能让它挂住整个测试进程。 */
const within = (promise, ms = 200) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), ms))])

/** 真实 page-guard.js（纯函数模块），可在内存里改写源码做反向变异。 */
function loadGuard(mutate) {
  let source = fs.readFileSync(GUARD_FILE, 'utf8')
  if (mutate) source = mutate(source)
  const mod = { exports: {} }
  vm.runInNewContext(`(function (module, exports, require) {${source}\n})`, { console })(mod, mod.exports, () => ({}))
  return mod.exports
}

/** 会话替身：state = 'logged_in' | 'restorable' | 'logged_out'；恢复结果由测试决定何时回来。 */
function createSession(initial = 'restorable') {
  let state = initial
  let generation = 1
  const pending = []
  let queued = null
  const auth = {
    restorableMember: () => ({ id: state === 'restorable' ? 'A' : null, unreadable: false }),
    restorableMemberId: () => (state === 'restorable' ? 'A' : null),
    isLoggedIn: () => state === 'logged_in',
    canSilentResignin: () => state === 'restorable',
    sessionGeneration: () => generation,
    isSameSession: (g) => g === generation,
  }
  const api = {
    calls: 0,
    restoreSession() {
      this.calls += 1
      if (queued) { const outcome = queued; queued = null; return Promise.resolve({ state: outcome }) }
      return new Promise((resolve) => pending.push(resolve))
    },
  }
  return {
    auth,
    api,
    get state() { return state },
    /** 恢复结果回来；ok 时会话随之可用（补签不推进代际）。 */
    resolve(outcome) {
      if (outcome === 'ok') state = 'logged_in'
      if (outcome === 'need_login') state = 'logged_out'
      if (pending.length) pending.splice(0).forEach((r) => r({ state: outcome }))
      else queued = outcome // ensureMember 在下一拍才调 restoreSession：结果先记下，调用时立即给
    },
    logout() { state = 'logged_out'; generation += 1 },
    loginAs() { state = 'logged_in'; generation += 1 },
  }
}

function createPage() {
  const page = {
    data: { restoring: false, restoreFailed: false },
    setDataCalls: 0,
    setData(patch) { this.setDataCalls += 1; Object.assign(this.data, patch) },
  }
  return page
}

function counters() {
  const c = { ready: 0, needLogin: 0, recoverable: 0, busy: 0, run: 0 }
  return {
    c,
    handlers: { ready: () => { c.ready += 1 }, needLogin: () => { c.needLogin += 1 }, recoverable: () => { c.recoverable += 1 } },
  }
}

const exit = (page) => (page.data.restoring ? 'restoring' : page.data.restoreFailed ? 'retry' : 'settled')

// ── gateMember：7 条验收条件 ────────────────────────────────────────────────

async function hideResolveShow(mutate) {
  const g = loadGuard(mutate)
  const s = createSession()
  const page = createPage()
  const { c, handlers } = counters()
  g.gateMember(page, s.auth, s.api, handlers)
  await flush()
  assert.equal(page.data.restoring, true, '恢复中')
  assert.equal(s.auth.isLoggedIn(), false, '恢复中不伪装成已登录')
  g.markPageHidden(page)
  const before = page.setDataCalls
  s.resolve('ok')
  await flush()
  assert.equal(page.setDataCalls, before, '后台期间不 setData')
  assert.equal(c.ready, 0, '后台期间不载入')
  g.markPageShown(page)
  g.gateMember(page, s.auth, s.api, handlers)
  assert.equal(page.data.restoring, false, '切回来不停在「恢复中」')
  assert.equal(c.ready, 1, 'ready 恰好一次')
  assert.equal(s.api.calls, 1)
}
test('条件1：恢复中 → onHide → 恢复成功 → onShow：退出「恢复中」，ready 恰好一次，后台期间什么都不做', () => hideResolveShow())

async function hideShowThenResolve(mutate) {
  const g = loadGuard(mutate)
  const s = createSession()
  const page = createPage()
  const first = counters()
  g.gateMember(page, s.auth, s.api, first.handlers)
  await flush()
  g.markPageHidden(page)
  g.markPageShown(page)
  const latest = counters()
  g.gateMember(page, s.auth, s.api, latest.handlers)
  assert.equal(s.api.calls, 1, '等待中再走闸门不再发恢复')
  s.resolve('ok')
  await flush()
  assert.equal(latest.c.ready, 1, '前台收到结果：用的是最新登记的回调')
  assert.equal(first.c.ready, 0, '旧回调不再调用')
  assert.equal(exit(page), 'settled')
}
test('条件1、6：恢复中 → onHide → onShow（仍在等）→ 恢复成功：前台回调不被吞，只恢复一次', () => hideShowThenResolve())

async function unloadDuringRestore(mutate) {
  const g = loadGuard(mutate)
  const s = createSession()
  const page = createPage()
  const { c, handlers } = counters()
  g.gateMember(page, s.auth, s.api, handlers)
  g.markPageUnloaded(page)
  const before = page.setDataCalls
  s.resolve('ok')
  await flush()
  assert.equal(page.setDataCalls, before, '卸载后零次 setData')
  assert.deepEqual(c, { ready: 0, needLogin: 0, recoverable: 0, busy: 0, run: 0 }, '卸载后不跳转、不载入')
}
test('条件2：恢复中 → onUnload → 恢复成功：零次 setData、零次跳转与载入', () => unloadDuringRestore())

async function recoverableOnlyManualRetry(mutate) {
  const g = loadGuard(mutate)
  const s = createSession()
  const page = createPage()
  const { c, handlers } = counters()
  g.gateMember(page, s.auth, s.api, handlers)
  s.resolve('recoverable')
  await flush()
  assert.equal(exit(page), 'retry', '临时失败：显示可重试')
  assert.equal(c.recoverable, 1)
  for (let i = 0; i < 3; i += 1) {
    g.markPageHidden(page)
    g.markPageShown(page)
    g.gateMember(page, s.auth, s.api, handlers)
    await flush()
  }
  assert.equal(s.api.calls, 1, '切前后台、onShow 都不自动再发起')
  assert.equal(exit(page), 'retry')
  g.retryMemberGate(page, s.auth, s.api)
  await flush()
  assert.equal(s.api.calls, 2, '用户点「重试」才再发起一次')
  assert.equal(page.data.restoring, true)
  s.resolve('ok')
  await flush()
  assert.equal(c.ready, 1)
  assert.equal(exit(page), 'settled')
}
test('条件3：断网失败后只认用户点「重试」，切前后台与 onShow 不自动再发起', () => recoverableOnlyManualRetry())

async function logoutDuringRestore(mutate) {
  const g = loadGuard(mutate)
  const s = createSession()
  const page = createPage()
  const { c, handlers } = counters()
  g.gateMember(page, s.auth, s.api, handlers)
  s.logout()
  g.gateMember(page, s.auth, s.api, handlers)
  assert.equal(c.needLogin, 1, '回到前台按「现在」判断：要登录')
  s.resolve('ok')
  await flush()
  assert.equal(c.ready, 0, 'A 的恢复结果不再触发载入')
  assert.equal(c.needLogin, 1, '不重复判断')
  assert.equal(exit(page), 'settled')
}
test('条件4：恢复中显式退出：按「现在」给登录入口，旧的恢复结果丢弃', () => logoutDuringRestore())

async function switchDuringRestore(mutate) {
  const g = loadGuard(mutate)
  const s = createSession()
  const page = createPage()
  const { c, handlers } = counters()
  g.gateMember(page, s.auth, s.api, handlers)
  s.loginAs('B')
  g.gateMember(page, s.auth, s.api, handlers)
  assert.equal(c.ready, 1, '换成 B 后按 B 载入一次')
  s.resolve('ok')
  await flush()
  assert.equal(c.ready, 1, 'A 的恢复结果回来也不再载入第二次')
  assert.equal(exit(page), 'settled')
}
test('条件4：恢复中换成 B 登录：按 B 载入一次，A 的旧结果丢弃', () => switchDuringRestore())

test('条件5：已登录、要登录两个同步出口也收口状态（不残留「恢复中 / 可重试」）', () => {
  const g = loadGuard()
  for (const state of ['logged_in', 'logged_out']) {
    const s = createSession(state)
    const page = createPage()
    page.data.restoring = true
    page.data.restoreFailed = true
    const { c, handlers } = counters()
    g.gateMember(page, s.auth, s.api, handlers)
    assert.equal(exit(page), 'settled', state)
    assert.equal(state === 'logged_in' ? c.ready : c.needLogin, 1)
  }
})

test('恢复结果说成功但会话仍不可用：按可重试处理，不自动再发起（不会循环）', async () => {
  const g = loadGuard()
  const s = createSession()
  s.api.restoreSession = function restoreSession() {
    this.calls += 1
    return Promise.resolve({ state: 'ok' }) // 会话没有真的变成已登录
  }
  const page = createPage()
  const { c, handlers } = counters()
  g.gateMember(page, s.auth, s.api, handlers)
  for (let i = 0; i < 5; i += 1) await flush()
  assert.equal(s.api.calls, 1, '只恢复一次')
  assert.equal(exit(page), 'retry')
  assert.equal(c.ready, 0)
})

// ── gateMemberAction：条件 6、7 ──────────────────────────────────────────

async function actionRunsOnceAfterRestore(mutate) {
  const g = loadGuard(mutate)
  const s = createSession()
  const page = createPage()
  let run = 0
  let busy = 0
  const h = { needLogin: () => {}, recoverable: () => {}, busy: () => { busy += 1 } }
  const first = g.gateMemberAction(page, s.auth, s.api, 'export', () => { run += 1 }, h)
  await flush()
  assert.equal(await within(g.gateMemberAction(page, s.auth, s.api, 'export', () => { run += 1 }, h)), 'busy', '同一动作再点：忽略')
  assert.equal(await within(g.gateMemberAction(page, s.auth, s.api, 'save', () => { run += 1 }, h)), 'busy', '别的动作：不执行')
  assert.equal(run, 0, '等待中：同一动作再点、别的动作都不执行')
  assert.equal(busy, 1, '别的动作：提示正在恢复')
  s.resolve('ok')
  assert.equal(await within(first), 'ran')
  assert.equal(run, 1, '恢复成功：原动作恰好一次')
  assert.equal(s.api.calls, 1)
}
test('条件6、7：点击动作等恢复时，同一动作再点忽略、别的动作提示；恢复成功只执行一次', () => actionRunsOnceAfterRestore())

async function actionNotReplayedAfterBackground(mutate) {
  const g = loadGuard(mutate)
  const s = createSession()
  const page = createPage()
  let run = 0
  const pending = g.gateMemberAction(page, s.auth, s.api, 'export', () => { run += 1 }, {})
  await flush()
  g.markPageHidden(page)
  s.resolve('ok')
  assert.equal(await within(pending), 'dropped')
  g.markPageShown(page)
  await flush()
  assert.equal(run, 0, '后台期间成功：不执行，回到前台也不补执行')
}
test('条件7：点击后切到后台、恢复成功：动作不执行，回到前台也不补执行', () => actionNotReplayedAfterBackground())

test('条件4：点击后换了号（代际变了）：动作丢弃', async () => {
  const g = loadGuard()
  const s = createSession()
  const page = createPage()
  let run = 0
  const pending = g.gateMemberAction(page, s.auth, s.api, 'export', () => { run += 1 }, {})
  s.loginAs('B')
  s.resolve('ok')
  assert.equal(await pending, 'dropped')
  assert.equal(run, 0)
})

test('点击动作：临时失败提示可重试、不执行、不自动重试；要登录走登录入口', async () => {
  const g = loadGuard()
  for (const [outcome, expected] of [['recoverable', 'recoverable'], ['need_login', 'need_login']]) {
    const s = createSession()
    const page = createPage()
    let run = 0
    const seen = []
    const pending = g.gateMemberAction(page, s.auth, s.api, 'export', () => { run += 1 }, {
      needLogin: () => seen.push('need_login'), recoverable: () => seen.push('recoverable'),
    })
    s.resolve(outcome)
    assert.equal(await pending, expected)
    assert.deepEqual(seen, [expected])
    assert.equal(run, 0)
    assert.equal(s.api.calls, 1)
  }
})

// ── 反向变异：摘掉辅助函数里的某一处，上面的场景必须判红 ─────────────────────

const assertionFailed = (err) => err && err.code === 'ERR_ASSERTION'
const swap = (from, to) => (src) => {
  assert.ok(src.includes(from), `变异锚点已失效：${from.slice(0, 60)}`)
  return src.split(from).join(to)
}

const MUTATIONS = [
  {
    name: '已登录的同步出口不收口「恢复中」',
    mutate: swap("  if (auth.isLoggedIn()) {\n    page._memberGateOutcome = null\n    patchIfChanged(page, { restoring: false, restoreFailed: false })\n", "  if (auth.isLoggedIn()) {\n    page._memberGateOutcome = null\n"),
    scenario: hideResolveShow,
  },
  {
    name: '等待结束不重新判断（按旧状态什么都不做）',
    mutate: swap("      gateMember(page, auth, api, page._memberGateHandlers, { afterRestore: true })\n", ''),
    scenario: hideShowThenResolve,
  },
  {
    name: '等待中再调用不更新回调',
    mutate: swap('  page._memberGateHandlers = handlers\n', '  if (!page._memberGateHandlers) page._memberGateHandlers = handlers\n'),
    scenario: hideShowThenResolve,
  },
  {
    name: '等待结束不看是否卸载',
    mutate: swap('      if (page._unloaded || page._hidden) return\n', '      if (page._hidden) return\n'),
    scenario: unloadDuringRestore,
  },
  {
    name: '等待结束不看是否在后台',
    mutate: swap('      if (page._unloaded || page._hidden) return\n', '      if (page._unloaded) return\n'),
    scenario: hideResolveShow,
  },
  {
    name: '临时失败后 onShow 自动再发起',
    mutate: swap("  if (page._memberGateOutcome === 'recoverable' || afterRestore) {", '  if (afterRestore) {'),
    scenario: recoverableOnlyManualRetry,
  },
  {
    name: '等待期间已判断过，恢复结束仍再判断一次',
    mutate: swap('      if ((page._memberGateDecisions || 0) !== decisionsAtStart) return\n', ''),
    scenario: switchDuringRestore,
  },
  {
    name: '点击动作不防重复',
    mutate: swap('  if (page._memberAction) {\n', '  if (false) {\n'),
    scenario: actionRunsOnceAfterRestore,
  },
  {
    name: '点击动作后台期间成功也执行',
    mutate: swap("      if (page._unloaded || page._hidden || !sameSession) return 'dropped'\n", "      if (page._unloaded || !sameSession) return 'dropped'\n"),
    scenario: actionNotReplayedAfterBackground,
  },
]

for (const m of MUTATIONS) {
  test(`变异[闸门·${m.name}]必须判红`, async () => {
    await assert.rejects(async () => m.scenario(m.mutate), assertionFailed)
  })
}
