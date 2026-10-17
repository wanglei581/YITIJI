/**
 * FLOW1b-1b 全站登录闸门（v3）——页面接入。每一页都验：
 *   - 过期但可恢复：先显示「恢复中」，**不先显示去登录、不跳登录页、不先载入本人数据**；
 *   - 恢复成功：退出「恢复中」并载入；
 *   - 恢复临时失败：显示「可重试」，不跳登录页；点「重试」才再发起一次；
 *   - 恢复中切到后台：结果回来不载入；回到前台载入一次；
 *   - 模板里「恢复中 / 可重试」排在「去登录」之前，且「去登录」是同一条 wx:if 链上的分支。
 * 点击类（导出、确认、保存、选文件）另验：恢复中再点不重复，恢复成功只执行一次。
 * 每页再做一条反向变异：把闸门换回「只看本地令牌」的旧写法，上面的用例必须判红。
 * auth / api 是替身；页面、page-guard 与页面自己目录下的模块都用真实实现。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
const settle = async () => { for (let i = 0; i < 6; i += 1) await flush() }

/** 会话替身：state = 'logged_in' | 'restorable' | 'logged_out'；恢复结果由测试决定何时回来。 */
function createEnv(initial = 'restorable') {
  let state = initial
  let generation = 1
  const pending = []
  let queued = null
  const calls = []
  const nav = []
  const toasts = []
  const user = { id: 'A', nickname: '王同学', phoneMasked: '183****0001' }
  const auth = {
    restorableMember: () => ({ id: state === 'restorable' ? 'A' : null, unreadable: false }),
    restorableMemberId: () => (state === 'restorable' ? 'A' : null),
    isLoggedIn: () => state === 'logged_in',
    getUser: () => (state === 'logged_in' ? user : null),
    getToken: () => (state === 'logged_in' ? 'TOKEN-A' : null),
    canSilentResignin: () => state === 'restorable',
    sessionGeneration: () => generation,
    isSameSession: (g) => g === generation,
  }
  const restoreSession = () => {
    calls.push('restoreSession')
    if (queued) { const outcome = queued; queued = null; return Promise.resolve({ state: outcome }) }
    return new Promise((resolve) => pending.push(resolve))
  }
  // 业务接口一律记下调用并回一个空结果；页面怎么处理空结果不是本文件要验的。
  const api = new Proxy({ restoreSession }, {
    get(target, name) {
      if (name in target) return target[name]
      if (typeof name !== 'string') return undefined
      return (...args) => { calls.push(name); return Promise.resolve(name === 'getPublicTerminals' ? [] : { items: [], list: [] }) }
    },
  })
  const store = new Map()
  const wx = {
    navigateTo: (o) => nav.push(o.url), redirectTo: (o) => nav.push(o.url), switchTab: (o) => nav.push(o.url),
    reLaunch: (o) => nav.push(o.url), navigateBack: () => nav.push('back'),
    showToast: (o) => toasts.push(o && o.title), showModal: (o) => toasts.push(`modal:${o && o.title}`),
    showLoading() {}, hideLoading() {}, stopPullDownRefresh() {}, showActionSheet() {},
    getStorageSync: (k) => (store.has(k) ? store.get(k) : ''), setStorageSync: (k, v) => store.set(k, v),
    removeStorageSync: (k) => store.delete(k), getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 390 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }), getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    chooseMessageFile() {}, scanCode() {},
  }
  return {
    auth, api, wx, calls, nav, toasts, store,
    resolve(outcome) {
      if (outcome === 'ok') state = 'logged_in'
      if (outcome === 'need_login') state = 'logged_out'
      if (pending.length) pending.splice(0).forEach((r) => r({ state: outcome }))
      else queued = outcome
    },
    restoreCalls: () => calls.filter((c) => c === 'restoreSession').length,
    called: (name) => calls.filter((c) => c === name).length,
    loginNavs: () => nav.filter((u) => String(u).includes('/pages/launch/launch')).length,
  }
}

function mount(rel, env, source) {
  const page = instantiate(loadPageDefinition(rel, { wx: env.wx, modules: { api: env.api, auth: env.auth }, source }))
  page.getTabBar = () => null
  return page
}

