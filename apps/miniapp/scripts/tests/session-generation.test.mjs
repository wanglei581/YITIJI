/**
 * 401 静默补签的**时序**测试：真跑 utils/auth.js + utils/request.js + utils/storage.js，
 * 只有 wx 是替身。
 *
 * 为什么不能只靠静态门禁：这一批缺陷的形态是「守卫代码全都在，顺序一换就漏」——
 * 补签要走 wx.login + 一次网络往返，这期间用户可能登出、可能换号；晚到的成功会
 * **复活已登出的账号**或**覆盖新账号**，晚到的失败会**把新账号踢下线**。正则断言
 * 只能证明某段代码存在，证明不了这三件事真的挡得住。所以这里把回调交给测试自己按
 * 任意顺序触发，并对**真实读接口**（getToken / getUser / isLoggedIn / canSilentResignin）、
 * 请求头、补签请求计数、重放计数做断言。
 *
 * 末尾一组是**反向变异**：在内存里（不改磁盘源）摘掉某一处核心防护，断言上面的场景
 * 立刻判红，且红的是断言失败（ERR_ASSERTION）而不是把代码改崩。变异不红 = 断言没
 * 测到它声称测的东西。
 *
 * 放在 scripts/tests/ 是刻意的：scripts/project-graph/gates.mjs 把 `/scripts/tests/`
 * 排除在"门禁脚本"之外，本文件由 `verify:session-generation` 拉起并串进 verify:static。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  flush,
  settle,
  fakeToken,
  tokenWithoutSubject,
  TOKEN_A,
  TOKEN_A2,
  TOKEN_B,
  TOKEN_B2,
  USER_A,
  USER_B,
  createRuntime,
  authHeader,
  mutator,
  assertionFailed,
} from './session-runtime.mjs'

function loginAs(ctx, token, user) {
  return ctx.auth.saveSession({ token, user })
}

/** 业务请求与上传只有底层 wx API 不同，时序完全同一套，因此两条都跑。 */
const TRANSPORTS = [
  {
    name: 'request',
    send: (ctx) => ctx.net.request('/member/print-orders'),
    calls: (ctx) => ctx.wx.calls.request.filter((c) => !c.url.includes('/wx-resignin')),
    reply: (call, statusCode, body) => call.success({ statusCode, data: body }),
  },
  {
    name: 'uploadFile',
    send: (ctx) => ctx.net.uploadFile('/files/kiosk-upload', 'wxfile://tmp.pdf'),
    calls: (ctx) => ctx.wx.calls.upload,
    // wx.uploadFile 的 res.data 是**字符串**，不会自动 JSON.parse。
    reply: (call, statusCode, body) => call.success({ statusCode, data: JSON.stringify(body) }),
  },
]

function switchToB(ctx) {
  ctx.auth.logout()
  assert.equal(loginAs(ctx, TOKEN_B, USER_B), true)
}

function assertIsB(ctx) {
  assert.equal(ctx.auth.getToken(), TOKEN_B, 'B 的 token 必须原样保留')
  assert.equal(ctx.auth.getUser().id, 'B')
  assert.equal(ctx.auth.isLoggedIn(), true)
  assert.equal(ctx.auth.canSilentResignin(), true)
}

function assertLoggedOut(ctx) {
  assert.equal(ctx.auth.getToken(), null)
  assert.equal(ctx.auth.getUser(), null)
  assert.equal(ctx.auth.isLoggedIn(), false)
  assert.equal(ctx.auth.canSilentResignin(), false)
}

// ── 场景（每个都能独立带 mutate 再跑一遍，供反向变异复用）─────────────────

/** 自然过期：同一个人续一次签，请求照常完成，代际不变。 */
async function naturalExpiryRecovers(tr, opts) {
  const ctx = createRuntime(opts)
  assert.equal(loginAs(ctx, TOKEN_A, USER_A), true)
  const generation = ctx.auth.sessionGeneration()

  const pending = settle(tr.send(ctx))
  await flush()
  const first = tr.calls(ctx)[0]
  assert.equal(authHeader(first), `Bearer ${TOKEN_A}`)
  tr.reply(first, 401, {})
  await flush()

  assert.equal(ctx.wx.calls.login.length, 1)
  ctx.wx.calls.login[0].success({ code: 'CODE-1' })
  await flush()

  assert.equal(ctx.resigninCalls().length, 1)
  ctx.resigninCalls()[0].success({ statusCode: 200, data: { token: TOKEN_A2, user: USER_A } })
  await flush()

  const replay = tr.calls(ctx)[1]
  assert.ok(replay, '补签成功后必须重放原请求')
  assert.equal(authHeader(replay), `Bearer ${TOKEN_A2}`, '重放必须带新 token')
  tr.reply(replay, 200, { data: { ok: 1 } })

  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(result.value.ok, 1)
  assert.equal(tr.calls(ctx).length, 2, '只重放一次')
  assert.equal(ctx.resigninCalls().length, 1)
  assert.equal(ctx.auth.sessionGeneration(), generation, '补签不换代')
  assert.equal(ctx.auth.getToken(), TOKEN_A2)
  assert.equal(ctx.auth.getUser().id, 'A')
  assert.equal(ctx.auth.isLoggedIn(), true)
  assert.equal(ctx.auth.canSilentResignin(), true)
}

/** 主动登出后 401 才到：不补签、不重放、旧身份读不回来。 */
async function logoutBeforeInitial401(tr, opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(tr.send(ctx))
  await flush()
  const first = tr.calls(ctx)[0]

  ctx.auth.logout()
  tr.reply(first, 401, {})
  await flush()

  assert.equal(ctx.wx.calls.login.length, 0, '登出后不得再 wx.login')
  assert.equal(ctx.resigninCalls().length, 0)
  assert.equal(tr.calls(ctx).length, 1, '不得重放')
  assertLoggedOut(ctx)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.statusCode, 401)
}

/** 换号后旧请求的 401 才到：不能借 B 的资格给 A 补签。 */
async function switchAccountBeforeInitial401(tr, opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(tr.send(ctx))
  await flush()
  const first = tr.calls(ctx)[0]

  switchToB(ctx)
  tr.reply(first, 401, {})
  await flush()

  assert.equal(ctx.wx.calls.login.length, 0, '旧会话的 401 不得触发补签')
  assert.equal(ctx.resigninCalls().length, 0)
  assert.equal(tr.calls(ctx).length, 1)
  assertIsB(ctx)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.statusCode, 401)
}

/** wx.login 晚到时已经换号：手上的 code 不该再去换旧账号的 token。 */
async function wxLoginLateAfterSwitch(tr, opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(tr.send(ctx))
  await flush()
  tr.reply(tr.calls(ctx)[0], 401, {})
  await flush()
  assert.equal(ctx.wx.calls.login.length, 1)

  switchToB(ctx)
  ctx.wx.calls.login[0].success({ code: 'CODE-1' })
  await flush()

  assert.equal(ctx.resigninCalls().length, 0, '换号后不得再拿旧 code 换 token')
  assert.equal(tr.calls(ctx).length, 1)
  assertIsB(ctx)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.statusCode, 401)
}

