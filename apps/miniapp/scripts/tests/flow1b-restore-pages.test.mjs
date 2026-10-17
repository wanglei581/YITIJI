/**
 * FLOW1b-1b：本来就认得「恢复暂时失败」的 4 页——取件码、确认支付、订单详情、材料包取件码。
 *
 * 场景：同一台手机上登录过、访问令牌已过期；页面一发请求就 401，请求层拿恢复凭证去换新，
 * 这一次网络断了（SESSION_RESTORE_PENDING，可恢复）。方案 v3 第 3 节与用户验收要求：
 *   - 不跳登录页，给「重试」出口；
 *   - 不自己循环重试：等多久都不再发恢复，只有用户点重试才再恢复一次；
 *   - 点重试重新取一次，用户已选的参数逐项不变；
 *   - 不自动建单、不自动支付、不换码，不走微信登录。
 *
 * 真实 utils/auth.js、request.js、storage.js、api.js 跑在 wx 替身上，服务端由测试按地址回复。
 * 只是本地行为证据，不是设备或生产结论。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  flush,
  fakeToken,
  TOKEN_A,
  USER_A,
  createRuntime,
  authHeader,
  mutator,
  assertionFailed,
} from './session-runtime.mjs'

const EXPIRED_A = fakeToken('A', -60)
const R_A1 = `${'a'.repeat(22)}.${'1'.repeat(43)}`
const R_A2 = `${'a'.repeat(22)}.${'2'.repeat(43)}`
const PENDING_COPY = '暂时没能恢复登录，请稍后重试'
const LAUNCH = '/pages/launch/launch'
const LATER = new Date(Date.now() + 3 * 3600e3).toISOString()

const PRINT_ORDER = {
  id: 'po-7f3a', orderNo: 'P20261017-0193', taskStatus: 'pending_release', payStatus: 'unpaid',
  pickupStatus: 'pending', pickupCode: '12345678', fileName: '王敏-简历.pdf', amountCents: 0, expiresAt: LATER,
  share: { outletName: '市人才市场一楼自助服务点' },
}
const PACKAGE_ORDER = {
  id: 'pk-2b91', orderNo: 'K20261017-0088', taskStatus: 'pending_release', payStatus: 'unpaid',
  pickupStatus: 'pending', pickupCode: '87654321', amountCents: 0, expiresAt: LATER,
  items: [{ fileName: '王敏-简历.pdf' }, { fileName: '王敏-作品集.pdf' }],
}

/** 登录一次（带恢复凭证），再模拟「过了很久」：盘上令牌换成过期的那一枚，冷启动。 */
function expiredRuntime(mutate) {
  const warm = createRuntime({ mutate })
  assert.equal(warm.auth.saveSession({ token: TOKEN_A, user: USER_A, restoreToken: R_A1 }), true)
  const disk = new Map(warm.wx.store)
  disk.set('zyd_token', EXPIRED_A)
  return createRuntime({ store: disk, mutate })
}

const restoreCalls = (ctx) => ctx.wx.calls.request.filter((c) => c.url.includes('/member/auth/restore') && !c.url.includes('/revoke'))
const navTargets = (ctx) => ctx.wx.calls.nav.map(([, url]) => String(url || ''))
const pathOf = (call) => call.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1/, '').split('?')[0]

/**
 * 测试里的服务端：按地址回复，并记下不该出现的请求（建单、支付、换码、取消……）。
 * restore 是恢复接口每一次的回法：'fail' 断网，'ok' 换新成功。
 * routes：[方法, 地址, 回复体, 是否要求登录]。要求登录而没带有效令牌的，回会话类 401。
 */
function createServer(ctx, { restore, routes }) {
  const answered = new WeakSet()
  const unexpected = []
  const serveOnce = () => {
    let n = 0
    for (const call of ctx.wx.calls.request) {
      if (answered.has(call)) continue
      answered.add(call)
      n += 1
      const p = pathOf(call)
      if (p === '/member/auth/restore') {
        const mode = restore.shift()
        if (mode === 'ok') call.success({ statusCode: 200, data: { token: TOKEN_A, user: USER_A, restoreToken: R_A2 } })
        else call.fail({ errMsg: 'request:fail timeout' })
        continue
      }
      const route = routes.find(([method, target]) => method === (call.method || 'GET') && p === target)
      if (!route) {
        unexpected.push(`${call.method || 'GET'} ${p}`)
        call.fail({ errMsg: 'request:fail 测试服务端没有这个地址' })
        continue
      }
      const [, , body, needsMember] = route
      if (needsMember && authHeader(call) !== `Bearer ${TOKEN_A}`) {
        call.success({ statusCode: 401, data: { error: { code: 'MEMBER_MISSING_TOKEN' } } })
        continue
      }
      call.success({ statusCode: 200, data: { success: true, data: body } })
    }
    return n
  }
  return {
    unexpected,
    async drain() {
      for (let i = 0; i < 20; i += 1) {
        await flush()
        if (serveOnce() === 0) {
          await flush()
          if (serveOnce() === 0) return
        }
      }
      throw new Error('请求一直没停：页面可能在自己循环')
    },
  }
}

