/**
 * FLOW1b 按格存储故障（Codex 冷审，10/17）：存储可以只坏一格——只坏写、只坏删、只坏读。
 *
 * agy 1639 复核的前提「资格写删都失败 ⇒ 本机资料也删不掉」不成立。Codex 用真实 auth 复现过两个反例：
 *   1. 资格 A / 本机资料 B / 过期令牌 B，只有资格那一格写删都失败：本次运行先认人→查令牌→再认人都是 null，
 *      但令牌与资料照常删掉，冷启动后只剩资格 A，被当成正常过期恢复成 A；
 *   2. 同一盘面，只有资格那一格读失败：storage.get 退回默认值、看起来像「没有资格」，资料被当成可删。
 * 规则：作废没能在盘上确认、或读不清时，不销毁冷启动唯一还能认出不一致的那一格；读不清按临时失败（可重试）；
 * 主动退出确认即在本机作废并落盘，落不了盘如实报。
 *
 * 只用本地真实 auth / request / storage + wx 替身验证，**不是**设备结论。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

import {
  UTILS,
  flush,
  fakeToken,
  TOKEN_A,
  TOKEN_B,
  USER_A,
  USER_B,
  createWx,
  createRuntime,
  authHeader,
  mutator,
  assertionFailed,
} from './session-runtime.mjs'

const EXPIRED_A = fakeToken('A', -60)
const EXPIRED_B = fakeToken('B', -60)
const ELIGIBLE = 'resignin_eligible'

const loginAs = (ctx, token, user) => ctx.auth.saveSession({ token, user })
/** 只让某一格坏：{ set, remove } 取 'silent'（安静丢操作）或 'throw'；{ get: 'throw' } 让读抛异常。 */
const breakKey = (ctx, key, modes) => { ctx.wx.faults.keys[key] = Object.assign({}, ctx.wx.faults.keys[key], modes) }

/** 冷启动：换一个进程，盘上原样。keepFaults=true：坏的那几格冷启动后照样坏；false：存储已恢复。 */
function coldStart(ctx, { keepFaults = true, mutate } = {}) {
  const cold = createRuntime({ store: new Map(ctx.wx.store), mutate })
  if (keepFaults) cold.wx.faults.keys = JSON.parse(JSON.stringify(ctx.wx.faults.keys))
  return cold
}

const BOTH = ['silent', 'throw']

// ── 反例 1：只有资格那一格写删都失败 ─────────────────────────────────────

async function eligibleStuckOnMismatch({ mode = 'silent', userSet = null } = {}, opts = {}) {
  const store = new Map([['zyd_token', EXPIRED_B], ['zyd_user', USER_B], [ELIGIBLE, 'A']])
  const ctx = createRuntime({ store, ...opts })
  breakKey(ctx, ELIGIBLE, { set: mode, remove: mode })
  if (userSet) breakKey(ctx, 'zyd_user', { set: userSet })
  const seq = [ctx.auth.restorableMemberId(), ctx.auth.getToken(), ctx.auth.restorableMemberId()]
  assert.deepEqual(seq, [null, null, null], '本次运行：先认人→查令牌→再认人都认不出 A')
  assert.equal(ctx.wx.store.get(ELIGIBLE), 'A', '前提成立：资格那一格写删都失败')
  assert.equal(ctx.wx.store.has('zyd_token'), false, '前提成立：令牌那一格照常删得掉（按格故障，不是整体坏）')
  for (const keepFaults of [true, false]) {
    const cold = coldStart(ctx, { keepFaults, mutate: opts.mutate })
    assert.equal(cold.auth.restorableMemberId(), null, `冷启动（${keepFaults ? '存储仍坏' : '存储已恢复'}）不能恢复成 A`)
    cold.auth.getToken()
    cold.auth.getUser()
    cold.auth.isLoggedIn()
    assert.equal((await cold.net.restoreSession()).state, 'need_login')
    assert.equal(cold.wx.calls.login.length, 0, '不去 wx.login')
    const again = coldStart(cold, { keepFaults, mutate: opts.mutate })
    assert.equal(again.auth.restorableMemberId(), null, '再冷启动一次也不能：证据不能在上一次运行里被删掉')
  }
}

for (const mode of BOTH) {
  test(`反例1[${mode}]：资料 B、资格 A，只有资格一格写删都失败——本次运行与两次冷启动都认不出 A`, () => eligibleStuckOnMismatch({ mode }))
}
test('反例1：再加本机资料那一格写不进（还能删）——资料留作证据，冷启动不恢复', () => eligibleStuckOnMismatch({ userSet: 'silent' }))

// ── 反例 2：只有资格那一格读失败（以及本机资料那一格读失败）────────────────

