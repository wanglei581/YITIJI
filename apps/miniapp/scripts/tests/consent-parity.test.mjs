/**
 * 手机上的说明与同意和大屏同一套（整改计划 8-11，合规 10/10 答复）。
 * 两处改动各有真跑用例；合规点名要的四样（六条说明同源同版本、提交时带的内容、
 * 录音同意、导出标识说明）各给一条真跑断言。两端要「同一句」的地方直接读对端源码比对，
 * 改一边不改另一边会红。由 verify:ai-access 拉起，串在 verify:static 里。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REPO = path.resolve(MINIAPP, '../..')
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const require = createRequire(import.meta.url)

/** 真跑 utils/*.js（request、ai-access、api 等），只有 wx 是替身。写法同 ai-access.test.mjs。 */
function runtime() {
  const store = new Map()
  const calls = { request: [], modal: [] }
  const wx = {
    getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
    setStorageSync: (key, value) => { store.set(key, JSON.parse(JSON.stringify(value))) },
    removeStorageSync: (key) => { store.delete(key) },
    request: (o) => { calls.request.push(o) },
    uploadFile() {}, login() {}, navigateTo() {},
    showModal: (o) => { calls.modal.push(o) },
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    getFileSystemManager: () => ({}),
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
  load('api-legal-consent') // 加载即向 request.js 注册 AI 前后置
  return { calls, load, ai: load('ai-access'), api: load('api'), auth: load('auth') }
}
const token = (sub) => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
}
const urls = (ctx) => ctx.calls.request.map((c) => c.url.replace(/^.*\/api\/v1/, ''))

// ── 改动一：自我探索可选勾选，两端同一句 ─────────────────────────────────

test('自我探索可选勾选的文字和大屏是同一句', () => {
  const kiosk = read('apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx').match(/testId="self-assessment-consent-sensitive"[\s\S]*?label="([^"]+)"/)
  assert.ok(kiosk, '大屏的可选勾选没找到')
  assert.equal(kiosk[1], '同意作答涉及偏好 / 风格的敏感题（可选）')
  const wxml = read('apps/miniapp/pages/self-explore/self-explore.wxml')
  const mini = wxml.match(/bindtap="toggleSensitive"[\s\S]*?<view class="cb-title">([^<]+)<\/view>/)
  assert.ok(mini, '小程序的可选勾选没找到')
  assert.equal(mini[1], kiosk[1])
  // 读屏听到的也要是这一句，不能还是旧说法。
  assert.equal(wxml.includes('敏感话题'), false)
  assert.ok(wxml.includes("'同意作答涉及偏好 / 风格的敏感题，可选'"))
  // 题库没有敏感题时，两端都说明勾不勾都不改变题目、只记录意愿。
  assert.match(wxml, /勾不勾都不会改变题目，此项只记录你的意愿/)
  assert.match(read('apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx'), /勾不勾都不会改变题目；此项只记录你的意愿/)
})

// ── 改动二：合同审查建任务前先过未满 14 周岁的声明 ───────────────────────

