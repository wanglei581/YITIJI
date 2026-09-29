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
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const UTILS = path.join(MINIAPP, 'utils')

/** 跑完所有已排队的微任务（回调都挂在 Promise 上）。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * 不用 try/catch 包断言：拿到结果再判，避免把断言失败当成业务 reject。
 * 带看门狗：防护被变异摘掉后请求可能永远不落地（比如被拿去补签却没人喂 wx.login），
 * 没有它，变异用例会挂在事件循环上而不是判红。
 */
async function settle(promise, timeoutMs = 300) {
  let timer = null
  const watchdog = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: { statusCode: 'TIMEOUT' } }), timeoutMs)
  })
  const settled = promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
  const result = await Promise.race([settled, watchdog])
  clearTimeout(timer)
  return result
}

function fakeToken(sub, ttlSeconds = 3600) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, exp })}.sig`
}

/** 没有 sub 的 JWT：证明不了持有者是谁。 */
function tokenWithoutSubject(ttlSeconds = 3600) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ exp: Math.floor(Date.now() / 1000) + ttlSeconds })}.sig`
}

// sub 必须等于 user.id —— 后端 member-auth.service.ts 按 user.id 签 sub。
// 补签拿到的是同一个人的新 token，所以只换 exp 不换 sub。
const TOKEN_A = fakeToken('A')
const TOKEN_A2 = fakeToken('A', 7200)
const TOKEN_B = fakeToken('B')
const TOKEN_B2 = fakeToken('B', 7200)
const USER_A = { id: 'A', maskedPhone: '183****0001' }
const USER_B = { id: 'B', maskedPhone: '183****0002' }

// ── wx 替身 ────────────────────────────────────────────────────────────────
// faults.set / faults.remove:
//   'throw'  → 接口抛异常（storage.js 会捕获）
//   'silent' → 不抛，但什么也没写/没删（**返回值盖不住的那一种**）

function createWx(seed) {
  // seed = 冷启动：换一个进程，但盘上的内容原样还在。
  const store = seed instanceof Map ? seed : new Map()
  // faults.key/keyMode 只让**某一格**写失败 —— 换号时的 torn write 就是这个形状。
  const faults = { set: null, remove: null, key: null, keyMode: null }
  const calls = { login: [], request: [], upload: [], toast: [], nav: [], loading: [] }
  const clone = (v) => {
    try {
      return JSON.parse(JSON.stringify(v))
    } catch (_) {
      return v
    }
  }
  return {
    store,
    faults,
    calls,
    getStorageSync(key) {
      return store.has(key) ? store.get(key) : ''
    },
    setStorageSync(key, value) {
      const mode = faults.key === key ? faults.keyMode : faults.set
      if (mode === 'throw') throw new Error('setStorageSync failed')
      if (mode === 'silent') return
      store.set(key, clone(value))
    },
    removeStorageSync(key) {
      if (faults.remove === 'throw') throw new Error('removeStorageSync failed')
      if (faults.remove === 'silent') return
      store.delete(key)
    },
    login(opts) { calls.login.push(opts) },
    request(opts) { calls.request.push(opts) },
    uploadFile(opts) { calls.upload.push(opts) },
    getAccountInfoSync() { return { miniProgram: { envVersion: 'release' } } },
    // 页面用到的那几个：跳转一律只记录，不真的走。
    showToast(opts) { calls.toast.push((opts && opts.title) || '') },
    showLoading(opts) { calls.loading.push(['show', (opts && opts.title) || '']) },
    hideLoading() { calls.loading.push(['hide', '']) },
    switchTab(opts) { calls.nav.push(['switchTab', opts && opts.url]) },
    redirectTo(opts) { calls.nav.push(['redirectTo', opts && opts.url]) },
    navigateTo(opts) { calls.nav.push(['navigateTo', opts && opts.url]) },
    navigateBack() { calls.nav.push(['navigateBack', '']) },
    getWindowInfo() { return { statusBarHeight: 20 } },
  }
}

/**
 * 真实模块装进一个只有 wx 替身的沙箱。
 * mutate(name, source) 可在**内存里**改写源码（磁盘上的生产源不动）。
 */
