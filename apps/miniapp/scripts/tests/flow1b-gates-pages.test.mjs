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
import vm from 'node:vm'
import { createRequire } from 'node:module'
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
    chooseMessageFile() {}, scanCode() {}, pageScrollTo() {}, vibrateShort() {},
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
    // 先找「未登录」那一支：它必须是恢复失败之后、同一条链上的 wx:elif。
    // 10/18 起恢复失败卡片里也有一个主动「去登录」（flow1b-restore-pages 另测），所以不能再拿第一个 goLogin 当登录卡片。
    const offset = wxml.slice(failed + 1).search(/wx:elif="\{\{[^}]*(!isLoggedIn|!loggedIn|loginRequired)[^}]*\}\}"/)
    assert.ok(offset >= 0, '去登录那一支是 wx:elif，不会和恢复中同时出现')
    const branch = failed + 1 + offset
    assert.match(wxml.slice(failed, branch), /bindtap="retryRestore"/)
    assert.match(wxml.slice(branch), /bindtap="(goLogin|toLogin)"/, '「去登录」在那一支里，排在后面')
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

// ── β 批：不登录也能用的 AI 工具页——过期但可恢复时先等恢复结果再启动 ─────────────
// 启动只做一次：恢复成功按会员启动，临时失败照游客启动；恢复中不发任何业务请求；
// 恢复结束时在后台不启动，回到前台的 onShow 才启动。点击类（导出、生成、重试、附到简历）另验只执行一次。

/** started：这一页「启动过」的可观测痕迹（各页启动时做的第一件事不同）。 */
const BETA = [
  { rel: 'pages/job-fit/job-fit', options: { taskId: 'T-1' }, started: (page) => page.data.historyMode === true, history: true },
  { rel: 'pages/career-plan/career-plan', options: { taskId: 'T-1' }, started: (page) => page.data.historyMode === true, history: true },
  { rel: 'pages/resume-diagnose/resume-diagnose', options: {}, started: (page, env) => env.called('getResumeExportPricing') > 0 },
  { rel: 'pages/resume-parse/resume-parse', options: { fileId: 'F-1', fileName: 'a.pdf' }, started: (page) => page.data.fileId === 'F-1' },
  { rel: 'pages/resume-optimize/resume-optimize', options: {}, started: (page, env) => env.called('getResumeExportPricing') > 0 },
  { rel: 'pages/self-explore/self-explore', options: {}, started: (page, env) => businessCalls(env) > 0 },
  { rel: 'pages/resume-build/resume-build', options: { taskId: 'T-1' }, started: (page, env) => businessCalls(env) > 0 },
]
function businessCalls(env) { return env.calls.filter((c) => c !== 'restoreSession').length }

async function betaStartsOnceAfterRestore(p, outcome, source) {
  const env = createEnv('restorable')
  const page = mount(`${p.rel}.js`, env, source)
  page.onLoad(p.options)
  page.onShow && page.onShow()
  await settle()
  assert.equal(businessCalls(env), 0, '恢复中不发业务请求（不会把会员当成游客先提交或先报价）')
  assert.equal(p.started(page, env), false, '恢复中不启动')
  env.resolve(outcome)
  await settle()
  const afterStart = businessCalls(env)
  assert.equal(p.started(page, env), true, '恢复结束后启动')
  if (p.history && outcome === 'recoverable') {
    assert.match(String(page.data.failMsg || ''), /暂时没能恢复登录/, '临时失败不说「登录已失效」')
  }
  page.onHide && page.onHide()
  page.onShow && page.onShow()
  await settle()
  assert.equal(businessCalls(env), afterStart, '只启动一次：再回到前台不重复启动')
  assert.equal(env.loginNavs(), 0, '不跳登录页')
}

async function betaBackgroundThenShow(p, source) {
  const env = createEnv('restorable')
  const page = mount(`${p.rel}.js`, env, source)
  page.onLoad(p.options)
  await settle()
  page.onHide && page.onHide()
  env.resolve('ok')
  await settle()
  assert.equal(p.started(page, env), false, '恢复结束时在后台：不启动')
  page.onShow && page.onShow()
  await settle()
  assert.equal(p.started(page, env), true, '回到前台才启动')
}

for (const p of BETA) {
  const name = p.rel.split('/').pop()
  test(`${name}：过期但可恢复时先等恢复，成功后只启动一次`, () => betaStartsOnceAfterRestore(p, 'ok'))
  test(`${name}：恢复临时失败也只启动一次（照游客），不自动再恢复`, async () => {
    await betaStartsOnceAfterRestore(p, 'recoverable')
  })
  test(`${name}：恢复结束时在后台不启动，回到前台才启动`, () => betaBackgroundThenShow(p))
  test(`${name}：已登录时直接启动，不进恢复`, async () => {
    const env = createEnv('logged_in')
    const page = mount(`${p.rel}.js`, env)
    page.onLoad(p.options)
    await settle()
    assert.equal(p.started(page, env), true)
    assert.equal(env.restoreCalls(), 0)
  })
  test(`变异[${name}·不等恢复直接启动]必须判红`, async () => {
    const original = read(`${p.rel}.js`)
    const anchor = 'startAfterMemberGate(this, auth, api, '
    assert.ok(original.includes(anchor), `${name} 没有接入 startAfterMemberGate`)
    const mutated = original.split(anchor).join(';((p, a, b, start) => start())(this, auth, api, ')
    await assert.rejects(async () => betaStartsOnceAfterRestore(p, 'ok', mutated), (e) => e && e.code === 'ERR_ASSERTION')
  })
}

