/**
 * 不含 AI 的提审版里那几处「看版本的字」：每处两版各加载一次，逐字对定稿；不靠目录当前停在哪个版本。
 * 字由合规八、合规十 10/12 定；完整版那几句一字不动。审核员不登录就看得到的登录页、关于页、「我的」排在前面。
 *
 * 页面用 page-sandbox 的成套替身（variantModules）；隐私页那句在页面目录下的辅助模块 consents.js 里，
 * 成套替身管不到它，这里像 ai-access.test 那样直接换掉它引用的 build-variant 再加载。
 * 由 verify:page-lifecycle 拉起，进 verify:static。不发网络请求。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition, variantModules } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const wx = {}

function page(rel, variant, modules = {}, pageWx = wx) {
  return instantiate(loadPageDefinition(rel, { wx: pageWx, modules: { ...variantModules(variant), ...modules } }))
}

function readMiniapp(rel) {
  return fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
}

// 登录页人人都会看到。不含 AI 的提审版里，品牌下那行和「登录后继续」下那行不提 AI 和简历（合规八 10/12 定字）。
test('不含 AI 版登录页两句不提 AI，完整版那两句原样', () => {
  assert.equal(page('pages/launch/launch.js', 'no-ai', { api: {}, auth: {} }).data.aiEnabled, false)
  assert.equal(page('pages/launch/launch.js', 'full', { api: {}, auth: {} }).data.aiEnabled, true)

  // 两句都是看版本的一对：完整版原句挂在 aiEnabled 上，紧跟着不含 AI 的那句。
  const wxml = readMiniapp('pages/launch/launch.wxml')
  assert.match(wxml, /<view wx:if="\{\{aiEnabled\}\}" class="launch-sub">AI 简历 · 文档打印<\/view>\s*<view wx:else class="launch-sub">求职材料 · 文档打印<\/view>/)
  assert.match(wxml, /<view wx:if="\{\{aiEnabled\}\}" class="sheet-sub">同步本人简历、文档、打印订单和 AI 服务记录<\/view>\s*<view wx:else class="sheet-sub">同步本人文档和打印订单<\/view>/)
  // 登录页别处没有不看版本的「AI」。
  const lines = wxml.replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((line) => line.includes('AI'))
  for (const line of lines) assert.match(line, /wx:if="\{\{aiEnabled\}\}"/, `登录页这行提到 AI 却不看版本：${line.trim()}`)
})

// 不含 AI 版里材料模板页没有入口：关于页那句和审核说明都不能说有模板（合规八 10/12 定字）。
// 哪天给模板页加了入口，再连同这条一起改。
test('不含 AI 版关于页和审核说明都不提材料模板，完整版那句不变', () => {
  const noAi = page('pages/about/about.js', 'no-ai')
  assert.equal(noAi.data.notice, '本平台提供求职材料与文档打印服务，不提供招聘信息、岗位投递或人力资源服务。')
  const full = page('pages/about/about.js', 'full')
  assert.equal(full.data.notice.includes('AI'), true)
  assert.notEqual(full.data.notice, noAi.data.notice)
  const notes = JSON.parse(readMiniapp('review-variants/variants.json'))
  assert.equal(notes['no-ai'].reviewNote.includes('模板'), false)
})

// 「我的」没登录那一行（审核员不登录就看得到）：不含 AI 版没有简历这一栏，不说「同步简历」（合规十 10/12 定字）。
test('不含 AI 版「我的」没登录那行不提简历，完整版那句原样', () => {
  assert.equal(page('pages/me/me.js', 'no-ai', { auth: { isLoggedIn: () => false }, api: {} }).data.aiEnabled, false)
  assert.equal(page('pages/me/me.js', 'full', { auth: { isLoggedIn: () => false }, api: {} }).data.aiEnabled, true)
  const wxml = readMiniapp('pages/me/me.wxml')
  // 三分支依次：登录了显示手机号；没登录且完整版；没登录且不含 AI 版。
  assert.match(wxml, /<view wx:if="\{\{isLoggedIn\}\}" class="profile-meta">[^\n]*<\/view>[\s\S]*?<view wx:elif="\{\{aiEnabled\}\}" class="profile-meta">未登录 · 登录后同步本人简历、文档与打印订单<\/view>\s*(?:<!--[\s\S]*?-->\s*)?<view wx:else class="profile-meta">未登录 · 登录后同步本人文档与打印订单<\/view>/)
})

// 打印参数页：不含 AI 版没有 AI 成果可选，两句都不提「真实 AI 成果」（合规十 10/12 定字）。
test('不含 AI 版打印参数页没选文件时两句不提 AI 成果，完整版原样', () => {
  const expect = {
    full: ['从本人文档或真实 AI 成果选择', '本版本只允许从本人已上传文档或真实 AI 成果进入打印，不能用占位文件建单。'],
    'no-ai': ['从本人文档选择', '本版本只允许从本人已上传文档进入打印，不能用占位文件建单。'],
  }
  for (const variant of ['full', 'no-ai']) {
    const modals = []
    const pageWx = { showModal(opts) { modals.push(opts) }, showToast() {} }
    const p = page('pages/print-upload/print-upload.js', variant, { api: {} }, pageWx)
    assert.equal(p.data.noFileHint, expect[variant][0], `${variant} 没选文件时那行`)
    assert.equal(p._passPrintGate(), false)
    assert.equal(modals.length, 1)
    assert.equal(modals[0].content, expect[variant][1], `${variant} 没选文件就继续的弹框`)
  }
  // 界面上那一处取的是 noFileHint，不再写死字。
  const wxml = readMiniapp('pages/print-upload/print-upload.wxml')
  assert.equal(wxml.includes('真实 AI 成果'), false)
  assert.match(wxml, /: noFileHint\}\}/)
})

// 设置页退出登录弹框（登录后才看得到）：不含 AI 版不说「同步简历」（合规十 10/12 定字）。
test('不含 AI 版退出登录弹框不提简历，完整版原样', () => {
  const expect = {
    full: '退出后需重新登录才能同步简历、文档与打印记录。',
    'no-ai': '退出后需重新登录才能同步文档与打印记录。',
  }
  for (const variant of ['full', 'no-ai']) {
    const modals = []
    const pageWx = { showModal(opts) { modals.push(opts) } }
    const p = page('pages/settings/settings.js', variant, { api: {}, auth: { isLoggedIn: () => true } }, pageWx)
    p.setData({ isLoggedIn: true, loggingOut: false })
    p.logout()
    assert.equal(modals.length, 1)
    assert.equal(modals[0].title, '退出登录')
    assert.equal(modals[0].content, expect[variant], `${variant} 退出登录弹框`)
  }
})

/**
 * 隐私页「年龄声明与 AI 授权」一节的辅助模块（pages/privacy/consents.js）：页面的成套替身管不到它，
 * 这里自己加载，把它引用的 build-variant 换成生成脚本写出的那一版；api、auth、ai-access 给替身（没登录、没声明）。
 */
