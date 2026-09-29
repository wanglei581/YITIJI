/**
 * 自我探索知情同意条款改为服务端下发（9/29 裁定）。真跑页面：
 *   (a) 用户看到的条款来自 questions 接口的 consentItems，提交带回同一次响应里的 consentVersion；
 *       响应里缺条款时「同意并开始作答」置灰、进不了答题；
 *   (b) 页面源码不写死同意版本号；
 *   (c) 页面源码不写死条款原文（以年龄那一句为代表），也不再有本地条款数组。
 * 每条都配反向变异：把页面改回错误写法，断言必须红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REL = 'pages/self-explore/self-explore.js'
const PAGE_DIR = path.join(MINIAPP, 'pages/self-explore')
const SRC = fs.readFileSync(path.join(MINIAPP, REL), 'utf8')
const WXML = fs.readFileSync(path.join(PAGE_DIR, 'self-explore.wxml'), 'utf8')
const AGE_LINE = '本工具面向年满 14 周岁的用户；未满 14 周岁的，请在监护人同意并陪同下使用。'

// 夹具里的条款和版本号故意不是真值：页面若自带一份，就和夹具对不上。
const FIXTURE_ITEMS = ['夹具条款甲：只用于测试。', '夹具条款乙：只用于测试。']
const FIXTURE_VERSION = 'fixture-consent-v9'
function questionsFixture(extra) {
  return Object.assign({
    version: 'v1',
    dimensions: [{
      key: 'd1', label: '维度一',
      questions: [{ idx: 0, prompt: '题目一', choices: [{ key: 'a', label: '选项甲', weight: 1 }] }],
    }],
  }, extra)
}

function makePage(res, source) {
  const calls = { submit: [], toast: [] }
  const api = {
    getSelfAssessmentQuestions: () => Promise.resolve(res),
    submitSelfAssessment: (answers, consent) => { calls.submit.push(consent); return new Promise(() => {}) },
  }
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375 }),
    pageScrollTo() {},
    showToast: (o) => { calls.toast.push(o) },
    showModal() {},
  }
  const modules = {
    api,
    auth: { isLoggedIn: () => false, getUser: () => null },
    storage: { get: () => null, set: () => true, KEYS: {} },
  }
  const page = instantiate(loadPageDefinition(REL, { wx, modules, source }))
  return { page, calls }
}

/** 断言 (a)：条款逐条等于响应、可以开始作答、提交带回同一个版本号。 */
async function checkServerItems(source) {
  const { page, calls } = makePage(questionsFixture({ consentItems: FIXTURE_ITEMS, consentVersion: FIXTURE_VERSION }), source)
  page.onLoad({})
  await flush()
  assert.equal(page.data.phase, 'consent')
  assert.equal(JSON.stringify(Array.from(page.data.consentItems)), JSON.stringify(FIXTURE_ITEMS), '条款逐条来自响应')
  assert.equal(page.data.consentReady, true)
  page.toggleNonSensitive()
  page.startAsk()
  assert.equal(page.data.phase, 'ask', '拿到条款并勾选后能进答题')
  page.tapChoice({ currentTarget: { dataset: { g: 0, q: 0, c: 'a' } } })
  page.submit()
  assert.equal(calls.submit.length, 1)
  assert.equal(calls.submit[0].consentVersion, FIXTURE_VERSION, '提交带回同一次响应里的版本号')
}

/** 断言：响应缺条款 → 置灰、说明原因、进不了答题、不提交。 */
async function checkMissingItemsBlocks(source) {
  const { page, calls } = makePage(questionsFixture({ consentVersion: FIXTURE_VERSION }), source)
  page.onLoad({})
  await flush()
  assert.equal(page.data.phase, 'consent')
  assert.equal(page.data.consentReady, false, '缺条款时不算就绪')
  page.toggleNonSensitive()
  page.startAsk()
  assert.equal(page.data.phase, 'consent', '缺条款时进不了答题')
  assert.equal(calls.submit.length, 0)
}

/** (b)：页面目录里不出现写死的同意版本号。 */
function checkNoVersionLiteral(text) {
  assert.doesNotMatch(text, /sa-consent-v\d/, '不写死 sa-consent 版本号')
  assert.doesNotMatch(text, /consentVersion\s*[:=]\s*(['"`])[^'"`]+\1/, 'consentVersion 不赋非空字面量')
}

/** (c)：页面目录里不出现条款原文，也没有本地条款数组。 */
function checkNoLocalItems(text) {
  assert.ok(!text.includes(AGE_LINE), '年龄那一句不在页面源码里')
  assert.doesNotMatch(text, /14 周岁/, '页面源码不写年龄条款')
  assert.doesNotMatch(text, /\bCONSENT_ITEMS\b/, '没有本地条款数组')
}

function pageDirText(mutate) {
  return fs.readdirSync(PAGE_DIR)
    .filter((f) => /\.(js|wxml)$/.test(f))
    .map((f) => {
      const t = fs.readFileSync(path.join(PAGE_DIR, f), 'utf8')
      return f === 'self-explore.js' && mutate ? mutate(t) : t
    })
    .join('\n')
}

function mutated(from, to) {
  assert.ok(SRC.includes(from), `变异锚点还在：${from}`)
  return SRC.replace(from, to)
}

test('(a) 条款与版本号来自同一次响应，提交带回该版本号', () => checkServerItems())

test('(a) 模板按 consentItems 渲染，按钮受 consentReady 控制', () => {
  assert.match(WXML, /wx:for="\{\{consentItems\}\}"/)
  assert.match(WXML, /agreeNonSensitive && consentReady \? '' : 'disabled'/)
  assert.match(WXML, /wx:if="\{\{consentReady\}\}"/)
})

test('(a) 响应缺条款：置灰、进不了答题', () => checkMissingItemsBlocks())

test('(b) 页面不写死同意版本号', () => checkNoVersionLiteral(pageDirText()))

test('(c) 页面不写死条款原文', () => checkNoLocalItems(pageDirText()))

test('变异 (a)：条款改回写死 → 判红', async () => {
  const src = mutated('consentItems: view.consentItems,', "consentItems: ['本地写死的条款'],")
  await assert.rejects(checkServerItems(src), (e) => e.code === 'ERR_ASSERTION')
})

test('变异 (a)：缺条款也放行 → 判红', async () => {
  const src = mutated('consentReady: view.consentItems.length > 0 && !!view.consentVersion,', 'consentReady: true,')
  await assert.rejects(checkMissingItemsBlocks(src), (e) => e.code === 'ERR_ASSERTION')
})

test('变异 (b)：写死版本号 → 判红', () => {
  const text = pageDirText((t) => t.replace('consentItems: [],', "consentItems: [],\n    consentVersion: 'sa-consent-v1.2026-09-29',"))
  assert.throws(() => checkNoVersionLiteral(text), (e) => e.code === 'ERR_ASSERTION')
})

test('变异 (c)：年龄条款写回页面 → 判红', () => {
  const text = pageDirText((t) => t.replace('consentItems: [],', `consentItems: ['${AGE_LINE}'],`))
  assert.throws(() => checkNoLocalItems(text), (e) => e.code === 'ERR_ASSERTION')
})