/** α 批：每页怎么进入、恢复成功后应当调到哪个本人数据接口、登录态写在哪个字段。 */
const ALPHA = [
  { rel: 'pages/resumes/resumes', load: 'getMyResumes' },
  { rel: 'pages/feedback/feedback', load: 'getMyFeedback' },
  { rel: 'pages/orders/orders', load: 'getMyPrintOrders' },
  { rel: 'pages/ai-records/ai-records', load: 'getMyAiRecords' },
  { rel: 'pages/privacy/privacy', load: 'listMemberDataRequests' },
  { rel: 'pages/daily-report/daily-report', load: 'getDailyBrief' },
  { rel: 'pages/package-create/package-create', load: 'getMyDocuments' },
  { rel: 'pages/package-confirm/package-confirm', flag: 'isLoggedIn' },
  { rel: 'pages/kiosk-login/kiosk-login', flag: 'isLoggedIn' },
]

const enter = (page) => { page.onLoad({}); page.onShow() }
const memberLoaded = (p, env, page) => (p.load ? env.called(p.load) > 0 : page.data[p.flag] === true)

async function restoringThenOk(p, source) {
  const env = createEnv('restorable')
  const page = mount(`${p.rel}.js`, env, source)
  enter(page)
  assert.equal(page.data.restoring, true, '先显示「恢复中」')
  assert.equal(env.loginNavs(), 0, '不跳登录页')
  assert.equal(memberLoaded(p, env, page), false, '恢复中不载入本人数据')
  await settle()
  env.resolve('ok')
  await settle()
  assert.equal(page.data.restoring, false, '退出「恢复中」')
  assert.equal(memberLoaded(p, env, page), true, '恢复成功后载入')
  assert.equal(env.loginNavs(), 0)
}

async function recoverableShowsRetry(p, source) {
  const env = createEnv('restorable')
  const page = mount(`${p.rel}.js`, env, source)
  enter(page)
  await settle()
  env.resolve('recoverable')
  await settle()
  assert.equal(page.data.restoreFailed, true, '显示可重试')
  assert.equal(page.data.restoring, false)
  assert.equal(env.loginNavs(), 0, '不跳登录页')
  page.onHide && page.onHide()
  page.onShow()
  await settle()
  assert.equal(env.restoreCalls(), 1, '切前后台不自动再发起')
  page.retryRestore()
  await settle()
  assert.equal(env.restoreCalls(), 2, '点「重试」才再发起')
}

async function backgroundThenShow(p, source) {
  const env = createEnv('restorable')
  const page = mount(`${p.rel}.js`, env, source)
  enter(page)
  await settle()
  page.onHide()
  env.resolve('ok')
  await settle()
  assert.equal(memberLoaded(p, env, page), false, '后台期间不载入')
  page.onShow()
  await settle()
  assert.equal(page.data.restoring, false, '回到前台不停在「恢复中」')
  assert.equal(memberLoaded(p, env, page), true, '回到前台载入')
}

for (const p of ALPHA) {
  const name = p.rel.split('/').pop()
  test(`${name}：过期但可恢复时先显示恢复中，不跳登录、不先载入；恢复成功后载入`, () => restoringThenOk(p))
  test(`${name}：恢复临时失败显示可重试、不跳登录；切前后台不自动再发，点重试才发`, () => recoverableShowsRetry(p))
  test(`${name}：恢复中切到后台，结果回来不载入；回到前台退出恢复中并载入`, () => backgroundThenShow(p))
  test(`${name}：已登录时照常载入，不进「恢复中」`, async () => {
    const env = createEnv('logged_in')
    const page = mount(`${p.rel}.js`, env)
    enter(page)
    await settle()
    assert.equal(page.data.restoring, false)
    assert.equal(env.restoreCalls(), 0)
    assert.equal(memberLoaded(p, env, page), true)
  })
  test(`变异[${name}·闸门换回只看本地令牌]必须判红`, async () => {
    const original = read(`${p.rel}.js`)
    const anchor = 'gateMember(this, auth, api, {'
    assert.ok(original.includes(anchor), `${name} 没有接入 gateMember`)
    const mutated = original.split(anchor).join(';(function (h) { if (auth.isLoggedIn()) h.ready(); else h.needLogin() })({')
    await assert.rejects(async () => restoringThenOk(p, mutated), (e) => e && e.code === 'ERR_ASSERTION')
  })
}

// ── 模板：「恢复中 / 可重试」在「去登录」之前，且同一条 wx:if 链 ───────────────

