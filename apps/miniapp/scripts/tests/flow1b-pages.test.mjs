/**
 * FLOW1b 页面闸门（10/17）：过期但可恢复时，页面先等恢复结果，不把「恢复中」当成未登录，
 * 网络、限流、服务端故障时留在本页给重试，只有确定需要登录才去登录页；只有主动退出才算退出。
 * 会话层（同一会员、失败分类、冷启动三态）在 session-generation.test.mjs 的 FLOW1b 段。
 * 这里的 auth / api 是替身：只描述「本地令牌状态」和「恢复结果」，验页面怎么用它们。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
const stripComments = (src) => src.replace(/<!--[\s\S]*?-->/g, '')

/** 本地令牌已过期、上次会员是 A、没有主动退出；restoreSession 按 outcome 给结果，ok 时令牌随之可用。 */
function restorableAuth() {
  const state = { loggedIn: false, member: 'A', revoked: false }
  const auth = {
    restorableMemberId: () => (state.revoked ? null : state.member),
    isLoggedIn: () => state.loggedIn,
    getUser: () => (state.loggedIn ? { id: 'A', nickname: '王同学', phoneMasked: '183****0001' } : null),
    canSilentResignin: () => !state.revoked && !!state.member,
    logout: () => { state.revoked = true; state.loggedIn = false },
  }
  return { auth, state }
}
function restoringApi(state, outcome, extra = {}) {
  const calls = { restore: 0 }
  const api = Object.assign({
    restoreSession: () => {
      calls.restore += 1
      if (outcome === 'ok') state.loggedIn = true
      if (outcome === 'need_login') state.revoked = true
      return Promise.resolve({ state: outcome })
    },
  }, extra)
  return { api, calls }
}
function wxStub() {
  const calls = { redirect: [], navigate: [], switchTab: [], back: 0, modal: [] }
  return {
    calls,
    wx: {
      redirectTo: (o) => calls.redirect.push(o.url), navigateTo: (o) => calls.navigate.push(o.url),
      switchTab: (o) => calls.switchTab.push(o.url), navigateBack: () => { calls.back += 1 },
      showModal: (o) => calls.modal.push(o), showToast() {}, showLoading() {}, hideLoading() {}, showActionSheet() {},
      getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 390 }), getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    },
  }
}

// ── 我的文档、消息通知：确定需要登录才跳；临时失败留在本页；恢复成功照常加载 ─────────────

for (const page of [
  { rel: 'pages/documents/documents.js', list: 'getMyDocuments', back: '/pages/documents/documents' },
  { rel: 'pages/notifications/notifications.js', list: 'getMyNotifications', back: '/pages/notifications/notifications' },
]) {
  test(`${page.rel}：恢复遇到临时失败时留在本页给重试，不跳登录页`, async () => {
    const { auth, state } = restorableAuth()
    const { api } = restoringApi(state, 'recoverable', { [page.list]: () => Promise.resolve([]), getDocumentConversionCapabilities: () => Promise.resolve({}) })
    const { wx, calls } = wxStub()
    const p = instantiate(loadPageDefinition(page.rel, { wx, modules: { api, auth } }))
    p.onLoad({}); await flush()
    assert.equal(calls.redirect.length, 0, '不送去登录页重收短信')
    assert.match(p.data.loadError, /暂时没能恢复登录/)
  })

  test(`${page.rel}：确定需要登录才跳登录页，并带回跳地址`, async () => {
    const { auth, state } = restorableAuth()
    const { api } = restoringApi(state, 'need_login', { [page.list]: () => Promise.resolve([]) })
    const { wx, calls } = wxStub()
    const p = instantiate(loadPageDefinition(page.rel, { wx, modules: { api, auth } }))
    p.onLoad({}); await flush()
    assert.deepEqual([...calls.redirect], [`/pages/launch/launch?returnTo=${encodeURIComponent(page.back)}`])
  })

  test(`${page.rel}：恢复成功就照常加载，不跳登录页`, async () => {
    const { auth, state } = restorableAuth()
    let listed = 0
    const { api, calls: apiCalls } = restoringApi(state, 'ok', {
      [page.list]: () => { listed += 1; return Promise.resolve(page.list === 'getMyNotifications' ? { items: [] } : []) },
      getDocumentConversionCapabilities: () => Promise.resolve({}),
    })
    const { wx, calls } = wxStub()
    const p = instantiate(loadPageDefinition(page.rel, { wx, modules: { api, auth } }))
    p.onLoad({}); await flush(); await flush()
    assert.equal(apiCalls.restore, 1)
    assert.equal(calls.redirect.length, 0)
    assert.equal(listed, 1)
  })
}