/** 补签**成功**但响应晚于换号：不得把 A 写回来、不得重放。 */
async function resigninSuccessLateAfterSwitch(tr, opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(tr.send(ctx))
  await flush()
  tr.reply(tr.calls(ctx)[0], 401, {})
  await flush()
  ctx.wx.calls.login[0].success({ code: 'CODE-1' })
  await flush()
  assert.equal(ctx.resigninCalls().length, 1)

  switchToB(ctx)
  ctx.resigninCalls()[0].success({ statusCode: 200, data: { token: TOKEN_A2, user: USER_A } })
  await flush()

  assert.equal(tr.calls(ctx).length, 1, '换号后不得重放旧请求')
  assertIsB(ctx)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.statusCode, 401)
}

/** 补签**失败**且失败晚于换号：不得把 B 踢下线。 */
async function resigninFailureLateAfterSwitch(tr, opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(tr.send(ctx))
  await flush()
  tr.reply(tr.calls(ctx)[0], 401, {})
  await flush()
  ctx.wx.calls.login[0].success({ code: 'CODE-1' })
  await flush()

  switchToB(ctx)
  // 确定失败（FLOW1b 起只有确定失败才会去登出），晚到时只能登出自己那一代，不能把 B 踢下线。
  ctx.resigninCalls()[0].success({ statusCode: 401, data: { error: { code: 'MEMBER_NOT_BOUND', message: '该微信尚未绑定账号' } } })
  await flush()

  assert.equal(tr.calls(ctx).length, 1)
  assertIsB(ctx)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.statusCode, 401)
}

/** 同代并发 401 只触发一次 wx.login，两条请求都要重放。 */
async function sameGenerationSingleFlight(tr, opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const first = settle(tr.send(ctx))
  const second = settle(tr.send(ctx))
  await flush()
  assert.equal(tr.calls(ctx).length, 2)
  tr.reply(tr.calls(ctx)[0], 401, {})
  tr.reply(tr.calls(ctx)[1], 401, {})
  await flush()

  assert.equal(ctx.wx.calls.login.length, 1, '微信 code 一次性，并发换取会互相作废')
  ctx.wx.calls.login[0].success({ code: 'CODE-1' })
  await flush()
  assert.equal(ctx.resigninCalls().length, 1)
  ctx.resigninCalls()[0].success({ statusCode: 200, data: { token: TOKEN_A2, user: USER_A } })
  await flush()

  const replays = tr.calls(ctx).slice(2)
  assert.equal(replays.length, 2, '两条都要重放')
  for (const replay of replays) {
    assert.equal(authHeader(replay), `Bearer ${TOKEN_A2}`)
    tr.reply(replay, 200, { data: { ok: 1 } })
  }
  assert.equal((await first).ok, true)
  assert.equal((await second).ok, true)
  assert.equal(ctx.auth.getToken(), TOKEN_A2)
}

/** 旧飞行结束时只能清自己那一次，不得把新会话的飞行一起抹掉。 */
async function staleFlightMustNotClearNewFlight(tr, opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const oldRequest = settle(tr.send(ctx))
  await flush()
  tr.reply(tr.calls(ctx)[0], 401, {})
  await flush()
  assert.equal(ctx.wx.calls.login.length, 1, 'A 的飞行')

  switchToB(ctx)
  const firstB = settle(tr.send(ctx))
  await flush()
  tr.reply(tr.calls(ctx)[1], 401, {})
  await flush()
  assert.equal(ctx.wx.calls.login.length, 2, '换人后必须是一次新飞行')

  // A 的飞行现在才失败：它的清理只许动自己那一次。
  ctx.wx.calls.login[0].fail({ errMsg: 'login:fail' })
  await flush()
  assert.equal((await oldRequest).ok, false)
  assertIsB(ctx)

  const secondB = settle(tr.send(ctx))
  await flush()
  tr.reply(tr.calls(ctx)[2], 401, {})
  await flush()
  assert.equal(ctx.wx.calls.login.length, 2, 'B 的并发 401 必须复用 B 的在途飞行')

  ctx.wx.calls.login[1].success({ code: 'CODE-B' })
  await flush()
  assert.equal(ctx.resigninCalls().length, 1)
  ctx.resigninCalls()[0].success({ statusCode: 200, data: { token: TOKEN_B2, user: USER_B } })
  await flush()

  const replays = tr.calls(ctx).slice(3)
  assert.equal(replays.length, 2)
  for (const replay of replays) {
    assert.equal(authHeader(replay), `Bearer ${TOKEN_B2}`)
    tr.reply(replay, 200, { data: { ok: 1 } })
  }
  assert.equal((await firstB).ok, true)
  assert.equal((await secondB).ok, true)
}

/** 补签已落盘、重放**之前**换号：重放会拿 B 的 token 去跑 A 的请求，必须拦住。 */
async function switchBetweenResigninAndReplay(tr, opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(tr.send(ctx))
  await flush()
  tr.reply(tr.calls(ctx)[0], 401, {})
  await flush()
  ctx.wx.calls.login[0].success({ code: 'CODE-1' })
  await flush()

  let witness = null
  ctx.resigninCalls()[0].success({ statusCode: 200, data: { token: TOKEN_A2, user: USER_A } })
  // 在微任务队列上自旋，直到 saveSession 把新 token 写进盘里，立刻换号 ——
  // 那一刻补签已经成功，而重放还在后面几跳。（不能只 queueMicrotask 一次：
  // rawRequest 的结果是被上一层 then 当 thenable 吸收的，吸收本身还要多跑两跳。）
  let spins = 0
  const switchOnceResigninLanded = () => {
    if (ctx.wx.store.get('zyd_token') === TOKEN_A2) {
      witness = TOKEN_A2
      switchToB(ctx)
      return
    }
    if (spins++ < 50) queueMicrotask(switchOnceResigninLanded)
  }
  queueMicrotask(switchOnceResigninLanded)

  await flush()
  assert.equal(witness, TOKEN_A2, '换号必须发生在补签已落盘之后、重放之前')
  assert.equal(tr.calls(ctx).length, 1, '换号后不得重放旧请求')
  assertIsB(ctx)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.statusCode, 401)
}

/** 补签自己带业务码（服务条款更新）：必须原样抛给页面，而不是被 401 盖掉。 */
async function legalVersionStaleSurfaces(tr, opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(tr.send(ctx))
  await flush()
  tr.reply(tr.calls(ctx)[0], 401, {})
  await flush()
  ctx.wx.calls.login[0].success({ code: 'CODE-1' })
  await flush()
  ctx.resigninCalls()[0].success({
    statusCode: 401,
    data: { error: { code: 'MEMBER_LEGAL_VERSION_STALE', message: '服务条款已更新，请重新登录并确认' } },
  })

  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'MEMBER_LEGAL_VERSION_STALE')
  assert.equal(tr.calls(ctx).length, 1, '补签失败不重放')
  assertLoggedOut(ctx)
}

/** 登出那一刻所有存储写入都安静丢失：在途补签仍必须失效（代际不能落盘的理由）。 */
async function logoutInvalidatesInflightWhenWritesAreLost(tr, opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(tr.send(ctx))
  await flush()
  tr.reply(tr.calls(ctx)[0], 401, {})
  await flush()
  assert.equal(ctx.wx.calls.login.length, 1)

  ctx.wx.faults.set = 'silent'
  ctx.wx.faults.remove = 'silent'
  ctx.auth.logout()
  // 存储随后恢复：代际若是落盘的，这时补签就能一路写回来，复活看得见。
  ctx.wx.faults.set = null
  ctx.wx.faults.remove = null

  ctx.wx.calls.login[0].success({ code: 'CODE-1' })
  await flush()
  assert.equal(ctx.resigninCalls().length, 0, '登出后不得再去换 token')

  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(tr.calls(ctx).length, 1)
  assertLoggedOut(ctx)
}

