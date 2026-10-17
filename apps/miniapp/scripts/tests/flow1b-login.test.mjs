/**
 * FLOW1b-2：登录页 /pages/launch/launch，以及确认页从登录页回来之后的核价（方案 v2 第五节 L1–L3、L5）。
 *
 *   L1 协议放在按钮上方；没勾选时页面上没有带 open-type 的按钮，点那个样子相同的按钮说清楚先勾哪里。
 *   L2 页面上一行状态条：登录中、取消了授权、没拿到手机号、服务暂时不可用、没能保存。
 *      取消授权（errMsg 转小写后含 deny 或 cancel）给「改用短信验证码」，点了打开短信表单。
 *   L3 本地和网络失败不露原文（「wx.login 调用失败」这类），服务端给的可读原因照常显示。
 *   L5 确认页因为没登录停在「去登录」，从登录页回来已登录 → 只重新核价一次；仍未登录不核价、不循环。
 *
 * L4（「暂不登录」改文字链、品牌区收紧）是外观改动，按小程序「颜色和风格不许改」的规矩先问产品负责人，本批不做。
 * 页面跑在沙箱里，api / auth 是替身；只是本地行为证据，不是真机结论。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
const require = createRequire(import.meta.url)
const idem = require('../../utils/print-order-idempotency.js')

const AGREE_FIRST = '请先阅读并勾选上方的服务协议和隐私政策'
const TECH = /wx\.login|request:fail|errMsg|Error|undefined|null/

/** 改动的那一种失败：断言没满足时 node:assert 抛的是 ERR_ASSERTION，不是把代码改崩。 */
const assertionFailed = (err) => err && err.code === 'ERR_ASSERTION'

// ── 登录页沙箱 ─────────────────────────────────────────────────────────────

function launchPage({ api = {}, auth = {}, source } = {}) {
  const calls = { toast: [], modal: [], nav: [] }
  const timers = []
  const wx = {
    showToast: (o) => calls.toast.push(o.title),
    showModal: (o) => calls.modal.push(o),
    showLoading() {},
    hideLoading() {},
    navigateTo: (o) => calls.nav.push(o.url),
    navigateBack: () => calls.nav.push('back'),
    redirectTo: (o) => calls.nav.push(o.url),
    switchTab: (o) => calls.nav.push(o.url),
    getWindowInfo: () => ({ statusBarHeight: 20 }),
  }
  const page = instantiate(loadPageDefinition('pages/launch/launch.js', {
    wx,
    timers,
    source,
    globals: { getCurrentPages: () => [{ route: 'pages/print-pay/print-pay' }, { route: 'pages/launch/launch' }] },
    modules: {
      api: { getLegalVersions: () => Promise.resolve({}), syncAiDeclarationsAfterLogin() {}, ...api },
      auth: { isLoggedIn: () => false, saveSession: () => true, ...auth },
    },
  }))
  page.onLoad({})
  return { page, calls, timers }
}

function agreedPage(opts) {
  const ctx = launchPage(opts)
  ctx.page.toggleAgree()
  assert.equal(ctx.page.data.agreed, true)
  return ctx
}

const launchSource = (pairs) => {
  let src = read('pages/launch/launch.js')
  for (const [from, to] of pairs) {
    assert.ok(src.includes(from), `变异锚点已失效：${from.slice(0, 60)}`)
    src = src.split(from).join(to)
  }
  return src
}

// ── L1 模板 ────────────────────────────────────────────────────────────────

function checkLoginTemplate(wxml) {
  const src = wxml.replace(/<!--[\s\S]*?-->/g, '')
  const buttons = src.match(/<button\b[^>]*>/g) || []
  const authButtons = buttons.filter((b) => b.includes('open-type="getPhoneNumber"'))
  assert.equal(authButtons.length, 1, '只有一个微信授权按钮')
  assert.match(authButtons[0], /wx:if="\{\{agreed && !legalBlocked\}\}"/, '微信授权按钮只在勾选协议、协议已发布时才出现')
  assert.ok(!/disabled=/.test(authButtons[0]), '不再用禁用态：禁用的按钮点了没有任何反应')
  const fallback = buttons[buttons.indexOf(authButtons[0]) + 1] || ''
  assert.match(fallback, /wx:else/, '紧跟一个 wx:else 的同款按钮')
  assert.match(fallback, /bindtap="needAgree"/, '没勾选时点它说清楚先勾哪里')
  assert.ok(!fallback.includes('open-type'), '没勾选时页面上没有带 open-type 的按钮')
  const legal = src.indexOf('class="launch-legal"')
  assert.ok(legal > 0 && legal < src.indexOf(authButtons[0]), '协议在按钮上方')
  assert.ok(legal < src.indexOf('bindtap="confirmSms"'), '短信表单也在协议下面')
  const status = src.indexOf('>{{status}}<')
  assert.equal((src.match(/>\{\{status\}\}</g) || []).length, 2, '提醒和状态两种样子各显示一处')
  assert.ok(status > legal && status < src.indexOf(authButtons[0]), '状态条在协议和按钮之间')
  assert.match(src, /<text wx:if="\{\{statusAction === 'sms'\}\}"[^>]*bindtap="useSms"[^>]*>改用短信验证码<\/text>/)
}