test('消息通知「点此重试」不再把点击事件当翻页参数（与我的文档同一类缺陷）', async () => {
  const requests = []
  const auth = { isLoggedIn: () => true, getUser: () => ({ id: 'A' }) }
  const api = { getMyNotifications: (q) => { requests.push(q); return Promise.resolve({ items: [], nextCursor: null }) } }
  const { wx } = wxStub()
  const p = instantiate(loadPageDefinition('pages/notifications/notifications.js', { wx, modules: { api, auth } }))
  p.onLoad({}); await flush(); await flush()
  assert.equal(requests.length, 1)
  p.reloadNotifications({ type: 'tap', currentTarget: { dataset: {} } }); await flush()
  assert.equal(requests.length, 2)
  assert.equal(requests[1].cursor, undefined)
  const wxml = stripComments(read('pages/notifications/notifications.wxml'))
  assert.doesNotMatch(wxml, /bindtap="loadNotifications"/)
})

// ── 「我的」、设置、首页：恢复中不显示「未登录 / 去登录」；可恢复时也能主动退出 ───────────

test('「我的」：可恢复时显示正在恢复、不出登录按钮；临时失败给「重试恢复登录」', async () => {
  const { auth, state } = restorableAuth()
  const { api } = restoringApi(state, 'recoverable', { getMeStats: () => new Promise(() => {}) })
  const { wx } = wxStub()
  const p = instantiate(loadPageDefinition('pages/me/me.js', { wx, modules: { api, auth } }))
  p.getTabBar = () => null
  p.onLoad({})
  p.onShow()
  assert.equal(p.data.restoring, true)
  assert.equal(p.data.isLoggedIn, false, '恢复中不伪装成已登录')
  await flush(); await flush()
  assert.equal(p.data.restoring, false)
  assert.equal(p.data.restoreFailed, true)
  const wxml = stripComments(read('pages/me/me.wxml'))
  assert.match(wxml, /wx:if="\{\{restoreFailed && !isLoggedIn\}\}"[^>]*bindtap="retryRestore"/)
  assert.match(wxml, /wx:elif="\{\{!isLoggedIn && !restoring\}\}"[^>]*bindtap="tapLogin"/, '恢复中不出登录按钮')
})

test('设置：过期但可恢复时照样给「退出登录」，退出走确认框，不跳登录页', async () => {
  const { auth, state } = restorableAuth()
  const { api } = restoringApi(state, 'recoverable')
  const { wx, calls } = wxStub()
  const p = instantiate(loadPageDefinition('pages/settings/settings.js', { wx, modules: { api, auth } }))
  p.onLoad({}); await flush()
  assert.equal(p.data.restorable, true)
  p.logout()
  assert.equal(calls.navigate.length, 0, '不去登录页')
  assert.equal(calls.modal[0].title, '退出登录')
  const wxml = stripComments(read('pages/settings/settings.wxml'))
  assert.match(wxml, /wx:if="\{\{isLoggedIn \|\| restorable\}\}"[^>]*bindtap="logout"/)
})

test('首页：可恢复时先显示「正在恢复上次的登录」，恢复成功后刷新成已登录', async () => {
  const { auth, state } = restorableAuth()
  const { api } = restoringApi(state, 'ok')
  const { wx } = wxStub()
  const p = instantiate(loadPageDefinition('pages/home/home.js', {
    wx,
    modules: { api, auth, 'pickup-summary': { load: () => new Promise(() => {}), pickupUrl: () => '' } },
  }))
  p.getTabBar = () => null
  p.onLoad({})
  p.onShow()
  assert.equal(p.data.restoring, true)
  assert.equal(p.data.isLoggedIn, false)
  await flush(); await flush()
  assert.equal(p.data.restoring, false)
  assert.equal(p.data.isLoggedIn, true)
  assert.equal(p.data.userName, '王同学')
})

// ── 登录页兜底：所有「去登录」都落到这里，先替用户恢复同一位会员 ─────────────────────