function loadConsents(variant) {
  const file = path.join(MINIAPP, 'pages/privacy/consents.js')
  const flags = { full: { VARIANT: 'full', AI_ENABLED: true }, 'no-ai': { VARIANT: 'no-ai', AI_ENABLED: false } }
  const stubs = {
    api: { getAiConsentStatus: () => Promise.reject(new Error('没登录不该读服务端')) },
    auth: { isLoggedIn: () => false },
    'ai-access': {
      AGE_SCOPE: 'age_14_plus',
      VOICE_SCOPE: 'voice_recording',
      RESUME_AI_SCOPE: 'resume_ai',
      isDeclared: () => false,
      declaredAt: () => 0,
    },
    'build-variant': flags[variant],
  }
  const mod = { exports: {} }
  const sandbox = { console }
  vm.createContext(sandbox)
  const compiled = vm.compileFunction(fs.readFileSync(file, 'utf8'), ['module', 'exports', 'require'], { parsingContext: sandbox, filename: file })
  compiled(mod, mod.exports, (spec) => {
    const name = String(spec).replace(/^.*\//, '').replace(/\.js$/, '')
    assert.ok(Object.prototype.hasOwnProperty.call(stubs, name), `consents.js 引用了没给替身的模块：${spec}`)
    return stubs[name]
  })
  return mod.exports
}

// 隐私页年龄那行：照实说什么时候问（上传文件、打印前的隐私检查会弹年龄确认框；合规十 10/12 定字）。
test('不含 AI 版隐私页年龄那行照实说什么时候问，完整版原样', async () => {
  const expect = {
    full: '还没有声明：第一次用 AI、上传简历或录音时会先问你',
    'no-ai': '还没有声明：第一次上传或打印文件时会先问你',
  }
  for (const variant of ['full', 'no-ai']) {
    const result = await loadConsents(variant).load()
    await flush()
    assert.equal(result.age.on, false)
    assert.equal(result.age.text, expect[variant], `${variant} 隐私页年龄那行`)
  }
})
