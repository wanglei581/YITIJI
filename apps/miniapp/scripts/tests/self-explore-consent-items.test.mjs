/**
 * 自我探索知情同意条款改为服务端下发（9/29 裁定）。真跑页面：
 *   (a) 用户看到的条款（consentItems）、勾选框文字（consentCheckboxLabel）与其中的链接
 *       （consentLinks，打开小程序内隐私政策并定位到「未成年人」章节）都来自 questions 接口，
 *       提交带回同一次响应里的 consentVersion；三样缺任一样「同意并开始作答」置灰、进不了答题；
 *       版本过期（不设过渡期，服务端 400）时只重拉说明、已答的题保留；
 *   (b) 页面源码不写死同意版本号；
 *   (c) 页面源码不写死条款与勾选框原文（以年龄那一句为代表），也不再有本地条款数组。
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
// 勾选框文字与链接同样故意不是真值。
const FIXTURE_LINK = '夹具规则链接'
const FIXTURE_LABEL = `我已阅读夹具说明和${FIXTURE_LINK}，确认夹具事项。`
const FIXTURE_SECTION = '夹具未成年专章标题'
/** 条款、勾选框文字、链接、版本号齐全的响应；extra 覆盖其中某项（给 undefined 即缺这项）。 */
function readyFixture(extra) {
  return questionsFixture(Object.assign({
    consentItems: FIXTURE_ITEMS,
    consentVersion: FIXTURE_VERSION,
    consentCheckboxLabel: FIXTURE_LABEL,
    consentLinks: [{ label: FIXTURE_LINK, legalDocType: 'privacy_policy', anchor: 'minors', sectionTitle: FIXTURE_SECTION }],
  }, extra))
}

/**
 * @param res        questions 接口的响应；给数组则按调用次序依次返回（元素为 Error 时拒绝）
 * @param submitImpl 提交替身；默认永不返回（只看请求里带了什么）
 */
function makePage(res, source, submitImpl) {
  const calls = { submit: [], toast: [], questions: 0, nav: [] }
  const queue = Array.isArray(res) ? res : null
  const api = {
    getSelfAssessmentQuestions: () => {
      const r = queue ? queue[Math.min(calls.questions, queue.length - 1)] : res
      calls.questions += 1
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r)
    },
    submitSelfAssessment: (answers, consent) => {
      calls.submit.push(consent)
      return submitImpl ? submitImpl(calls.submit.length) : new Promise(() => {})
    },
    LEGAL_DOC_TITLES: { privacy_policy: '隐私政策', terms_of_service: '用户服务协议' },
  }
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375 }),
    pageScrollTo() {},
    navigateTo: (o) => { calls.nav.push(o.url) },
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


/** 断言 (a)：条款、勾选框文字逐字来自响应，可以开始作答，提交带回同一个版本号。 */
async function checkServerItems(source) {
  const { page, calls } = makePage(readyFixture(), source)
  page.onLoad({})
  await flush()
  assert.equal(page.data.phase, 'consent')
  assert.equal(JSON.stringify(Array.from(page.data.consentItems)), JSON.stringify(FIXTURE_ITEMS), '条款逐条来自响应')
  const shown = Array.from(page.data.checkboxParts).map((p) => p.text).join('')
  assert.equal(shown, FIXTURE_LABEL, '勾选框文字逐字来自响应')
  assert.equal(page.data.consentReady, true)
  page.toggleNonSensitive()
  page.startAsk()
  assert.equal(page.data.phase, 'ask', '拿到说明并勾选后能进答题')
  page.tapChoice({ currentTarget: { dataset: { g: 0, q: 0, c: 'a' } } })
  page.submit()
  assert.equal(calls.submit.length, 1)
  assert.equal(calls.submit[0].consentVersion, FIXTURE_VERSION, '提交带回同一次响应里的版本号')
}

/** 断言：勾选框里的链接文字在原位可点，点开小程序内隐私政策并带上章节锚点。 */
async function checkConsentLink(source) {
  const { page, calls } = makePage(readyFixture(), source)
  page.onLoad({})
  await flush()
  const parts = Array.from(page.data.checkboxParts)
  const linkPart = parts.find((p) => p.link >= 0)
  assert.ok(linkPart, '勾选框文字里有可点的链接段')
  assert.equal(linkPart.text, FIXTURE_LINK)
  assert.equal(page.data.extraLinks.length, 0, '链接文字在勾选框里，不另列')
  page.tapConsentLink({ currentTarget: { dataset: { i: linkPart.link } } })
  assert.equal(calls.nav.length, 1)
  assert.equal(calls.nav[0], `/pages/legal/legal?type=privacy_policy&anchor=minors&section=${encodeURIComponent(FIXTURE_SECTION)}`)
  assert.equal(page.data.agreeNonSensitive, false, '点链接不顺带勾选')
}