test('登录页兜底：可恢复时先恢复，成功就回到原处，不展示登录按钮、不收短信', async () => {
  const { auth, state } = restorableAuth()
  const { api } = restoringApi(state, 'ok', { getLegalVersions: () => Promise.resolve({}) })
  const { wx, calls } = wxStub()
  const p = instantiate(loadPageDefinition('pages/launch/launch.js', {
    wx, modules: { api, auth }, globals: { getCurrentPages: () => [{}, {}] },
  }))
  p.onLoad({}); await flush(); await flush()
  assert.equal(calls.back, 1, '回到上一页')
  assert.equal(p.data.showSms, false)
  const wxml = stripComments(read('pages/launch/launch.wxml'))
  assert.match(wxml, /<block wx:if="\{\{!restoring\}\}">/, '恢复中不展示登录按钮与协议')
})

test('登录页兜底：临时失败给「重试恢复」，同时保留手动登录；确定失败显示正常登录', async () => {
  const flaky = restorableAuth()
  const { api } = restoringApi(flaky.state, 'recoverable', { getLegalVersions: () => Promise.resolve({}) })
  const { wx, calls } = wxStub()
  const p = instantiate(loadPageDefinition('pages/launch/launch.js', { wx, modules: { api, auth: flaky.auth } }))
  p.onLoad({}); await flush(); await flush()
  assert.equal(p.data.restoreFailed, true)
  assert.equal(p.data.restoring, false)
  assert.equal(calls.back + calls.redirect.length + calls.switchTab.length, 0)

  const gone = restorableAuth()
  const r2 = restoringApi(gone.state, 'need_login', { getLegalVersions: () => Promise.resolve({}) })
  const w2 = wxStub()
  const p2 = instantiate(loadPageDefinition('pages/launch/launch.js', { wx: w2.wx, modules: { api: r2.api, auth: gone.auth } }))
  p2.onLoad({}); await flush(); await flush()
  assert.equal(p2.data.restoreFailed, false)
  assert.equal(p2.data.restoring, false)
})

test('登录页：没有恢复资格（从未登录或已主动退出）就不尝试恢复', async () => {
  const auth = { restorableMemberId: () => null, isLoggedIn: () => false, canSilentResignin: () => false }
  let restored = 0
  const api = { restoreSession: () => { restored += 1; return Promise.resolve({ state: 'ok' }) }, getLegalVersions: () => Promise.resolve({}) }
  const { wx } = wxStub()
  const p = instantiate(loadPageDefinition('pages/launch/launch.js', { wx, modules: { api, auth } }))
  p.onLoad({}); await flush()
  assert.equal(restored, 0)
  assert.equal(p.data.restoring, false)
})

// ── FLOW1a 补测（M5）：确认文件页在**收到**草稿那一刻就核对代际与会员，不等到使用时 ──────

test('确认文件页：跳转后换了会话，晚到的草稿在收到时就被拒，不进页面实例', async () => {
  const state = { gen: 3, user: { id: 'A' } }
  const api = {
    createPrintPiiScan: () => Promise.resolve({ id: 's', piiFindings: [] }),
    quoteMyPrintOrder: () => Promise.resolve({ amountCents: 0, billablePages: 1 }),
  }
  const auth = { sessionGeneration: () => state.gen, isSameSession: (g) => g === state.gen }
  const storage = { KEYS: { USER: 'zyd_user' }, get: (k, fb) => (k === 'zyd_user' && state.user ? state.user : fb) }
  const navs = []
  const { wx } = wxStub()
  wx.navigateTo = (o) => navs.push(o)
  const p = instantiate(loadPageDefinition('pages/print-upload/print-upload.js', { wx, modules: { api, auth, storage } }))
  p.onLoad({ fileId: 'f-1', name: encodeURIComponent('简历.pdf') }); await flush(); await flush()
  p.toStore()
  state.gen += 1
  navs[0].events.printDraft({ fileId: 'f-1', copies: 2, colorMode: 'color', duplex: 'simplex', terminalId: 'T' })
  assert.equal(p._draft, undefined, '代际变了，收到时就不收')
  state.gen -= 1
  state.user = { id: 'B' }
  navs[0].events.printDraft({ fileId: 'f-1', copies: 2, colorMode: 'color', duplex: 'simplex', terminalId: 'T' })
  assert.equal(p._draft, undefined, '会员变了，收到时就不收')
})
