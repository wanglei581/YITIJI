// 自我探索同意说明（#1119 同批）与职业规划「未纳入」提示的单测。
// 纯函数直接编译后跑；两个小组件用 react-dom/server 渲染成字符串断言。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (rel) => ts.transpileModule(readFileSync(join(root, rel), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  fileName: rel,
}).outputText
const withReact = (code) => code
  .replace(/from ["']react\/jsx-runtime["']/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
  .replace(/from ["']react["']/g, `from '${import.meta.resolve('react')}'`)

const consentUrl = toDataUrl(transpile('src/pages/resume/selfAssessmentConsent.ts'))
const consent = await import(consentUrl)
const { interpretationGap } = await import(toDataUrl(transpile('src/pages/resume/selfAssessmentInterpretation.ts')))
const kit = await import(toDataUrl(withReact(transpile('src/pages/resume/components/self-assessment/SelfAssessmentConsentKit.tsx'))
  .replaceAll("from '../../selfAssessmentConsent'", `from '${consentUrl}'`)))
const careerNote = await import(toDataUrl(withReact(transpile('src/pages/resume/components/career-plan/CareerPlanSelfAssessmentExcluded.tsx'))
  .replaceAll("from 'lucide-react'", `from '${toDataUrl('export const CompassIcon = () => null\n')}'`)))

const LINK = { label: '《隐私政策》中的未成年人个人信息处理规则', legalDocType: 'privacy_policy', sectionTitle: '未满十四周岁未成年人个人信息处理规则' }
const LABEL = `我已阅读上述说明和${LINK.label}，确认本人已满 14 周岁；未满 14 周岁的，已取得监护人同意并由监护人陪同。`
const served = (over = {}) => ({
  version: 'v1', dimensions: [], consentVersion: 'sa-consent-v2.2026-09-29',
  consentItems: ['第一条说明', '第二条说明'], consentLinks: [LINK], consentCheckboxLabel: LABEL, ...over,
})
const empty = () => ({ answers: {}, consent: { nonSensitive: false, sensitive: false } })

test('下发的说明原样读出，版本号不 trim', () => {
  const bundle = consent.readConsentBundle(served({ consentVersion: '  sa-consent-v2.2026-09-29 ' }))
  assert.equal(bundle.version, '  sa-consent-v2.2026-09-29 ')
  assert.deepEqual(bundle.items, ['第一条说明', '第二条说明'])
  assert.equal(bundle.checkboxLabel, LABEL)
  assert.deepEqual(bundle.links, [LINK])
})

test('缺版本、空条款、缺勾选框文字、链接不是数组时读不出说明', () => {
  for (const over of [{ consentVersion: '' }, { consentVersion: '   ' }, { consentItems: [] }, { consentCheckboxLabel: '' }, { consentLinks: undefined }]) {
    assert.equal(consent.readConsentBundle(served(over)), null, JSON.stringify(over))
  }
  assert.equal(consent.readConsentBundle(undefined), null)
})

test('勾选框文字切段：链接原位成一段，拼回来与原句逐字相同', () => {
  const segments = consent.consentLabelSegments(LABEL, [LINK])
  assert.equal(segments.map((s) => s.text).join(''), LABEL)
  assert.deepEqual(segments.filter((s) => s.link).map((s) => s.text), [LINK.label])
  // label 不在句子里的链接不硬塞，句子照样完整
  const stray = consent.consentLabelSegments('我已阅读上述说明。', [LINK])
  assert.deepEqual(stray, [{ text: '我已阅读上述说明。' }])
})

test('确认说明：记原值版本、保留已答、丢掉草稿；过期：撤同意、留答案、记下重交', () => {
  const draft = { ...empty(), answers: { interest: { 0: 'a' }, style: { 1: 'b' } }, consentDraft: { checkedVersion: null, sensitive: true } }
  const next = consent.sessionAfterConsent(draft, { sensitive: false, version: ' v ', now: '2026-09-29T09:00:00.000Z', keepAnswer: (dim) => dim === 'interest' })
  assert.equal(next.consentVersion, ' v ')
  assert.deepEqual(next.answers, { interest: { 0: 'a' } })
  assert.equal('consentDraft' in next, false)
  assert.equal(consent.hasRecordedConsent(next), true)
  const stale = consent.sessionAfterStaleConsent(next)
  assert.deepEqual(stale.answers, next.answers)
  assert.equal(consent.hasRecordedConsent(stale), false)
  assert.equal(stale.resubmitAfterConsent, true)
  assert.equal(consent.isConsentVersionStale({ code: 'SELF_ASSESSMENT_CONSENT_VERSION_STALE' }), true)
  assert.equal(consent.isConsentVersionStale({ code: 'SELF_ASSESSMENT_CONSENT_REQUIRED' }), false)
})

test('去读隐私政策前的勾选草稿只对同一版有效', () => {
  const s = { ...empty(), consentDraft: { checkedVersion: 'v2', sensitive: false } }
  assert.equal(consent.initialCheckedVersion(s, 'v2'), true)
  assert.equal(consent.initialCheckedVersion(s, 'v3'), false)
  assert.equal(consent.consentLinkRoute(LINK), `/legal/privacy?section=${encodeURIComponent(LINK.sectionTitle)}`)
})

test('同意页勾选块：条款逐条渲染；链接是可点的一段，不嵌在勾选按钮里', () => {
  const list = renderToStaticMarkup(createElement(kit.SaConsentList, { items: ['第一条说明', '第二条说明'] }))
  assert.match(list, /<li><em>1<\/em><div>第一条说明<\/div><\/li><li><em>2<\/em><div>第二条说明<\/div><\/li>/)
  const html = renderToStaticMarkup(createElement(kit.SaConsentLinkedCheck, {
    checked: false, label: LABEL, links: [LINK], testId: 'sa-required', onToggle() {}, onOpenLink() {},
  }))
  assert.match(html, /role="checkbox" aria-checked="false"/)
  assert.match(html, new RegExp(`data-testid="self-assessment-consent-link">${LINK.label}</button>`))
  // 勾选按钮自己是空的方框，不把链接套进去
  assert.match(html, /<button type="button" class="sa-cbox-hit"[^>]*><span class="sa-box" aria-hidden="true">✓<\/span><\/button>/)
})

const OUTAGE = new Set(['AI_PAUSED', 'AI_BUDGET_EXHAUSTED', 'AI_ACCESS_CHECK_FAILED'])
const dims = (note) => [{ note }]

test('结果页 AI 解读：优先读 interpretationAvailable 与原因码', () => {
  assert.equal(interpretationGap({ status: 'completed', summary: '有', dimensions: dims('有'), interpretationAvailable: true, aiUnavailableReason: null }, OUTAGE), 'none')
  assert.equal(interpretationGap({ status: 'completed', summary: null, dimensions: dims(null), interpretationAvailable: false, aiUnavailableReason: 'AI_DECLARATION_REQUIRED' }, OUTAGE), 'declaration')
  assert.equal(interpretationGap({ status: 'completed', summary: null, dimensions: dims(null), interpretationAvailable: false, aiUnavailableReason: 'AI_LOGIN_REQUIRED' }, OUTAGE), 'login')
  assert.equal(interpretationGap({ status: 'completed', summary: null, dimensions: dims(null), interpretationAvailable: false, aiUnavailableReason: 'AI_PAUSED' }, OUTAGE), 'stopped')
  assert.equal(interpretationGap({ status: 'completed', summary: null, dimensions: dims(null), interpretationAvailable: false, aiUnavailableReason: 'AI_ACCESS_CHECK_FAILED' }, OUTAGE), 'stopped')
  assert.equal(interpretationGap({ status: 'completed', summary: null, dimensions: dims(null), interpretationAvailable: false, aiUnavailableReason: 'COMPLIANCE_REJECT' }, OUTAGE), 'rejected')
  assert.equal(interpretationGap({ status: 'completed', summary: null, dimensions: dims(null), interpretationAvailable: false, aiUnavailableReason: 'AI_INTERPRETATION_UNAVAILABLE' }, OUTAGE), 'unavailable')
  // 字段说有解读就以字段为准（不拿正文是否为空去猜）
  assert.equal(interpretationGap({ status: 'completed', summary: null, dimensions: dims(null), interpretationAvailable: true, aiUnavailableReason: null }, OUTAGE), 'none')
})

test('结果页 AI 解读：旧服务端没有字段时退回 providerName 与正文', () => {
  assert.equal(interpretationGap({ status: 'completed', summary: '有', dimensions: dims(null), providerName: 'deepseek' }, OUTAGE), 'none')
  assert.equal(interpretationGap({ status: 'completed', summary: null, dimensions: dims(null), providerName: 'llm_unavailable' }, OUTAGE), 'unavailable')
  assert.equal(interpretationGap({ status: 'rejected', summary: null, dimensions: dims(null), providerName: 'deepseek' }, OUTAGE), 'rejected')
  assert.equal(interpretationGap(null, OUTAGE), 'none')
})

test('职业规划：consent_outdated 时在依据旁说明并给去自我探索的入口', () => {
  const html = renderToStaticMarkup(createElement(careerNote.CareerPlanSelfAssessmentExcluded, { excluded: 'consent_outdated', onGo() {} }))
  assert.ok(html.includes('你之前的自我探索结果因说明已更新，这次没有纳入；重新确认说明后可以纳入。'))
  assert.match(html, /<button type="button" class="qx-btn rdq-aria-btn" data-variant="ghost" data-testid="career-plan-sa-excluded-go">去自我探索重新确认<\/button>/)
})

test('职业规划：null 或缺省时什么都不显示', () => {
  assert.equal(renderToStaticMarkup(createElement(careerNote.CareerPlanSelfAssessmentExcluded, { excluded: null, onGo() {} })), '')
  assert.equal(renderToStaticMarkup(createElement(careerNote.CareerPlanSelfAssessmentExcluded, { excluded: undefined, onGo() {} })), '')
  const page = readFileSync(join(root, 'src/pages/resume/CareerPlanPage.tsx'), 'utf8')
  assert.match(page, /<CareerPlanSelfAssessmentExcluded excluded=\{plan\.selfAssessmentExcluded\} onGo=\{goSelfAssessment\} \/>/)
})
