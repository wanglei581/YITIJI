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

const calls = (ctx, part) => ctx.wx.calls.request.filter((c) => c.url.includes(part))
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

// ── 求职材料页（β 批里唯一不用改的一页：它没有同步登录判断，靠请求层恢复）─────────────

async function materialsScenario(mutate) {
  const ctx = expiredRuntime(mutate)
  const generated = { fileId: 'f-9d41', filename: '王敏-求职信.pdf', pageCount: 1 }
  const server = createServer(ctx, {
    restore: ['fail', 'ok'],
    routes: [
      ['GET', '/job-materials/templates', { items: [] }, false],
      ['POST', '/job-materials/generate', generated, true],
    ],
  })
  const page = ctx.loadPage('pages/job-materials/job-materials.js', ctx.load('api'))
  page.onLoad({})
  await server.drain()
  const values = { name: '王敏', target: '行政专员' }
  page.setData({ phase: 'form', picked: { id: 'cover-letter', title: '求职信' }, values, canSubmit: true })

  page.submit()
  await server.drain()
  assert.equal(restoreCalls(ctx).length, 1)
  assert.equal(page.data.generating, false, '恢复暂时失败：解开按钮，用户可以再点一次')
  assert.deepEqual(ctx.wx.calls.modal.map((m) => m.title), ['未能生成材料'], '不弹「需要登录」')
  assert.equal(ctx.wx.calls.modal[0].content, PENDING_COPY)
  assert.equal(calls(ctx, '/job-materials/generate').filter((c) => authHeader(c) === `Bearer ${TOKEN_A}`).length, 0, '没恢复成功就没有真的生成')
  await noAutomaticRetry(ctx, server)
  common(ctx, server)

  page.submit()
  await server.drain()
  assert.equal(restoreCalls(ctx).length, 2, '再点一次才再恢复一次')
  assert.equal(calls(ctx, '/job-materials/generate').filter((c) => authHeader(c) === `Bearer ${TOKEN_A}`).length, 1, '恢复成功后只真的生成一次')
  assert.deepEqual(page.data.values, values, '已填内容不丢')
  assert.ok(navTargets(ctx).some((url) => url.startsWith('/pages/print-upload/print-upload?') && url.includes('fileId=f-9d41')), navTargets(ctx).join(', '))
  common(ctx, server)
}

test('求职材料页：生成时恢复暂时失败 → 提示可重试、不弹登录、不自己循环；再点一次恢复成功只生成一次，已填内容不丢', () => materialsScenario())

test('反向变异：求职材料页把「恢复暂时失败」当成要登录 → 上一条必须判红', async () => {
  const mutate = mutator('pages/job-materials/job-materials.js', [[
    'if (err && err.statusCode === 401) {',
    'if (err && (err.statusCode === 401 || err.recoverable)) {',
  ]])
  await assert.rejects(materialsScenario(mutate), assertionFailed)
})

// ── 恢复一直不成时的主动出口：失败卡片上的「去登录」（agy 13:18 指出的缺口，10/18 补）───────────
//
// 要求：复用各页已有的登录入口（都去 /pages/launch/launch）；点它只跳转，不登出、不删凭证、不发请求；
// 进了登录页，登录页照常先替用户再试一次恢复——再失败也停在登录页、登录方式能操作，不把人送回失败卡片；
// 用户主动登录后回到原页就是已登录，不再出现失败卡片，也不再恢复。

import fs from 'node:fs'
import path from 'node:path'
import { MINIAPP } from './session-runtime.mjs'

const LOGIN_ENTRIES = [
  ['ai-records', 'goLogin'], ['daily-report', 'goLogin'], ['feedback', 'goLogin'], ['resumes', 'goLogin'],
  ['kiosk-login', 'goLogin'], ['orders', 'toLogin'], ['package-confirm', 'toLogin'], ['package-create', 'toLogin'],
  ['privacy', 'toLogin'], ['me', 'tapLogin'], ['home', 'tapLogin'],
]
const wxmlOf = (name) => fs.readFileSync(path.join(MINIAPP, `pages/${name}/${name}.wxml`), 'utf8').replace(/<!--[\s\S]*?-->/g, '')

/** 失败状态下能看到一个「去登录」，绑的是这一页已有的登录入口。 */
function checkLoginEntry(name, handler, wxml) {
  const src = wxml || wxmlOf(name)
  if (name === 'me' || name === 'home') {
    // 这两页的失败提示在 wx:if/wx:elif 链里，入口单独挂在链后面，条件同样是 restoreFailed。
    const re = new RegExp(`<(view|text) wx:if="\\{\\{restoreFailed[^"]*\\}\\}"[^>]*bindtap="${handler}"[^>]*>去登录</(view|text)>`)
    assert.match(src, re, `${name}：失败时有「去登录」`)
    return
  }
  const start = src.indexOf('wx:elif="{{restoreFailed}}"')
  assert.ok(start > 0, `${name}：有恢复失败的卡片`)
  const next = src.indexOf('wx:elif=', start + 10)
  const block = src.slice(start, next > 0 ? next : undefined)
  assert.ok(block.includes('bindtap="retryRestore"'), `${name}：仍有「重试」`)
  const at = block.indexOf(`bindtap="${handler}"`)
  assert.ok(at > 0, `${name}：失败卡片上有绑定 ${handler} 的入口`)
  assert.ok(block.slice(at, at + 300).includes('去登录'), `${name}：入口写着「去登录」`)
}