function createRuntime({ mutate, store } = {}) {
  const wx = createWx(store)
  // 计时器由测试自己推进：launch.js 的「登录成功 → 600ms 后跳转」不能真等。
  // （vm 的新 realm 本来就没有 setTimeout，必须注入。）
  const timers = []
  const sandbox = {
    wx,
    console,
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => {},
    setInterval: (fn) => timers.push(fn),
    clearInterval: () => {},
    getApp: () => ({ globalData: { statusBarHeight: 20 } }),
    getCurrentPages: () => [{ route: 'pages/launch/launch' }],
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)

  const cache = new Map()
  const load = (name) => {
    if (cache.has(name)) return cache.get(name).exports
    const file = path.join(UTILS, `${name}.js`)
    let source = fs.readFileSync(file, 'utf8')
    if (mutate) source = mutate(name, source)
    const mod = { exports: {} }
    cache.set(name, mod)
    const compiled = vm.compileFunction(source, ['module', 'exports', 'require'], {
      parsingContext: sandbox,
      filename: file,
    })
    compiled(mod, mod.exports, (spec) => load(String(spec).replace(/^\.\//, '').replace(/\.js$/, '')))
    return mod.exports
  }

  const ctx = { wx, storage: load('storage'), auth: load('auth'), net: load('request') }
  ctx.resigninCalls = () => wx.calls.request.filter((c) => c.url.includes('/wx-resignin'))
  ctx.runTimers = () => { timers.splice(0).forEach((fn) => fn()) }

  /**
   * 真跑一个页面：Page 配置由沙箱捕获后实例化成带 setData 的对象。
   * utils/auth 用的是上面那一份**真实**实例（页面与请求层共享同一个会话），
   * 只有 utils/api 是替身 —— 它是网络边界，和 wx 同类。
   */
  ctx.loadPage = (relPath, apiStub) => {
    const file = path.join(MINIAPP, relPath)
    let source = fs.readFileSync(file, 'utf8')
    if (mutate) source = mutate(relPath, source)
    let config = null
    sandbox.Page = (cfg) => { config = cfg }
    const compiled = vm.compileFunction(source, ['module', 'exports', 'require'], {
      parsingContext: sandbox,
      filename: file,
    })
    compiled({ exports: {} }, {}, (spec) => {
      const name = String(spec).replace(/^(\.\.\/)+utils\//, '').replace(/\.js$/, '')
      return name === 'api' ? apiStub : load(name)
    })
    assert.ok(config, `页面没有调用 Page()：${relPath}`)
    const page = Object.assign({}, config)
    page.data = JSON.parse(JSON.stringify(config.data))
    page.setData = function setData(patch) { Object.assign(this.data, patch) }
    return page
  }

  return ctx
}

const authHeader = (call) => (call && call.header && call.header.Authorization) || null

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
  ctx.resigninCalls()[0].success({ statusCode: 401, data: {} })
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

/** 补签回来了但落不了盘：存不下的会话等于没有会话，按补签失败处理。 */
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
  assert.equal(result.error.statusCode, 401)
  assert.equal(tr.calls(ctx).length, 1, '没存下新 token 就不该拿旧 token 去重放')
  assertLoggedOut(ctx)
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
    test(`[${tr.name}] 补签保存失败(${mode})：按补签失败处理`, () => resigninSaveFailureIsFailure(tr, mode))
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
  assert.equal(store.get('resignin_eligible'), 1, '前提：补签资格仍在')
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

      // 补签资格还在，所以能自己修好：补签写回成对的一份会话。
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
  const defer = (key) => (...args) => new Promise((resolve, reject) => { pending[key] = { resolve, reject, args } })
  return { pending, loginByPhone: defer('loginByPhone'), loginBySms: defer('loginBySms'), sendOtp: defer('sendOtp') }
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
  return { ctx, page }
}

for (const entry of ['wx', 'sms']) {
  for (const mode of ['throw', 'silent']) {
    test(`[登录页/${entry}] 会话写失败(${mode})：不报成功、不跳转、仍未登录`, async () => {
      const { ctx, page } = await runLaunchLogin({ entry, saveFault: mode })
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
    const { ctx } = await runLaunchLogin({ entry })
    assert.ok(ctx.wx.calls.toast.includes('登录成功'))
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
function mutator(target, pairs) {
  const file = target.includes('/') ? path.join(MINIAPP, target) : path.join(UTILS, `${target}.js`)
  const source = fs.readFileSync(file, 'utf8')
  for (const [from] of pairs) {
    assert.ok(source.includes(from), `变异锚点已失效（${target}）：${from.slice(0, 60)}`)
  }
  return (name, src) => {
    if (name !== target) return src
    let out = src
    for (const [from, to] of pairs) out = out.split(from).join(to)
    return out
  }
}

/** 变异必须让**断言**失败（ERR_ASSERTION），而不是把代码改崩。 */
const assertionFailed = (err) => err && err.code === 'ERR_ASSERTION'

const MUTATIONS = [
  {
    name: '补签保存时不再校验代际',
    build: () => mutator('auth', [['  if (isResignin && !isSameSession(expect)) return false;\n', '']]),
    scenario: (opts) => resigninSuccessLateAfterSwitch(TRANSPORTS[0], opts),
  },
  {
    name: '登出不推进代际',
    build: () => mutator('auth', [['  bumpSessionGeneration();\n  sessionRevoked = true;\n  clearSession();', '  sessionRevoked = true;\n  clearSession();']]),
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
      "        if (!saved) {\n          wx.showToast({ title: '登录状态未能保存，请重试', icon: 'none' })\n          return\n        }\n",
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