/**
 * 补签回来了但落不了盘：存不下的会话等于没有会话，这次不重放。
 * FLOW1b 起按**临时失败**处理：不登出、不删恢复资格（存储问题不该让人重收短信），给页面可恢复的错误。
 */
async function resigninSaveFailureIsFailure(tr, mode, opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(tr.send(ctx))
  await flush()
  tr.reply(tr.calls(ctx)[0], 401, {})
  await flush()
  ctx.wx.calls.login[0].success({ code: 'CODE-1' })
  await flush()

  ctx.wx.faults.set = mode
  ctx.resigninCalls()[0].success({ statusCode: 200, data: { token: TOKEN_A2, user: USER_A } })
  await flush()
  ctx.wx.faults.set = null

  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'SESSION_RESTORE_PENDING')
  assert.equal(result.error.recoverable, true)
  assert.equal(tr.calls(ctx).length, 1, '没存下新 token 就不该拿旧 token 去重放')
  assert.equal(ctx.auth.canSilentResignin(), true, '存储问题不撤销恢复资格')
  assert.equal(ctx.auth.restorableMemberId(), 'A')
}

// ── 用例 ────────────────────────────────────────────────────────────────────

for (const tr of TRANSPORTS) {
  test(`[${tr.name}] 自然过期：同代补签成功并重放`, () => naturalExpiryRecovers(tr))
  test(`[${tr.name}] 主动登出后 401 晚到：不补签不重放`, () => logoutBeforeInitial401(tr))
  test(`[${tr.name}] 换号后 401 晚到：不借 B 的资格给 A 补签`, () => switchAccountBeforeInitial401(tr))
  test(`[${tr.name}] wx.login 晚到时已换号：不拿旧 code 换 token`, () => wxLoginLateAfterSwitch(tr))
  test(`[${tr.name}] 补签成功晚到：不复活 A、不覆盖 B`, () => resigninSuccessLateAfterSwitch(tr))
  test(`[${tr.name}] 补签失败晚到：不把 B 踢下线`, () => resigninFailureLateAfterSwitch(tr))
  test(`[${tr.name}] 同代并发 401 只发一次 wx.login`, () => sameGenerationSingleFlight(tr))
  test(`[${tr.name}] 旧飞行的清理不得清掉新会话的飞行`, () => staleFlightMustNotClearNewFlight(tr))
  test(`[${tr.name}] 补签已落盘、重放前换号：不得重放`, () => switchBetweenResigninAndReplay(tr))
  test(`[${tr.name}] 补签带 MEMBER_LEGAL_VERSION_STALE：业务码不被 401 盖掉`, () => legalVersionStaleSurfaces(tr))
  test(`[${tr.name}] 登出时写入全丢：在途补签仍然失效`, () => logoutInvalidatesInflightWhenWritesAreLost(tr))
  for (const mode of ['throw', 'silent']) {
    test(`[${tr.name}] 补签保存失败(${mode})：不重放、不登出、保留恢复资格`, () => resigninSaveFailureIsFailure(tr, mode))
  }
}

for (const mode of ['throw', 'silent']) {
  test(`显式登录写失败(${mode})：新会话不成立，旧账号也读不回来`, () => {
    const ctx = createRuntime()
    loginAs(ctx, TOKEN_A, USER_A)
    assert.equal(ctx.auth.isLoggedIn(), true)

    ctx.wx.faults.set = mode
    assert.equal(ctx.auth.saveSession({ token: TOKEN_B, user: USER_B }), false, '写不进去就不能报成功')
    ctx.wx.faults.set = null

    assertLoggedOut(ctx)
    assert.notEqual(ctx.auth.getToken(), TOKEN_A, 'A 不得因为 B 登录失败而继续可用')

    // 撤销位不是永久砖：重新登录成功即解除。
    assert.equal(loginAs(ctx, TOKEN_B, USER_B), true)
    assertIsB(ctx)
  })

  test(`登出时清理失败(${mode})：本次运行内彻底登出`, async () => {
    const ctx = createRuntime()
    loginAs(ctx, TOKEN_A, USER_A)
    ctx.wx.faults.remove = mode
    // 存储彻底坏掉：删不掉，也写不进。旧 token 原样留在盘上。
    if (mode === 'throw') ctx.wx.faults.set = 'throw'
    ctx.auth.logout()
    ctx.wx.faults.remove = null
    ctx.wx.faults.set = null

    assertLoggedOut(ctx)

    const pending = settle(ctx.net.request('/member/print-orders'))
    await flush()
    const call = ctx.wx.calls.request[0]
    assert.equal(authHeader(call), null, '登出后不得再带旧 token')
    call.success({ statusCode: 401, data: {} })
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(ctx.wx.calls.login.length, 0, '残留的资格旗子不得引发再次补签')
    assert.equal(ctx.resigninCalls().length, 0)

    assert.equal(loginAs(ctx, TOKEN_B, USER_B), true)
    assertIsB(ctx)
  })
}

// ── 冷启动：盘上两格分属两个人 ────────────────────────────────────────────
// 成因是换号时只有一格写成功。本次运行内有内存撤销位兜着，冷启动后它没了，只剩这两格：
// 页面显示 A 的资料、请求却带着 B 的 token。

const subjectOf = (token) => JSON.parse(
  Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'),
).sub

/** 造一份撕裂的存储：A 已登录，换 B 时只有 failingKey 这一格写失败。 */
function tornStore(failingKey, mode) {
  const warm = createRuntime()
  loginAs(warm, TOKEN_A, USER_A)
  warm.wx.faults.key = failingKey
  warm.wx.faults.keyMode = mode
  assert.equal(warm.auth.saveSession({ token: TOKEN_B, user: USER_B }), false, '写不全的会话不能报成功')
  warm.wx.faults.key = null
  warm.wx.faults.keyMode = null
  assert.equal(warm.auth.isLoggedIn(), false, '本次运行内由内存撤销位兜住')

  const store = warm.wx.store
  const token = store.get('zyd_token')
  const user = store.get('zyd_user')
  assert.ok(token && user, '前提：两格都还有值')
  assert.notEqual(subjectOf(token), String(user.id), '前提：盘上两格分属两个人')
  // FLOW1b：补签资格记的是最近一次**显式登录**的会员 id（这里是 B），过期后只恢复这一位。
  assert.equal(store.get('resignin_eligible'), 'B', '前提：补签资格仍在，且认的是最近一次显式登录的 B')
  return store
}