async function eligibleUnreadableOnMismatch(opts = {}) {
  const store = new Map([['zyd_token', EXPIRED_B], ['zyd_user', USER_B], [ELIGIBLE, 'A']])
  const ctx = createRuntime({ store, ...opts })
  breakKey(ctx, ELIGIBLE, { get: 'throw' })
  assert.deepEqual({ ...ctx.auth.restorableMember() }, { id: null, unreadable: true }, '读不清不等于没有资格')
  assert.equal(ctx.auth.getToken(), null)
  assert.equal(ctx.auth.getUser(), null)
  assert.equal((await ctx.net.restoreSession()).state, 'recoverable', '读不清按临时失败给重试，不送去登录')
  assert.equal(ctx.wx.calls.login.length, 0)
  assert.deepEqual(ctx.wx.store.get('zyd_user'), USER_B, '读不清时本机资料留作证据')
  const cold = coldStart(ctx, { keepFaults: false, mutate: opts.mutate })
  assert.equal(cold.auth.restorableMemberId(), null, '读恢复后冷启动不能恢复成 A')
  assert.equal((await cold.net.restoreSession()).state, 'need_login')
  assert.equal(cold.wx.calls.login.length, 0)
}
test('反例2：资料 B、资格 A，只有资格一格读失败——读不清给可重试，资料不删，读恢复后冷启动也认不出 A', () => eligibleUnreadableOnMismatch())

test('反例2 变体：本机资料那一格读失败——同样读不清给可重试，什么都不删', async () => {
  const store = new Map([['zyd_token', EXPIRED_B], ['zyd_user', USER_B], [ELIGIBLE, 'A']])
  const ctx = createRuntime({ store })
  breakKey(ctx, 'zyd_user', { get: 'throw' })
  assert.deepEqual({ ...ctx.auth.restorableMember() }, { id: null, unreadable: true })
  ctx.auth.getToken()
  ctx.auth.getUser()
  assert.equal((await ctx.net.restoreSession()).state, 'recoverable')
  assert.deepEqual(ctx.wx.store.get('zyd_user'), USER_B)
  assert.equal(ctx.wx.store.get(ELIGIBLE), 'A', '读不清不作废')
  const cold = coldStart(ctx, { keepFaults: false })
  assert.equal(cold.auth.restorableMemberId(), null)
})

test('读不清不是没资格：同一位 A 过期、资格那一格一时读不出——给可重试；读恢复后照常恢复 A，不用再收短信', async () => {
  const store = new Map([['zyd_token', EXPIRED_A], ['zyd_user', USER_A], [ELIGIBLE, 'A']])
  const ctx = createRuntime({ store })
  breakKey(ctx, ELIGIBLE, { get: 'throw' })
  assert.equal((await ctx.net.restoreSession()).state, 'recoverable')
  ctx.wx.faults.keys = {}
  const pending = ctx.net.restoreSession()
  await flush()
  assert.equal(ctx.wx.calls.login.length, 1)
  ctx.wx.calls.login[0].success({ code: 'CODE-A' })
  await flush()
  ctx.resigninCalls()[0].success({ statusCode: 200, data: { token: fakeToken('A', 7200), user: USER_A } })
  assert.equal((await pending).state, 'ok')
})

/** 登录中、资格那一格读不出来时遇到会话 401：补签认不清是谁——按临时失败，不登出、不删资格。 */
async function unreadable401IsRecoverable(opts = {}) {
  const ctx = createRuntime(opts)
  assert.equal(loginAs(ctx, TOKEN_A, USER_A), true)
  breakKey(ctx, ELIGIBLE, { get: 'throw' })
  const pending = ctx.net.request('/member/print-orders').then(() => null, (e) => e)
  await flush()
  ctx.wx.calls.request[0].success({ statusCode: 401, data: { error: { code: 'MEMBER_SESSION_EXPIRED' } } })
  const err = await pending
  assert.equal(err && err.code, 'SESSION_RESTORE_PENDING', '给页面的是「可重试」，不是「请重新登录」')
  assert.equal(ctx.wx.calls.login.length, 0, '认不清是谁就不去 wx.login')
  ctx.wx.faults.keys = {}
  assert.equal(ctx.wx.store.get(ELIGIBLE), 'A', '资格还在')
  assert.equal(ctx.auth.getToken(), TOKEN_A, '没有登出')
}
test('登录中资格读不出来又遇到会话 401：不登出、不删资格，报可重试', () => unreadable401IsRecoverable())

/** 页面闸门：读不清时 ensureMember 给 recoverable（留在本页重试），不给 need_login（去登录页）。 */
async function unreadableGateIsRecoverable(opts = {}) {
  const store = new Map([['zyd_token', EXPIRED_A], ['zyd_user', USER_A], [ELIGIBLE, 'A']])
  const ctx = createRuntime({ store, ...opts })
  breakKey(ctx, ELIGIBLE, { get: 'throw' })
  const guard = ctx.load('page-guard')
  const r = await guard.ensureMember(ctx.auth, { restoreSession: () => ctx.net.restoreSession() })
  assert.equal(r.state, 'recoverable')
}
test('页面闸门：资格读不出来时给可重试，不送去登录页', () => unreadableGateIsRecoverable())

// ── 主动退出：先作废、确认落盘；落不了盘如实报 ─────────────────────────────

