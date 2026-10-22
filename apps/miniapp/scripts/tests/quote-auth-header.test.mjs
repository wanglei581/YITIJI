/**
 * S4：两处打印报价带上已有会员令牌，并确认短信登录的同设备恢复不因此回归。
 *
 * 真实 utils/api.js、request.js、auth.js、storage.js 在 node:vm 里跑（session-runtime）。
 * 只替 wx 的存储和 wx.request。不替换 getToken、saveSession、logout，也不替换 request.js 的补签。
 * 本文件把报价回复成 200，只为看客户端请求头，以及 200 的报价会不会自己去补签或跳登录。
 * 这不证明服务端 POST /orders/quote 不回 401；那一项由 S3 的控制器门禁另验。
 * flow1b-restore-pages 路由表里报价那格的 false 只是那支页面桩，不作为这里的证据。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  flush,
  fakeToken,
  TOKEN_A,
  TOKEN_A2,
  USER_A,
  createRuntime,
  authHeader,
  mutator,
  assertionFailed,
} from './session-runtime.mjs'

const EXPIRED_A = fakeToken('A', -60)
const R_A1 = `${'a'.repeat(22)}.${'1'.repeat(43)}`
const R_A2 = `${'a'.repeat(22)}.${'2'.repeat(43)}`
const PRESET = 'https://files.example.invalid/signed/preset'
const PRINT_URL = 'https://files.example.invalid/signed/f-5c2e'
const PARAMS = { colorMode: 'black_white', duplex: 'simplex', copies: 1, paperSize: 'A4' }
const QUOTE = { amountCents: 0, billablePages: 1 }
const ELIGIBLE = 'resignin_eligible'
const TOKEN_KEY = 'zyd_token'
const USER_KEY = 'zyd_user'
const RESTORE_KEY = 'zyd_restore'

const pathOf = (call) => call.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1/, '').split('?')[0]
const quotePosts = (ctx) => ctx.wx.calls.request.filter((c) => (c.method || 'GET') === 'POST' && pathOf(c) === '/orders/quote')
const restoreCalls = (ctx) => ctx.wx.calls.request.filter((c) => pathOf(c) === '/member/auth/restore')

function assertNoSms(ctx) {
  const hits = ctx.wx.calls.request
    .map((c) => c.url)
    .filter((url) => /\/member\/auth\/sms-code|\/member\/auth\/login(?:\?|$)|\/step-up\/sms-code/.test(url))
  assert.deepEqual(hits, [], '不得发短信或走短信登录')
  assert.equal(ctx.wx.calls.login.length, 0, '不得走 wx.login')
}

function assertNoLoginJump(ctx) {
  assert.deepEqual(ctx.wx.calls.nav, [], '报价和补签都不得跳登录页')
}

function okData(call, data) {
  call.success({ statusCode: 200, data: { success: true, data } })
}

function session401(call) {
  call.success({ statusCode: 401, data: { error: { code: 'MEMBER_SESSION_EXPIRED', message: '登录已失效' } } })
}

function createResponder(ctx) {
  const seen = new WeakSet()
  return {
    async drain(handle) {
      for (let i = 0; i < 30; i += 1) {
        await flush()
        let n = 0
        for (const call of ctx.wx.calls.request) {
          if (seen.has(call)) continue
          seen.add(call)
          n += 1
          handle(call)
        }
        if (n === 0) return
      }
      throw new Error('请求没有停')
    },
  }
}

function track(promise) {
  const box = { state: 'pending', value: null, error: null }
  promise.then((value) => {
    box.state = 'ok'
    box.value = value
  }, (error) => {
    box.state = 'err'
    box.error = error
  })
  return box
}

/** 登录过、盘上只剩过期令牌。不调用 getToken，避免在报价之前先把令牌清掉。 */
function expiredDisk() {
  const warm = createRuntime()
  assert.equal(warm.auth.saveSession({ token: TOKEN_A, user: USER_A, restoreToken: R_A1 }), true)
  const disk = new Map(warm.wx.store)
  disk.set(TOKEN_KEY, EXPIRED_A)
  return disk
}