for (const failingKey of ['zyd_user', 'zyd_token']) {
  for (const mode of ['throw', 'silent']) {
    test(`冷启动[${failingKey}/${mode}]：撕裂的两格不得拼成一个会话`, async () => {
      const torn = tornStore(failingKey, mode)

      // 每次冷启动各用一份拷贝：第一次读就会 clearSession，会改动那份存储。
      const userFirst = createRuntime({ store: new Map(torn) })
      assert.equal(userFirst.auth.getUser(), null, 'getUser 先被调用时也必须关着')

      const cold = createRuntime({ store: new Map(torn) })
      assert.equal(cold.auth.getToken(), null)
      assert.equal(cold.auth.getUser(), null)
      assert.equal(cold.auth.isLoggedIn(), false)

      const pending = settle(cold.net.request('/member/print-orders'))
      await flush()
      assert.equal(authHeader(cold.wx.calls.request[0]), null, '不得带上任何一方的 token')
      cold.wx.calls.request[0].success({ statusCode: 401, data: {} })
      await flush()

      if (failingKey === 'zyd_user') {
        // FLOW1b（Codex 冷审）：资格认的是 B、本机资料还是 A —— 两边对不上，资格按不可恢复作废，
        // 不靠微信补签「自己修好」，用户再登录一次。宁可多一次登录，不可错认一个人。
        assert.equal(cold.wx.calls.login.length, 0, '对不上就不去 wx.login')
        assert.equal(cold.auth.canSilentResignin(), false)
        assert.equal(cold.auth.restorableMemberId(), null)
        assert.equal((await pending).ok, false)
        return
      }

      // 资格与本机资料都是 B（令牌那一格是旧的）：补签资格可信，能自己修好，补签写回成对的一份会话。
      assert.equal(cold.wx.calls.login.length, 1)
      cold.wx.calls.login[0].success({ code: 'CODE-COLD' })
      await flush()
      cold.resigninCalls()[0].success({ statusCode: 200, data: { token: TOKEN_B, user: USER_B } })
      await flush()
      const replay = cold.wx.calls.request.filter((c) => !c.url.includes('/wx-resignin'))[1]
      assert.ok(replay, '补签成功后要重放')
      assert.equal(authHeader(replay), `Bearer ${TOKEN_B}`)
      replay.success({ statusCode: 200, data: { data: { ok: 1 } } })
      assert.equal((await pending).ok, true)
      assert.equal(cold.auth.getUser().id, 'B', '修好之后两格是同一个人')
    })
  }
}

test('冷启动：只有 token、没有 user —— 证明不了是谁就不算登录', () => {
  const warm = createRuntime()
  loginAs(warm, TOKEN_A, USER_A)
  const store = new Map(warm.wx.store)
  store.delete('zyd_user')
  const cold = createRuntime({ store })
  assert.equal(cold.auth.getToken(), null)
  assert.equal(cold.auth.getUser(), null)
  assert.equal(cold.auth.isLoggedIn(), false)
})

test('冷启动：JWT 没有 sub —— 同样证明不了', () => {
  const warm = createRuntime()
  loginAs(warm, TOKEN_A, USER_A)
  const store = new Map(warm.wx.store)
  store.set('zyd_token', tokenWithoutSubject())
  const cold = createRuntime({ store })
  assert.equal(cold.auth.getToken(), null)
  assert.equal(cold.auth.getUser(), null)
})

test('冷启动：两格成对时照常恢复登录并带 token', async () => {
  const warm = createRuntime()
  loginAs(warm, TOKEN_A, USER_A)
  const cold = createRuntime({ store: new Map(warm.wx.store) })
  assert.equal(cold.auth.getToken(), TOKEN_A)
  assert.equal(cold.auth.getUser().id, 'A')
  assert.equal(cold.auth.isLoggedIn(), true)
  assert.equal(cold.auth.canSilentResignin(), true)

  const pending = settle(cold.net.request('/member/print-orders'))
  await flush()
  assert.equal(authHeader(cold.wx.calls.request[0]), `Bearer ${TOKEN_A}`)
  cold.wx.calls.request[0].success({ statusCode: 200, data: { data: { ok: 1 } } })
  assert.equal((await pending).ok, true)
})

test('撕裂 + 删除失败：每一次读都还是关着的', () => {
  const cold = createRuntime({ store: new Map(tornStore('zyd_user', 'silent')) })
  cold.wx.faults.remove = 'throw'
  assert.equal(cold.auth.getToken(), null)
  assert.equal(cold.auth.getUser(), null)
  assert.equal(cold.auth.getToken(), null, '清不掉不要紧：下一次读现算，仍然关着')
  assert.equal(cold.auth.isLoggedIn(), false)
})

// ── 登录页：会话没存下来就不是登录成功 ──────────────────────────────────────
// 这一段跑的是**真实页面 + 真实 auth**，只有 utils/api 是替身（它是网络边界，和 wx 同类）。
// 防的是：`auth.saveSession` 返回 false（写不进去 / 安静丢写）时页面照样提示「登录成功」
// 并跳走 —— 用户以为登录了，下一页当场 401。

/** utils/api 替身：登录请求什么时候成功由测试说了算。 */
function createApiStub() {
  const pending = {}
  const calls = { sync: 0, legal: 0 }
  const defer = (key) => (...args) => new Promise((resolve, reject) => { pending[key] = { resolve, reject, args } })
  return {
    pending,
    calls,
    loginByPhone: defer('loginByPhone'),
    loginBySms: defer('loginBySms'),
    sendOtp: defer('sendOtp'),
    // 登录页打开时先核对协议是否已发布（C4）；这里一律当作已发布，只测会话落盘。
    getLegalVersions: () => { calls.legal += 1; return Promise.resolve({ termsVersion: 'v1', privacyVersion: 'v1' }) },
    // 登录成功后对一次账（C6）。只数次数：没存下会话就不该对账。
    syncAiDeclarationsAfterLogin: () => { calls.sync += 1; return Promise.resolve() },
  }
}

async function runLaunchLogin({ entry, saveFault = null, opts }) {
  const ctx = createRuntime(opts)
  const api = createApiStub()
  const page = ctx.loadPage('pages/launch/launch.js', api)
  page.onLoad({})
  page.setData({ agreed: true })

  const key = entry === 'wx' ? 'loginByPhone' : 'loginBySms'
  if (entry === 'wx') {
    page.onGetPhoneNumber({ detail: { code: 'PHONE-CODE' } })
  } else {
    page.setData({ showSms: true, phone: '18300000001', code: '123456' })
    page.confirmSms()
  }
  assert.ok(api.pending[key], `${entry} 入口应当发出登录请求`)

  if (saveFault) ctx.wx.faults.set = saveFault
  api.pending[key].resolve({ token: TOKEN_A, user: USER_A })
  await flush()
  ctx.wx.faults.set = null
  return { ctx, page, api }
}

for (const entry of ['wx', 'sms']) {
  for (const mode of ['throw', 'silent']) {
    test(`[登录页/${entry}] 会话写失败(${mode})：不报成功、不跳转、仍未登录`, async () => {
      const { ctx, page, api } = await runLaunchLogin({ entry, saveFault: mode })
      assert.equal(api.calls.sync, 0, '会话没存下，不去对账声明')
      assert.ok(!ctx.wx.calls.toast.includes('登录成功'), '存不下会话时不得提示登录成功')
      assert.ok(ctx.wx.calls.toast.some((t) => t.includes('未能保存')), '要给出明确的失败文案')
      ctx.runTimers() // 即便有挂起的计时器，也不该把人跳走
      assert.equal(ctx.wx.calls.nav.length, 0, '不得跳转')
      assert.equal(ctx.auth.isLoggedIn(), false)
      assert.equal(ctx.auth.getToken(), null)
      assert.equal(ctx.auth.getUser(), null)
      assert.equal(ctx.auth.canSilentResignin(), false)
      if (entry === 'sms') assert.equal(page.data.submitting, false, '短信入口要放开再次提交')
    })
  }

  test(`[登录页/${entry}] 正常登录不回归：提示成功并跳转`, async () => {
    const { ctx, api } = await runLaunchLogin({ entry })
    assert.ok(ctx.wx.calls.toast.includes('登录成功'))
    assert.equal(api.calls.legal, 1, '打开登录页先核对协议是否已发布')
    assert.equal(api.calls.sync, 1, '登录成功后对一次账')
    assert.equal(ctx.auth.isLoggedIn(), true)
    assert.equal(ctx.auth.getToken(), TOKEN_A)
    assert.equal(ctx.auth.getUser().id, 'A')
    assert.equal(ctx.auth.canSilentResignin(), true)
    ctx.runTimers()
    assert.ok(ctx.wx.calls.nav.length >= 1, '成功后要跳转')
  })
}