async function logoutWithStuckEligibility({ mode = 'silent', read = null } = {}, opts = {}) {
  const ctx = createRuntime(opts)
  assert.equal(loginAs(ctx, TOKEN_A, USER_A), true)
  breakKey(ctx, ELIGIBLE, { set: mode, remove: mode, ...(read ? { get: read } : {}) })
  assert.equal(ctx.auth.logout(), true, '资格删不掉时靠本机资料的作废标落盘')
  assert.equal(ctx.auth.restorableMemberId(), null)
  assert.equal(ctx.auth.getToken(), null)
  for (const keepFaults of [true, false]) {
    const cold = coldStart(ctx, { keepFaults, mutate: opts.mutate })
    assert.equal(cold.auth.getToken(), null)
    assert.equal(cold.auth.restorableMemberId(), null, '主动退出后冷启动不恢复')
    assert.equal((await cold.net.restoreSession()).state, keepFaults && read ? 'recoverable' : 'need_login')
    assert.equal(cold.wx.calls.login.length, 0, '不去 wx.login')
    const again = coldStart(cold, { keepFaults: false, mutate: opts.mutate })
    assert.equal(again.auth.restorableMemberId(), null)
  }
}
for (const mode of BOTH) {
  test(`主动退出[${mode}]：资格一格写删都失败——退出照样落盘，两次冷启动都不恢复`, () => logoutWithStuckEligibility({ mode }))
}
test('主动退出：资格一格写删失败、读也失败——确认不了作废就写本机作废标，退出照样落盘', () => logoutWithStuckEligibility({ read: 'throw' }))

async function logoutReportsUnpersisted(opts = {}) {
  const ctx = createRuntime(opts)
  assert.equal(loginAs(ctx, TOKEN_A, USER_A), true)
  breakKey(ctx, ELIGIBLE, { set: 'silent', remove: 'silent' })
  breakKey(ctx, 'zyd_user', { set: 'silent', remove: 'silent' })
  assert.equal(ctx.auth.logout(), false, '落不了盘如实报')
  // 本次运行照样是退出状态（内存撤销位）
  assert.equal(ctx.auth.getToken(), null)
  assert.equal(ctx.auth.getUser(), null)
  assert.equal(ctx.auth.restorableMemberId(), null)
  assert.equal(ctx.auth.canSilentResignin(), false)
}
test('主动退出：资格与本机资料两格都写删不了——logout 返回 false，本次运行仍是退出', () => logoutReportsUnpersisted())

test('主动退出：全部存储写删都失败——logout 返回 false', () => {
  const ctx = createRuntime()
  assert.equal(loginAs(ctx, TOKEN_A, USER_A), true)
  ctx.wx.faults.set = 'silent'
  ctx.wx.faults.remove = 'silent'
  assert.equal(ctx.auth.logout(), false)
  assert.equal(ctx.auth.isLoggedIn(), false)
})

async function logoutTombstonesStuckToken({ userRemove = null } = {}, opts = {}) {
  const ctx = createRuntime(opts)
  assert.equal(loginAs(ctx, TOKEN_A, USER_A), true)
  breakKey(ctx, 'zyd_token', { remove: 'silent' })
  if (userRemove) breakKey(ctx, 'zyd_user', { remove: userRemove })
  assert.equal(ctx.auth.logout(), true)
  const cold = coldStart(ctx, { keepFaults: true, mutate: opts.mutate })
  assert.equal(cold.auth.getToken(), null, '冷启动读不回会话')
  assert.equal(cold.auth.isLoggedIn(), false)
  assert.equal(cold.auth.restorableMemberId(), null)
}
test('主动退出：令牌那一格删不掉——写成作废标，冷启动读不回会话', () => logoutTombstonesStuckToken())
test('主动退出：令牌与本机资料都删不掉（写得进）——令牌写成作废标，退出照样落盘', () => logoutTombstonesStuckToken({ userRemove: 'silent' }))
test('主动退出：令牌与本机资料都写删不了（资格正常）——logout 返回 false', () => {
  const ctx = createRuntime()
  assert.equal(loginAs(ctx, TOKEN_A, USER_A), true)
  breakKey(ctx, 'zyd_token', { set: 'silent', remove: 'silent' })
  breakKey(ctx, 'zyd_user', { set: 'silent', remove: 'silent' })
  assert.equal(ctx.auth.logout(), false)
})

// ── 其他按格故障 ────────────────────────────────────────────────────────

test('资格那一格卡在作废标、写删都失败：显式登录 B 照常成立，过期后不自动恢复（宁可再登录）', () => {
  const ctx = createRuntime({ store: new Map([[ELIGIBLE, '!']]) })
  breakKey(ctx, ELIGIBLE, { set: 'silent', remove: 'silent' })
  assert.equal(loginAs(ctx, TOKEN_B, USER_B), true)
  assert.equal(ctx.auth.getUser().id, 'B')
  assert.equal(ctx.auth.restorableMemberId(), null)
})