/** 断网失败之后：等多久（跑掉所有定时器）都不该再发恢复。 */
async function noAutomaticRetry(ctx, server) {
  const before = restoreCalls(ctx).length
  for (let i = 0; i < 3; i += 1) {
    ctx.runTimers()
    await server.drain()
  }
  assert.equal(restoreCalls(ctx).length, before, '没有人点重试，不得自己再恢复')
}

function common(ctx, server) {
  assert.equal(ctx.wx.calls.login.length, 0, '不走微信登录')
  assert.ok(!navTargets(ctx).some((url) => url.startsWith(LAUNCH)), `不得跳登录页：${navTargets(ctx).join(', ')}`)
  assert.deepEqual(server.unexpected, [], '不得建单、支付、换码或取消')
}

// ── 取件码页 ────────────────────────────────────────────────────────────────

async function pickupScenario(mutate) {
  const ctx = expiredRuntime(mutate)
  const server = createServer(ctx, {
    restore: ['fail', 'ok'],
    routes: [['GET', '/me/print-orders/po-7f3a', PRINT_ORDER, true]],
  })
  const page = ctx.loadPage('pages/print-pickup/print-pickup.js', ctx.load('api'))
  page.onLoad({ orderId: 'po-7f3a' })
  page.onShow()
  await server.drain()

  assert.equal(restoreCalls(ctx).length, 1, '过期后先用恢复凭证换新')
  assert.equal(page.data.state, 'error')
  assert.equal(page.data.errorAction, 'retry', '恢复暂时失败给「重试」，不给登录')
  assert.equal(page.data.errorMsg, PENDING_COPY)
  assert.equal(page.data.showQr, false)
  await noAutomaticRetry(ctx, server)
  common(ctx, server)

  page.recover()
  await server.drain()
  assert.equal(restoreCalls(ctx).length, 2, '点重试才再恢复一次')
  assert.equal(page.data.state, 'ready')
  assert.equal(page.data.orderId, 'po-7f3a', '还是同一张单')
  assert.equal(ctx.auth.getUser().id, 'A')
  common(ctx, server)
}

test('取件码页：恢复暂时失败 → 留在本页给「重试」，不自己循环；点重试换新成功、取回同一张单，不换码', () => pickupScenario())

test('反向变异：取件码页把「恢复暂时失败」当成登录失效 → 上一条必须判红', async () => {
  const mutate = mutator('pages/print-pickup/print-pickup.js', [[
    'if (err && err.statusCode === 401) {',
    'if (err && (err.statusCode === 401 || err.recoverable)) {',
  ]])
  await assert.rejects(pickupScenario(mutate), assertionFailed)
})

// ── 确认支付页（核价）────────────────────────────────────────────────────────

const PAY_OPTS = {
  fileId: 'f-5c2e', storeId: 'KSK-001', store: encodeURIComponent('市人才市场一楼自助服务点'),
  copies: '2', colorMode: 'black_white', duplex: 'simplex',
}
const payParams = (data) => JSON.parse(JSON.stringify({
  q: data.q, storeName: data.storeName, colorMode: data.colorMode, duplex: data.duplex,
  colorLabel: data.colorLabel, duplexLabel: data.duplexLabel, copiesLabel: data.copiesLabel,
}))

async function payScenario(mutate) {
  const ctx = expiredRuntime(mutate)
  const server = createServer(ctx, {
    restore: ['fail', 'ok'],
    routes: [
      ['GET', '/files/f-5c2e/preview-url', { printFileUrl: 'https://files.example.invalid/signed/f-5c2e?sig=0193' }, true],
      ['POST', '/orders/quote', { amountCents: 0, billablePages: 2 }, false],
      ['GET', '/me/documents', { items: [{ id: 'f-5c2e', name: '王敏-简历.pdf' }] }, true],
    ],
  })
  const page = ctx.loadPage('pages/print-pay/print-pay.js', ctx.load('api'))
  page.onLoad({ ...PAY_OPTS })
  page.onShow()
  const chosen = payParams(page.data)
  assert.equal(chosen.copiesLabel, 2)
  await server.drain()

  assert.equal(restoreCalls(ctx).length, 1, '核价和文件名两条请求共用一次换新')
  assert.equal(page.data.quoteState, 'error')
  assert.equal(page.data.quoteRecover, 'retry', '恢复暂时失败给「重新核价」，不给登录')
  assert.equal(page.data.quoteError, PENDING_COPY)
  await noAutomaticRetry(ctx, server)
  common(ctx, server)

  page.retryQuote()
  await server.drain()
  assert.equal(restoreCalls(ctx).length, 2, '点重新核价才再恢复一次')
  assert.equal(page.data.quoteState, 'ready')
  assert.equal(page.data['fee.total'], '免费')
  assert.deepEqual(payParams(page.data), chosen, '份数、颜色、单双面、终端逐项不变')
  common(ctx, server)
}