/** 断言：响应缺某一样 → 置灰、进不了答题、不提交。 */
async function checkMissingBlocks(extra, source) {
  const { page, calls } = makePage(readyFixture(extra), source)
  page.onLoad({})
  await flush()
  assert.equal(page.data.phase, 'consent')
  assert.equal(page.data.consentReady, false, '说明不全时不算就绪')
  page.toggleNonSensitive()
  page.startAsk()
  assert.equal(page.data.phase, 'consent', '说明不全时进不了答题')
  assert.equal(calls.submit.length, 0)
}

/**
 * 断言：服务端说版本过期 → 提示「说明已更新，请重新确认」、勾选清零、已答的题保留、
 * 换上新条款；重新确认后直接能提交，且带的是新版本号。
 */
const NEW_ITEMS = ['夹具新条款：只用于测试。']
const NEW_VERSION = 'fixture-consent-v10'
const STALE = () => Object.assign(new Error('同意版本已过期'), { code: 'SELF_ASSESSMENT_CONSENT_VERSION_STALE' })
async function checkStaleKeepsAnswers(source) {
  const { page, calls } = makePage([
    readyFixture(),
    readyFixture({ consentItems: NEW_ITEMS, consentVersion: NEW_VERSION }),
  ], source, (n) => (n === 1 ? Promise.reject(STALE()) : new Promise(() => {})))
  page.onLoad({})
  await flush()
  page.toggleNonSensitive()
  page.startAsk()
  page.tapChoice({ currentTarget: { dataset: { g: 0, q: 0, c: 'a' } } })
  page.submit()
  await flush()
  await flush()
  assert.equal(page.data.phase, 'consent', '回到同意页重新确认')
  assert.match(page.data.consentTip, /^说明已更新，请重新确认/)
  assert.equal(page.data.agreeNonSensitive, false, '旧勾选不算对新说明的同意')
  assert.equal(page.data.dims[0].questions[0].picked, 'a', '已答的题保留')
  assert.equal(JSON.stringify(Array.from(page.data.consentItems)), JSON.stringify(NEW_ITEMS), '换上新条款')
  page.toggleNonSensitive()
  page.startAsk()
  assert.equal(page.data.isLastGroup, true, '题已答完，直接落在可提交的一组')
  page.submit()
  assert.equal(calls.submit.length, 2)
  assert.equal(calls.submit[1].consentVersion, NEW_VERSION, '重新提交带新版本号')
}

/** 断言：版本过期后补拉说明失败 → 不放行、题仍保留。 */
async function checkStaleRefreshFailBlocks(source) {
  const { page, calls } = makePage([readyFixture(), new Error('网络异常')], source, () => Promise.reject(STALE()))
  page.onLoad({})
  await flush()
  page.toggleNonSensitive()
  page.startAsk()
  page.tapChoice({ currentTarget: { dataset: { g: 0, q: 0, c: 'a' } } })
  page.submit()
  await flush()
  await flush()
  assert.equal(page.data.phase, 'consent')
  assert.equal(page.data.consentReady, false, '取不到新说明不放行')
  assert.equal(page.data.dims[0].questions[0].picked, 'a', '题仍保留')
  page.toggleNonSensitive()
  page.startAsk()
  assert.equal(page.data.phase, 'consent')
  assert.equal(calls.submit.length, 1)
}

