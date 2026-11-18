// 政策搜索、截止日期、原文摘录、已看不到（2026-11-17）。
// 编译后执行真实函数，并用 react-dom/server 断言渲染结果。不读取源码做字符串比对。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (rel) => ts.transpileModule(readFileSync(join(root, rel), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  fileName: rel,
}).outputText
const withReact = (code) => code
  .replace(/from ["']react\/jsx-runtime["']/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
  .replace(/from ["']react["']/g, `from '${import.meta.resolve('react')}'`)
const retarget = (code, from, to) => code
  .replaceAll(`from '${from}'`, `from '${to}'`)
  .replaceAll(`from "${from}"`, `from '${to}'`)

globalThis.__pl2PolicyClears = []
const policiesUrl = toDataUrl(`
export class PolicyKeywordTooLongError extends Error {
  constructor() {
    super('POLICY_KEYWORD_TOO_LONG')
    this.name = 'PolicyKeywordTooLongError'
    this.code = 'POLICY_KEYWORD_TOO_LONG'
  }
}
`)
const sessionStubUrl = toDataUrl(`
export function subscribeKioskSensitiveSessionClear(listener) {
  globalThis.__pl2PolicyClears.push(listener)
  return () => {
    const list = globalThis.__pl2PolicyClears
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
  }
}
`)
const modelCoreUrl = toDataUrl(transpile('src/pages/renshi/policyModel.ts'))
const searchModelUrl = toDataUrl(retarget(retarget(
  transpile('src/pages/renshi/policySearchModel.ts'),
  '../../services/api/policies', policiesUrl,
), './policyModel', modelCoreUrl))
const sessionUrl = toDataUrl(retarget(
  transpile('src/pages/renshi/policyKeywordSession.ts'),
  '../../auth/kioskSensitiveSession', sessionStubUrl,
))
const factsUrl = toDataUrl(transpile('src/pages/renshi/policyFacts.ts'))
const iconUrl = toDataUrl(withReact(transpile('src/components/qingxu/touch/QxTouchIcon.tsx')))
const artUrl = toDataUrl(withReact(transpile('src/components/qingxu/touch/QxTouchArt.tsx')))
const checklistUrl = toDataUrl(`
import { createElement } from '${import.meta.resolve('react')}'
export function PolicyChecklistSample() {
  return createElement('section', { 'data-testid': 'policy-checklist-sample' }, '清单示意')
}
`)
const fieldUrl = toDataUrl(withReact(retarget(retarget(
  transpile('src/pages/renshi/PolicySearchField.tsx'),
  './policySearchModel', searchModelUrl,
), './policyKeywordSession', sessionUrl)))
const rowUrl = toDataUrl(withReact(retarget(retarget(
  transpile('src/pages/renshi/PolicyGuideRow.tsx'),
  './policyFacts', factsUrl,
), './policySearchModel', searchModelUrl)))
const excerptUrl = toDataUrl(withReact(retarget(retarget(
  transpile('src/pages/renshi/PolicyExcerpt.tsx'),
  '../../components/qingxu/touch/QxTouchIcon', iconUrl,
), './policySearchModel', searchModelUrl)))
const goneUrl = toDataUrl(withReact(retarget(retarget(
  transpile('src/pages/renshi/PolicyUnavailable.tsx'),
  '../../components/qingxu/touch/QxTouchArt', artUrl,
), './PolicyTouchLayout', checklistUrl)))

const model = await import(searchModelUrl)
const session = await import(sessionUrl)
const { PolicyKeywordTooLongError } = await import(policiesUrl)
const { PolicySearchFieldView } = await import(fieldUrl)
const { PolicyGuideRow } = await import(rowUrl)
const { PolicyExcerpt } = await import(excerptUrl)
const { PolicyUnavailable } = await import(goneUrl)

const noop = () => {}
const emptyResult = { items: [], total: 0, page: 1, pageSize: 4, totalPages: 1 }
const BEIJING_NOON = new Date('2026-11-17T04:00:00.000Z')

function fieldHtml(props) {
  return renderToStaticMarkup(createElement(PolicySearchFieldView, {
    onValue: noop, onSearch: noop, onClear: noop, ...props,
  }))
}

function policy(over = {}) {
  return {
    id: 'p1', kind: 'policy_guide', title: '高校毕业生创业补贴', summary: '含创业一词的摘要',
    sourceName: '示例人社局', syncTime: '2026-09-20T00:00:00.000Z', publishedDate: '2026-08-01',
    ...over,
  }
}

function rowHtml(item, extra = {}) {
  return renderToStaticMarkup(createElement(PolicyGuideRow, {
    policy: item,
    onOpen: noop,
    deadlineLabel: model.policyDeadlineLabel(item.validThrough),
    ...extra,
  }))
}

function excerptHtml(content) {
  return renderToStaticMarkup(createElement(PolicyExcerpt, {
    content, title: '高校毕业生创业补贴', source: '示例人社局', published: '2026-08-01', onOverlay: noop,
  }))
}

function goneHtml(kind, meta) {
  const copy = model.policyGoneCopy(kind, meta)
  return renderToStaticMarkup(createElement('article', null,
    createElement('h1', null, copy.title),
    createElement('p', null, copy.eyebrow),
    createElement(PolicyUnavailable, { copy, onHome: noop, onKiosk: noop }),
  ))
}

test('字数去首尾空白，和第 30 字还能搜、第 31 字停用', () => {
  const thirty = '补'.repeat(30)
  const thirtyOne = '补'.repeat(31)
  const atLimit = fieldHtml({ value: `  ${thirty}  `, active: true, filled: true })
  assert.match(atLimit, /data-testid="policy-search-count">30 \/ 30</)
  assert.doesNotMatch(atLimit, /最多 30 个字/)
  assert.equal(atLimit.includes('disabled'), false)
  const over = fieldHtml({ value: thirtyOne, active: true, filled: true })
  assert.match(over, /最多 30 个字，现在 31 个字/)
  assert.match(over, /data-testid="policy-search-count">31 \/ 30</)
  assert.match(over, /输入一个词就够/)
  assert.match(over, /data-testid="policy-search-go"[^>]*disabled/)
  const emoji = fieldHtml({ value: '👍', active: true, filled: true })
  assert.match(emoji, /data-testid="policy-search-count">2 \/ 30</)
})

test('拼音还在候选栏里时不计入字数', () => {
  const html = fieldHtml({ value: '创ye', composition: 'ye', active: true, filled: true })
  assert.match(html, /data-testid="policy-search-count">1 \/ 30</)
  assert.equal(html.includes('>3 / 30<'), false)
  assert.equal(html.includes('>4 / 30<'), false)
  assert.match(html, /value="创ye"/)
})

test('去掉空白后为空、或超过 30 字，都不发请求', async () => {
  let calls = 0
  const request = async (word) => { calls += 1; return { ...emptyResult, keyword: word } }
  const blank = await model.resolvePolicySearch('   ', request)
  assert.equal(blank.status, 'idle')
  const over = await model.resolvePolicySearch(`  ${'补'.repeat(31)}  `, request)
  assert.equal(over.status, 'too-long')
  assert.equal(over.count, 31)
  assert.equal(calls, 0)
  const exact = await model.resolvePolicySearch('补'.repeat(30), request)
  assert.equal(exact.status, 'ready')
  assert.equal(calls, 1)
})

test('服务端 400 超长按超过 30 字，其它失败才是没连上', async () => {
  const tooLong = await model.resolvePolicySearch('补贴', async () => { throw new PolicyKeywordTooLongError() })
  assert.equal(tooLong.status, 'too-long')
  assert.equal(tooLong.count, 2)
  assert.notEqual(tooLong.status, 'failed')
  const coded = new Error('关键词最长 30 字')
  coded.code = 'POLICY_KEYWORD_TOO_LONG'
  const also = await model.resolvePolicySearch('补贴', async () => { throw coded })
  assert.equal(also.status, 'too-long')
  const failed = await model.resolvePolicySearch('补贴', async () => { throw new Error('network') })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.keyword, '补贴')
})

test('短超时和默认 8 秒都按没连上，默认那次真的等到 8 秒', { timeout: 20_000 }, async () => {
  const quick = await model.resolvePolicySearch('补贴', () => new Promise(() => {}), 40)
  assert.equal(quick.status, 'failed')
  assert.equal(quick.keyword, '补贴')
  const started = Date.now()
  const hung = await model.resolvePolicySearch('见习', () => new Promise(() => {}))
  const elapsed = Date.now() - started
  assert.equal(hung.status, 'failed')
  assert.equal(hung.keyword, '见习')
  assert.equal(model.POLICY_SEARCH_TIMEOUT_MS, 8000)
  assert.ok(elapsed >= 8000, `只等了 ${elapsed} 毫秒`)
  assert.ok(elapsed < 15000, `等了 ${elapsed} 毫秒`)
})

test('清场回调把这一次的关键词清掉，只改关键词不会通知', () => {
  let heard = 0
  const stop = session.subscribePolicyKeywordClear(() => { heard += 1 })
  session.setPolicyKeyword('创业')
  assert.equal(session.getPolicyKeyword(), '创业')
  assert.equal(heard, 0)
  for (const listener of [...globalThis.__pl2PolicyClears]) listener()
  assert.equal(session.getPolicyKeyword(), '')
  assert.equal(heard, 1)
  stop()
  session.setPolicyKeyword('补贴')
  for (const listener of [...globalThis.__pl2PolicyClears]) listener()
  assert.equal(session.getPolicyKeyword(), '')
})

test('有截止日期才写出陶土签，没有就不写、也不写已过期', () => {
  const dated = rowHtml(policy({ validThrough: '2026-12-31' }), { highlight: '创业', categoryLabel: '创业扶持' })
  assert.match(dated, /12 月 31 日截止/)
  assert.match(dated, /policy-deadline/)
  assert.match(dated, /<mark class="policy-kw">创业<\/mark>/)
  assert.match(dated, /创业扶持/)
  assert.match(dated, /示例人社局/)
  assert.match(dated, /更新于 2026-08-01/)
  const open = rowHtml(policy())
  assert.equal(open.includes('截止'), false)
  assert.equal(open.includes('已过期'), false)
  assert.equal(open.includes('policy-deadline'), false)
  const past = rowHtml(policy({ validThrough: '2026-11-16' }))
  assert.match(past, /11 月 16 日截止/)
  assert.equal(past.includes('已过期'), false)
  assert.equal(model.policyDeadlinePassed('2026-11-17', BEIJING_NOON), false)
  assert.equal(model.policyDeadlinePassed('2026-11-16', BEIJING_NOON), true)
  assert.equal(model.policyDeadlinePassed(undefined, BEIJING_NOON), false)
  assert.equal(model.policyDeadlineLabel('不是日期'), undefined)
})

test('原文两行放得下就整段放下，放不下才给展开全文', () => {
  const fits = '第一行补贴说明。\n第二行见习说明。'
  const fitted = excerptHtml(fits)
  assert.match(fitted, /原文摘录/)
  assert.match(fitted, /以发布机构原文为准/)
  assert.match(fitted, /第一行补贴说明。\n第二行见习说明。/)
  assert.equal(fitted.includes('policy-excerpt-open'), false)
  assert.equal(fitted.includes('policy-excerpt-cut'), false)
  const overflow = `${fits}\n第三行创业说明，见 https://hrss.example.gov.cn/policy`
  const cut = excerptHtml(overflow)
  assert.match(cut, /policy-excerpt-cut/)
  assert.match(cut, new RegExp(`展开全文 · ${model.policyExcerptAbout(overflow).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.match(cut, /https:\/\/hrss\.example\.gov\.cn\/policy/)
  assert.equal(cut.includes('<a '), false)
  assert.equal(cut.includes('qr'), false)
  assert.equal(excerptHtml(''), '')
  assert.equal(excerptHtml('  \n  '), '')
  const oneLine = model.policyExcerptPages(overflow, 1)
  assert.equal(oneLine.length, 4)
  assert.equal(oneLine[0], '第一行补贴说明。')
  assert.equal(oneLine[1], '第二行见习说明。')
  assert.equal(oneLine[2] + oneLine[3], '第三行创业说明，见 https://hrss.example.gov.cn/policy')
  assert.equal(oneLine[2].includes('\n'), false)
  const wide = '字'.repeat(34 * 22 + 5)
  const paged = model.policyExcerptPages(wide)
  assert.equal(paged.length, 2)
  assert.equal(Array.from(paged[0]).length, 34 * 22)
  assert.equal(paged[0].includes('\n'), false)
  assert.equal(paged.join(''), wide)
})

test('打开时 404 和正在看时过了截止日期是两句不同的话', () => {
  const missing = goneHtml('missing')
  assert.match(missing, /<h1>这条政策现在看不到了<\/h1>/)
  assert.match(missing, /可能是这几种情况/)
  assert.match(missing, /发布机构写的截止日期已经过了/)
  assert.match(missing, /发布机构已经撤下这一条/)
  assert.match(missing, /这一条不在本机的显示范围里/)
  assert.match(missing, /不再显示旧正文、原文二维码和办事清单。/)
  assert.match(missing, /返回政策首页/)
  assert.match(missing, /回首页办别的事/)
  assert.equal(missing.includes('这条政策已下架'), false)
  assert.equal(missing.includes('这条政策已经撤下或不在可查看范围'), false)
  assert.equal(missing.includes('重新读取'), false)
  const expired = goneHtml('expired', { sourceName: '示例人社局', validThrough: '2026-08-01' })
  assert.match(expired, /<h1>这条政策已过截止日期<\/h1>/)
  assert.match(expired, /示例人社局发布 · 8 月 1 日截止/)
  assert.match(expired, /8 月 1 日已截止/)
  assert.match(expired, /发布机构写的截止日期是 8 月 1 日，过了这一天，这里不再显示/)
  assert.equal(expired.includes('已过期'), false)
  assert.equal(expired.includes('这条政策现在看不到了'), false)
  assert.equal(expired.includes('重新读取'), false)
})