test('确认支付页：核价时恢复暂时失败 → 给「重新核价」，不自己循环；重试后参数逐项不变、不自动建单', () => payScenario())

test('反向变异：确认支付页把「恢复暂时失败」的核价出口改成登录 → 上一条必须判红', async () => {
  const mutate = mutator('pages/print-pay/print-pay.js', [[
    "// 普通失败（网络 / 服务端）重试是有意义的，这里不给登录出口。\n          quoteRecover: 'retry',",
    "quoteRecover: (err && err.recoverable) ? 'login' : 'retry',",
  ]])
  await assert.rejects(payScenario(mutate), assertionFailed)
})

// ── 订单详情页 ──────────────────────────────────────────────────────────────

async function detailScenario(mutate) {
  const ctx = expiredRuntime(mutate)
  const server = createServer(ctx, {
    restore: ['fail', 'ok'],
    routes: [['GET', '/me/print-orders/po-7f3a', PRINT_ORDER, true]],
  })
  const page = ctx.loadPage('pages/order-detail/order-detail.js', ctx.load('api'))
  page.onLoad({ orderId: 'po-7f3a' })
  page.onShow()
  await server.drain()

  assert.equal(restoreCalls(ctx).length, 1)
  assert.equal(page.data.loading, false, '恢复暂时失败要停在错误卡片上，不能一直转圈或离开本页')
  assert.equal(page.data.detail, null)
  assert.equal(page.data.error, PENDING_COPY, '说清楚是恢复登录没成，点卡片重试')
  assert.equal(page.data.errorTitle, '加载失败，点此重试')
  await noAutomaticRetry(ctx, server)
  common(ctx, server)

  page.retry()
  await server.drain()
  assert.equal(restoreCalls(ctx).length, 2, '点重试才再恢复一次')
  assert.equal(page.data.error, '')
  assert.ok(page.data.detail, '取回订单详情')
  assert.equal(page._orderId, 'po-7f3a', '还是同一张单')
  common(ctx, server)
}

test('订单详情页：恢复暂时失败 → 错误卡片点此重试，不自己循环；重试后取回同一张单', () => detailScenario())

test('反向变异：订单详情页遇到「恢复暂时失败」就跳登录 → 上一条必须判红', async () => {
  const anchor = 'if (token.confirming && this._isOwnerDeniedError(err) && isMemberIdentity(token.identity)) {'
  const mutate = mutator('pages/order-detail/order-detail.js', [[
    anchor,
    `if (err && err.recoverable) { wx.navigateTo({ url: '${LAUNCH}' }); return }\n        ${anchor}`,
  ]])
  await assert.rejects(detailScenario(mutate), assertionFailed)
})

// ── 材料包取件码页 ──────────────────────────────────────────────────────────

async function packageScenario(mutate) {
  const ctx = expiredRuntime(mutate)
  const server = createServer(ctx, {
    restore: ['fail', 'ok'],
    routes: [['GET', '/orders/package/pk-2b91', PACKAGE_ORDER, true]],
  })
  const page = ctx.loadPage('pages/package-code/package-code.js', ctx.load('api'))
  page.onLoad({ orderId: 'pk-2b91' })
  page.onShow()
  await server.drain()

  assert.equal(restoreCalls(ctx).length, 1)
  assert.equal(page.data.ready, false)
  assert.equal(page.data.loadRecover, 'retry', '恢复暂时失败给「重新加载」，不给登录')
  assert.equal(page.data.showQr, false)
  await noAutomaticRetry(ctx, server)
  common(ctx, server)

  page.recover({ currentTarget: { dataset: { recover: page.data.loadRecover } } })
  await server.drain()
  assert.equal(restoreCalls(ctx).length, 2, '点重新加载才再恢复一次')
  assert.equal(page.data.ready, true)
  assert.equal(page.data.orderNo, 'K20261017-0088', '还是同一张单')
  assert.equal(page.data.fileCount, 2)
  common(ctx, server)
}

test('材料包取件码页：恢复暂时失败 → 给「重新加载」，不自己循环；重试后取回同一张单', () => packageScenario())

test('反向变异：材料包错误映射把「恢复暂时失败」算成登录失效 → 上一条必须判红', async () => {
  const mutate = mutator('package-order', [[
    "if (statusCode === 401 || code === 'MEMBER_SESSION_EXPIRED'",
    "if (statusCode === 401 || (err && err.recoverable) || code === 'MEMBER_SESSION_EXPIRED'",
  ]])
  await assert.rejects(packageScenario(mutate), assertionFailed)
})