/** (b)：页面目录里不出现写死的同意版本号。 */
function checkNoVersionLiteral(text) {
  assert.doesNotMatch(text, /sa-consent-v\d/, '不写死 sa-consent 版本号')
  assert.doesNotMatch(text, /consentVersion\s*[:=]\s*(['"`])[^'"`]+\1/, 'consentVersion 不赋非空字面量')
}

/** (c)：页面目录里不出现条款原文与勾选框原文，也没有本地条款数组。 */
function checkNoLocalItems(text) {
  assert.ok(!text.includes(AGE_LINE), '年龄那一句不在页面源码里')
  assert.doesNotMatch(text, /14 周岁/, '页面源码不写年龄条款或年龄确认')
  assert.doesNotMatch(text, /未成年人个人信息处理规则/, '页面源码不写链接文字')
  assert.doesNotMatch(text, /我已阅读并同意上述说明/, '页面源码不写本地勾选框文字')
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

test('(a) 条款、勾选框文字、版本号来自同一次响应，提交带回该版本号', () => checkServerItems())

test('(a) 勾选框里的链接打开小程序内隐私政策「未成年人」章节', () => checkConsentLink())

test('(a) 模板按下发内容渲染，按钮受 consentReady 控制', () => {
  assert.match(WXML, /wx:for="\{\{consentItems\}\}"/)
  assert.match(WXML, /wx:for="\{\{checkboxParts\}\}"/)
  assert.match(WXML, /catchtap="tapConsentLink"/, '链接用 catchtap，不顺带勾选')
  assert.match(WXML, /agreeNonSensitive && consentReady \? '' : 'disabled'/)
  assert.match(WXML, /wx:if="\{\{consentReady\}\}"/)
})

test('(a) 响应缺条款：置灰、进不了答题', () => checkMissingBlocks({ consentItems: undefined }))

test('(a) 响应缺勾选框文字：置灰、进不了答题', () => checkMissingBlocks({ consentCheckboxLabel: undefined }))

test('(a) 响应缺版本号：置灰、进不了答题', () => checkMissingBlocks({ consentVersion: undefined }))

test('版本过期：提示重新确认、已答的题保留、带新版本号重交', () => checkStaleKeepsAnswers())

test('版本过期后补拉说明失败：不放行、题保留', () => checkStaleRefreshFailBlocks())

test('(b) 页面不写死同意版本号', () => checkNoVersionLiteral(pageDirText()))

test('(c) 页面不写死条款原文与勾选框原文', () => checkNoLocalItems(pageDirText()))

test('变异 (a)：条款改回写死 → 判红', async () => {
  const src = mutated('}, view.consent))', "}, view.consent, { consentItems: ['本地写死的条款'] }))")
  await assert.rejects(checkServerItems(src), (e) => e.code === 'ERR_ASSERTION')
})

test('变异 (a)：勾选框文字改回写死 → 判红', async () => {
  const src = mutated('}, view.consent))', "}, view.consent, { checkboxParts: [{ text: '本地写死的勾选文字', link: -1 }] }))")
  await assert.rejects(checkServerItems(src), (e) => e.code === 'ERR_ASSERTION')
})

test('变异 (a)：说明不全也放行 → 判红', async () => {
  const src = mutated('}, view.consent))', '}, view.consent, { consentReady: true }))')
  await assert.rejects(checkMissingBlocks({ consentCheckboxLabel: undefined }, src), (e) => e.code === 'ERR_ASSERTION')
})

test('变异 (a)：链接不带章节锚点 → 判红', async () => {
  const src = mutated('if (link.anchor) q.push', 'if (false) q.push')
  await assert.rejects(checkConsentLink(src), (e) => e.code === 'ERR_ASSERTION')
})

test('变异：版本过期改回整套重拉（清空答案）→ 判红', async () => {
  const src = mutated('this._refreshConsent(STALE_TIP)', 'this._loadQuestions()')
  await assert.rejects(checkStaleKeepsAnswers(src), (e) => e.code === 'ERR_ASSERTION')
})

test('变异：补拉失败仍沿用旧说明放行 → 判红', async () => {
  const src = mutated('this.setData(Object.assign(reset, consentView.emptyConsentView()))', 'this.setData(reset)')
  await assert.rejects(checkStaleRefreshFailBlocks(src), (e) => e.code === 'ERR_ASSERTION')
})

test('变异 (b)：写死版本号 → 判红', () => {
  const text = pageDirText((t) => t.replace('consentItems: [],', "consentItems: [],\n    consentVersion: 'sa-consent-v1.2026-09-29',"))
  assert.throws(() => checkNoVersionLiteral(text), (e) => e.code === 'ERR_ASSERTION')
})

test('变异 (c)：年龄条款写回页面 → 判红', () => {
  const text = pageDirText((t) => t.replace('consentItems: [],', `consentItems: ['${AGE_LINE}'],`))
  assert.throws(() => checkNoLocalItems(text), (e) => e.code === 'ERR_ASSERTION')
})

test('变异 (c)：本地勾选框文字写回页面 → 判红', () => {
  const text = pageDirText((t) => t.replace("consentCheckboxLabel: '',", "consentCheckboxLabel: '我已阅读并同意上述说明（必选）',"))
  assert.throws(() => checkNoLocalItems(text), (e) => e.code === 'ERR_ASSERTION')
})

// ── 法务页章节锚点 ──
const LEGAL_REL = 'pages/legal/legal.js'
const LEGAL_SRC = fs.readFileSync(path.join(MINIAPP, LEGAL_REL), 'utf8')
// 两章标题都含「未成年」：按章节标题要落到第六章，只按兜底会落到第三章 —— 这样才分得出用没用 section。
const SECTION = '未满十四周岁未成年人个人信息处理规则'
const PRIVACY_DOC = {
  title: '隐私政策', version: 'fixture-privacy-v1',
  content: `一、总则\n正文一。\n三、未成年人使用须知\n正文三。\n六、${SECTION}\n正文六。\n七、联系我们\n正文七。`,
}

async function checkLegalAnchor(source, options, expected) {
  const scrolls = []
  const wx = { pageScrollTo: (o) => { scrolls.push(o.selector) }, navigateBack() {}, switchTab() {} }
  const modules = {
    api: {
      LEGAL_DOC_TITLES: { privacy_policy: '隐私政策' },
      getLegalDocument: () => Promise.resolve(PRIVACY_DOC),
    },
  }
  const page = instantiate(loadPageDefinition(LEGAL_REL, { wx, modules, source }))
  page.onLoad(Object.assign({ type: 'privacy_policy' }, options))
  await flush()
  assert.equal(page.data.state, 'ready')
  if (!expected) {
    assert.equal(scrolls.length, 0, '认不出章节就从头显示')
    return
  }
  const heading = Array.from(page.data.blocks).find((b) => b.kind === 'heading' && b.text === expected)
  assert.ok(heading, `夹具里有「${expected}」一章，且被认成标题`)
  assert.equal(scrolls.length, 1, '打开后滚到锚点')
  assert.equal(scrolls[0], `#${heading.key}`, `滚到的是「${expected}」`)
}

// 带编码的 section，和自我探索页 navigateTo 拼出来的一样。
const SECTION_OPTS = { anchor: 'minors', section: encodeURIComponent(SECTION) }

test('法务页：先按下发的章节标题定位（与一体机同一依据）', () => checkLegalAnchor(undefined, SECTION_OPTS, `六、${SECTION}`))

test('法务页：章节标题找不到时按「未成年」兜底', () => checkLegalAnchor(undefined, { anchor: 'minors', section: encodeURIComponent('不存在的标题') }, '三、未成年人使用须知'))

test('法务页：锚点与标题都认不出时从头显示', () => checkLegalAnchor(undefined, { anchor: 'unknown' }, ''))

test('法务页：只带章节标题（后端定稿形状，没有 anchor）且找不到 → 从头显示', () =>
  checkLegalAnchor(undefined, { section: encodeURIComponent('不存在的标题') }, ''))

test('自我探索：链接不带 anchor 时只拼 type 与 section', async () => {
  const { page, calls } = makePage(readyFixture({
    consentLinks: [{ label: FIXTURE_LINK, legalDocType: 'privacy_policy', sectionTitle: FIXTURE_SECTION }],
  }))
  page.onLoad({})
  await flush()
  const linkPart = Array.from(page.data.checkboxParts).find((p) => p.link >= 0)
  page.tapConsentLink({ currentTarget: { dataset: { i: linkPart.link } } })
  assert.equal(calls.nav[0], `/pages/legal/legal?type=privacy_policy&section=${encodeURIComponent(FIXTURE_SECTION)}`)
})

test('变异：法务页不看章节标题、只按兜底 → 判红', async () => {
  const from = 'this._section = decodeParam(options.section)'
  assert.ok(LEGAL_SRC.includes(from))
  await assert.rejects(checkLegalAnchor(LEGAL_SRC.replace(from, "this._section = ''"), SECTION_OPTS, `六、${SECTION}`), (e) => e.code === 'ERR_ASSERTION')
})

test('法务页：章节标题带 id，滚动选择器能找到', () => {
  const wxml = fs.readFileSync(path.join(MINIAPP, 'pages/legal/legal.wxml'), 'utf8')
  assert.match(wxml, /kind === 'heading'\}\}" id="\{\{item\.key\}\}"/)
})

test('变异：法务页忽略锚点 → 判红', async () => {
  const from = "this._anchor = options.anchor || ''"
  assert.ok(LEGAL_SRC.includes(from))
  await assert.rejects(checkLegalAnchor(LEGAL_SRC.replace(from, "this._anchor = ''"), { anchor: 'minors' }, '三、未成年人使用须知'), (e) => e.code === 'ERR_ASSERTION')
})
