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

test('结果页静态不显示搜索，进入输入态显示搜索和清空', () => {
  const resting = fieldHtml({ value: '创业', active: false, filled: true, showGo: false })
  assert.equal(resting.includes('data-testid="policy-search-go"'), false)
  assert.match(resting, /data-testid="policy-search-clear"/)
  const editing = fieldHtml({ value: '创业补', active: true, filled: true, showGo: false })
  assert.match(editing, /data-testid="policy-search-go"/)
  assert.match(editing, />搜索</)
  assert.match(editing, /data-testid="policy-search-clear"/)
  assert.match(editing, /data-testid="policy-search-count">3 \/ 30</)
  assert.equal(editing.includes('disabled'), false)
})

test('拼音在词中间不计数，组字区间决定扣哪一段，组字本身不触发超长', () => {
  assert.equal(model.policyKeywordCount('创ye补贴', 'ye'), 3)
  assert.equal(model.committedKeyword('创ye补贴', 'ye'), '创补贴')
  assert.deepEqual(model.policyCompositionSpan('创ye补贴', 'ye', 3, 3, 1), { start: 1, end: 3 })
  assert.equal(model.committedKeyword('ye创业ye', 'ye', { start: 0, end: 2 }), '创业ye')
  assert.equal(model.committedKeyword('ye创业ye', 'ye', { start: 4, end: 6 }), 'ye创业')
  const raw = `${'补'.repeat(15)}ye${'补'.repeat(15)}`
  assert.equal(raw.length, 32)
  assert.equal(model.policyKeywordCount(raw, 'ye'), 30)
  const html = fieldHtml({
    value: raw, composition: 'ye', compositionSpan: { start: 15, end: 17 }, active: true, filled: true,
  })
  assert.match(html, /data-testid="policy-search-count">30 \/ 30</)
  assert.equal(html.includes('最多 30 个字'), false)
  assert.equal(html.includes('disabled'), false)
})

test('原文摘录保留开头空行和连续空行', () => {
  assert.equal(model.policyExcerptPages('\n第一行\n第二行', 100)[0], '\n第一行\n第二行')
  assert.equal(model.policyExcerptPages('\n\n第一行', 100)[0], '\n\n第一行')
  assert.equal(model.policyExcerptPages('第一行\n\n第二行', 100)[0], '第一行\n\n第二行')
  const shown = excerptHtml('\n第一行补贴说明。\n\n第二行见习说明。')
  assert.match(shown, /\n第一行补贴说明。\n\n第二行见习说明。/)
})

test('本地超长不发请求，服务端 400 记为已拒绝，句子都不写内部判定', async () => {
  let calls = 0
  const local = await model.resolvePolicySearch('补'.repeat(31), async () => {
    calls += 1
    return emptyResult
  })
  assert.equal(local.status, 'too-long')
  assert.equal(local.blocked, 'local')
  assert.equal(local.count, 31)
  assert.equal(calls, 0)
  const server = await model.resolvePolicySearch('补贴', async () => {
    calls += 1
    throw new PolicyKeywordTooLongError()
  })
  assert.equal(server.status, 'too-long')
  assert.equal(server.blocked, 'server')
  assert.equal(server.count, 2)
  assert.equal(calls, 1)
  for (const outcome of [local, server]) {
    const copy = model.policyTooLongCopy(outcome.count)
    const html = renderToStaticMarkup(createElement('section', null,
      createElement('h1', null, copy.title),
      createElement('p', null, copy.sub),
      createElement('h2', null, copy.heading),
      createElement('p', null, copy.body),
    ))
    assert.match(html, /这个词超过 30 个字/)
    assert.match(html, /最多 30 个字/)
    assert.match(html, /输入一个词就够/)
    assert.equal(html.includes('没有发出搜索'), false)
    assert.equal(html.includes('没有按没连上处理'), false)
    assert.equal(html.includes('没连上'), false)
  }
})