test('恢复失败卡片：11 页都有「去登录」，复用该页已有的登录入口，「重试」仍在', () => {
  for (const [name, handler] of LOGIN_ENTRIES) checkLoginEntry(name, handler)
})

test('反向变异：简历页去掉失败卡片上的「去登录」→ 上一条必须判红', () => {
  const wxml = wxmlOf('resumes')
  const entry = '<view class="btn ghost block tap mt12" hover-class="tap-press" bindtap="goLogin">去登录</view>'
  assert.ok(wxml.includes(entry))
  assert.throws(() => checkLoginEntry('resumes', 'goLogin', wxml.replace(entry, '')), assertionFailed)
})

test('「去登录」只跳到登录页：不发请求、不登出、本机凭证与资格原样留着', () => {
  for (const [name, handler] of LOGIN_ENTRIES) {
    const ctx = expiredRuntime()
    const before = JSON.stringify([...ctx.wx.store.entries()])
    const page = ctx.loadPage(`pages/${name}/${name}.js`, ctx.load('api'))
    page[handler]()
    assert.deepEqual(ctx.wx.calls.nav, [['navigateTo', LAUNCH]], `${name}：只跳登录页`)
    assert.equal(ctx.wx.calls.request.length, 0, `${name}：不发请求`)
    assert.equal(JSON.stringify([...ctx.wx.store.entries()]), before, `${name}：本机存储一个字节都不变`)
  }
})

/** 闭环：恢复失败 → 去登录 → 登录页再试恢复仍失败、停在登录页可操作 → 主动短信登录 → 回原页已登录。 */
async function manualLoginAfterRestoreFailed(mutate) {
  const ctx = expiredRuntime(mutate)
  ctx.setPages([{ route: 'pages/resumes/resumes' }, { route: 'pages/launch/launch' }])
  const legalDoc = (type) => ({ docType: type, version: 'v2026.09', content: '职易达服务协议（测试正文）' })
  const server = createServer(ctx, {
    restore: ['fail', 'fail'],
    routes: [
      ['GET', '/me/resumes', { items: [] }, true],
      ['GET', '/kiosk/legal/terms_of_service', legalDoc('terms_of_service'), false],
      ['GET', '/kiosk/legal/privacy_policy', legalDoc('privacy_policy'), false],
      ['POST', '/member/auth/login', { token: TOKEN_A, user: USER_A, restoreToken: R_A2 }, false],
      // 登录成功后登录页会对一次账：读 AI 授权状态，再把「登录即声明」补写到账号（失败不影响登录）。
      ['GET', '/me/ai-consents/status', { consents: [] }, true],
      ['POST', '/me/ai-consents', { ok: true }, true],
    ],
  })
  const page = ctx.loadPage('pages/resumes/resumes.js', ctx.load('api'))
  page.onLoad({})
  page.onShow()
  await server.drain()
  assert.equal(page.data.restoreFailed, true, '前提：简历页恢复失败')
  assert.equal(restoreCalls(ctx).length, 1)

  page.goLogin()
  assert.deepEqual(ctx.wx.calls.nav, [['navigateTo', LAUNCH]])
  const launch = ctx.loadPage('pages/launch/launch.js', ctx.load('api'))
  launch.onLoad({})
  await server.drain()
  assert.equal(restoreCalls(ctx).length, 2, '登录页照常替用户再试一次恢复')
  assert.equal(launch.data.restoring, false, '再失败：不停在「正在恢复」')
  assert.equal(launch.data.restoreFailed, true, '说清楚没恢复成，同时给登录方式')
  assert.deepEqual(ctx.wx.calls.nav, [['navigateTo', LAUNCH]], '不把人送回失败卡片')

  launch.toggleAgree()
  launch.tapSmsLogin()
  assert.equal(launch.data.showSms, true, '登录方式能操作：打开短信表单')
  launch.setData({ phone: '18369160193', code: '482913', otp: ['4', '8', '2', '9', '1', '3'] })
  launch.confirmSms()
  await server.drain()
  ctx.runTimers()
  assert.ok(ctx.wx.calls.nav.some(([kind]) => kind === 'navigateBack'), '登录成功后回到原来那一页')
  assert.equal(ctx.auth.isLoggedIn(), true)

  page.onShow()
  await server.drain()
  assert.equal(page.data.restoreFailed, false, '回到原页：不再是失败卡片')
  assert.equal(page.data.loginRequired, false)
  assert.equal(restoreCalls(ctx).length, 2, '登录之后不再恢复，没有循环')
  assert.equal(ctx.wx.calls.login.length, 0, '没有走微信登录')
  assert.equal(calls(ctx, '/auth/logout').length, 0, '全程没有登出')
  assert.deepEqual(server.unexpected, [])
}

test('闭环：恢复失败 → 去登录 → 登录页再失败仍可操作 → 主动短信登录 → 回原页已登录、不再恢复', () => manualLoginAfterRestoreFailed())

test('反向变异：登录页恢复失败后把人送回去（困回失败卡片）→ 上一条必须判红', async () => {
  const anchor = "      this.setData({ restoring: false, restoreFailed: r.state === 'recoverable' })\n    })"
  const mutate = mutator('pages/launch/launch.js', [[
    anchor,
    "      this.setData({ restoring: false, restoreFailed: r.state === 'recoverable' })\n      wx.navigateBack()\n    })",
  ]])
  await assert.rejects(manualLoginAfterRestoreFailed(mutate), assertionFailed)
})