test('L1 模板：协议在按钮上方；没勾选时页面上没有带 open-type 的按钮，只有一个点了会提示的同款按钮', () => {
  checkLoginTemplate(read('pages/launch/launch.wxml'))
})

test('反向变异：微信授权按钮不再受勾选控制 → 上一条必须判红', () => {
  const wxml = read('pages/launch/launch.wxml')
  const anchor = '<button wx:if="{{agreed && !legalBlocked}}" class="btn wx block launch-btn-wx tap"'
  assert.ok(wxml.includes(anchor))
  assert.throws(() => checkLoginTemplate(wxml.replace(anchor, '<button class="btn wx block launch-btn-wx tap"')), assertionFailed)
})

// ── L1 行为 ────────────────────────────────────────────────────────────────

test('L1 没勾选就点登录：状态条说先勾哪里，不打开短信表单；勾上之后那句收起', () => {
  const { page, calls } = launchPage()
  page.needAgree()
  assert.equal(page.data.status, AGREE_FIRST)
  assert.equal(page.data.statusTone, 'warn')
  assert.deepEqual(calls.toast, ['请先阅读并同意服务协议和隐私政策'])
  page.tapSmsLogin()
  assert.equal(page.data.showSms, false, '没勾选时短信入口同样先要勾选')
  page.toggleAgree()
  assert.equal(page.data.status, '', '勾上之后不再说「请先勾选」')
})

test('L1 协议还没正式发布：点按钮弹说明，不出「请先勾选」', () => {
  const { page, calls } = launchPage()
  page.setData({ legalBlocked: true })
  page.needAgree()
  assert.equal(calls.modal.length, 1)
  assert.equal(calls.modal[0].title, '暂时不能登录')
  assert.equal(page.data.status, '')
})

// ── L2 状态条 ──────────────────────────────────────────────────────────────

async function denyScenario(source) {
  for (const errMsg of ['getPhoneNumber:fail user deny', 'getPhoneNumber:fail:cancel', 'getPhoneNumber:FAIL USER DENY']) {
    const { page, calls } = agreedPage({ source })
    page.onGetPhoneNumber({ detail: { errMsg } })
    assert.equal(page.data.status, '你取消了微信授权，可以改用短信验证码登录', errMsg)
    assert.equal(page.data.statusAction, 'sms', '状态条上给「改用短信验证码」')
    assert.equal(page.data.showSms, false, '用户自己取消的，不替他打开别的表单')
    assert.deepEqual(calls.nav, [])
    page.useSms()
    assert.equal(page.data.showSms, true, '点「改用短信验证码」打开短信表单')
    assert.equal(page.data.status, '')
  }
}

test('L2 取消授权（errMsg 含 deny 或 cancel，不分大小写）：状态条给「改用短信验证码」，点了打开短信表单', () => denyScenario())

test('反向变异：判断取消授权前不转小写 → 上一条必须判红', async () => {
  const source = launchSource([["String(d.errMsg || '').toLowerCase()", "String(d.errMsg || '')"]])
  await assert.rejects(denyScenario(source), assertionFailed)
})

test('L2 没拿到手机号（其余原因）：直接打开短信表单，状态条说清原因', () => {
  const { page } = agreedPage()
  page.onGetPhoneNumber({ detail: { errMsg: 'getPhoneNumber:fail 用户绑定的手机需要进行验证，请在客户端完成短信验证步骤' } })
  assert.equal(page.data.showSms, true)
  assert.equal(page.data.status, '没有拿到微信绑定的手机号，已为你打开短信验证码登录')
  assert.equal(page.data.statusTone, 'warn')
})

