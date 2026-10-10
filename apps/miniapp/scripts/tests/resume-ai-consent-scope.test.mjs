/**
 * 「简历 AI 授权」管到哪几项（第八次，依据合规意见 2026-10-10）：页面这一层的真跑测试。
 * 请求层那一半（403 → 确认框 → 写账号 → 重发）在 ai-access.test.mjs，这里只看页面拿到结果以后：
 *
 *   - 职业规划页：点「暂不使用」后留在原页、说明内容没有发给 AI，不自己再发、不自己再问；
 *     他自己再点一次才重新走。
 *   - 模拟面试入口页：小程序上的模拟面试不带简历（不传 resumeFileId），所以这一项在小程序上
 *     不会被这项授权拦。以后谁要让它带简历，要先把「被拒后退回不带简历」接上，这条才许改。
 *   - 隐私页「简历 AI 授权」一行和弹窗：两句是合规定的字，说的是「凡是要把简历内容发给 AI 的功能」。
 *
 * 末尾是反向变异。由 verify:page-lifecycle 拉起。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
const { SHARED_USER_MESSAGES } = requireMiniapp('../utils/user-error.js')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')

const CAREER_PLAN = 'pages/career-plan/career-plan.js'
const INTERVIEW_ENTRY = 'pages/interview-entry/interview-entry.js'
const CONSENTS = 'pages/privacy/consents.js'

function declined() {
  const e = new Error(SHARED_USER_MESSAGES.AI_RESUME_NOT_CONSENTED)
  e.code = 'AI_RESUME_NOT_CONSENTED'
  return e
}

// ── 职业规划页 ──────────────────────────────────────────────────────────

async function careerPlanDeclineStaysOnPage({ source } = {}) {
  const generates = []
  const wx = { calls: { modal: [], nav: [] } }
  wx.showModal = (o) => wx.calls.modal.push(o)
  wx.showToast = () => {}
  wx.navigateTo = (o) => wx.calls.nav.push(o && o.url)
  wx.redirectTo = wx.navigateTo
  wx.navigateBack = () => wx.calls.nav.push('back')
  wx.switchTab = wx.navigateTo
  const api = {
    getCareerPlan: () => Promise.reject(Object.assign(new Error('没有记录'), { statusCode: 404, code: 'CAREER_PLAN_NOT_FOUND' })),
    generateCareerPlan: () => { const d = deferred(); generates.push(d); return d.promise },
  }
  const def = loadPageDefinition(CAREER_PLAN, {
    wx,
    source,
    modules: {
      api,
      auth: { isLoggedIn: () => true },
      storage: { KEYS: { RESUME_TASK: 'RESUME_TASK' }, get: () => ({ taskId: 't1', accessToken: '', fileName: '简历.pdf' }), set: () => true },
    },
  })
  const page = instantiate(def)
  page.onLoad({})
  await flush()
  assert.equal(page.data.phase, 'ready', '有已解析的简历、还没有规划：可以生成')

  page.tapGenerate()
  assert.equal(generates.length, 1)
  generates[0].reject(declined())
  await flush()
  assert.equal(page.data.phase, 'failed', '留在原页的说明态，不是空白也不是转圈')
  assert.match(page.data.failMsg, /没有同意使用简历 AI/)
  assert.match(page.data.failMsg, /没有发给 AI/)
  assert.equal(page.data.needReupload, false, '不是简历的问题，不让他去重新上传')
  assert.equal(page.data.plan, null, '没有任何规划内容')
  assert.equal(generates.length, 1, '页面不自己再发（不反复弹）')
  assert.equal(wx.calls.nav.length, 0, '不跳走')
  assert.equal(wx.calls.modal.length, 0, '页面自己不另弹框')

  // 他自己再点一次，才重新走一遍（这一次会再被问）。
  page.tapGenerate()
  assert.equal(generates.length, 2)
  assert.equal(page.data.phase, 'running')
  page.onUnload()
}

// ── 模拟面试入口页 ───────────────────────────────────────────────────────

async function interviewEntrySendsNoResume({ source } = {}) {
  const sent = []
  const wx = { showToast: () => {}, navigateTo: () => {}, redirectTo: () => {}, navigateBack: () => {}, switchTab: () => {} }
  const def = loadPageDefinition(INTERVIEW_ENTRY, {
    wx,
    source,
    modules: {
      api: { createInterview: (p) => { sent.push(p); return Promise.resolve({ sessionId: 's1', accessToken: '', questionTarget: 6 }) } },
      storage: { KEYS: { INTERVIEW_SESSION: 'INTERVIEW_SESSION' }, get: () => null, set: () => true },
    },
  })
  const page = instantiate(def)
  page.onLoad({})
  page.inputPosition({ detail: { value: '行政助理' } })
  await page.tapStart()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].position, '行政助理')
  assert.equal(Object.prototype.hasOwnProperty.call(sent[0], 'resumeFileId'), false, '小程序的模拟面试不带简历')
  assert.ok(!JSON.stringify(sent[0]).includes('resume'), '请求里没有任何简历字段')
}

// ── 隐私页「简历 AI 授权」一行与弹窗 ──────────────────────────────────────

const REVOKE_TEXT = '撤回后，凡是要把简历内容发给 AI 的功能都会先问你，不同意就不发。已经生成的结果还在「我的」里，可以自己删。'
const NOT_GRANTED_TEXT = '第一次用到要把简历内容发给 AI 的功能时会先问你。同意后，简历内容发送到系统里的 AI 分析，结果只给你本人看。'

function loadConsents({ source, rows }) {
  const wx = { calls: { modal: [], toast: [] } }
  wx.showModal = (o) => wx.calls.modal.push(o)
  wx.showToast = (o) => wx.calls.toast.push(o)
  const revokes = []
  const api = {
    getAiConsentStatus: () => Promise.resolve(rows),
    revokeAiConsent: (scope) => { revokes.push(scope); return Promise.resolve({}) },
  }
  const mod = { exports: {} }
  const sandbox = {
    wx,
    console,
    module: mod,
    exports: mod.exports,
    require: (id) => {
      const name = id.replace(/^.*\//, '').replace(/\.js$/, '')
      if (name === 'api') return api
      if (name === 'auth') return { isLoggedIn: () => true }
      return requireMiniapp(`../utils/${name}.js`)
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(typeof source === 'string' ? source : read(CONSENTS), sandbox, { filename: CONSENTS })
  return { consents: mod.exports, wx, revokes }
}

async function privacyResumeRowAndDialogs({ source } = {}) {
  // 已授权：一行写清共用范围；点开是撤回说明，确认后才撤。
  const on = loadConsents({ source, rows: [{ scope: 'resume_ai', granted: true, grantedAt: '2026-10-10T02:00:00Z' }] })
  const viewOn = await on.consents.load()
  assert.equal(viewOn.resume.on, true)
  assert.match(viewOn.resume.text, /要把简历内容发给 AI 的功能共用/)
  assert.ok(!/诊断、优化、生成共用/.test(viewOn.resume.text), '不再只点三项')
  const pageOn = { data: { consents: viewOn }, setData(p) { Object.assign(this.data, p) }, loadConsents() {} }
  on.consents.promptResume(pageOn)
  assert.equal(on.wx.calls.modal.length, 1)
  assert.equal(on.wx.calls.modal[0].content, REVOKE_TEXT)
  assert.equal(on.revokes.length, 0, '点确认之前不撤')
  on.wx.calls.modal[0].success({ confirm: false, cancel: true })
  assert.equal(on.revokes.length, 0, '点「保留」不撤')
  on.wx.calls.modal[0].success({ confirm: true })
  await flush()
  assert.equal(on.revokes.length, 1)
  assert.equal(on.revokes[0], 'resume_ai')

  // 没授权：只说明什么时候会问，没有可撤的东西。
  const off = loadConsents({ source, rows: [] })
  const viewOff = await off.consents.load()
  assert.equal(viewOff.resume.on, false)
  assert.match(viewOff.resume.text, /第一次用到要把简历内容发给 AI 的功能时会先问你/)
  const pageOff = { data: { consents: viewOff }, setData(p) { Object.assign(this.data, p) }, loadConsents() {} }
  off.consents.promptResume(pageOff)
  assert.equal(off.wx.calls.modal[0].content, NOT_GRANTED_TEXT)
  assert.equal(off.wx.calls.modal[0].showCancel, false)
  off.wx.calls.modal[0].success({ confirm: true })
  await flush()
  assert.equal(off.revokes.length, 0)
}

const SCENARIOS = { careerPlanDeclineStaysOnPage, interviewEntrySendsNoResume, privacyResumeRowAndDialogs }

for (const [name, run] of Object.entries(SCENARIOS)) test(name, () => run())

// ── 反向变异 ────────────────────────────────────────────────────────────

function mutated(rel, from, to) {
  const src = read(rel)
  assert.ok(src.includes(from), `变异锚点不在 ${rel}：${from}`)
  return src.replace(from, to)
}

const MUTATIONS = [
  ['职业规划被拒后自己再发', 'careerPlanDeclineStaysOnPage',
    mutated(CAREER_PLAN, "        this._fail((err && err.message) || '生成失败,请稍后重试')", '        this.setData({ phase: \'ready\' }); this.tapGenerate()')],
  ['职业规划被拒后让人重新上传', 'careerPlanDeclineStaysOnPage',
    mutated(CAREER_PLAN, "        this._fail((err && err.message) || '生成失败,请稍后重试')", "        this._fail((err && err.message) || '生成失败,请稍后重试', true)")],
  ['职业规划被拒后不说原因', 'careerPlanDeclineStaysOnPage',
    mutated(CAREER_PLAN, "        this._fail((err && err.message) || '生成失败,请稍后重试')", "        this._fail('生成失败,请稍后重试')")],
  ['模拟面试偷偷带上简历', 'interviewEntrySendsNoResume',
    mutated(INTERVIEW_ENTRY, '        durationMin: this.data.activeDuration,', "        durationMin: this.data.activeDuration,\n        resumeFileId: 'f1',")],
  ['撤回弹窗退回旧句', 'privacyResumeRowAndDialogs',
    mutated(CONSENTS, '凡是要把简历内容发给 AI 的功能都会先问你，不同意就不发。', '简历诊断、优化、生成会先问你，不同意就不发给 AI。')],
  ['没授权弹窗退回旧句', 'privacyResumeRowAndDialogs',
    mutated(CONSENTS, "'第一次用到要把简历内容发给 AI 的功能时会先问你。同意后", "'第一次用简历诊断、优化、生成时会先问你。同意后")],
  ['没点确认就撤回', 'privacyResumeRowAndDialogs',
    mutated(CONSENTS, '      if (!granted || !r.confirm) return\n      page.setData({ busy: \'正在撤回…\' })\n      api.revokeAiConsent(aiAccess.RESUME_AI_SCOPE)', '      if (!granted) return\n      page.setData({ busy: \'正在撤回…\' })\n      api.revokeAiConsent(aiAccess.RESUME_AI_SCOPE)')],
]

for (const [label, scenario, source] of MUTATIONS) {
  test(`变异：${label} → ${scenario} 判红`, async () => {
    await assert.rejects(() => SCENARIOS[scenario]({ source }), (err) => {
      assert.equal(err && err.code, 'ERR_ASSERTION', `应当是断言失败，实际：${err && err.stack}`)
      return true
    })
  })
}
