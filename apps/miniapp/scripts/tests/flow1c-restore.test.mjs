/**
 * FLOW1c 同设备恢复（小程序侧）：纯短信登录、没绑微信的账号，在同一台手机上登录一次后，
 * 访问令牌过期也能自动续上，不再收验证码。
 *
 * 真实 utils/auth.js、request.js、storage.js（必要时 api.js 与设置页）跑在 wx 替身上，服务端由测试按需回复。
 * 服务端的签发、换新、宽限期、重放、撤销在 services/api/scripts/verify-member-restore.ts 里另测。
 * 只是本地行为证据，**不是**设备或生产结论。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  flush,
  settle,
  fakeToken,
  TOKEN_A,
  TOKEN_B,
  USER_A,
  USER_B,
  createRuntime,
  authHeader,
  mutator,
  assertionFailed,
} from './session-runtime.mjs'

const EXPIRED_A = fakeToken('A', -60)
const R_A1 = `${'a'.repeat(22)}.${'1'.repeat(43)}`
const R_A2 = `${'a'.repeat(22)}.${'2'.repeat(43)}`
const R_B1 = `${'b'.repeat(22)}.${'1'.repeat(43)}`
const RESTORE = 'zyd_restore'

const calls = (ctx, part) => ctx.wx.calls.request.filter((c) => c.url.includes(part))
const restoreCalls = (ctx) => calls(ctx, '/member/auth/restore').filter((c) => !c.url.includes('/revoke'))
const ok = (call, body) => call.success({ statusCode: 200, data: body })

/** 登录一次（带恢复凭证），再模拟「过了很久」：盘上令牌换成过期的那一枚，冷启动。 */
function expiredAfterLogin({ restoreToken = R_A1, opts = {} } = {}) {
  const warm = createRuntime(opts)
  assert.equal(warm.auth.saveSession({ token: TOKEN_A, user: USER_A, restoreToken }), true)
  const disk = new Map(warm.wx.store)
  disk.set('zyd_token', EXPIRED_A)
  return createRuntime({ store: disk, ...opts })
}

async function normalReopen(opts) {
  const ctx = expiredAfterLogin({ opts })
  assert.equal(ctx.auth.isLoggedIn(), false, '前提：访问令牌已过期')
  const pending = ctx.net.restoreSession()
  await flush()
  assert.equal(ctx.wx.calls.login.length, 0, '不调 wx.login，不走微信补签')
  const sent = restoreCalls(ctx)
  assert.equal(sent.length, 1, '用恢复凭证换新')
  assert.deepEqual({ ...sent[0].data }, { restoreToken: R_A1 })
  assert.equal(authHeader(sent[0]), null, '换新请求不带过期的访问令牌')
  ok(sent[0], { token: TOKEN_A, user: USER_A, restoreToken: R_A2 })
  assert.equal((await pending).state, 'ok')
  assert.equal(ctx.auth.getUser().id, 'A')
  assert.deepEqual({ ...ctx.wx.store.get(RESTORE) }, { memberId: 'A', token: R_A2 }, '本机凭证换成新的那一枚')
}
test('正常重开：访问令牌过期，用恢复凭证换新，同一位、不发短信、不走微信补签', () => normalReopen())

test('用着用着访问令牌过期：请求 401 → 单飞换新 → 原请求用新令牌重放', async () => {
  const ctx = expiredAfterLogin()
  const pending = ctx.net.request('/member/print-orders').then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }))
  await flush()
  const first = calls(ctx, '/member/print-orders')
  assert.equal(first.length, 1)
  first[0].success({ statusCode: 401, data: { error: { code: 'MEMBER_MISSING_TOKEN' } } })
  await flush()
  ok(restoreCalls(ctx)[0], { token: TOKEN_A, user: USER_A, restoreToken: R_A2 })
  await flush()
  const replay = calls(ctx, '/member/print-orders')[1]
  assert.equal(authHeader(replay), `Bearer ${TOKEN_A}`)
  ok(replay, { data: { items: [] } })
  assert.equal((await pending).ok, true)
})