test('L2 登录中 → 成功：状态条先说正在登录，成功后收起，回到原来那一页', async () => {
  const login = deferred()
  const { page, calls, timers } = agreedPage({ api: { loginByPhone: () => login.promise } })
  page.onGetPhoneNumber({ detail: { code: 'phone-code-0193' } })
  assert.equal(page.data.status, '正在登录…')
  assert.equal(page.data.statusTone, '')
  login.resolve({ token: 't', user: { id: 'A' } })
  await flush()
  assert.equal(page.data.status, '')
  assert.ok(calls.toast.includes('登录成功'))
  timers.forEach((fn) => fn())
  assert.deepEqual(calls.nav, ['back'])
})

test('L2 登录状态没能保存：状态条说没能保存，不提示成功、不跳转', async () => {
  const { page, calls, timers } = agreedPage({
    api: { loginByPhone: () => Promise.resolve({ token: 't', user: { id: 'A' } }) },
    auth: { saveSession: () => false },
  })
  page.onGetPhoneNumber({ detail: { code: 'phone-code-0193' } })
  await flush()
  assert.equal(page.data.status, '登录状态没能保存，请重试')
  assert.equal(page.data.statusTone, 'warn')
  assert.ok(!calls.toast.includes('登录成功'))
  timers.forEach((fn) => fn())
  assert.deepEqual(calls.nav, [])
})

// ── L3 不露技术原文 ────────────────────────────────────────────────────────

async function wechatFailure(err, source) {
  const { page, calls } = agreedPage({ api: { loginByPhone: () => Promise.reject(err) }, source })
  page.onGetPhoneNumber({ detail: { code: 'phone-code-0193' } })
  await flush()
  return { page, calls }
}

async function technicalTextScenario(source) {
  for (const err of [new Error('wx.login 调用失败'), Object.assign(new Error('request:fail timeout'), { statusCode: -1 })]) {
    const { page, calls } = await wechatFailure(err, source)
    assert.equal(page.data.status, '网络不太稳定，暂时没能登录，请稍后重试，也可以改用短信验证码', err.message)
    assert.equal(page.data.statusAction, 'sms')
    assert.ok(!TECH.test(page.data.status) && !calls.toast.some((t) => TECH.test(t)), `不露原文：${calls.toast.join(' | ')}`)
  }
  const down = await wechatFailure(Object.assign(new Error('Bad Gateway'), { statusCode: 502 }), source)
  assert.equal(down.page.data.status, '登录服务暂时不可用，请稍后重试，也可以改用短信验证码')
}

test('L3 微信登录：本地失败（没有状态码）和断网（-1）、服务故障（5xx）都用固定的话，不露原文', () => technicalTextScenario())

test('反向变异：本地和网络失败照搬原文 → 上一条必须判红', async () => {
  const source = launchSource([['if (!Number.isFinite(status) || status <= 0) {', 'if (false) {']])
  await assert.rejects(technicalTextScenario(source), assertionFailed)
})

test('L3 服务端给的可读原因照常显示（微信授权过期、验证码不对）', async () => {
  const { page } = await wechatFailure(Object.assign(new Error('微信授权已过期，请重新授权。'), { statusCode: 400 }))
  assert.equal(page.data.status, '微信授权已过期，请重新授权，也可以改用短信验证码')

  const sms = agreedPage({ api: { loginBySms: () => Promise.reject(Object.assign(new Error('验证码错误或已过期'), { statusCode: 400 })) } })
  sms.page.tapSmsLogin()
  sms.page.setData({ phone: '18369160193', code: '482913' })
  sms.page.confirmSms()
  assert.equal(sms.page.data.status, '正在登录…')
  await flush()
  assert.equal(sms.page.data.status, '验证码错误或已过期')
  assert.equal(sms.page.data.statusAction, '', '已经在短信表单里，不再给「改用短信验证码」')
})

test('L3 短信验证码没发出去：断网不露原文，限流的原因照常写在输入框下', async () => {
  const offline = agreedPage({ api: { sendOtp: () => Promise.reject(Object.assign(new Error('request:fail timeout'), { statusCode: -1 })) } })
  offline.page.tapSmsLogin()
  offline.page.setData({ phone: '18369160193' })
  offline.page.sendCode()
  await flush()
  assert.equal(offline.page.data.codeHint, '网络不太稳定，验证码没有发出去，请稍后重试')

  const limited = agreedPage({ api: { sendOtp: () => Promise.reject(Object.assign(new Error('发送太频繁，请 60 秒后再试'), { statusCode: 429 })) } })
  limited.page.tapSmsLogin()
  limited.page.setData({ phone: '18369160193' })
  limited.page.sendCode()
  await flush()
  assert.equal(limited.page.data.codeHint, '发送太频繁，请 60 秒后再试')
})