// ── 反向变异：摘掉核心防护，上面的断言必须判红 ────────────────────────────

/** 在内存里改写某个 util 的源码；锚点失效会在这里当场报错（而不是静默不变异）。 */

const MUTATIONS = [
  {
    name: '补签保存时不再校验代际',
    build: () => mutator('auth', [['  if (isResignin && !isSameSession(expect)) return false;\n', '']]),
    scenario: (opts) => resigninSuccessLateAfterSwitch(TRANSPORTS[0], opts),
  },
  {
    name: '登出不推进代际',
    build: () => mutator('auth', [['  bumpSessionGeneration();\n  sessionRevoked = true;\n  // 先作废资格', '  sessionRevoked = true;\n  // 先作废资格']]),
    scenario: (opts) => logoutInvalidatesInflightWhenWritesAreLost(TRANSPORTS[0], opts),
  },
  {
    name: '代际改回落存储（写丢就推不动）',
    build: () => mutator('auth', [
      ['function sessionGeneration() {\n  return generation;\n}', "function sessionGeneration() {\n  const raw = Number(storage.get('zyd_session_gen', 0));\n  return Number.isFinite(raw) && raw > 0 ? raw : 0;\n}"],
      ['function isSameSession(expected) {\n  return generation === expected;\n}', 'function isSameSession(expected) {\n  return sessionGeneration() === expected;\n}'],
      ['function bumpSessionGeneration() {\n  generation += 1;\n  return generation;\n}', "function bumpSessionGeneration() {\n  const next = sessionGeneration() + 1;\n  storage.set('zyd_session_gen', next);\n  return next;\n}"],
    ]),
    scenario: (opts) => logoutInvalidatesInflightWhenWritesAreLost(TRANSPORTS[0], opts),
  },
  {
    name: '撤销位不管读接口',
    build: () => mutator('auth', [['if (sessionRevoked) return null;', 'if (false) return null;']]),
    scenario: async (opts) => {
      const ctx = createRuntime(opts)
      loginAs(ctx, TOKEN_A, USER_A)
      ctx.wx.faults.remove = 'throw'
      ctx.wx.faults.set = 'throw'
      ctx.auth.logout()
      ctx.wx.faults.remove = null
      ctx.wx.faults.set = null
      assertLoggedOut(ctx)
    },
  },
  {
    name: '新会话不做写完读回',
    build: () => mutator('auth', [[
      '  const usable = !!data.token && storage.get(storage.KEYS.TOKEN) === data.token\n    && (!data.user || sameJson(storage.get(storage.KEYS.USER, null), data.user))\n    && identityProven(data.token);',
      '  const usable = !!data.token;',
    ]]),
    scenario: async (opts) => {
      const ctx = createRuntime(opts)
      loginAs(ctx, TOKEN_A, USER_A)
      ctx.wx.faults.set = 'silent'
      assert.equal(ctx.auth.saveSession({ token: TOKEN_B, user: USER_B }), false)
      ctx.wx.faults.set = null
      assertLoggedOut(ctx)
    },
  },
  {
    name: '补签失败时无条件登出',
    build: () => mutator('auth', [['  if (!isSameSession(expected)) return false;\n  logout();', '  logout();']]),
    scenario: (opts) => resigninFailureLateAfterSwitch(TRANSPORTS[0], opts),
  },
  {
    name: '飞行清理不认自己那一次',
    build: () => mutator('request', [['const done = () => { if (resigninInflight === flight) resigninInflight = null; };', 'const done = () => { resigninInflight = null; };']]),
    scenario: (opts) => staleFlightMustNotClearNewFlight(TRANSPORTS[0], opts),
  },
  {
    name: '飞行不按代际绑定',
    build: () => mutator('request', [['if (resigninInflight && resigninInflight.generation === generation) return resigninInflight.promise;', 'if (resigninInflight) return resigninInflight.promise;']]),
    scenario: (opts) => staleFlightMustNotClearNewFlight(TRANSPORTS[0], opts),
  },
  {
    name: '重放前不再校验代际',
    build: () => mutator('request', [['if (!auth.isSameSession(generation)) throw err;\n        return raw', 'return raw']]),
    scenario: (opts) => switchBetweenResigninAndReplay(TRANSPORTS[0], opts),
  },
  {
    name: '401 准入不再校验代际',
    build: () => mutator('request', [['&& auth.isSameSession(generation);', '&& true;']]),
    scenario: (opts) => switchAccountBeforeInitial401(TRANSPORTS[0], opts),
  },
  {
    name: 'getToken 不再校验 token 与 user 是否同一个人',
    build: () => mutator('auth', [['if (isTokenExpired(token) || !identityProven(token)) {', 'if (isTokenExpired(token)) {']]),
    scenario: async (opts) => {
      const cold = createRuntime({ store: new Map(tornStore('zyd_user', 'silent')), ...opts })
      assert.equal(cold.auth.getToken(), null)
      assert.equal(cold.auth.isLoggedIn(), false)
    },
  },
  {
    name: 'getUser 不再校验 token 与 user 是否同一个人',
    build: () => mutator('auth', [['  if (!identityProven(storage.get(storage.KEYS.TOKEN))) {\n    clearSession();\n    return null;\n  }\n', '']]),
    scenario: async (opts) => {
      const cold = createRuntime({ store: new Map(tornStore('zyd_token', 'throw')), ...opts })
      assert.equal(cold.auth.getUser(), null)
    },
  },
  {
    name: '登录页忽略 saveSession 的返回值',
    build: () => mutator('pages/launch/launch.js', [[
      "        if (!saved) {\n          wx.showToast({ title: '登录状态未能保存，请重试', icon: 'none' })\n          this._say('登录状态没能保存，请重试', 'warn')\n          return\n        }\n",
      '',
    ]]),
    scenario: async (opts) => {
      const { ctx } = await runLaunchLogin({ entry: 'wx', saveFault: 'silent', opts })
      assert.ok(!ctx.wx.calls.toast.includes('登录成功'), '存不下会话时不得提示登录成功')
      ctx.runTimers()
      assert.equal(ctx.wx.calls.nav.length, 0, '不得跳转')
    },
  },
]

for (const mutation of MUTATIONS) {
  test(`变异[${mutation.name}]必须判红`, async () => {
    const mutate = mutation.build()
    await assert.rejects(() => mutation.scenario({ mutate }), assertionFailed)
  })
}

// ── FLOW1b：过期后只恢复同一位会员、网络问题不登出、只有主动退出才算退出 ─────────────
// 真跑 auth / request / storage；wx 是替身。令牌用负的有效期造「已过期」。