function installPolicyDom() {
  if (globalThis.document?.body) return
  class MiniNode {
    constructor(nodeType, nodeName) {
      this.nodeType = nodeType
      this.nodeName = nodeName
      this.parentNode = null
      this.childNodes = []
      this.ownerDocument = null
      this.listeners = new Map()
      this.data = ''
    }
    addEventListener(type, fn) {
      const list = this.listeners.get(type) ?? []
      list.push(fn)
      this.listeners.set(type, list)
    }
    removeEventListener(type, fn) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== fn))
    }
    get firstChild() { return this.childNodes[0] ?? null }
    get nextSibling() {
      if (!this.parentNode) return null
      const index = this.parentNode.childNodes.indexOf(this)
      return this.parentNode.childNodes[index + 1] ?? null
    }
    insertBefore(child, ref) {
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
      const index = ref ? this.childNodes.indexOf(ref) : -1
      if (index < 0) this.childNodes.push(child)
      else this.childNodes.splice(index, 0, child)
      return child
    }
    appendChild(child) { return this.insertBefore(child, null) }
    removeChild(child) {
      const index = this.childNodes.indexOf(child)
      if (index >= 0) this.childNodes.splice(index, 1)
      child.parentNode = null
      return child
    }
    contains(node) {
      let current = node
      while (current) {
        if (current === this) return true
        current = current.parentNode
      }
      return false
    }
    get nodeValue() { return this.nodeType === 3 || this.nodeType === 8 ? this.data : null }
    set nodeValue(value) { if (this.nodeType === 3 || this.nodeType === 8) this.data = value == null ? '' : String(value) }
    get textContent() {
      return this.nodeType === 3 || this.nodeType === 8
        ? this.data
        : this.childNodes.map((child) => child.textContent).join('')
    }
    set textContent(value) {
      this.childNodes = []
      if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)))
    }
  }
  class MiniElement extends MiniNode {
    constructor(name) {
      super(1, String(name).toUpperCase())
      this.attributes = new Map()
      this.style = { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } }
      this.namespaceURI = 'http://www.w3.org/1999/xhtml'
      this.value = ''
      this.selectionStart = null
      this.selectionEnd = null
      this.disabled = false
    }
    get tagName() { return this.nodeName }
    setAttribute(name, value) { this.attributes.set(name, String(value)) }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
    removeAttribute(name) { this.attributes.delete(name) }
    hasAttribute(name) { return this.attributes.has(name) }
    focus() {}
    blur() {}
  }
  class MiniDocument extends MiniNode {
    constructor() {
      super(9, '#document')
      this.ownerDocument = this
      this.documentElement = this.createElement('html')
      this.appendChild(this.documentElement)
      this.body = this.createElement('body')
      this.documentElement.appendChild(this.body)
    }
    createElement(name) {
      const element = new MiniElement(name)
      element.ownerDocument = this
      return element
    }
    createElementNS(_namespace, name) { return this.createElement(name) }
    createTextNode(data) {
      const node = new MiniNode(3, '#text')
      node.data = String(data)
      node.ownerDocument = this
      return node
    }
    createComment(data) {
      const node = new MiniNode(8, '#comment')
      node.data = String(data)
      node.ownerDocument = this
      return node
    }
  }
  const document = new MiniDocument()
  const base = {
    document,
    HTMLElement: MiniElement,
    Element: MiniElement,
    Node: MiniNode,
    navigator: { userAgent: 'node' },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener() {},
    removeEventListener() {},
  }
  const windowStub = new Proxy(base, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver)
      if (typeof prop === 'string' && prop.startsWith('HTML')) {
        const ctor = class {}
        target[prop] = ctor
        return ctor
      }
      return undefined
    },
  })
  document.defaultView = windowStub
  globalThis.window = windowStub
  globalThis.document = document
  globalThis.HTMLElement = MiniElement
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
}

function textOf(node) {
  return node?.textContent ?? ''
}

function findTestId(root, id) {
  let found = null
  const visit = (node) => {
    if (node?.getAttribute?.('data-testid') === id) found = node
    for (const child of node?.childNodes ?? []) visit(child)
  }
  visit(root)
  return found
}