/** Codex 冷审兼容差异：旧版本资格「1」、资料 B、过期令牌 B，页面**先**调 getToken——清资料前要先迁成 id。 */
async function legacyGetTokenFirst({ legacyValue = 1 } = {}, opts = {}) {
  const store = new Map([['zyd_token', EXPIRED_B], ['zyd_user', USER_B], [ELIGIBLE, legacyValue]])
  const ctx = createRuntime({ store, ...opts })
  assert.equal(ctx.auth.getToken(), null, '先查令牌（过期，清会话）')
  const cold = coldStart(ctx, { keepFaults: false, mutate: opts.mutate })
  assert.equal(cold.auth.restorableMemberId(), 'B', '升级上来的老用户冷启动照样恢复同一位')
  const pending = cold.net.restoreSession()
  await flush()
  assert.equal(cold.wx.calls.login.length, 1)
  cold.wx.calls.login[0].success({ code: 'CODE-LEGACY' })
  await flush()
  cold.resigninCalls()[0].success({ statusCode: 200, data: { token: fakeToken('B', 7200), user: USER_B } })
  assert.equal((await pending).state, 'ok')
  assert.equal(cold.auth.getUser().id, 'B')
}
for (const legacyValue of [1, '1', true]) {
  test(`旧版本资格「${legacyValue}」：页面先调 getToken 也先迁成会员 id，冷启动恢复同一位，不逼再收短信`, () => legacyGetTokenFirst({ legacyValue }))
}
test('旧版本资格「1」迁不进去（资格那一格写失败）：先查令牌后认不出人——不恢复，也不认错人', () => {
  const store = new Map([['zyd_token', EXPIRED_B], ['zyd_user', USER_B], [ELIGIBLE, 1]])
  const ctx = createRuntime({ store })
  breakKey(ctx, ELIGIBLE, { set: 'silent' })
  assert.equal(ctx.auth.getToken(), null)
  assert.equal(ctx.auth.restorableMemberId(), null)
  const cold = coldStart(ctx, { keepFaults: false })
  assert.equal(cold.auth.restorableMemberId(), null)
})

/** 本次运行里证据被别处删掉（不经过 auth）：靠作废位挡住第二次读取。冷启动后就没有依据了，这一层只管本次运行。 */
async function revokedFlagHoldsWhenEvidenceLost(opts = {}) {
  const ctx = createRuntime({ store: new Map([['zyd_user', USER_B], [ELIGIBLE, 'A']]), ...opts })
  breakKey(ctx, ELIGIBLE, { set: 'silent', remove: 'silent' })
  assert.equal(ctx.auth.restorableMemberId(), null)
  ctx.wx.store.delete('zyd_user')
  assert.equal(ctx.auth.restorableMemberId(), null, '本次运行第二次读也认不出 A')
  assert.equal(ctx.auth.canSilentResignin(), false)
}
test('作废位：运行中本机资料被别处删掉，本次运行第二次读仍认不出 A', () => revokedFlagHoldsWhenEvidenceLost())

// ── 设置页：确认退出即本机作废并落盘，服务端尽力 ───────────────────────────

const logoutCalls = (ctx) => ctx.wx.calls.request.filter((c) => c.url.includes('/member/auth/logout'))

/** reply：服务端退出请求后来怎样——'pending'（一直不回）/ 'ok' / '401' / 'offline'。 */
async function settingsLogout({ reply = 'pending' } = {}, opts = {}) {
  const ctx = createRuntime(opts)
  assert.equal(loginAs(ctx, TOKEN_A, USER_A), true)
  const page = ctx.loadPage('pages/settings/settings.js', ctx.load('api'))
  page.onLoad({})
  assert.equal(page.data.isLoggedIn, true)
  page.logout()
  ctx.wx.calls.modal[0].success({ confirm: true })
  const sent = logoutCalls(ctx)
  assert.equal(sent.length, 1, '服务端退出照发')
  assert.equal(authHeader(sent[0]), `Bearer ${TOKEN_A}`, '带的是退出前的令牌')
  // 服务端还没回：本机已经作废并落盘
  assert.equal(ctx.wx.store.has(ELIGIBLE), false)
  assert.equal(ctx.wx.store.has('zyd_token'), false)
  assert.equal(ctx.wx.store.has('zyd_user'), false)
  const closedNow = coldStart(ctx, { mutate: opts.mutate })
  assert.equal((await closedNow.net.restoreSession()).state, 'need_login', '此刻关掉小程序重开：不恢复')
  assert.equal(closedNow.wx.calls.login.length, 0)
  if (reply === 'ok') sent[0].success({ statusCode: 200, data: { data: { loggedOut: true } } })
  if (reply === '401') sent[0].success({ statusCode: 401, data: { error: { code: 'MEMBER_SESSION_EXPIRED' } } })
  if (reply === 'offline') sent[0].fail({ errMsg: 'request:fail' })
  await flush()
  await flush()
  assert.equal(ctx.wx.calls.login.length, 0, '退出请求回 401 也不补签')
  assert.equal(ctx.resigninCalls().length, 0)
  ctx.runTimers()
  ctx.runTimers()
  assert.deepEqual(ctx.wx.calls.toast, [reply === 'ok' ? '已退出登录' : '已退出本机登录'])
  assert.ok(ctx.wx.calls.nav.some(([how, url]) => how === 'reLaunch' && url === '/pages/home/home'))
  assert.equal(ctx.auth.isLoggedIn(), false)
  const later = coldStart(ctx, { mutate: opts.mutate })
  assert.equal(later.auth.restorableMemberId(), null)
  assert.equal(later.auth.getToken(), null)
}
for (const reply of ['pending', 'ok', '401', 'offline']) {
  test(`设置页退出（服务端 ${reply}）：确认即本机作废并落盘，不等网络；服务端怎么回都登不回来`, () => settingsLogout({ reply }))
}