test('并发：三个请求同时 401，只换新一次，全部用新令牌重放', async () => {
  const ctx = expiredAfterLogin()
  const pending = [1, 2, 3].map((n) => ctx.net.request(`/member/orders-${n}`).catch((e) => e))
  await flush()
  for (const c of ctx.wx.calls.request.filter((c) => c.url.includes('/member/orders-'))) {
    c.success({ statusCode: 401, data: { error: { code: 'MEMBER_TOKEN_INVALID' } } })
  }
  await flush()
  assert.equal(restoreCalls(ctx).length, 1, '只换新一次')
  ok(restoreCalls(ctx)[0], { token: TOKEN_A, user: USER_A, restoreToken: R_A2 })
  await flush()
  const replays = ctx.wx.calls.request.filter((c) => c.url.includes('/member/orders-')).slice(3)
  assert.equal(replays.length, 3)
  for (const r of replays) assert.equal(authHeader(r), `Bearer ${TOKEN_A}`)
  replays.forEach((r) => ok(r, {}))
  await Promise.all(pending)
})

test('断网：换新失败按临时失败给重试，凭证不变；网络恢复后再试成功（回复丢了也是同一枚去重试）', async () => {
  const ctx = expiredAfterLogin()
  const first = ctx.net.restoreSession()
  await flush()
  restoreCalls(ctx)[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal((await first).state, 'recoverable')
  assert.deepEqual({ ...ctx.wx.store.get(RESTORE) }, { memberId: 'A', token: R_A1 }, '凭证不变')
  assert.equal(ctx.auth.restorableMemberId(), 'A', '恢复资格还在')
  const second = ctx.net.restoreSession()
  await flush()
  assert.deepEqual({ ...restoreCalls(ctx)[1].data }, { restoreToken: R_A1 }, '再试用的还是同一枚（服务端宽限期内会返回同一个后继）')
  ok(restoreCalls(ctx)[1], { token: TOKEN_A, user: USER_A, restoreToken: R_A2 })
  assert.equal((await second).state, 'ok')
})

for (const code of ['MEMBER_RESTORE_INVALID', 'MEMBER_RESTORE_REUSED']) {
  test(`服务端撤销或判重放（${code}）：要求重新登录，不回退到微信补签，本机凭证删除`, async () => {
    const ctx = expiredAfterLogin()
    const pending = ctx.net.restoreSession()
    await flush()
    restoreCalls(ctx)[0].success({ statusCode: 401, data: { error: { code, message: '登录已过期，请重新登录' } } })
    assert.equal((await pending).state, 'need_login')
    assert.equal(ctx.wx.calls.login.length, 0, '不回退到 wx.login')
    assert.equal(ctx.auth.restorableMemberId(), null, '恢复资格已撤销')
    assert.equal(ctx.wx.store.has(RESTORE), false, '本机凭证删除')
    const cold = createRuntime({ store: new Map(ctx.wx.store) })
    assert.equal((await cold.net.restoreSession()).state, 'need_login')
    assert.equal(restoreCalls(cold).length, 0)
  })
}

test('账号不可用（ACCOUNT_UNAVAILABLE）：确定失败，要求登录', async () => {
  const ctx = expiredAfterLogin()
  const pending = ctx.net.restoreSession()
  await flush()
  restoreCalls(ctx)[0].success({ statusCode: 403, data: { error: { code: 'ACCOUNT_UNAVAILABLE' } } })
  assert.equal((await pending).state, 'need_login')
})

test('服务端暂时核验不了（503）：可重试，不登出', async () => {
  const ctx = expiredAfterLogin()
  const pending = ctx.net.restoreSession()
  await flush()
  restoreCalls(ctx)[0].success({ statusCode: 503, data: { error: { code: 'MEMBER_SESSION_STORE_UNAVAILABLE' } } })
  assert.equal((await pending).state, 'recoverable')
  assert.equal(ctx.auth.restorableMemberId(), 'A')
})

async function returnsOtherMember(opts) {
  const ctx = expiredAfterLogin({ opts })
  const pending = ctx.net.restoreSession()
  await flush()
  ok(restoreCalls(ctx)[0], { token: TOKEN_B, user: USER_B, restoreToken: R_B1 })
  assert.equal((await pending).state, 'need_login')
  assert.notEqual(ctx.wx.store.get('zyd_token'), TOKEN_B, 'B 的令牌不得写入')
}
test('换新回来的不是这一位：不写入，按确定失败处理', () => returnsOtherMember())

async function unreadableCredential(opts) {
  const ctx = expiredAfterLogin({ opts })
  ctx.wx.faults.keys[RESTORE] = { get: 'throw' }
  // 看门狗：防护被变异摘掉后会去等一个没人回的 wx.login，不能让它挂住整个测试进程。
  const result = await settle(ctx.net.restoreSession())
  assert.equal(result.ok && result.value.state, 'recoverable')
  assert.equal(ctx.wx.calls.login.length, 0, '读不出凭证时不改走微信补签（没绑微信会被判确定失败而登出）')
  assert.equal(restoreCalls(ctx).length, 0)
  assert.equal(ctx.auth.restorableMemberId(), 'A', '不登出、不作废')
}
test('凭证那一格读不出来：临时失败给重试，不改走微信补签', () => unreadableCredential())

test('旧登录没有凭证：照旧走微信补签', async () => {
  const ctx = expiredAfterLogin({ restoreToken: null })
  assert.equal(ctx.wx.store.has(RESTORE), false)
  ctx.net.restoreSession()
  await flush()
  assert.equal(ctx.wx.calls.login.length, 1, '没有凭证时走原来的微信补签')
  assert.equal(restoreCalls(ctx).length, 0)
})

async function switchAccountIsolation(opts) {
  const warm = createRuntime(opts)
  assert.equal(warm.auth.saveSession({ token: TOKEN_A, user: USER_A, restoreToken: R_A1 }), true)
  warm.auth.logout()
  assert.equal(warm.auth.saveSession({ token: TOKEN_B, user: USER_B, restoreToken: R_B1 }), true)
  assert.deepEqual({ ...warm.wx.store.get(RESTORE) }, { memberId: 'B', token: R_B1 })
  const disk = new Map(warm.wx.store)
  disk.set('zyd_token', fakeToken('B', -60))
  const cold = createRuntime({ store: disk, ...opts })
  cold.net.restoreSession()
  await flush()
  assert.deepEqual({ ...restoreCalls(cold)[0].data }, { restoreToken: R_B1 }, '换号后只用 B 的凭证')
}
test('换号：B 登录后凭证换成 B 的，冷启动只用 B 的', () => switchAccountIsolation())

async function staleCredentialOfOtherMember(opts) {
  const warm = createRuntime(opts)
  assert.equal(warm.auth.saveSession({ token: TOKEN_A, user: USER_A, restoreToken: R_A1 }), true)
  warm.wx.faults.keys[RESTORE] = { set: 'silent', remove: 'silent' }
  warm.auth.logout()
  assert.equal(warm.auth.saveSession({ token: TOKEN_B, user: USER_B }), true, 'B 登录（这次没拿到凭证）')
  assert.deepEqual({ ...warm.wx.store.get(RESTORE) }, { memberId: 'A', token: R_A1 }, '前提：A 的凭证删不掉、留在盘上')
  const disk = new Map(warm.wx.store)
  disk.set('zyd_token', fakeToken('B', -60))
  const cold = createRuntime({ store: disk, ...opts })
  cold.net.restoreSession()
  await flush()
  assert.equal(restoreCalls(cold).length, 0, 'A 留下的凭证永远用不上')
  assert.equal(cold.wx.calls.login.length, 1, 'B 没有自己的凭证，走微信补签')
}
test('换号隔离：A 的凭证删不掉留在盘上，B 冷启动也绝不拿它换', () => staleCredentialOfOtherMember())

test('显式登录没带凭证（旧版 API）：删掉旧的那一格，不留上一位的', () => {
  const ctx = createRuntime()
  assert.equal(ctx.auth.saveSession({ token: TOKEN_A, user: USER_A, restoreToken: R_A1 }), true)
  assert.equal(ctx.auth.saveSession({ token: TOKEN_B, user: USER_B }), true)
  assert.equal(ctx.wx.store.has(RESTORE), false)
})

test('凭证格式不对：不用（照旧走微信补签），也不会把它发给服务端', async () => {
  const ctx = expiredAfterLogin({ restoreToken: 'not-a-token' })
  ctx.net.restoreSession()
  await flush()
  assert.equal(restoreCalls(ctx).length, 0)
  assert.equal(ctx.wx.calls.login.length, 1)
})

// ── 主动退出：本机作废并落盘，服务端作废尽力而为 ───────────────────────────

async function settingsLogoutRevokes(opts) {
  const ctx = expiredAfterLogin({ opts })
  const page = ctx.loadPage('pages/settings/settings.js', ctx.load('api'))
  page.onLoad({})
  await flush()
  // 设置页在可恢复时会先去恢复一次：让它临时失败，留在「可恢复」状态。
  if (restoreCalls(ctx)[0]) restoreCalls(ctx)[0].fail({ errMsg: 'request:fail' })
  await flush()
  page.logout()
  ctx.wx.calls.modal[0].success({ confirm: true })
  assert.equal(ctx.wx.store.has(RESTORE), false, '本机凭证已删除')
  const revoke = calls(ctx, '/member/auth/restore/revoke')
  assert.equal(revoke.length, 1, '交服务端作废')
  assert.deepEqual({ ...revoke[0].data }, { restoreToken: R_A1 }, '作废的是退出前那一枚')
  assert.equal(authHeader(revoke[0]), null, '作废请求不带访问令牌')
  revoke[0].fail({ errMsg: 'request:fail' })
  await flush()
  const cold = createRuntime({ store: new Map(ctx.wx.store), ...opts })
  assert.equal((await cold.net.restoreSession()).state, 'need_login', '服务端作废没送到，重开也不恢复')
  assert.equal(restoreCalls(cold).length, 0)
}
test('主动退出：本机凭证删除；服务端作废请求带退出前那一枚，没送到也不影响', () => settingsLogoutRevokes())

// ── 登录时申请恢复凭证 ─────────────────────────────────────────────────

async function loginAsksForRestore(opts) {
  const ctx = createRuntime(opts)
  const api = ctx.load('api')
  const pending = api.loginBySms('13800000001', '123456')
  for (let i = 0; i < 4; i += 1) {
    await flush()
    for (const c of ctx.wx.calls.request.filter((c) => c.url.includes('/kiosk/legal/') && !c._answered)) {
      c._answered = true
      ok(c, { version: 'v1' })
    }
  }
  const login = calls(ctx, '/member/auth/login')
  assert.equal(login.length, 1)
  assert.equal(login[0].header['x-member-keep-signed-in'], '1', '登录请求申请恢复凭证（请求头，不是请求体字段）')
  assert.equal('persistent' in login[0].data, false)
  ok(login[0], { token: TOKEN_A, user: USER_A, restoreToken: R_A1 })
  const res = await pending
  assert.equal(ctx.auth.saveSession(res), true)
  assert.deepEqual({ ...ctx.wx.store.get(RESTORE) }, { memberId: 'A', token: R_A1 })
}
test('短信登录：请求头申请恢复凭证；拿到后跟着会话写下', () => loginAsksForRestore())

// ── 反向变异 ───────────────────────────────────────────────────────────

const MUTATIONS = [
  {
    name: '有凭证也不用（照旧走微信补签）',
    build: () => mutator('request', [['    if (restore.token) {\n      resolve({ restoreToken: restore.token });', '    if (false) {\n      resolve({ restoreToken: restore.token });']]),
    scenario: normalReopen,
  },
  {
    name: '换新回来不核对会员',
    build: () => mutator('request', [["      if (memberId !== expected) throw makeError('登录已过期，请重新登录', 401, 'RESIGNIN_MEMBER_MISMATCH');\n", '']]),
    scenario: returnsOtherMember,
  },
  {
    name: '凭证读失败当成没有',
    build: () => mutator('auth', [['  if (!read.ok) return { ok: false, token: null };\n', '']]),
    scenario: unreadableCredential,
  },
  {
    name: '凭证不核对是不是这一位',
    build: () => mutator('auth', [["  if (!expected || !value || typeof value !== 'object' || String(value.memberId) !== String(expected)) {", "  if (!value || typeof value !== 'object') {"]]),
    scenario: staleCredentialOfOtherMember,
  },
  {
    name: '退出不删本机凭证',
    build: () => mutator('auth', [['  storage.remove(storage.KEYS.RESTORE);\n  if (storage.get(storage.KEYS.RESTORE)) storage.set(storage.KEYS.RESTORE, ELIGIBILITY_VOID);\n', '']]),
    scenario: settingsLogoutRevokes,
  },
  {
    name: '退出不交服务端作废',
    build: () => mutator('pages/settings/settings.js', [['        if (restoreToken) api.revokeRestore(restoreToken).catch(() => {})\n', '']]),
    scenario: settingsLogoutRevokes,
  },
  {
    name: '登录不申请恢复凭证',
    build: () => mutator('api', [["      return request('/member/auth/login', { method: 'POST', data, needAuth: false, header: KEEP_SIGNED_IN });", "      return request('/member/auth/login', { method: 'POST', data, needAuth: false });"]]),
    scenario: loginAsksForRestore,
  },
  {
    name: '换新后不保存新凭证',
    build: () => mutator('request', [['auth.saveSession({ token, user: res.user, restoreToken: res.restoreToken }, { expectGeneration: generation })', 'auth.saveSession({ token, user: res.user }, { expectGeneration: generation })']]),
    scenario: normalReopen,
  },
  {
    name: '凭证被拒不算确定失败',
    build: () => mutator('request', [["  'MEMBER_RESTORE_INVALID', 'MEMBER_RESTORE_REUSED',\n", '']]),
    scenario: async (opts) => {
      const ctx = expiredAfterLogin({ opts })
      const pending = ctx.net.restoreSession()
      await flush()
      restoreCalls(ctx)[0].success({ statusCode: 401, data: { error: { code: 'MEMBER_RESTORE_INVALID' } } })
      assert.equal((await pending).state, 'need_login')
    },
  },
  {
    name: '换号后仍用上一位的凭证',
    build: () => mutator('auth', [['  if (!isResignin) storage.remove(storage.KEYS.RESTORE);\n', '']]),
    scenario: async (opts) => {
      const ctx = createRuntime(opts)
      assert.equal(ctx.auth.saveSession({ token: TOKEN_A, user: USER_A, restoreToken: R_A1 }), true)
      assert.equal(ctx.auth.saveSession({ token: TOKEN_B, user: USER_B }), true)
      assert.equal(ctx.wx.store.has(RESTORE), false)
    },
  },
]

for (const mutation of MUTATIONS) {
  test(`变异[FLOW1c·${mutation.name}]必须判红`, async () => {
    const mutate = mutation.build()
    await assert.rejects(async () => mutation.scenario({ mutate }), assertionFailed)
  })
}