const routerUrl = toDataUrl(`
export function useNavigate() {
  return (to) => { globalThis.__pl2Navs.push(String(to)) }
}
export function useSearchParams() {
  return [new URLSearchParams(globalThis.__pl2Search || ''), () => {}]
}
`)
const pagePoliciesUrl = toDataUrl(`
export function getPublishedPolicies(query) {
  globalThis.__pl2PolicyQueries.push({ ...query })
  if (query.keyword === '补贴') {
    const error = new Error('POLICY_KEYWORD_TOO_LONG')
    error.code = 'POLICY_KEYWORD_TOO_LONG'
    return Promise.reject(error)
  }
  return Promise.resolve({ items: [], total: 0, page: 1, pageSize: query.pageSize || 4, totalPages: 1 })
}
export class PolicyKeywordTooLongError extends Error {}
`)
const layoutUrl = toDataUrl(`
import { createElement } from '${import.meta.resolve('react')}'
export function PolicyTouchLayout({ title, sub, children }) {
  return createElement('section', null, createElement('h1', null, title), createElement('p', null, sub), children)
}
`)
const tileUrl = toDataUrl(`
import { createElement } from '${import.meta.resolve('react')}'
export function QxTouchTile({ title, onClick }) {
  return createElement('button', { type: 'button', onClick }, title)
}
export function QxTouchArtChecklist() { return null }
`)
const rowStubUrl = toDataUrl(`export function PolicyGuideRow() { return null }`)
const pageCode = withReact(transpile('src/pages/renshi/PolicySearchPage.tsx'))
const pageUrl = toDataUrl([
  ['react-router-dom', routerUrl],
  ['../../components/qingxu/touch/QxTouchArt', tileUrl],
  ['../../components/qingxu/touch/QxTouchTile', tileUrl],
  ['../../services/api/policies', pagePoliciesUrl],
  ['./PolicyGuideRow', rowStubUrl],
  ['./PolicySearchField', fieldUrl],
  ['./PolicyTouchLayout', layoutUrl],
  ['./policyModel', modelCoreUrl],
  ['./policyKeywordSession', sessionUrl],
  ['./policySearchModel', searchModelUrl],
].reduce((code, [from, to]) => retarget(code, from, to), pageCode))

async function mountSearchPage(keyword) {
  installPolicyDom()
  const { act } = await import('react')
  const { flushSync } = await import('react-dom')
  const { createRoot } = await import('react-dom/client')
  const { PolicySearchPage } = await import(pageUrl)
  globalThis.__pl2PolicyQueries = []
  globalThis.__pl2Navs = []
  globalThis.__pl2Search = 'search=1'
  session.setPolicyKeyword(keyword)
  const host = globalThis.document.createElement('div')
  globalThis.document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    flushSync(() => root.render(createElement(PolicySearchPage)))
    await Promise.resolve()
    await Promise.resolve()
  })
  return {
    host,
    queries: globalThis.__pl2PolicyQueries,
    stop() {
      root.unmount()
      host.parentNode?.removeChild(host)
      session.setPolicyKeyword('')
    },
  }
}

test('搜索页请求带关键词，并且只搜政策', async () => {
  const mounted = await mountSearchPage('创业')
  try {
    assert.match(textOf(mounted.host), /没有找到含「创业」的政策/)
    const search = mounted.queries.filter((query) => query.keyword === '创业')
    assert.equal(search.length, 1)
    assert.equal(search[0].kind, 'policy_guide')
    assert.equal(search[0].pageSize, 4)
    assert.equal(findTestId(mounted.host, 'policy-search-go'), null)
    assert.ok(findTestId(mounted.host, 'policy-search-clear'))
  } finally {
    mounted.stop()
  }
})

test('服务端拒绝超长后页面写出超过 30 字，不写没发出搜索', async () => {
  const mounted = await mountSearchPage('补贴')
  try {
    const text = textOf(mounted.host)
    assert.match(text, /这个词超过 30 个字/)
    assert.match(text, /最多 30 个字，现在 2 个字/)
    assert.match(text, /这里按政策标题和摘要里的词找，输入一个词就够，比如「创业」「补贴」。/)
    assert.equal(text.includes('没有发出搜索'), false)
    assert.equal(text.includes('没有按没连上处理'), false)
    assert.equal(text.includes('这次没连上'), false)
    const search = mounted.queries.filter((query) => query.keyword === '补贴')
    assert.equal(search.length, 1)
    assert.equal(search[0].kind, 'policy_guide')
  } finally {
    mounted.stop()
  }
})

test('搜索页本地超过 30 字不发关键词请求，屏上仍是超过 30 字', async () => {
  const word = '补'.repeat(31)
  const mounted = await mountSearchPage(word)
  try {
    const text = textOf(mounted.host)
    assert.match(text, /最多 30 个字，现在 31 个字/)
    assert.equal(text.includes('没有发出搜索'), false)
    assert.equal(text.includes('没有按没连上处理'), false)
    assert.equal(mounted.queries.some((query) => query.keyword), false)
  } finally {
    mounted.stop()
  }
})