for (const [label, call] of [
  ['建任务', (api) => api.createContractReview({ sourceFileId: 'f_8c21', contractType: 'labor' })],
  ['确认开始审查', (api) => api.confirmContractReview('cr_5d07', { contractType: 'labor' })],
]) {
  test(`合同审查${label}：没声明先问，确认后先写账号再发请求`, async () => {
    const ctx = runtime()
    assert.equal(ctx.auth.saveSession({ token: token('m_3f9a'), user: { id: 'm_3f9a' } }), true)
    const pending = call(ctx.api).then(() => 'sent', (e) => e)
    await flush(); await flush()
    assert.equal(ctx.calls.modal.length, 1, '先弹年龄确认')
    assert.equal(ctx.calls.modal[0].title, '你已年满 14 周岁吗？')
    assert.equal(ctx.calls.request.length, 0, '确认之前一个请求都不发')
    ctx.calls.modal[0].success({ confirm: true, cancel: false })
    await flush(); await flush()
    assert.equal(urls(ctx).length, 1)
    assert.equal(urls(ctx)[0], '/me/ai-consents', '会员的新声明先写服务端')
    ctx.calls.request[0].success({ statusCode: 200, data: { data: { scope: 'age_14_plus', granted: true } } })
    await flush(); await flush()
    assert.equal(urls(ctx).length, 2)
    assert.match(urls(ctx)[1], /^\/contract-reviews/)
    ctx.calls.request[1].success({ statusCode: 200, data: { data: { id: 'cr_5d07' } } })
    assert.equal(await pending, 'sent')
  })

  test(`合同审查${label}：选「未满」就不发请求`, async () => {
    const ctx = runtime()
    assert.equal(ctx.auth.saveSession({ token: token('m_3f9a'), user: { id: 'm_3f9a' } }), true)
    const pending = call(ctx.api).then(() => 'sent', (e) => e)
    await flush(); await flush()
    ctx.calls.modal[0].success({ confirm: false, cancel: true })
    const result = await pending
    assert.equal(result.code, 'AI_AGE_NOT_DECLARED')
    assert.equal(ctx.calls.request.length, 0)
  })
}

test('合同审查这两条在服务端和大屏也都归在要声明的一类', () => {
  const kiosk = read('apps/kiosk/src/ai/aiUseKindTable.ts')
  assert.match(kiosk, /\{ method: 'POST', path: '\/contract-reviews', kind: 'generate' \}/)
  const server = read('services/api/src/contract-review/contract-review.controller.ts')
  assert.match(server, /@Post\(\)\s*(?:@[A-Za-z]+\([^\n]*\)\s*)*@AiUse\('generate'\)/)
})

// ── 合规点名的四样 ───────────────────────────────────────────────────────

function selfExplore(response) {
  const submitted = []
  const api = {
    getSelfAssessmentQuestions: () => Promise.resolve(response),
    submitSelfAssessment: (answers, consent) => { submitted.push(consent); return new Promise(() => {}) },
    LEGAL_DOC_TITLES: { privacy_policy: '隐私政策', terms_of_service: '用户服务协议' },
  }
  const wx = { getWindowInfo: () => ({ windowWidth: 375 }), pageScrollTo() {}, navigateTo() {}, showToast() {}, showModal() {} }
  const modules = { api, auth: { isLoggedIn: () => false, getUser: () => null }, storage: { get: () => null, set: () => true, KEYS: {} } }
  return { submitted, page: instantiate(loadPageDefinition('pages/self-explore/self-explore.js', { wx, modules })) }
}
const ITEMS = ['一、这次作答只给你本人看。', '二、结果是参考，不是评定。', '三、可以随时退出。', '四、作答保存在你的账号里。', '五、你可以删除本次结果。', '六、未满 14 周岁需监护人同意并陪同。']
const QUESTIONS = {
  version: 'v1',
  dimensions: [{ key: 'style', label: '做事风格', questions: [{ idx: 0, prompt: '更喜欢先计划还是先动手', choices: [{ key: 'a', label: '先计划', weight: 1 }] }] }],
  consentItems: ITEMS,
  consentVersion: 'sa-consent-v2.2026-09-29',
  consentCheckboxLabel: '我已阅读以上说明，确认本人已满 14 周岁。',
  consentLinks: [],
}

test('一、六条说明逐条来自服务端，小程序自己不带条款也不带版本号', async () => {
  const { page } = selfExplore(QUESTIONS)
  page.onLoad({})
  await flush()
  assert.equal(page.data.consentItems.length, 6)
  ITEMS.forEach((line, i) => assert.equal(page.data.consentItems[i], line))
  const source = read('apps/miniapp/pages/self-explore/self-explore.js') + read('apps/miniapp/pages/self-explore/self-explore.wxml')
  assert.equal(/sa-consent-v/.test(source), false, '版本号只能来自接口')
  // 大屏同样从这个接口取，不自带版本号。
  assert.equal(/sa-consent-v/.test(read('apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx')), false)
})