// ── L5 确认页从登录页回来 ──────────────────────────────────────────────────

function payPage({ source } = {}) {
  const session = { user: null }
  const auth = {
    isLoggedIn: () => !!session.user,
    getUser: () => session.user,
    canSilentResignin: () => false,
    sessionGeneration: () => 0,
    isSameSession: (value) => value === 0,
  }
  const quotes = []
  const created = []
  const api = {
    getMyDocuments: () => Promise.resolve({ items: [] }),
    quoteMyPrintOrder: (...args) => { quotes.push(args); return Promise.resolve({ amountCents: 0, billablePages: 2 }) },
    createCloudPrintOrder: (...args) => { created.push(args); return Promise.reject(new Error('本测试不该建单')) },
  }
  const idemPort = { ...idem, findRecord: () => null, ensureKey: () => Promise.resolve({ key: 'one-stable-key' }), markSubmitted: () => true, rememberOrderId: () => ({ orderId: 'po-7f3a' }), clearRecord: () => true }
  const nav = []
  const wx = { navigateTo: (o) => nav.push(o.url), redirectTo() {}, reLaunch() {}, showToast() {}, showModal() {}, showLoading() {}, hideLoading() {}, navigateBack() {}, switchTab() {} }
  const page = instantiate(loadPageDefinition('pages/print-pay/print-pay.js', {
    wx, source, modules: { api, auth, 'print-order-idempotency': idemPort },
  }))
  return { page, session, quotes, created, nav }
}

const PAY_OPTS = {
  fileId: 'f-5c2e', storeId: 'KSK-001', store: encodeURIComponent('市人才市场一楼自助服务点'),
  copies: '2', colorMode: 'black_white', duplex: 'simplex',
}

async function returnFromLoginScenario(source) {
  const { page, session, quotes, created, nav } = payPage({ source })
  page.onLoad({ ...PAY_OPTS })
  page.onShow()
  await flush()
  assert.equal(page.data.quoteRecover, 'login', '没登录：停在「去登录」')
  assert.equal(quotes.length, 0, '没登录不核价')
  const chosen = JSON.stringify({ q: page.data.q, colorMode: page.data.colorMode, duplex: page.data.duplex, copiesLabel: page.data.copiesLabel })

  page.toLogin()
  assert.deepEqual(nav, ['/pages/launch/launch'])
  page.onHide && page.onHide()
  page.onShow()
  await flush()
  assert.equal(quotes.length, 0, '从登录页回来仍未登录：不核价、不循环')

  session.user = { id: 'A' }
  page.onShow()
  await flush()
  assert.equal(quotes.length, 1, '登录回来：重新核价一次')
  assert.equal(page.data.quoteState, 'ready')
  assert.equal(page.data.fee.total, '免费')
  page.onShow()
  page.onShow()
  await flush()
  assert.equal(quotes.length, 1, '再切前后台也不重复核价')
  assert.equal(created.length, 0, '不建单')
  assert.equal(JSON.stringify({ q: page.data.q, colorMode: page.data.colorMode, duplex: page.data.duplex, copiesLabel: page.data.copiesLabel }), chosen, '已选参数不丢')
}

test('L5 确认页：因为没登录停在「去登录」，回来已登录只核价一次；仍未登录不核价；不建单、参数不丢', () => returnFromLoginScenario())

test('反向变异：回前台只要登录着就核价（不认「因为没登录才停下」）→ 上一条必须判红', async () => {
  let src = read('pages/print-pay/print-pay.js')
  const anchor = 'if (this._quoteNeedsLogin && auth.isLoggedIn()) this._loadQuote()'
  assert.ok(src.includes(anchor))
  src = src.split(anchor).join('if (auth.isLoggedIn()) this._loadQuote()')
  await assert.rejects(returnFromLoginScenario(src), assertionFailed)
})

test('L5 换了账号：不替新账号自动核上一位选的文件，页面照旧请他返回重新选择', async () => {
  const { page, session, quotes } = payPage()
  session.user = { id: 'A' }
  page.onLoad({ ...PAY_OPTS })
  page.onShow()
  await flush()
  assert.equal(quotes.length, 1, 'A 打开时照常核价')
  session.user = { id: 'B' }
  page.onShow()
  await flush()
  assert.equal(quotes.length, 1, '换成 B：不自动核价')
  assert.equal(page.data.quoteRecover, 'login')
  assert.match(page.data.quoteError, /不是同一个/)
})