const EXPIRED_A = fakeToken('A', -60)
const RESIGN = (code, status = 401) => ({ statusCode: status, data: { error: { code, message: '服务端原话' } } })

/** 冷启动：盘上是一份过期的 A 会话（资格记着 A），就像用户 38 分钟后重新打开小程序。 */
function coldExpiredA(extra = {}) {
  const warm = createRuntime()
  assert.equal(loginAs(warm, TOKEN_A, USER_A), true)
  const store = new Map(warm.wx.store)
  store.set('zyd_token', EXPIRED_A)
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) store.delete(k)
    else store.set(k, v)
  }
  return createRuntime({ store })
}

test('FLOW1b 登录即记下会员 id；同一位续签不改它', async () => {
  const ctx = createRuntime()
  assert.equal(loginAs(ctx, TOKEN_A, USER_A), true)
  assert.equal(ctx.wx.store.get('resignin_eligible'), 'A')
  assert.equal(ctx.auth.restorableMemberId(), 'A')
})

test('FLOW1b 补签只认同一会员：短信登录的 B 不会被换成这个微信绑定的 A', async () => {
  const ctx = createRuntime()
  assert.equal(loginAs(ctx, TOKEN_B, USER_B), true)
  const pending = settle(ctx.net.request('/member/print-orders'))
  await flush()
  TRANSPORTS[0].reply(TRANSPORTS[0].calls(ctx)[0], 401, {})
  await flush()
  ctx.wx.calls.login[0].success({ code: 'CODE-1' })
  await flush()
  ctx.resigninCalls()[0].success({ statusCode: 200, data: { token: TOKEN_A2, user: USER_A } })
  await flush()
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'RESIGNIN_MEMBER_MISMATCH')
  assert.equal(TRANSPORTS[0].calls(ctx).length, 1, '不是同一位就不重放')
  assert.notEqual(ctx.wx.store.get('zyd_token'), TOKEN_A2, 'A 的令牌不得写入')
  assertLoggedOut(ctx)
})

for (const [label, fail] of [
  ['补签接口 503', (ctx) => ctx.resigninCalls()[0].success({ statusCode: 503, data: { error: { code: 'MEMBER_SESSION_STORE_UNAVAILABLE' } } })],
  ['补签接口限流 429', (ctx) => ctx.resigninCalls()[0].success({ statusCode: 429, data: { error: { code: 'RATE_LIMITED' } } })],
  ['补签请求断网', (ctx) => ctx.resigninCalls()[0].fail({ errMsg: 'request:fail timeout' })],
]) {
  test(`FLOW1b 临时失败不登出（${label}）：保留恢复资格，下一次请求就能恢复`, async () => {
    const ctx = createRuntime()
    loginAs(ctx, TOKEN_A, USER_A)
    const first = settle(ctx.net.request('/member/print-orders'))
    await flush()
    TRANSPORTS[0].reply(TRANSPORTS[0].calls(ctx)[0], 401, {})
    await flush()
    ctx.wx.calls.login[0].success({ code: 'CODE-1' })
    await flush()
    fail(ctx)
    await flush()
    const r1 = await first
    assert.equal(r1.ok, false)
    assert.equal(r1.error.code, 'SESSION_RESTORE_PENDING')
    assert.equal(r1.error.recoverable, true)
    assert.notEqual(r1.error.statusCode, 401, '不让页面当成「要重新登录」')
    assert.equal(ctx.auth.canSilentResignin(), true, '恢复资格保留')
    assert.equal(ctx.auth.restorableMemberId(), 'A')

    const second = settle(ctx.net.request('/member/print-orders'))
    await flush()
    TRANSPORTS[0].reply(TRANSPORTS[0].calls(ctx)[1], 401, {})
    await flush()
    ctx.wx.calls.login[1].success({ code: 'CODE-2' })
    await flush()
    ctx.resigninCalls()[1].success({ statusCode: 200, data: { token: TOKEN_A2, user: USER_A } })
    await flush()
    TRANSPORTS[0].reply(TRANSPORTS[0].calls(ctx)[2], 200, { data: { ok: 1 } })
    assert.equal((await second).ok, true, '网络恢复后同一位会员接着用')
    assert.equal(ctx.auth.getToken(), TOKEN_A2)
  })
}

test('FLOW1b 临时失败不登出（wx.login 失败）', async () => {
  const ctx = createRuntime()
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(ctx.net.request('/member/print-orders'))
  await flush()
  TRANSPORTS[0].reply(TRANSPORTS[0].calls(ctx)[0], 401, {})
  await flush()
  ctx.wx.calls.login[0].fail({ errMsg: 'login:fail' })
  await flush()
  const result = await pending
  assert.equal(result.error.code, 'SESSION_RESTORE_PENDING')
  assert.equal(ctx.auth.canSilentResignin(), true)
})

for (const code of ['MEMBER_NOT_BOUND', 'ACCOUNT_UNAVAILABLE']) {
  test(`FLOW1b 确定失败（补签回 ${code}）：本机登出并撤销恢复资格`, async () => {
    const ctx = createRuntime()
    loginAs(ctx, TOKEN_A, USER_A)
    const pending = settle(ctx.net.request('/member/print-orders'))
    await flush()
    TRANSPORTS[0].reply(TRANSPORTS[0].calls(ctx)[0], 401, {})
    await flush()
    ctx.wx.calls.login[0].success({ code: 'CODE-1' })
    await flush()
    ctx.resigninCalls()[0].success(RESIGN(code, code === 'ACCOUNT_UNAVAILABLE' ? 403 : 401))
    await flush()
    const result = await pending
    assert.equal(result.error.code, code)
    assertLoggedOut(ctx)
  })
}

test('FLOW1b 业务 401（二次验证码错）不补签、不登出', async () => {
  const ctx = createRuntime()
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(ctx.net.request('/member/step-up/verify'))
  await flush()
  TRANSPORTS[0].reply(TRANSPORTS[0].calls(ctx)[0], 401, { error: { code: 'STEP_UP_CODE_INVALID', message: '验证码不正确' } })
  await flush()
  const result = await pending
  assert.equal(result.error.code, 'STEP_UP_CODE_INVALID')
  assert.equal(ctx.wx.calls.login.length, 0, '不去 wx.login')
  assert.equal(ctx.auth.isLoggedIn(), true)
  assert.equal(ctx.auth.canSilentResignin(), true)
})

test('FLOW1b 守卫说账号不可用（401 ACCOUNT_UNAVAILABLE）：不补签，直接本机登出', async () => {
  const ctx = createRuntime()
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(ctx.net.request('/member/print-orders'))
  await flush()
  TRANSPORTS[0].reply(TRANSPORTS[0].calls(ctx)[0], 401, { error: { code: 'ACCOUNT_UNAVAILABLE', message: '账号不可用' } })
  await flush()
  await pending
  assert.equal(ctx.wx.calls.login.length, 0)
  assertLoggedOut(ctx)
})

test('FLOW1b 冷启动恢复：过期的 A → 只换 A 的新令牌，不发短信；恢复中不伪装成已登录', async () => {
  const ctx = coldExpiredA()
  const pending = ctx.net.restoreSession()
  await flush()
  assert.equal(ctx.auth.isLoggedIn(), false, '恢复进行中照旧是未登录')
  ctx.wx.calls.login[0].success({ code: 'CODE-COLD' })
  await flush()
  ctx.resigninCalls()[0].success({ statusCode: 200, data: { token: TOKEN_A2, user: USER_A } })
  assert.deepEqual({ ...(await pending) }, { state: 'ok' })
  assert.equal(ctx.auth.getToken(), TOKEN_A2)
  assert.equal(ctx.auth.getUser().id, 'A')
  assert.equal(ctx.wx.calls.request.filter((c) => /sms|login\b/.test(c.url) && !c.url.includes('wx-resignin')).length, 0, '没有短信或登录请求')
})