const BETA_ACTIONS = [
  { rel: 'pages/job-fit/job-fit', options: { taskId: 'T-1' }, tap: 'retry', run: '_retry' },
  { rel: 'pages/career-plan/career-plan', options: { taskId: 'T-1' }, tap: 'tapGenerate', run: '_tapGenerate' },
  { rel: 'pages/resume-build/resume-build', options: {}, tap: 'tapExport', run: '_export' },
  { rel: 'pages/resume-optimize/resume-optimize', options: {}, tap: 'exportResume', run: '_exportResume' },
]
for (const a of BETA_ACTIONS) {
  const name = a.rel.split('/').pop()
  test(`${name}「${a.tap}」：令牌过期但可恢复时先等恢复，恢复中再点不重复，成功只执行一次；后台期间成功不执行`, async () => {
    for (const background of [false, true]) {
      const env = createEnv('restorable')
      const page = mount(`${a.rel}.js`, env)
      page._memberStarted = true // 只验点击：页面启动另有用例
      let ran = 0
      page[a.run] = () => { ran += 1 }
      page[a.tap]()
      page[a.tap]()
      await settle()
      if (background) page.onHide()
      env.resolve('ok')
      await settle()
      if (background) { page.onShow(); await settle() }
      assert.equal(ran, background ? 0 : 1)
      assert.equal(env.restoreCalls(), 1)
    }
  })
}

// 自我探索「附到本人简历」在页面目录下的 append-print.js 里：页面沙箱给页面换的 auth / api 替身到不了它
// （它用 Node 的 require 直接拿真实模块）。所以这里单独把 append-print.js 装进沙箱、把它的 auth / api
// 换成同一套替身，真跑它的勾选逻辑——不是只钉写法。
function loadAppendPrint(env, mutate) {
  const file = path.join(MINIAPP, 'pages/self-explore/append-print.js')
  let source = fs.readFileSync(file, 'utf8')
  if (mutate) source = mutate(source)
  const realRequire = createRequire(file)
  const mod = { exports: {} }
  const sandbox = { console, wx: env.wx, module: mod, exports: mod.exports }
  sandbox.require = (id) => {
    if (id === '../../utils/api') return env.api
    if (id === '../../utils/auth') return env.auth
    return realRequire(id)
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: file })
  return mod.exports
}

function appendPage(env, mutate) {
  const { methods } = loadAppendPrint(env, mutate)
  const page = Object.assign({
    data: { canManage: true, appending: false, appendConfirmed: false, selectedResumeId: '', taskId: 'T-1' },
    setData(patch) { Object.assign(this.data, patch) },
  }, methods)
  return page
}

async function appendOnceAfterRestore(mutate) {
  const env = createEnv('restorable')
  const page = appendPage(env, mutate)
  page.toggleAppendConfirmed()
  page.toggleAppendConfirmed()
  await settle()
  assert.equal(page.data.appendConfirmed, false, '恢复中不勾选')
  assert.equal(env.restoreCalls(), 1, '恢复中再点同一个动作：忽略，不再发恢复')
  env.resolve('ok')
  await settle()
  assert.equal(page.data.appendConfirmed, true, '恢复成功：勾选')
  assert.equal(env.called('getMyDocuments'), 1, '只读一次本人简历列表')
  assert.equal(env.restoreCalls(), 1)
}
test('自我探索「附到本人简历」：恢复中再点同一动作忽略，恢复成功只勾选一次、只读一次简历列表', () => appendOnceAfterRestore())

test('自我探索「附到本人简历」：恢复临时失败提示可重试、不勾选；要登录走原来的登录弹窗', async () => {
  for (const outcome of ['recoverable', 'need_login']) {
    const env = createEnv('restorable')
    const page = appendPage(env)
    page.toggleAppendConfirmed()
    await settle()
    env.resolve(outcome)
    await settle()
    assert.equal(page.data.appendConfirmed, false)
    if (outcome === 'recoverable') assert.ok(env.toasts.some((t) => String(t).includes('暂时没能恢复登录')))
    else assert.ok(env.toasts.some((t) => String(t) === 'modal:请先登录'), '要登录：原来的「请先登录」弹窗')
  }
})

test('自我探索「附到本人简历」：恢复中页面切到后台，结果回来不勾选，回到前台也不补执行', async () => {
  const env = createEnv('restorable')
  const page = appendPage(env)
  page.toggleAppendConfirmed()
  await settle()
  page.onHide()
  env.resolve('ok')
  await settle()
  page.onShow()
  await settle()
  assert.equal(page.data.appendConfirmed, false)
})

test('变异[自我探索·附到简历不走会员闸门]必须判红', async () => {
  const anchor = "    gateMemberAction(this, auth, api, 'append', () => this._toggleAppendConfirmed(), {"
  const mutate = (src) => {
    assert.ok(src.includes(anchor), '变异锚点已失效')
    return src.split(anchor).join("    ;((p, a, b, k, run, h) => (auth.isLoggedIn() ? run() : h.needLogin()))(this, auth, api, 'append', () => this._toggleAppendConfirmed(), {")
  }
  await assert.rejects(async () => appendOnceAfterRestore(mutate), (e) => e && e.code === 'ERR_ASSERTION')
})
