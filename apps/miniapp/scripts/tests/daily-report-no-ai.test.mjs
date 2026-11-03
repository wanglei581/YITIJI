import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REPORT = { date: '2026-11-03', empty: false, modules: [
  { type: 'pickup_expiring', items: [{ orderId: 'mine', hoursLeft: 3, route: '/pages/orders/orders' }] },
  { type: 'broadcast', item: { title: '平台通知', route: '/pages/notifications/notifications' } },
] }

function runtime(aiFailureCode) {
  const store = new Map()
  const calls = { request: [], modal: [], aiRequest: [] }
  const wx = {
    getStorageSync: (key) => store.get(key) || '',
    setStorageSync: (key, value) => { store.set(key, value) },
    removeStorageSync: (key) => { store.delete(key) },
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    getFileSystemManager: () => ({}),
    request: (options) => {
      calls.request.push(options)
      if (options.url.endsWith('/assistant/daily-report')) {
        options.success({ statusCode: 200, data: REPORT })
      } else {
        calls.aiRequest.push(options)
        options.success({ statusCode: 503, data: { error: { code: aiFailureCode, message: 'AI 不可用' } } })
      }
    },
    showModal: (options) => { calls.modal.push(options) },
  }
  const sandbox = { wx, console, setTimeout, clearTimeout, getApp: () => ({ globalData: {} }) }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  const cache = new Map()
  const load = (name) => {
    if (cache.has(name)) return cache.get(name).exports
    const file = path.join(MINIAPP, 'utils', `${name}.js`)
    const mod = { exports: {} }
    cache.set(name, mod)
    vm.compileFunction(fs.readFileSync(file, 'utf8'), ['module', 'exports', 'require'], { parsingContext: sandbox, filename: file })(
      mod, mod.exports, (spec) => load(String(spec).replace(/^\.\//, '').replace(/\.js$/, '')))
    return mod.exports
  }
  const api = load('api') // 同时注册真实 AI 请求前置；本测试必须证实今日提醒不会走进去。
  const auth = load('auth')
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const token = `${enc({ alg: 'HS256' })}.${enc({ sub: 'member', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
  assert.equal(auth.saveSession({ token, user: { id: 'member' } }), true)
  return { api, auth, wx, calls }
}

for (const [state, aiFailureCode] of [
  ['未同意 AI', 'AI_DECLARATION_REQUIRED'],
  ['AI 不可用', 'AI_PAUSED'],
  ['AI 额度用完', 'AI_BUDGET_EXHAUSTED'],
]) {
  test(`今日提醒：${state}时订单与通知照常展示，不弹 AI 授权也不报错`, async () => {
    const ctx = runtime(aiFailureCode)
    const page = instantiate(loadPageDefinition('pages/daily-report/daily-report.js', {
      wx: ctx.wx, modules: { api: ctx.api, auth: ctx.auth },
    }))
    page.onLoad()
    page.onShow()
    await flush()
    assert.equal(ctx.calls.request.length, 1, '只发今日提醒请求')
    assert.equal(ctx.calls.aiRequest.length, 0, '没有发起受阻的 AI 请求')
    assert.match(ctx.calls.request[0].url, /\/api\/v1\/assistant\/daily-report$/)
    assert.equal(ctx.calls.request[0].method, 'POST')
    assert.match(ctx.calls.request[0].header.Authorization, /^Bearer /)
    assert.equal(ctx.calls.modal.length, 0, '不问 AI 授权')
    assert.equal(page.data.loading, false)
    assert.equal(page.data.error, '')
    assert.equal(page.data.empty, false)
    assert.equal(page.data.modules.length, 2)
    assert.equal(page.data.modules[0].rows[0].title, '打印订单到机码')
    assert.equal(page.data.modules[1].title, '平台通知')
  })
}

test('从零建简历：第 6 段提交提示后可直接原样导出，第 1 段不显示，缺项仍校验', () => {
  const wxml = fs.readFileSync(path.join(MINIAPP, 'pages/resume-build/resume-build.wxml'), 'utf8')
  const form = wxml.slice(wxml.indexOf('<!-- ── 分段填写 ── -->'))
  const buttons = [...form.matchAll(/<view\b[^>]*\bbindtap="tapExportDraft"[^>]*>[\s\S]*?<\/view>/g)]
  assert.equal(buttons.length, 1, '填写页只有一个原样导出入口')
  const [button] = buttons[0]
  const note = form.indexOf('提交后 AI 会对你填的描述文字做表达润色')
  const noteEnd = form.indexOf('</view>', note)
  const compliance = form.indexOf('<view class="compliance-note">', noteEnd)
  assert.ok(note >= 0 && buttons[0].index > noteEnd && buttons[0].index < compliance, '按钮紧跟第 6 段提交提示')
  const condition = button.match(/wx:if="\{\{([^"}]+)\}\}"/)
  assert.ok(condition, '按钮有显示条件')
  const visible = new Function('step', 'historyMode', `return ${condition[1]}`)
  assert.equal(visible(5, false), true, '新建简历第 6 段可见')
  assert.equal(visible(0, false), false, '第 1 段不可见')
  assert.equal(visible(5, true), false, '历史结果不可见')
  assert.match(button, /class="btn lg ghost-ink block tap \{\{exporting \? 'disabled' : ''\}\}"/)
  assert.match(button, /按填写内容导出（未润色）/)

  const modals = []
  const exports = []
  const wx = { showModal: (options) => { modals.push(options) }, showLoading: () => {} }
  const modules = {
    api: { exportGeneratedResume: (body) => { exports.push(body); return new Promise(() => {}) } },
    auth: { isLoggedIn: () => true },
  }
  const page = instantiate(loadPageDefinition('pages/resume-build/resume-build.js', {
    wx, modules,
  }))
  page.onLoad({})
  page.setData({ step: 5, basic: { name: '小李' }, intention: { position: '目标方向' }, selfIntro: '我自己写的介绍' })
  assert.equal(page.data.phase, 'form', '未提交 AI')
  page.tapExportDraft()
  assert.equal(exports.length, 1, '不经 AI 失败即可请求原样导出')
  assert.equal(exports[0].draft, true)
  assert.equal(exports[0].summary, '我自己写的介绍')
  assert.equal(page.data.exporting, true, '导出中按钮进入禁用态')
  page.tapExportDraft()
  assert.equal(exports.length, 1, '导出中不会重复请求')

  const incomplete = instantiate(loadPageDefinition('pages/resume-build/resume-build.js', { wx, modules }))
  incomplete.onLoad({})
  incomplete.setData({ step: 5 })
  incomplete.tapExportDraft()
  assert.equal(modals.length, 1)
  assert.equal(modals[0].title, '还差几项')
  assert.equal(exports.length, 1, '缺项未请求后端')
})