test('FLOW1b 冷启动恢复：临时失败 → recoverable，资格保留；确定失败 → need_login，资格撤销', async () => {
  const flaky = coldExpiredA()
  const p1 = flaky.net.restoreSession()
  await flush()
  flaky.wx.calls.login[0].success({ code: 'C1' })
  await flush()
  flaky.resigninCalls()[0].success({ statusCode: 502, data: { error: { code: 'WX_CODE2SESSION_FAILED' } } })
  assert.equal((await p1).state, 'recoverable')
  assert.equal(flaky.auth.canSilentResignin(), true)

  const unbound = coldExpiredA()
  const p2 = unbound.net.restoreSession()
  await flush()
  unbound.wx.calls.login[0].success({ code: 'C2' })
  await flush()
  unbound.resigninCalls()[0].success(RESIGN('MEMBER_NOT_BOUND'))
  assert.equal((await p2).state, 'need_login')
  assert.equal(unbound.auth.canSilentResignin(), false)
  assert.equal(unbound.wx.store.has('resignin_eligible'), false)
})

test('FLOW1b 主动退出后重开：不恢复、不去 wx.login', async () => {
  const warm = createRuntime()
  loginAs(warm, TOKEN_A, USER_A)
  warm.auth.logout()
  const cold = createRuntime({ store: new Map(warm.wx.store) })
  assert.deepEqual({ ...(await cold.net.restoreSession()) }, { state: 'need_login' })
  assert.equal(cold.wx.calls.login.length, 0)
})

test('FLOW1b 旧版本资格「1」：本机资料还在就迁成会员 id 并恢复；资料不在就不恢复并删掉旧值', async () => {
  const legacy = coldExpiredA({ resignin_eligible: 1 })
  const p = legacy.net.restoreSession()
  assert.equal(legacy.wx.store.get('resignin_eligible'), 'A', '迁成会员 id')
  await flush()
  legacy.wx.calls.login[0].success({ code: 'C' })
  await flush()
  legacy.resigninCalls()[0].success({ statusCode: 200, data: { token: TOKEN_A2, user: USER_A } })
  assert.equal((await p).state, 'ok')

  const orphan = coldExpiredA({ resignin_eligible: 1, zyd_user: undefined })
  assert.equal((await orphan.net.restoreSession()).state, 'need_login')
  assert.equal(orphan.wx.calls.login.length, 0)
  assert.equal(orphan.wx.store.has('resignin_eligible'), false)
})

test('FLOW1b 并发 401：三个请求只补签一次，全部用新令牌重放', async () => {
  const ctx = createRuntime()
  loginAs(ctx, TOKEN_A, USER_A)
  const all = [1, 2, 3].map(() => settle(ctx.net.request('/member/print-orders')))
  await flush()
  TRANSPORTS[0].calls(ctx).slice(0, 3).forEach((c) => TRANSPORTS[0].reply(c, 401, {}))
  await flush()
  assert.equal(ctx.wx.calls.login.length, 1)
  ctx.wx.calls.login[0].success({ code: 'C' })
  await flush()
  ctx.resigninCalls()[0].success({ statusCode: 200, data: { token: TOKEN_A2, user: USER_A } })
  await flush()
  const replays = TRANSPORTS[0].calls(ctx).slice(3)
  assert.equal(replays.length, 3)
  replays.forEach((c) => { assert.equal(authHeader(c), `Bearer ${TOKEN_A2}`); TRANSPORTS[0].reply(c, 200, { data: { ok: 1 } }) })
  for (const r of await Promise.all(all)) assert.equal(r.ok, true)
})

// ── FLOW1b 负向：恢复资格与最后一次显式登录必须一致（Codex 冷审 P1），以及各防护的反向变异 ────────

/** 资格既写不进也删不掉：登录 B 不成立，盘上不会出现「会话是 B、资格还是 A」。 */
async function staleEligibilityCannotSurvive(opts) {
  const ctx = createRuntime(opts)
  assert.equal(loginAs(ctx, TOKEN_A, USER_A), true)
  ctx.wx.faults.key = 'resignin_eligible'
  ctx.wx.faults.keyMode = 'silent'
  ctx.wx.faults.remove = 'silent'
  const savedB = ctx.auth.saveSession({ token: TOKEN_B, user: USER_B })
  ctx.wx.faults.key = null
  ctx.wx.faults.keyMode = null
  ctx.wx.faults.remove = null
  assert.equal(savedB, false, '资格确认不了就不能报登录成功')
  const disk = ctx.wx.store
  const diskUser = disk.get('zyd_user')
  const diskEligible = disk.get('resignin_eligible')
  assert.ok(!(diskUser && String(diskUser.id) === 'B' && diskEligible === 'A'), '盘上不得出现会话 B + 资格 A')
  const cold = createRuntime({ store: new Map(disk) })
  const coldUser = cold.auth.getUser()
  const coldMember = cold.auth.restorableMemberId()
  assert.ok(!coldMember || (coldUser && String(coldUser.id) === coldMember), '冷启动后能恢复的只能是本机当前那一位')
}

/** 资格写不进、但能删掉：登录 B 照常成立，过期后不自动恢复（宁可再登录一次也不认错人）。 */
async function eligibilityRemovedWhenNotWritable(opts) {
  const ctx = createRuntime(opts)
  assert.equal(loginAs(ctx, TOKEN_A, USER_A), true)
  ctx.wx.faults.key = 'resignin_eligible'
  ctx.wx.faults.keyMode = 'silent'
  assert.equal(ctx.auth.saveSession({ token: TOKEN_B, user: USER_B }), true)
  ctx.wx.faults.key = null
  ctx.wx.faults.keyMode = null
  assert.equal(ctx.auth.getUser().id, 'B')
  assert.equal(ctx.wx.store.has('resignin_eligible'), false, '旧的 A 资格必须删掉')
  assert.equal(ctx.auth.restorableMemberId(), null)
}

/** 一致性核对：本机资料是 B、资格却是 A（撕裂或旧版本残留）→ 不恢复，也不去 wx.login。 */
async function mismatchedEligibilityIsNotRestorable(opts) {
  const store = new Map([['zyd_token', fakeToken('B', -60)], ['zyd_user', USER_B], ['resignin_eligible', 'A']])
  const ctx = createRuntime({ store, ...opts })
  assert.equal(ctx.auth.restorableMemberId(), null)
  assert.equal((await ctx.net.restoreSession()).state, 'need_login')
  assert.equal(ctx.wx.calls.login.length, 0)
}

