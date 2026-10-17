/**
 * VIS3b（10/17）：页面层级、空态与操作。每条对应 cfbe56784 基线的一张开发者工具实际截图：
 *   打印 Tab 三层重复讲步骤、「今日提醒」写死「登录后查看」（16、16b）；AI 工具分组标题贴左（04）；
 *   首页待取件副标题被截断（03）；帮助 FAQ、U 盘格式标签贴着卡片边（19、30）；订单详情主按钮贴屏边（候选 10）；
 *   组包没选文件时「选择服务点」看着能点（17）；AI 服务记录空态没有出口（25）；助手问候态就显示可点的
 *   「保存本次要点」（11）；语音简历手打时题面仍写「请说出」（07b）；自我探索露出「服务端」（29）；
 *   简历搭建首屏先被语音入口占满（05）；微信一键登录拿不到手机号后只弹两秒提示（10/17 用户实测）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
const stripComments = (src) => src.replace(/<!--[\s\S]*?-->/g, '')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))

function cssRule(rel, selector) {
  const clean = read(rel).replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).includes(selector)) return m[2]
  }
  return null
}

test('打印 Tab：卡片不再重复讲流程，也不再写死「登录后查看」；六个入口和去处不变', () => {
  const wxml = stripComments(read('pages/print/print.wxml'))
  assert.doesNotMatch(wxml, /pc-flow|item\.flow/)
  const calls = []
  const wx = { navigateTo: (o) => calls.push(o.url) }
  const def = loadPageDefinition('pages/print/print.js', { wx, modules: {} })
  const paths = def.data.paths
  assert.equal(paths.length, 6)
  for (const p of paths) assert.equal(p.flow, undefined, p.id)
  assert.doesNotMatch(read('pages/print/print.js'), /登录后查看/)
  const page = instantiate(def)
  for (const p of paths) page.tapPath({ currentTarget: { dataset: { id: p.id } } })
  assert.deepEqual([...calls], [
    '/pages/documents/documents', '/pages/package-create/package-create', '/pages/orders/orders',
    '/pages/daily-report/daily-report', '/pages/kiosk-login/kiosk-login', '/pages/usb-import/usb-import',
  ])
})

test('AI 工具：分组标题和说明左右 16px，和卡片对齐', () => {
  assert.match(cssRule('pages/ai/ai.wxss', '.grp-head'), /padding:\s*26rpx 16px 14rpx/)
})

test('首页：待取件副标题最多两行，不再单行截断', () => {
  const rule = cssRule('pages/home/home.wxss', '.pickup-sub')
  assert.doesNotMatch(rule, /nowrap/)
  assert.match(rule, /-webkit-line-clamp:\s*2/)
})

test('帮助、U 盘指引：内容放进现成的 card-inner，不再贴着卡片边', () => {
  const help = stripComments(read('pages/help/help.wxml'))
  assert.match(help, /<view class="card"><view class="card-inner">\s*<view\s+class="faq-item tap"/)
  assert.match(read('pages/usb-import/usb-import.wxml'), /<view class="fmt-chips card-inner sm">/)
})

test('订单详情：底部按钮区左右 16px，不再贴屏幕边', () => {
  assert.match(cssRule('pages/order-detail/order-detail.wxss', '.od-actions'), /padding:\s*24rpx 16px 8rpx/)
})

test('组包：一份都没选时「选择服务点」置灰并声明不可用（点了仍由原逻辑提示，不改）', () => {
  const wxml = read('pages/package-create/package-create.wxml')
  assert.match(wxml, /class="btn primary tap \{\{selectedCount \? '' : 'disabled'\}\}"[^>]*bindtap="createPackage"[^>]*aria-disabled="\{\{!selectedCount\}\}"/)
  assert.match(read('pages/package-create/package-create.js'), /if \(!selected\.length\) \{\s*wx\.showToast\(\{ title: '请先选择文件'/)
})

test('AI 服务记录：空态有出口——问答为空去问小青，其余去 AI 工具 Tab', () => {
  const wxml = stripComments(read('pages/ai-records/ai-records.wxml'))
  const empty = wxml.slice(wxml.indexOf('<view class="card" wx:else>'), wxml.indexOf('<view class="compliance-note">'))
  assert.match(empty, /bindtap="emptyAction"/)
  assert.match(empty, /\{\{activeFilter === 'qa' \? '去问小青' : '去用 AI 工具'\}\}/)
  const calls = { switchTab: [], navigateTo: [] }
  const wx = {
    switchTab: (o) => calls.switchTab.push(o.url),
    navigateTo: (o) => calls.navigateTo.push(o.url),
    showToast() {}, navigateBack() {},
  }
  const def = loadPageDefinition('pages/ai-records/ai-records.js', { wx, modules: { auth: { isLoggedIn: () => true }, api: {} } })
  const page = instantiate(def)
  // 每点一次就看落点：只看最后的两个数组，分流写反时内容恰好一样，测不出来。
  page.data.activeFilter = 'all'
  page.emptyAction()
  assert.deepEqual([...calls.switchTab], ['/pages/ai/ai'], '全部筛选：去 AI 工具 Tab')
  assert.deepEqual([...calls.navigateTo], [])
  page.data.activeFilter = 'qa'
  page.emptyAction()
  assert.deepEqual([...calls.navigateTo], ['/pages/assistant/assistant'], '问答筛选：去问小青')
  assert.deepEqual([...calls.switchTab], ['/pages/ai/ai'], '问答筛选不切 Tab')
})

test('AI 助手：还没对话（没有 sessionId）时「保存本次要点」置灰并声明不可用', () => {
  const wxml = read('pages/assistant/assistant.wxml')
  assert.match(wxml, /class="as-sum-btn tap \{\{savingSummary \|\| !sessionId \? 'ib-disabled' : ''\}\}"[^>]*bindtap="saveSummary"\s*aria-role="button" aria-disabled="\{\{savingSummary \|\| !sessionId\}\}"/)
  assert.match(read('pages/assistant/assistant.js'), /if \(!this\.data\.sessionId\) \{\s*this\.setData\(\{ summaryHint: '先问小青至少一轮，才能保存本次要点。' \}\)/)
})

test('语音简历：手打时题面不再写「说」「转成文字」，语音时一字不变', () => {
  const Q = requireMiniapp('../pages/resume-voice/resume-voice-questions.js')
  const byId = Object.fromEntries(Q.QUESTIONS.map((q) => [q.id || q.key, q]))
  for (const id of ['name', 'expDesc', 'skills', 'selfIntro']) {
    const q = byId[id]
    const voiceShown = Q.promptFor(q, true)
    assert.equal(voiceShown.prompt, q.prompt, `${id} 语音题面不变`)
    assert.equal(voiceShown.hint, q.hint || '')
    const typed = Q.promptFor(q, false)
    assert.doesNotMatch(`${typed.prompt}${typed.hint}`, /说出|说就行|你自己的话说|不想说|转成文字/, id)
  }
  assert.equal(Q.promptFor(byId.name, false).prompt, '请填写你的姓名。')
  assert.equal(Q.promptFor(byId.city, false).prompt, byId.city.prompt, '没有文字版的题沿用原句')
})

test('语音简历：这题改用手打时，页面上的题面跟着换', () => {
  const wx = { showToast() {}, showModal() {}, navigateTo() {}, redirectTo() {}, navigateBack() {}, setStorageSync() {}, getStorageSync() { return '' } }
  const voice = { cancel() {}, start() {}, stop() {} }
  const def = loadPageDefinition('pages/resume-voice/resume-voice.js', { wx, modules: { voice: voice, 'voice-recorder': voice, api: {}, storage: { get: () => null, set() {}, KEYS: {} }, 'ai-access': {} } })
  const page = instantiate(def)
  page.data.qIndex = 0
  page.data.qPrompt = '请说出你的姓名。'
  page.typeThisQuestion()
  assert.equal(page.data.qVoice, false)
  assert.equal(page.data.qPrompt, '请填写你的姓名。')
  assert.equal(page.data.qHint, '填好后自己看一眼，确认后才写进简历。')
})

test('自我探索：同意区和底部说明这两句不再露「服务端」，意思不变（其余几处另起文案批）', () => {
  const visible = stripComments(read('pages/self-explore/self-explore.wxml'))
  assert.match(visible, /<view class="cb-desc">不勾选无法提交：系统也会拒绝没有这项同意的请求。<\/view>/)
  assert.match(visible, /<view class="compliance-note">作答内容不会上传原文，只保存作答摘要和按固定权重算出的五维强度。<\/view>/)
  assert.doesNotMatch(visible, /服务端同样会拒绝|服务端只保存作答摘要/)
})

test('简历搭建：第 1 段基本信息卡在前，语音入口和说明跟在后面；段落的 if/elif 链不变', () => {
  const wxml = stripComments(read('pages/resume-build/resume-build.wxml'))
  const basic = wxml.indexOf('<view wx:if="{{step === 0}}" class="card rise-d2">')
  const voice = wxml.indexOf('rb-voice-go')
  const notice = wxml.indexOf('这是一份表单，不是对话。')
  assert.ok(basic > 0 && voice > basic && notice > voice, '顺序应为 基本信息 → 语音入口 → 说明')
  assert.match(wxml, /<view wx:if="\{\{step === 0\}\}" class="card rise-d2">[\s\S]*?<\/view><\/view>\s*<view wx:elif="\{\{step === 1\}\}"/,
    '第 2 段的 wx:elif 仍紧跟基本信息卡')
  const voiceCard = wxml.lastIndexOf('<view wx:if="{{step === 0}}" class="card', voice)
  assert.ok(voiceCard > wxml.indexOf('<view wx:else class="card rise-d2">'), '语音入口在整条 if/elif 链之后')
})

test('登录页：微信一键登录拿不到手机号时，直接打开现有的短信验证码表单', () => {
  const toasts = []
  const wx = { showToast: (o) => toasts.push(o.title), showModal() {}, showLoading() {}, hideLoading() {} }
  const def = loadPageDefinition('pages/launch/launch.js', { wx, modules: { api: {}, auth: { isLoggedIn: () => false } } })
  const page = instantiate(def)
  page.data.agreed = true
  page.data.legalBlocked = false
  page.data.showSms = false
  page.onGetPhoneNumber({ detail: { errMsg: 'getPhoneNumber:fail 用户绑定的手机需要进行验证，请在客户端完成短信验证步骤' } })
  assert.equal(page.data.showSms, true)
  assert.deepEqual([...toasts], ['未获取到手机号，可用短信验证码登录'])
})

test('登录页：没勾协议时仍只提示勾选，不打开短信表单', async () => {
  const toasts = []
  const wx = { showToast: (o) => toasts.push(o.title), showModal() {}, showLoading() {}, hideLoading() {} }
  const def = loadPageDefinition('pages/launch/launch.js', { wx, modules: { api: {}, auth: { isLoggedIn: () => false } } })
  const page = instantiate(def)
  page.data.agreed = false
  page.data.legalBlocked = false
  page.data.showSms = false
  page.onGetPhoneNumber({ detail: {} })
  await flush()
  assert.equal(page.data.showSms, false)
  assert.deepEqual([...toasts], ['请先阅读并同意服务协议和隐私政策'])
})