test('设置页：恢复还在路上时确认退出——补签晚到不写入，没有有效令牌就不发服务端退出，冷启动不恢复', async () => {
  const ctx = createRuntime({ store: new Map([['zyd_token', EXPIRED_A], ['zyd_user', USER_A], [ELIGIBLE, 'A']]) })
  const page = ctx.loadPage('pages/settings/settings.js', ctx.load('api'))
  page.onLoad({})
  assert.equal(page.data.restorable, true)
  await flush()
  assert.equal(ctx.wx.calls.login.length, 1, '恢复已在路上')
  page.logout()
  ctx.wx.calls.modal[0].success({ confirm: true })
  assert.equal(logoutCalls(ctx).length, 0, '没有有效令牌：不发服务端退出')
  ctx.wx.calls.login[0].success({ code: 'CODE-LATE' })
  await flush()
  const late = ctx.resigninCalls()
  if (late.length) late[0].success({ statusCode: 200, data: { token: fakeToken('A', 7200), user: USER_A } })
  await flush()
  await flush()
  assert.equal(ctx.auth.isLoggedIn(), false, '晚到的补签不把人登回来')
  assert.equal(ctx.wx.store.has('zyd_token'), false)
  ctx.runTimers()
  assert.deepEqual(ctx.wx.calls.toast, ['已退出登录'])
  const cold = coldStart(ctx)
  assert.equal((await cold.net.restoreSession()).state, 'need_login')
  assert.equal(cold.wx.calls.login.length, 0)
})

test('设置页：退出落不了盘——如实弹窗，不提示「已退出」', async () => {
  const ctx = createRuntime()
  assert.equal(loginAs(ctx, TOKEN_A, USER_A), true)
  const page = ctx.loadPage('pages/settings/settings.js', ctx.load('api'))
  page.onLoad({})
  page.logout()
  ctx.wx.faults.set = 'silent'
  ctx.wx.faults.remove = 'silent'
  ctx.wx.calls.modal[0].success({ confirm: true })
  logoutCalls(ctx)[0].success({ statusCode: 200, data: { data: { loggedOut: true } } })
  await flush()
  await flush()
  ctx.runTimers()
  assert.deepEqual(ctx.wx.calls.toast, [], '不报「已退出」了事')
  const notice = ctx.wx.calls.modal[1]
  assert.equal(notice && notice.title, '退出没有完全保存')
  assert.doesNotMatch(notice.content, /Error|storage|Storage|undefined/, '不露技术原文')
  notice.complete()
  assert.ok(ctx.wx.calls.nav.some(([how, url]) => how === 'reLaunch' && url === '/pages/home/home'))
})

// ── 有界穷举：盘面 × 按格故障 × 操作序列 × 冷启动 ─────────────────────────
//
// 盘面：令牌 {无, A 有效, A 过期, B 有效, B 过期} × 本机资料 {无, A, B, 作废标} × 资格 {无, A, B, 旧值 1, 作废标}。
// 故障：三格各取 {正常, 写删都失败, 只写失败, 只删失败, 读抛异常}。
// 序列：热运行 0–2 步 {认人, 查令牌, 读资料, 主动退出} → 冷启动（存储仍坏 / 已恢复）→ 读资料、查令牌、认人
//       → 再冷启动两种各探一次。
// 判据（按需求写，不照实现抄）：
//   1. 恢复出来的只能是「资格与本机资料不矛盾」的那一位：资格为空或作废标、资料是作废标、资料与资格对不上，都不得恢复任何人；
//   2. 令牌只能是本机资料那一位的有效令牌（getUser 照现行约定：证得出是同一位才给资料）；
//   3. 主动退出之后本次运行一律读不出人；退出返回 true 之后，之后每一次冷启动也读不出人；
//   4. 退出返回 false 必须属实：紧接着存储恢复的冷启动确实还认得出人。

const STORAGE_SRC = fs.readFileSync(path.join(UTILS, 'storage.js'), 'utf8')
const AUTH_SRC = fs.readFileSync(path.join(UTILS, 'auth.js'), 'utf8')