/** 补签回来的不是上次那一位：不写入、不重放。 */
async function resigninMustMatchMember(opts) {
  const ctx = createRuntime(opts)
  assert.equal(loginAs(ctx, TOKEN_B, USER_B), true)
  const pending = settle(ctx.net.request('/member/print-orders'))
  await flush()
  TRANSPORTS[0].reply(TRANSPORTS[0].calls(ctx)[0], 401, {})
  await flush()
  ctx.wx.calls.login[0].success({ code: 'CODE-1' })
  await flush()
  ctx.resigninCalls()[0].success({ statusCode: 200, data: { token: TOKEN_A2, user: USER_A } })
  await flush()
  await pending
  assert.notEqual(ctx.wx.store.get('zyd_token'), TOKEN_A2, 'A 的令牌不得写入')
  assert.equal(TRANSPORTS[0].calls(ctx).length, 1, '不得重放')
}

/** 补签临时失败（503）：不登出、资格保留。 */
async function transientFailureKeepsSession(opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(ctx.net.request('/member/print-orders'))
  await flush()
  TRANSPORTS[0].reply(TRANSPORTS[0].calls(ctx)[0], 401, {})
  await flush()
  ctx.wx.calls.login[0].success({ code: 'CODE-1' })
  await flush()
  ctx.resigninCalls()[0].success({ statusCode: 503, data: { error: { code: 'MEMBER_SESSION_STORE_UNAVAILABLE' } } })
  await flush()
  await pending
  assert.equal(ctx.auth.canSilentResignin(), true, '临时失败不撤销恢复资格')
}

/** 业务 401（二次验证码错）：不补签、不登出。 */
async function business401DoesNotResign(opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx, TOKEN_A, USER_A)
  const pending = settle(ctx.net.request('/member/step-up/verify'))
  await flush()
  TRANSPORTS[0].reply(TRANSPORTS[0].calls(ctx)[0], 401, { error: { code: 'STEP_UP_CODE_INVALID', message: '验证码不正确' } })
  await flush()
  await pending
  assert.equal(ctx.wx.calls.login.length, 0, '业务 401 不去 wx.login')
}

test('FLOW1b 资格写不进也删不掉：登录 B 不成立，冷启动后能恢复的只能是本机当前那一位', () => staleEligibilityCannotSurvive())
test('FLOW1b 资格写不进但能删掉：登录 B 成立，旧的 A 资格删掉，过期后不自动恢复', () => eligibilityRemovedWhenNotWritable())
test('FLOW1b 一致性核对：本机资料是 B、资格是 A 时不恢复', () => mismatchedEligibilityIsNotRestorable())

/** Codex 给的实际调用顺序：资格 A、本机资料 B、令牌是过期的 B。先认人、再查令牌、再认人，前后都不能认出 A。 */
async function inconsistentEligibilityStaysDead({ removeFault = null, setFault = null } = {}, opts) {
  const store = new Map([['zyd_token', fakeToken('B', -60)], ['zyd_user', USER_B], ['resignin_eligible', 'A']])
  const ctx = createRuntime({ store, ...opts })
  ctx.wx.faults.remove = removeFault
  if (setFault) { ctx.wx.faults.key = 'resignin_eligible'; ctx.wx.faults.keyMode = setFault }
  const before = ctx.auth.restorableMemberId()
  const token = ctx.auth.getToken()
  const after = ctx.auth.restorableMemberId()
  assert.deepEqual({ before, token, after }, { before: null, token: null, after: null }, '同一次运行里第二次读也复活不了 A')
  assert.equal(ctx.auth.canSilentResignin(), false)
  ctx.wx.faults.remove = null
  ctx.wx.faults.key = null
  ctx.wx.faults.keyMode = null
  // 冷启动：删不掉时要么写了作废标记，要么本机资料还在（删除被 removeUserUnlessLastEvidence 拦下），都能再认出不一致。
  const cold = createRuntime({ store: new Map(ctx.wx.store) })
  assert.equal(cold.auth.restorableMemberId(), null, '冷启动后也不能恢复成 A')
  assert.equal((await cold.net.restoreSession()).state, 'need_login')
  assert.equal(cold.wx.calls.login.length, 0)
}

/** 反过来的顺序：先查令牌（会清掉本机资料），再认人——清资料前必须先对账。 */
async function tokenFirstOrderCannotRevive(opts) {
  const store = new Map([['zyd_token', fakeToken('B', -60)], ['zyd_user', USER_B], ['resignin_eligible', 'A']])
  const ctx = createRuntime({ store, ...opts })
  assert.equal(ctx.auth.getToken(), null)
  assert.equal(ctx.auth.restorableMemberId(), null, '清掉资料后再认人也不能认出 A')
  assert.equal(ctx.wx.store.has('resignin_eligible'), false, '不一致的资格要删掉')
}

test('FLOW1b 不一致资格：先认人 → 查令牌 → 再认人，前后都认不出 A（Codex 给的调用顺序）', () => inconsistentEligibilityStaysDead())
test('FLOW1b 不一致资格：删不掉时写作废标记，本次运行和冷启动都复活不了', () => inconsistentEligibilityStaysDead({ removeFault: 'silent' }))
test('FLOW1b 不一致资格：所有格都删不掉、资格也写不进作废标记时，本次运行和冷启动都复活不了（只坏资格一格的情形见 flow1b-storage-faults）', () => inconsistentEligibilityStaysDead({ removeFault: 'silent', setFault: 'silent' }))
test('FLOW1b 不一致资格：先查令牌再认人，清资料前已对账', () => tokenFirstOrderCannotRevive())

const FLOW1B_MUTATIONS = [
  {
    name: '显式登录不先确认恢复资格就写新会话',
    build: () => mutator('auth', [['    if (!recordRestorableMember(data.user)) return false;\n', '    recordRestorableMember(data.user);\n']]),
    scenario: staleEligibilityCannotSurvive,
  },
  {
    name: '记不下资格时不作废旧资格',
    build: () => mutator('auth', [['    }\n  }\n  return revokeEligibility();\n}', '    }\n  }\n  return true;\n}']]),
    scenario: eligibilityRemovedWhenNotWritable,
  },
  {
    name: '恢复资格不核对本机资料',
    build: () => mutator('auth', [['  if (userId && userId !== member) return { id: null, mismatch: true, legacy };\n', '']]),
    scenario: mismatchedEligibilityIsNotRestorable,
  },
  // 「作废位不挡第二次读取」「清资料前不对账」两条移到 flow1b-storage-faults.test.mjs：
  // 本机资料的删除改由 removeUserUnlessLastEvidence 把关后，这里原来的场景测不出它们（等价变异），换成能测出的场景。
  {
    name: '补签不核对回来的是不是同一位会员',
    build: () => mutator('request', [["      if (memberId !== expected) throw makeError('登录已过期，请重新登录', 401, 'RESIGNIN_MEMBER_MISMATCH');\n", '']]),
    scenario: resigninMustMatchMember,
  },
  {
    name: '临时失败也登出',
    build: () => mutator('request', [['  if (!auth.isSameSession(generation)) return err;\n  return recoverableSessionError();', '  auth.logoutIfSameSession(generation);\n  return recoverableSessionError();']]),
    scenario: transientFailureKeepsSession,
  },
  {
    name: '业务 401 也去补签',
    build: () => mutator('request', [['      && isSession401(err)\n      && auth.canSilentResignin()\n      // 出发时', '      && auth.canSilentResignin()\n      // 出发时']]),
    scenario: business401DoesNotResign,
  },
]

for (const mutation of FLOW1B_MUTATIONS) {
  test(`变异[FLOW1b·${mutation.name}]必须判红`, async () => {
    const mutate = mutation.build()
    await assert.rejects(() => mutation.scenario({ mutate }), assertionFailed)
  })
}