async function loggedInHeaders(mutate) {
  const ctx = createRuntime({ mutate })
  assert.equal(ctx.auth.saveSession({ token: TOKEN_A, user: USER_A, restoreToken: R_A1 }), true)
  const api = ctx.load('api')
  const server = createResponder(ctx)
  const mine = track(api.quoteMyPrintOrder('file-ignored', PARAMS, PRESET, { terminalId: 'KSK-001' }))
  const minePost = quotePosts(ctx)
  assert.equal(minePost.length, 1, '预设地址路径只发报价，不先换 preview-url')
  assert.equal(authHeader(minePost[0]), `Bearer ${TOKEN_A}`)
  assert.equal(minePost[0].data.fileUrl, PRESET)
  await flush()
  assert.equal(mine.state, 'pending', '服务端未回之前，客户端不得自行结束')
  await server.drain((call) => {
    assert.equal(pathOf(call), '/orders/quote')
    okData(call, QUOTE)
  })
  assert.equal(mine.state, 'ok')
  assert.equal(mine.value.amountCents, 0)

  const pack = track(api.quotePackageOrder({
    terminalId: 'KSK-001',
    files: [{ fileId: 'f-5c2e' }],
    params: PARAMS,
  }))
  await flush()
  const preview = ctx.wx.calls.request.filter((c) => pathOf(c) === '/files/f-5c2e/preview-url')
  assert.equal(preview.length, 1)
  assert.equal(authHeader(preview[0]), `Bearer ${TOKEN_A}`)
  assert.equal(quotePosts(ctx).length, 1, '材料包要等 preview-url 回来才报价')
  okData(preview[0], { printFileUrl: PRINT_URL })
  await flush()
  const packPost = quotePosts(ctx)
  assert.equal(packPost.length, 2)
  assert.equal(authHeader(packPost[1]), `Bearer ${TOKEN_A}`)
  assert.equal(packPost[1].data.lines[0].fileUrl, PRINT_URL)
  assert.equal(pack.state, 'pending')
  okData(packPost[1], QUOTE)
  await flush()
  assert.equal(pack.state, 'ok')
  assert.equal(restoreCalls(ctx).length, 0)
  assertNoSms(ctx)
  assertNoLoginJump(ctx)
}

test('已登录：两处 POST /orders/quote 都带 saveSession 写入的 Bearer', () => loggedInHeaders())

test('反向：两处报价改回 needAuth:false 时，已登录请求不再带 Bearer', async () => {
  const mutate = mutator('api', [
    [
      'data: terminalId ? { fileUrl, params, terminalId } : { fileUrl, params },\n      // 本地有未过期令牌才附 Bearer；没有或已过期则不带头照发，不在这里跳登录。\n      needAuth: true,',
      'data: terminalId ? { fileUrl, params, terminalId } : { fileUrl, params },\n      needAuth: false,',
    ],
    [
      'data: { terminalId, lines, params },\n      // 与 quoteMyPrintOrder 相同：有令牌就带上，没有也照发。\n      needAuth: true,',
      'data: { terminalId, lines, params },\n      needAuth: false,',
    ],
  ])
  await assert.rejects(loggedInHeaders(mutate), assertionFailed)
})

test('未登录：两处报价都不带头，请求照发，不补签、不跳登录', async () => {
  const ctx = createRuntime()
  const api = ctx.load('api')
  const mine = track(api.quoteMyPrintOrder('file-ignored', PARAMS, PRESET, { terminalId: 'KSK-001' }))
  const minePost = quotePosts(ctx)
  assert.equal(minePost.length, 1)
  assert.equal(authHeader(minePost[0]), null)
  await flush()
  assert.equal(mine.state, 'pending')
  okData(minePost[0], QUOTE)
  await flush()
  assert.equal(mine.state, 'ok')

  const pack = track(api.quotePackageOrder({
    terminalId: 'KSK-001',
    files: [{ fileId: 'f-5c2e' }],
    params: PARAMS,
  }))
  await flush()
  const preview = ctx.wx.calls.request.filter((c) => pathOf(c) === '/files/f-5c2e/preview-url')
  assert.equal(preview.length, 1)
  assert.equal(authHeader(preview[0]), null)
  okData(preview[0], { printFileUrl: PRINT_URL })
  await flush()
  const packPost = quotePosts(ctx)[1]
  assert.ok(packPost)
  assert.equal(authHeader(packPost), null)
  assert.equal(pack.state, 'pending')
  okData(packPost, QUOTE)
  await flush()
  assert.equal(pack.state, 'ok')
  assert.equal(restoreCalls(ctx).length, 0)
  assertNoSms(ctx)
  assertNoLoginJump(ctx)
})