/** 只装 storage + auth 的轻量沙箱：源码编译一次，每个「进程」各起一份模块实例。同一时刻只跑一个进程。 */
function fastAuthFactory(mutate) {
  const sandbox = { console }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  const compile = (name, src) => vm.compileFunction(mutate ? mutate(name, src) : src, ['module', 'exports', 'require'], {
    parsingContext: sandbox,
    filename: `${name}.js`,
  })
  const storageFn = compile('storage', STORAGE_SRC)
  const authFn = compile('auth', AUTH_SRC)
  return (wx) => {
    sandbox.wx = wx
    const storage = { exports: {} }
    storageFn(storage, storage.exports, () => { throw new Error('storage.js 不应 require') })
    const auth = { exports: {} }
    authFn(auth, auth.exports, (spec) => {
      if (spec === './storage') return storage.exports
      throw new Error(`unexpected require: ${spec}`)
    })
    return auth.exports
  }
}

// 矩阵里的 wx 只要三个存储接口；按格故障的语义与 session-runtime 的 createWx 一致（按格设置）。
// 失败用预先建好的异常对象：storage.js 只捕获、不看内容，省掉每次抛错的堆栈开销。
const READ_FAILED = new Error('getStorageSync failed')
const WRITE_FAILED = new Error('setStorageSync failed')
const REMOVE_FAILED = new Error('removeStorageSync failed')
function matrixWx(store, keys) {
  return {
    store,
    getStorageSync(key) {
      const k = keys[key]
      if (k && k.get === 'throw') throw READ_FAILED
      return store.has(key) ? store.get(key) : ''
    },
    setStorageSync(key, value) {
      const k = keys[key]
      if (k && k.set === 'throw') throw WRITE_FAILED
      if (k && k.set === 'silent') return
      store.set(key, typeof value === 'object' && value !== null ? JSON.parse(JSON.stringify(value)) : value)
    },
    removeStorageSync(key) {
      const k = keys[key]
      if (k && k.remove === 'throw') throw REMOVE_FAILED
      if (k && k.remove === 'silent') return
      store.delete(key)
    },
  }
}

const MATRIX_TOKENS = [null, TOKEN_A, EXPIRED_A, TOKEN_B, EXPIRED_B]
const MATRIX_USERS = [null, USER_A, USER_B, '!']
const MATRIX_ELIGIBLE = [null, 'A', 'B', 1, '!']
const FAULT_MODES = {
  ok: {},
  stuck: { set: 'silent', remove: 'silent' },
  noset: { set: 'silent' },
  noremove: { remove: 'silent' },
  noread: { get: 'throw' },
}
const WARM_OPS = ['R', 'T', 'U', 'O']

const payloadOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
const subOf = (token) => (token ? payloadOf(token).sub : null)
const isUsable = (token) => !!token && payloadOf(token).exp * 1000 > Date.now() + 5000

/** 判据 1：初始盘面上「资格与本机资料不矛盾」的那一位；没有就是 null。 */
function allowedMember({ user, eligible }) {
  if (!eligible || eligible === '!' || user === '!') return null
  const userId = user && user.id ? user.id : null
  const legacy = eligible === 1 || eligible === '1' || eligible === true
  const member = legacy ? userId : eligible
  if (!member) return null
  if (userId && userId !== member) return null
  return member
}
/** 判据 2：本机资料那一位的有效令牌。 */
function allowedTokenMember({ token, user }) {
  return isUsable(token) && user && user.id && subOf(token) === user.id ? user.id : null
}
/** getUser 现行约定（本批不改）：令牌与本机资料证得出是同一位就给资料，不看令牌过没过期——页面都先判 isLoggedIn。 */
function allowedUserMember({ token, user }) {
  return token && user && user.id && subOf(token) === user.id ? user.id : null
}

const WARM_SEQUENCES = [[]]
for (const a of WARM_OPS) {
  WARM_SEQUENCES.push([a])
  for (const b of WARM_OPS) WARM_SEQUENCES.push([a, b])
}

function seedStore({ token, user, eligible }) {
  const store = new Map()
  if (token) store.set('zyd_token', token)
  if (user) store.set('zyd_user', typeof user === 'object' ? { ...user } : user)
  if (eligible !== null) store.set(ELIGIBLE, eligible)
  return store
}