const TEMPLATES = [
  'pages/resumes/resumes.wxml', 'pages/feedback/feedback.wxml', 'pages/orders/orders.wxml',
  'pages/ai-records/ai-records.wxml', 'pages/privacy/privacy.wxml', 'pages/daily-report/daily-report.wxml',
  'pages/kiosk-login/kiosk-login.wxml', 'pages/package-create/package-create.wxml', 'pages/package-confirm/package-confirm.wxml',
]
for (const rel of TEMPLATES) {
  test(`${rel}：恢复中、可重试排在去登录之前，去登录是同一条链上的 wx:elif，重试绑定 retryRestore`, () => {
    const wxml = read(rel).replace(/<!--[\s\S]*?-->/g, '')
    const restoring = wxml.indexOf('wx:if="{{restoring}}"')
    const failed = wxml.indexOf('wx:elif="{{restoreFailed}}"')
    assert.ok(restoring >= 0 && failed > restoring, '先「恢复中」，再「可重试」')
    const loginIdx = Math.max(wxml.indexOf('bindtap="goLogin"'), wxml.indexOf('bindtap="toLogin"'))
    assert.ok(loginIdx > failed, '「去登录」在后面')
    const between = wxml.slice(failed, loginIdx)
    assert.match(between, /bindtap="retryRestore"/)
    assert.match(between, /wx:elif="\{\{[^}]*(!isLoggedIn|!loggedIn|loginRequired)[^}]*\}\}"/, '去登录那一支是 wx:elif，不会和恢复中同时出现')
  })
}

test('orders 底部按钮：恢复中、可重试时不出「微信一键登录」', () => {
  const wxml = read('pages/orders/orders.wxml')
  assert.match(wxml, /wx:elif="\{\{!restoring && !restoreFailed\}\}"[^>]*bindtap="toLogin"/)
})

// ── 点击类：恢复中再点不重复，恢复成功只执行一次 ─────────────────────────

test('隐私与数据「导出」：恢复中再点不重复发，恢复成功只进入导出一次', async () => {
  const env = createEnv('restorable')
  const page = mount('pages/privacy/privacy.js', env)
  enter(page)
  await settle()
  env.resolve('ok')
  await settle()
  // 进入页面那一轮恢复已经结束；再模拟令牌又过期、点导出
  const env2 = createEnv('restorable')
  const page2 = mount('pages/privacy/privacy.js', env2)
  page2.onLoad({})
  let entered = 0
  page2._startExport = () => { entered += 1 }
  page2.startExport()
  page2.startExport()
  await settle()
  env2.resolve('ok')
  await settle()
  assert.equal(entered, 1, '恢复成功后导出只进入一次')
})

test('扫码登录一体机「确认」：恢复中再点不重复确认；恢复临时失败提示可重试、不跳登录', async () => {
  for (const outcome of ['ok', 'recoverable']) {
    const env = createEnv('restorable')
    const page = mount('pages/kiosk-login/kiosk-login.js', env)
    page.onLoad({})
    let confirmed = 0
    page._confirmLogin = () => { confirmed += 1 }
    page.setData({ phase: 'ready' })
    page._ticketId = 'T-1'
    page.confirmLogin()
    page.confirmLogin()
    await settle()
    env.resolve(outcome)
    await settle()
    assert.equal(confirmed, outcome === 'ok' ? 1 : 0)
    assert.equal(env.loginNavs(), 0)
    if (outcome === 'recoverable') assert.ok(env.toasts.some((t) => String(t).includes('暂时没能恢复登录')))
  }
})

test('小青「保存要点」：恢复中再点只提示不重复；恢复成功只保存一次', async () => {
  const env = createEnv('restorable')
  const page = mount('pages/assistant/assistant.js', env)
  let saved = 0
  page._saveSummary = () => { saved += 1 }
  page.saveSummary()
  page.saveSummary()
  await settle()
  env.resolve('ok')
  await settle()
  assert.equal(saved, 1)
})

test('材料包「选文件」：恢复中切到后台，结果回来不打开选文件，回到前台也不补执行', async () => {
  const env = createEnv('restorable')
  const page = mount('pages/package-create/package-create.js', env)
  page.onLoad({})
  let opened = 0
  page._addFile = () => { opened += 1 }
  page.addFile()
  await settle()
  page.onHide()
  env.resolve('ok')
  await settle()
  page.onShow()
  await settle()
  assert.equal(opened, 0)
})