test('预设文件地址：过期令牌由报价第一次 getToken 清掉，资格和恢复凭证还在；随后 401 用原凭证恢复同一账号，主动退出后不再恢复', async () => {
  const ctx = createRuntime({ store: expiredDisk() })
  assert.equal(ctx.wx.store.get(TOKEN_KEY), EXPIRED_A)
  assert.equal(ctx.wx.store.get(USER_KEY).id, 'A')
  assert.equal(ctx.wx.store.get(ELIGIBLE), 'A')
  assert.deepEqual({ ...ctx.wx.store.get(RESTORE_KEY) }, { memberId: 'A', token: R_A1 })
  const api = ctx.load('api')
  const server = createResponder(ctx)

  const quote = track(api.quoteMyPrintOrder('must-not-preview', PARAMS, PRESET, { terminalId: 'KSK-001' }))
  assert.equal(ctx.wx.store.has(TOKEN_KEY), false, '过期令牌被清掉')
  assert.equal(ctx.wx.store.has(USER_KEY), false, '本机资料被清掉')
  assert.equal(ctx.wx.store.get(ELIGIBLE), 'A', '恢复资格还在，这不是登出')
  assert.deepEqual({ ...ctx.wx.store.get(RESTORE_KEY) }, { memberId: 'A', token: R_A1 })
  assert.equal(ctx.auth.canSilentResignin(), true)
  assert.equal(ctx.auth.restorableMemberId(), 'A')
  const post = quotePosts(ctx)
  assert.equal(post.length, 1)
  assert.equal(authHeader(post[0]), null, '过期令牌不得带出去')
  assert.equal(post[0].data.fileUrl, PRESET)
  assert.equal(ctx.wx.calls.request.filter((c) => pathOf(c).includes('/preview-url')).length, 0)
  await server.drain((call) => {
    assert.equal(pathOf(call), '/orders/quote')
    okData(call, QUOTE)
  })
  assert.equal(quote.state, 'ok', '报价可以完成')
  await server.drain(() => { throw new Error('报价完成后不得再发请求') })
  assert.equal(restoreCalls(ctx).length, 0, '报价本身不调用恢复')
  assertNoSms(ctx)
  assertNoLoginJump(ctx)

  const me = track(api.getMe())
  let meRound = 0
  await server.drain((call) => {
    const p = pathOf(call)
    if (p === '/member/me' && meRound === 0) {
      meRound += 1
      assert.equal(authHeader(call), null)
      session401(call)
      return
    }
    if (p === '/member/auth/restore') {
      assert.equal(authHeader(call), null)
      assert.deepEqual({ ...call.data }, { restoreToken: R_A1 })
      okData(call, { token: TOKEN_A2, user: USER_A, restoreToken: R_A2 })
      return
    }
    if (p === '/member/me' && meRound === 1) {
      meRound += 1
      assert.equal(authHeader(call), `Bearer ${TOKEN_A2}`)
      okData(call, { id: 'A', maskedPhone: USER_A.maskedPhone })
      return
    }
    throw new Error(`多余请求 ${call.method || 'GET'} ${p}`)
  })
  assert.equal(me.state, 'ok')
  assert.equal(me.value.id, 'A')
  assert.equal(ctx.auth.getUser().id, 'A', '恢复的是同一个账号')
  assert.equal(restoreCalls(ctx).length, 1)
  assertNoSms(ctx)
  assertNoLoginJump(ctx)

  const restoresBeforeLogout = restoreCalls(ctx).length
  assert.equal(ctx.auth.logout(), true)
  const afterLogout = track(api.getMe())
  await server.drain((call) => {
    assert.equal(pathOf(call), '/member/me')
    session401(call)
  })
  await server.drain(() => { throw new Error('主动退出后不得再补签') })
  assert.equal(afterLogout.state, 'err')
  assert.equal(afterLogout.error.statusCode, 401)
  assert.equal(restoreCalls(ctx).length, restoresBeforeLogout, '本次运行退出后不得恢复')
  assertNoSms(ctx)
  assertNoLoginJump(ctx)

  const cold = createRuntime({ store: new Map(ctx.wx.store) })
  const coldApi = cold.load('api')
  const coldServer = createResponder(cold)
  const coldMe = track(coldApi.getMe())
  await coldServer.drain((call) => {
    assert.equal(pathOf(call), '/member/me')
    session401(call)
  })
  await coldServer.drain(() => { throw new Error('冷启动也不得恢复') })
  assert.equal(coldMe.state, 'err')
  assert.equal(coldMe.error.statusCode, 401)
  assert.equal(restoreCalls(cold).length, 0)
  const coldQuote = track(coldApi.quoteMyPrintOrder('x', PARAMS, PRESET, { terminalId: 'KSK-001' }))
  const coldPost = quotePosts(cold)
  assert.equal(coldPost.length, 1)
  assert.equal(authHeader(coldPost[0]), null)
  await flush()
  assert.equal(coldQuote.state, 'pending', '退出后坏令牌/无令牌不得把报价拦下或跳登录')
  okData(coldPost[0], QUOTE)
  await flush()
  assert.equal(coldQuote.state, 'ok')
  assert.equal(restoreCalls(cold).length, 0)
  assertNoSms(cold)
  assertNoLoginJump(cold)
})

test('坏令牌：报价照发且不带头，不补签、不跳登录，恢复资格仍保留', async () => {
  const ctx = createRuntime()
  assert.equal(ctx.auth.saveSession({ token: TOKEN_A, user: USER_A, restoreToken: R_A1 }), true)
  ctx.wx.store.set(TOKEN_KEY, 'not-a-jwt')
  const api = ctx.load('api')
  const quote = track(api.quoteMyPrintOrder('file-ignored', PARAMS, PRESET, { terminalId: 'KSK-001' }))
  assert.equal(ctx.wx.store.has(TOKEN_KEY), false)
  assert.equal(ctx.wx.store.get(ELIGIBLE), 'A')
  assert.deepEqual({ ...ctx.wx.store.get(RESTORE_KEY) }, { memberId: 'A', token: R_A1 })
  assert.equal(ctx.auth.canSilentResignin(), true)
  const post = quotePosts(ctx)
  assert.equal(post.length, 1)
  assert.equal(authHeader(post[0]), null)
  await flush()
  assert.equal(quote.state, 'pending')
  okData(post[0], QUOTE)
  await flush()
  assert.equal(quote.state, 'ok')
  await flush()
  assert.equal(quotePosts(ctx).length, 1)
  assert.equal(restoreCalls(ctx).length, 0)
  assertNoSms(ctx)
  assertNoLoginJump(ctx)
})