/** 跑完整个矩阵，返回违反判据的前 limit 条记录与总次数。 */
function runMatrix({ mutate, limit = 5 } = {}) {
  const spawn = fastAuthFactory(mutate)
  const failures = []
  let runs = 0
  const faultNames = Object.keys(FAULT_MODES)
  const HEALED = {}
  for (const token of MATRIX_TOKENS) for (const user of MATRIX_USERS) for (const eligible of MATRIX_ELIGIBLE) {
    const init = { token, user, eligible }
    const allowed = allowedMember(init)
    const allowedToken = allowedTokenMember(init)
    const allowedUser = allowedUserMember(init)
    const tokenText = token ? `${subOf(token)}${isUsable(token) ? '' : '(过期)'}` : '-'
    const userText = user === '!' ? '!' : (user && user.id) || '-'
    for (const fe of faultNames) for (const fu of faultNames) for (const ft of faultNames) {
      const keys = { [ELIGIBLE]: FAULT_MODES[fe], zyd_user: FAULT_MODES[fu], zyd_token: FAULT_MODES[ft] }
      const anyUnreadable = fe === 'noread' || fu === 'noread' || ft === 'noread'
      for (const seq of WARM_SEQUENCES) for (const healCold of [false, true]) {
        if (failures.length >= limit) return { runs, failures }
        runs += 1
        const fail = (why) => {
          if (failures.length < limit) {
            failures.push(`${why}｜盘面 token=${tokenText} user=${userText} eligible=${eligible} 故障 资格=${fe} 资料=${fu} 令牌=${ft} 序列=${seq.join('') || '∅'} 冷启动=${healCold ? '已恢复' : '仍坏'}`)
          }
        }
        const wx = matrixWx(seedStore(init), keys)
        let auth = spawn(wx)
        let loggedOut = false
        let persisted = false
        const checkRead = (phase) => {
          const member = auth.restorableMemberId()
          if (member !== null && (loggedOut || member !== allowed)) fail(`${phase} 认出了不该恢复的 ${member}`)
          const tok = auth.getToken()
          const tokMember = tok ? subOf(tok) : null
          if (tokMember !== null && (loggedOut || tokMember !== allowedToken)) fail(`${phase} 读出了不该有的令牌 ${tokMember}`)
        }
        for (const op of seq) {
          if (op === 'R') {
            const m = auth.restorableMemberId()
            if (m !== null && (loggedOut || m !== allowed)) fail(`热运行认出了 ${m}`)
          } else if (op === 'T') {
            const t = auth.getToken()
            const tm = t ? subOf(t) : null
            if (tm !== null && (loggedOut || tm !== allowedToken)) fail(`热运行令牌 ${tm}`)
          } else if (op === 'U') {
            const u = auth.getUser()
            const um = u && u.id ? u.id : null
            if (um !== null && (loggedOut || um !== allowedUser)) fail(`热运行资料 ${um}`)
          } else {
            const ok = auth.logout()
            loggedOut = true
            persisted = persisted || ok
            if (!ok && !anyUnreadable) {
              // 判据 4：返回 false 必须属实——读都读得出来时，紧接着存储恢复的冷启动确实还认得出人。
              // （有格读不出来时，false 的意思是「确认不了」，本身就是实话。）
              const probe = spawn(matrixWx(new Map(wx.store), HEALED))
              const seen = probe.restorableMemberId() !== null || probe.getToken() !== null
              if (!seen) fail('退出报了 false，但存储恢复后的冷启动其实已认不出人')
              auth = spawn(wx)
              auth.logout()
            }
          }
        }
        if (loggedOut) checkRead('退出后同一运行')
        // 冷启动：内存旗子没了，只剩盘上。退出返回 false 时不再要求读不出人（已如实报过），但仍不得认错人。
        const coldStore = new Map(wx.store)
        auth = spawn(matrixWx(coldStore, healCold ? HEALED : keys))
        loggedOut = persisted
        auth.getUser()
        auth.getToken()
        checkRead('冷启动')
        // 再冷启动一次（存储已恢复：读得最清楚、最容易把残留的资格认成可恢复）——证据不能在上一次运行里被删掉。
        auth = spawn(matrixWx(new Map(coldStore), HEALED))
        checkRead('再冷启动')
      }
    }
  }
  return { runs, failures }
}

test('有界穷举：盘面 × 按格故障 × 操作序列 × 冷启动，四条判据全部成立', () => {
  const { runs, failures } = runMatrix({ limit: 10 })
  assert.ok(runs > 100000, `矩阵规模不对：${runs}`)
  assert.deepEqual(failures, [])
})

// ── 反向变异：摘掉某一处防护，上面的场景必须判红 ───────────────────────────