for (const sensitive of [false, true]) {
  test(`二、提交时带的同意内容和大屏同形：必选、可选（${sensitive ? '勾' : '不勾'}）、版本号`, async () => {
    const { page, submitted } = selfExplore(QUESTIONS)
    page.onLoad({})
    await flush()
    page.toggleNonSensitive()
    if (sensitive) page.toggleSensitive()
    page.startAsk()
    page.tapChoice({ currentTarget: { dataset: { g: 0, q: 0, c: 'a' } } })
    page.submit()
    assert.equal(submitted.length, 1)
    assert.equal(Object.keys(submitted[0]).sort().join(','), 'consentVersion,nonSensitive,sensitive')
    assert.equal(submitted[0].nonSensitive, true)
    assert.equal(submitted[0].sensitive, sensitive)
    assert.equal(submitted[0].consentVersion, 'sa-consent-v2.2026-09-29')
  })
}

test('三、录音单独同意：录音前先问，版本号和服务端、大屏一致，五件事写全', async () => {
  const ctx = runtime()
  const pending = ctx.load('request').request('/assistant/voice', { method: 'POST', ai: 'voice' }).then(() => 'sent', (e) => e)
  await flush(); await flush()
  ctx.calls.modal[0].success({ confirm: true, cancel: false }) // 年龄
  await flush(); await flush()
  assert.equal(ctx.calls.modal.length, 2)
  assert.equal(ctx.calls.modal[1].title, '录音单独同意')
  assert.equal(ctx.calls.request.length, 0, '同意录音之前不发请求')
  const said = ctx.calls.modal[1].content
  for (const word of ['转成文字', '腾讯云', '转完即删', '声纹', '撤回']) assert.ok(said.includes(word), `录音同意里要说到「${word}」`)
  ctx.calls.modal[1].success({ confirm: false, cancel: true })
  assert.equal((await pending).code, 'AI_VOICE_NOT_CONSENTED')
  assert.equal(ctx.calls.request.length, 0, '选「改用手打」不发请求')
  const server = read('services/api/src/member-privacy/member-privacy.service.ts')
  const kiosk = read('apps/kiosk/src/ai/aiDeclarationVersions.ts')
  for (const [scope, serverName, kioskName] of [
    ['voice_recording', 'CURRENT_VOICE_RECORDING_CONSENT_VERSION', 'VOICE_RECORDING_CONSENT_VERSION'],
    ['age_14_plus', 'CURRENT_AGE_14_PLUS_CONSENT_VERSION', 'AGE_14_PLUS_CONSENT_VERSION'],
  ]) {
    const version = ctx.ai.SCOPES[scope].version
    assert.ok(server.includes(`${serverName} = '${version}'`), `${scope} 版本号和服务端不一致`)
    assert.ok(kiosk.includes(`export const ${kioskName} = '${version}'`), `${scope} 版本号和大屏不一致`)
  }
})

test('四、导出前的 AI 标识说明：两页都显示，说的是大屏同一句标识', async () => {
  const note = require('../../utils/resume-build-model.js').RESUME_AI_LABEL_NOTE
  assert.ok(note.includes('含人工智能辅助生成内容'))
  assert.ok(read('apps/kiosk/src/pages/resume/components/resume-deliver/ResumeFormatChooser.tsx').includes('含人工智能辅助生成内容'))
  for (const name of ['resume-optimize', 'resume-build']) {
    const wxml = read(`apps/miniapp/pages/${name}/${name}.wxml`)
    assert.match(wxml, /\{\{aiLabelNote\}\}/, `${name} 页面上要把说明显示出来`)
    assert.ok(read(`apps/miniapp/pages/${name}/${name}.js`).includes('RESUME_AI_LABEL_NOTE'))
  }
})