const MUTATIONS = [
  {
    name: '删本机资料不看是不是最后证据',
    build: () => mutator('auth', [['  if (found.id === null && judgeEligibility(found.raw, null).id !== null) return;\n', '']]),
    scenario: (opts) => eligibleStuckOnMismatch({ mode: 'silent' }, opts),
  },
  {
    name: '资格读不出来当成没有',
    build: () => mutator('auth', [['  if (!user.ok || !eligible.ok) return', '  if (!user.ok) return']]),
    scenario: (opts) => eligibleUnreadableOnMismatch(opts),
  },
  {
    name: '确认作废时把读失败当已作废',
    build: () => mutator('auth', [['  return raw.ok && (!raw.found || !raw.value || raw.value === ELIGIBILITY_VOID);', '  return !raw.found || !raw.value || raw.value === ELIGIBILITY_VOID;']]),
    scenario: (opts) => logoutWithStuckEligibility({ read: 'throw' }, opts),
  },
  {
    name: '退出沿用旧顺序：先清资料、再删资格',
    build: () => mutator('auth', [['  if (!revokeEligibility()) storage.set(storage.KEYS.USER, ELIGIBILITY_VOID);\n  storage.remove(storage.KEYS.TOKEN);\n', '  clearSession();\n  storage.remove(storage.KEYS.RESIGNIN_ELIGIBLE);\n  storage.remove(storage.KEYS.TOKEN);\n']]),
    scenario: (opts) => logoutWithStuckEligibility({ mode: 'silent' }, opts),
  },
  {
    name: '退出时资格删不掉也不写本机作废标',
    build: () => mutator('auth', [['  if (!revokeEligibility()) storage.set(storage.KEYS.USER, ELIGIBILITY_VOID);\n', '  revokeEligibility();\n']]),
    scenario: (opts) => logoutWithStuckEligibility({ mode: 'silent' }, opts),
  },
  {
    name: '退出不报告没落盘',
    build: () => mutator('auth', [['  return logoutPersisted();\n}', '  return true;\n}']]),
    scenario: (opts) => logoutReportsUnpersisted(opts),
  },
  {
    name: '本机资料的作废标不算证据',
    build: () => mutator('auth', [['  if (user === ELIGIBILITY_VOID) return { id: null, mismatch: true, legacy };\n', '']]),
    scenario: (opts) => logoutWithStuckEligibility({ mode: 'silent' }, opts),
  },
  {
    name: '令牌删不掉不写作废标',
    build: () => mutator('auth', [['  if (left && !isTokenExpired(left) && identityProven(left)) storage.set(storage.KEYS.TOKEN, ELIGIBILITY_VOID);\n', '']]),
    scenario: (opts) => logoutTombstonesStuckToken({ userRemove: 'silent' }, opts),
  },
  {
    name: '作废位不挡第二次读取',
    build: () => mutator('auth', [['  if (sessionRevoked || eligibilityRevoked) return { id: null, unreadable: false };\n  reconcileEligibility();\n  if (eligibilityRevoked) return { id: null, unreadable: false };\n', '  if (sessionRevoked) return { id: null, unreadable: false };\n  reconcileEligibility();\n']]),
    scenario: (opts) => revokedFlagHoldsWhenEvidenceLost(opts),
  },
  {
    name: '清资料前不对账（旧值来不及迁）',
    build: () => mutator('auth', [['  reconcileEligibility();\n  storage.remove(storage.KEYS.TOKEN);\n  removeUserUnlessLastEvidence();', '  storage.remove(storage.KEYS.TOKEN);\n  removeUserUnlessLastEvidence();']]),
    scenario: (opts) => legacyGetTokenFirst({ legacyValue: 1 }, opts),
  },
  {
    name: '补签出发时读不清当成认不出人',
    build: () => mutator('request', [['    reject(member.unreadable ? recoverableSessionError() : makeError(', '    reject(false ? recoverableSessionError() : makeError(']]),
    scenario: (opts) => unreadable401IsRecoverable(opts),
  },
  {
    name: '恢复时读不清也送去登录',
    build: () => mutator('request', [["  if (!expected && member.unreadable) return Promise.resolve({ state: 'recoverable' });\n", '']]),
    scenario: (opts) => eligibleUnreadableOnMismatch(opts),
  },
  {
    name: '页面闸门读不清当成不可恢复',
    build: () => mutator('page-guard', [['  if (!member.id && !member.unreadable) return false', '  if (!member.id) return false']]),
    scenario: (opts) => unreadableGateIsRecoverable(opts),
  },
  {
    name: '设置页等服务端回来才在本机退出',
    build: () => mutator('pages/settings/settings.js', [
      ['        const saved = auth.logout()\n', '        const saved = true\n'],
      ['          this.finishLogout(message, saved)\n', '          auth.logout()\n          this.finishLogout(message, saved)\n'],
    ]),
    scenario: (opts) => settingsLogout({ reply: 'pending' }, opts),
  },
  {
    name: '服务端退出在本机作废之后才发',
    build: () => mutator('pages/settings/settings.js', [
      ['        const server = auth.isLoggedIn() ? api.logout() : null\n        const saved = auth.logout()\n', '        const saved = auth.logout()\n        const server = auth.isLoggedIn() ? api.logout() : null\n'],
    ]),
    scenario: (opts) => settingsLogout({ reply: 'ok' }, opts),
  },
]

for (const mutation of MUTATIONS) {
  test(`变异[按格故障·${mutation.name}]必须判红`, async () => {
    const mutate = mutation.build()
    await assert.rejects(async () => mutation.scenario({ mutate }), assertionFailed)
  })
}

test('变异[按格故障·删本机资料不看是不是最后证据]也让穷举矩阵判红', () => {
  const mutate = mutator('auth', [['  if (found.id === null && judgeEligibility(found.raw, null).id !== null) return;\n', '']])
  assert.notDeepEqual(runMatrix({ mutate, limit: 1 }).failures, [])
})
