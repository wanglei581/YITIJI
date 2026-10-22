/**
 * FLOW1a（10/17，用户手机验收后重开）：我的文档 → 打印参数 → 终端和参数 → 确认提交。
 *   - 「刷新」「重试」绑的是 loadDocuments，点击事件对象被当成翻页参数：没有下一页时不发请求，
 *     有下一页时把下一页追加进来（Claude、Codex 各在沙箱复现过）；
 *   - 其余各项见 claude-exec/outputs/claude-flow1a-plan.md。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
const stripComments = (src) => src.replace(/<!--[\s\S]*?-->/g, '')
const TAP = { type: 'tap', timeStamp: 1, currentTarget: { dataset: {} }, target: { dataset: {} }, detail: { x: 1, y: 1 } }

const doc = (id, name) => ({ id, filename: name, mimeType: 'application/pdf', sizeBytes: 2048, createdAt: '2026-10-16T08:14:00Z', expiresAt: '2026-10-23T08:14:00Z', retentionPolicy: 'system_short', allowedRetentionPolicies: ['system_short'] })
const firstPage = () => Object.assign([doc('f-offline', 'ZYD-20261016-BIZ-OFFLINE-D93A.pdf'), doc('f-duplex', 'ZYD-20261016-BIZ-DUPLEX-D93A.pdf')], { nextCursor: 'c-2' })
const lastPage = () => [doc('f-color', 'ZYD-20261016-BIZ-COLOR-D93A.pdf')]

function documentsPage(respond) {
  const requests = []
  const api = {
    getMyDocuments(q) { requests.push(q); return respond(requests.length, q) },
    getDocumentConversionCapabilities: () => Promise.resolve({ wordToPdf: false }),
  }
  const auth = { isLoggedIn: () => true, getUser: () => ({ id: 'member-1' }) }
  const wx = { redirectTo() {}, switchTab() {}, navigateTo() {}, showModal() {}, showToast() {}, showLoading() {}, hideLoading() {}, showActionSheet() {} }
  const page = instantiate(loadPageDefinition('pages/documents/documents.js', { wx, modules: { api, auth } }))
  return { page, requests }
}

test('我的文档「刷新」：只有一页时也重新请求第一页（点击事件不是翻页参数）', async () => {
  const { page, requests } = documentsPage(() => Promise.resolve(lastPage()))
  page.onLoad({}); await flush()
  assert.equal(requests.length, 1)
  page.reloadDocuments(TAP); await flush()
  assert.equal(requests.length, 2, '点了刷新要发请求')
  assert.equal(requests[1].cursor, undefined, '刷新取第一页，不带 cursor')
})

test('我的文档「刷新」：有下一页时也是从第一页重来，不是把下一页追加进来', async () => {
  const { page, requests } = documentsPage(() => Promise.resolve(firstPage()))
  page.onLoad({}); await flush()
  assert.equal(page.data.nextCursor, 'c-2')
  page.reloadDocuments(TAP); await flush()
  assert.equal(requests.length, 2)
  assert.equal(requests[1].cursor, undefined, '不能带上 nextCursor')
  assert.deepEqual(page.data.all.map((d) => d.id), ['f-offline', 'f-duplex'], '列表换成第一页，没有重复追加')
})

test('我的文档：加载失败后点「重试」会重新请求', async () => {
  const { page, requests } = documentsPage((n) => (n === 1 ? Promise.reject({ message: '网络不太稳定，请稍后再试' }) : Promise.resolve(lastPage())))
  page.onLoad({}); await flush()
  assert.ok(page.data.loadError)
  page.reloadDocuments(TAP); await flush()
  assert.equal(requests.length, 2, '点了重试要发请求')
  assert.equal(page.data.loadError, '')
  assert.deepEqual(page.data.all.map((d) => d.id), ['f-color'])
})

test('我的文档：loadDocuments 只认 append === true 才翻页；触底仍按 cursor 追加', async () => {
  const { page, requests } = documentsPage((n) => Promise.resolve(n <= 2 ? firstPage() : lastPage()))
  page.onLoad({}); await flush()
  page.loadDocuments(TAP); await flush()
  assert.equal(requests.length, 2, '传进事件对象也按刷新处理')
  assert.equal(requests[1].cursor, undefined)
  page.onReachBottom(); await flush()
  assert.equal(requests.length, 3)
  assert.equal(requests[2].cursor, 'c-2', '触底带 cursor')
  assert.deepEqual([...page.data.all.map((d) => d.id)], ['f-offline', 'f-duplex', 'f-color'], '触底是追加')
})

test('我的文档模板：「刷新」「重试」都绑 reloadDocuments，不再直接绑 loadDocuments', () => {
  const wxml = stripComments(read('pages/documents/documents.wxml'))
  assert.doesNotMatch(wxml, /bindtap="loadDocuments"/)
  assert.equal((wxml.match(/bindtap="reloadDocuments"/g) || []).length, 2)
})

// ── 文件名拆成主名 + 扩展名 ─────────────────────────────────────────────────

test('displayNameParts：只在 1–5 位字母数字扩展名、点不在开头时才拆', async () => {
  const { createRequire } = await import('node:module')
  const names = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))('./upload-name.js')
  const cases = [
    ['ZYD-20261016-BIZ-COLOR-D93A.pdf', 'ZYD-20261016-BIZ-COLOR-D93A', 'PDF'],
    ['王同学 简历 2026.PDF', '王同学 简历 2026', 'PDF'],
    ['a.b.c.docx', 'a.b.c', 'DOCX'],
    ['简历', '简历', ''],
    ['.bashrc', '.bashrc', ''],
    ['name.', 'name.', ''],
    ['report.verylongext', 'report.verylongext', ''],
    ['x.p df', 'x.p df', ''],
    ['', '', ''],
  ]
  for (const [input, base, ext] of cases) assert.deepEqual({ ...names.displayNameParts(input) }, { base, ext }, input)
})

// ── 我的文档：点整行看原文，「打印」走打印，菜单统一叫法、顶部给完整原名 ─────

function documentsUi(all) {
  const calls = { nav: [], sheet: [], fetch: [] }
  const api = {
    getMyDocuments: () => Promise.resolve([]),
    getDocumentConversionCapabilities: () => Promise.resolve({ wordToPdf: false }),
    getFilePreviewUrl: (id) => { calls.fetch.push(id); return new Promise(() => {}) },
  }
  const auth = { isLoggedIn: () => true, getUser: () => ({ id: 'member-1' }) }
  const wx = { redirectTo() {}, switchTab() {}, navigateTo: (o) => calls.nav.push(o.url), showModal() {}, showToast() {}, showLoading() {}, hideLoading() {}, showActionSheet: (o) => calls.sheet.push(o) }
  const page = instantiate(loadPageDefinition('pages/documents/documents.js', { wx, modules: { api, auth } }))
  page.data.all = all
  return { page, calls }
}
const row = (id) => ({ currentTarget: { dataset: { id } } })
const colorDoc = { id: 'f-color', name: 'ZYD-20261016-BIZ-COLOR-D93A.pdf', mimeType: 'application/pdf', isImage: false, reprintable: true, pages: 1, retentionLocked: true }

test('我的文档：点整行打开原文，不进打印；不可打印的报告点整行也直接打开', async () => {
  const { page, calls } = documentsUi([colorDoc, { ...colorDoc, id: 'r-1', reprintable: false }])
  page.openDoc(row('f-color')); await flush()
  assert.deepEqual([...calls.fetch], ['f-color'], '点整行要现取原文链接')
  assert.equal(calls.nav.length, 0, '点整行不再进打印参数页')
  page.data.previewing = false
  page.openDoc(row('r-1')); await flush()
  assert.deepEqual([...calls.fetch], ['f-color', 'r-1'])
  assert.equal(calls.nav.length, 0)
})

test('我的文档：「打印」才进打印；「⋯」菜单叫「打印」，顶部给完整原名', () => {
  const { page, calls } = documentsUi([colorDoc])
  page.reprintDoc(row('f-color'))
  assert.match(calls.nav[0], /^\/pages\/print-upload\/print-upload\?fileId=f-color&/)
  page.more(row('f-color'))
  const sheet = calls.sheet[0]
  assert.equal(sheet.alertText, 'ZYD-20261016-BIZ-COLOR-D93A.pdf')
  assert.ok(sheet.itemList.includes('打印'))
  assert.ok(!sheet.itemList.includes('发起打印') && !sheet.itemList.includes('重新打印'))
})

test('我的文档模板：标题只放主名；行内「打印」走 reprintDoc；没有「重新打印」字样；⋯ 有无障碍名称', () => {
  const wxml = stripComments(read('pages/documents/documents.wxml'))
  assert.match(wxml, /<view class="doc-name">\{\{item\.baseName\}\}<\/view>/)
  assert.match(wxml, /catchtap="reprintDoc"[\s\S]*?>打印<\/view>/)
  assert.doesNotMatch(wxml, />\s*(?:重新打印|发起打印)\s*</, '按钮不再叫「重新打印」「发起打印」')
  assert.match(wxml, /catchtap="more"[^>]*aria-role="button" aria-label="更多操作"/)
  const css = read('pages/documents/documents.wxss')
  assert.match(css, /\.doc-more \{[^}]*width: 96rpx;[^}]*height: 96rpx;/, '⋯ 的真实点击盒 96rpx 见方')
  assert.match(css, /\.doc-action::after \{[^}]*top: -18rpx;[^}]*bottom: -18rpx;/, '胶囊点击区上下各扩 18rpx，合计 96rpx')
  assert.match(css, /\.doc-item \.doc-actions \{[^}]*margin-top: 20rpx;/, '底行离 ⋯ 至少 20rpx，点击区不重叠')
})

// ── 确认文件页（print-upload）：不再设参数；直接开原文；草稿按发起跳转时的会话与会员归属 ──

function uploadUi({ name = 'ZYD-20261016-BIZ-COLOR-D93A.pdf', user = { id: 'A' } } = {}) {
  const state = { gen: 7, user }
  const calls = { nav: [], open: [], preview: [], modal: [], fetch: [] }
  const api = {
    createPrintPiiScan: () => Promise.resolve({ id: 'scan-1', piiFindings: [] }),
    quoteMyPrintOrder: () => Promise.resolve({ amountCents: 0, billablePages: 1 }),
    getFilePreviewUrl: (id) => { calls.fetch.push(id); return Promise.resolve({ url: '/api/v1/files/' + id + '/content?sig=x' }) },
  }
  const forbidden = (fn) => () => { throw new Error(`print-upload 不该调 auth.${fn}（过期时会顺手清会话）`) }
  const auth = { sessionGeneration: () => state.gen, isSameSession: (g) => g === state.gen, isLoggedIn: forbidden('isLoggedIn'), getToken: forbidden('getToken'), getUser: forbidden('getUser') }
  const storage = { KEYS: { USER: 'zyd_user' }, get: (k, fb) => (k === 'zyd_user' && state.user ? state.user : fb) }
  const fileUrl = {
    openSignedDocument: (o) => { calls.open.push(o.name); return Promise.resolve({ ok: false, text: '下载域名还没有配置好' }) },
    absoluteUrl: (u) => (u ? 'https://api.example.test' + u : ''),
  }
  const wx = { navigateTo: (o) => calls.nav.push(o), showModal: (o) => calls.modal.push(o), showToast() {}, showLoading() {}, hideLoading() {}, previewImage: (o) => calls.preview.push(o), navigateBack() {}, switchTab() {} }
  const page = instantiate(loadPageDefinition('pages/print-upload/print-upload.js', { wx, modules: { api, auth, storage, 'file-url': fileUrl } }))
  page.onLoad({ fileId: 'f-color', name: encodeURIComponent(name), pages: '1' })
  return { page, calls, state }
}
const queryOf = (url) => Object.fromEntries(url.split('?')[1].split('&').map((kv) => kv.split('=')).map(([k, v]) => [k, decodeURIComponent(v)]))
const draft = (extra = {}) => ({ fileId: 'f-color', copies: 2, colorMode: 'color', duplex: 'duplex_long_edge', terminalId: 'KSK-001', ...extra })

test('确认文件页：没有颜色、单双面、份数控件；标题「确认文件」；步骤与按钮写清下一步；不再进打印预览页', () => {
  const wxml = stripComments(read('pages/print-upload/print-upload.wxml'))
  assert.doesNotMatch(wxml, /pickColor|pickDuplex|bindtap="minus"|bindtap="plus"|打印设置|合计纸张/)
  assert.match(wxml, /<view class="nav-title">确认文件<\/view>/)
  assert.match(wxml, /<text class="n">2<\/text><text class="nl">终端和参数<\/text>/)
  assert.match(wxml, /'请完成隐私检查' : '选终端和参数'\)/)
  assert.match(wxml, /<view class="fc-name">\{\{fileBase\}\}<\/view>/, '文件卡标题只放主名，扩展名在 fc-tag')
  assert.doesNotMatch(wxml, /可以提交打印订单/, '提交在第 3 步')
  assert.doesNotMatch(read('pages/print-upload/print-upload.js'), /\/pages\/print-preview\//)
})

test('确认文件页：默认带黑白、单面、1 份去第 2 步，并挂上草稿回传通道', async () => {
  const { page, calls } = uploadUi()
  await flush(); await flush()
  assert.equal(page.data.fileBase, 'ZYD-20261016-BIZ-COLOR-D93A')
  page.toStore()
  const nav = calls.nav[0]
  assert.deepEqual(queryOf(nav.url), { fileId: 'f-color', copies: '1', colorMode: 'black_white', duplex: 'simplex', name: 'ZYD-20261016-BIZ-COLOR-D93A.pdf' })
  assert.equal(typeof nav.events.printDraft, 'function')
})

test('确认文件页：同一会话、同一会员、同一文件的草稿带回第 2 步（含上次选的终端）', async () => {
  const { page, calls } = uploadUi()
  await flush(); await flush()
  page.toStore()
  calls.nav[0].events.printDraft(draft())
  page.toStore()
  assert.deepEqual(queryOf(calls.nav[1].url), { fileId: 'f-color', copies: '2', colorMode: 'color', duplex: 'duplex_long_edge', name: 'ZYD-20261016-BIZ-COLOR-D93A.pdf', terminalId: 'KSK-001' })
})

test('确认文件页：别的文件、未登录、跳转后换了会话、收下后换了会员、参数不合法的草稿都不用', async () => {
  const cases = [
    ['别的文件', (t) => t.calls.nav[0].events.printDraft(draft({ fileId: 'f-other' }))],
    ['跳转后才登出或换号（代际变了）', (t) => { t.state.gen += 1; t.calls.nav[0].events.printDraft(draft()) }],
    ['收下后换了会员（代际没变也不用）', (t) => { t.calls.nav[0].events.printDraft(draft()); t.state.user = { id: 'B' } }],
    ['收下后登出又登录（代际变了）', (t) => { t.calls.nav[0].events.printDraft(draft()); t.state.gen += 1 }],
    ['份数不合法', (t) => t.calls.nav[0].events.printDraft(draft({ copies: 0 }))],
    ['短边翻页（未开放）', (t) => t.calls.nav[0].events.printDraft(draft({ duplex: 'duplex_short_edge' }))],
  ]
  for (const [label, act] of cases) {
    const t = uploadUi()
    await flush(); await flush()
    t.page.toStore()
    act(t)
    t.page.toStore()
    const q = queryOf(t.calls.nav[1].url)
    assert.deepEqual([q.copies, q.colorMode, q.duplex, q.terminalId], ['1', 'black_white', 'simplex', undefined], label)
  }
  const anon = uploadUi({ user: null })
  await flush(); await flush()
  anon.page.toStore()
  anon.calls.nav[0].events.printDraft(draft())
  anon.page.toStore()
  assert.equal(queryOf(anon.calls.nav[1].url).colorMode, 'black_white', '未登录（会员为空）不收草稿')
})

test('确认文件页「查看原文」：PDF 走 openSignedDocument、失败弹原因；图片走 previewImage；都不跳页', async () => {
  const pdf = uploadUi()
  await flush(); await flush()
  pdf.page.tapFile(); await flush()
  assert.deepEqual([...pdf.calls.open], ['ZYD-20261016-BIZ-COLOR-D93A.pdf'])
  assert.equal(pdf.calls.modal[0].content, '下载域名还没有配置好')
  assert.equal(pdf.calls.nav.length, 0)
  const img = uploadUi({ name: '证件照.jpg' })
  await flush(); await flush()
  img.page.openOriginal(); await flush()
  assert.equal(img.calls.open.length, 0)
  assert.deepEqual([...img.calls.preview.map((p) => p.current)], ['https://api.example.test/api/v1/files/f-color/content?sig=x'])
  assert.equal(img.calls.nav.length, 0)
})

// ── 终端和参数页（print-store）：恢复、报回、份数、降级拦截、外部参数严格拒绝 ──────────

const storeCaps = (enabled = true) => ({ capabilities: ['color_print', 'duplex_print'].map((capabilityKey) => ({ capabilityKey, status: 'available', configured: enabled })) })
function storeUi(query, { capsFor = () => storeCaps(), terminals } = {}) {
  const calls = { nav: [], toast: [], quotes: [], emitted: [] }
  const api = {
    getPublicTerminals: () => Promise.resolve(terminals || [{ id: 'KSK-001', displayName: 'KSK-001', isOnline: true }, { id: 'KSK-002', displayName: 'KSK-002', isOnline: true }]),
    getTerminalCapabilities: (id) => Promise.resolve(capsFor(id)),
    quoteMyPrintOrder: (...args) => { calls.quotes.push(args); return Promise.resolve({ amountCents: 0, billablePages: 1 }) },
  }
  const wx = { navigateTo: (o) => calls.nav.push(o.url), showToast: (o) => calls.toast.push(o), showModal() {}, showLoading() {}, hideLoading() {}, navigateBack() {}, switchTab() {} }
  const timers = []
  const page = instantiate(loadPageDefinition('pages/print-store/print-store.js', { wx, modules: { api }, timers }))
  page.getOpenerEventChannel = () => ({ emit: (name, payload) => calls.emitted.push([name, JSON.parse(JSON.stringify(payload))]) })
  page.onLoad({ fileId: 'f-color', name: encodeURIComponent('ZYD-20261016-BIZ-COLOR-D93A.pdf'), ...query })
  page.onShow()
  return { page, calls, timers }
}
// 改参数后的报价要等停手再发（防抖）；沙箱定时器不自己跑，这里跑掉排上的。
const settleStore = (timers) => { while (timers.length) timers.shift()() }
const pickEv = (id) => ({ currentTarget: { dataset: { id } } })
const paramEv = (key, mode) => ({ currentTarget: { dataset: { key, mode } } })

test('终端和参数页：带着上次的终端和参数进来，按该终端实时能力重算并重新核价', async () => {
  const { page, calls } = storeUi({ copies: '2', colorMode: 'color', duplex: 'duplex_long_edge', terminalId: 'KSK-002' })
  await flush(); await flush()
  assert.equal(page.data.picked, 'KSK-002')
  assert.deepEqual([page.data.colorMode, page.data.duplex, page.data.copies], ['color', 'duplex_long_edge', 2])
  const last = calls.quotes[calls.quotes.length - 1]
  assert.equal(last[3].terminalId, 'KSK-002')
  assert.deepEqual([last[1].colorMode, last[1].duplex, last[1].copies], ['color', 'duplex_long_edge', 2])
})

test('终端和参数页：上次的终端已不在列表里就丢弃，不代选别台', async () => {
  const { page } = storeUi({ colorMode: 'color', terminalId: 'KSK-OLD' })
  await flush(); await flush()
  assert.equal(page.data.picked, '')
})

test('终端降级（T8）：带着彩色换到只能黑白的终端，提示并挡住下一步，不静默改回', async () => {
  const { page, calls } = storeUi({ colorMode: 'color', terminalId: 'KSK-002' }, { capsFor: (id) => storeCaps(id !== 'KSK-002') })
  await flush(); await flush()
  assert.equal(page.data.colorMode, 'color', '用户意图保留')
  assert.ok(page.data.capError, '要说清楚为什么不能继续')
  page.toPay()
  assert.equal(calls.nav.length, 0)
  assert.ok(calls.toast.length > 0)
})

test('终端和参数页：选终端、改颜色单双面、改份数都把选择报回上一页（带 fileId）', async () => {
  const { page, calls } = storeUi({})
  await flush(); await flush()
  page.pick(pickEv('KSK-001')); await flush()
  page.setParam(paramEv('colorMode', 'color')); await flush()
  page.setParam(paramEv('duplex', 'duplex_long_edge')); await flush()
  page.plusCopies(); await flush()
  const lastDraft = calls.emitted.filter(([n]) => n === 'printDraft').pop()[1]
  assert.deepEqual(lastDraft, { fileId: 'f-color', copies: 2, colorMode: 'color', duplex: 'duplex_long_edge', terminalId: 'KSK-001' })
})

test('份数步进（T9）：1 时减不动、99 时加不动，改了就重新核价', async () => {
  const low = storeUi({ terminalId: 'KSK-001' })
  await flush(); await flush()
  low.page.minusCopies()
  assert.equal(low.page.data.copies, 1)
  const before = low.calls.quotes.length
  low.page.plusCopies(); settleStore(low.timers); await flush()
  assert.equal(low.page.data.copies, 2)
  assert.ok(low.calls.quotes.length > before, '改份数要重新核价')
  const high = storeUi({ copies: '99', terminalId: 'KSK-001' })
  await flush(); await flush()
  high.page.plusCopies()
  assert.equal(high.page.data.copies, 99)
})

test('外部参数不合法（T9）：照旧整页报错，不回退成 1 份（严格拒绝）', async () => {
  for (const copies of ['abc', '0', '100']) {
    const { page, calls } = storeUi({ copies })
    await flush()
    assert.ok(page.data.loadError, copies)
    assert.equal(calls.quotes.length, 0, copies)
  }
})

test('07 原场景：选好彩色、长边双面、2 份 → 返回确认文件页 → 再进终端和参数页，选择都还在', async () => {
  const up = uploadUi()
  await flush(); await flush()
  up.page.toStore()
  const nav1 = up.calls.nav[0]
  const s1 = storeUi(queryOf(nav1.url))
  s1.page.getOpenerEventChannel = () => ({ emit: (name, payload) => nav1.events[name](payload) })
  await flush(); await flush()
  s1.page.pick(pickEv('KSK-001')); await flush()
  s1.page.plusCopies(); await flush()
  s1.page.setParam(paramEv('colorMode', 'color')); await flush()
  s1.page.setParam(paramEv('duplex', 'duplex_long_edge')); await flush()
  s1.page.onUnload()
  up.page.toStore()
  const q2 = queryOf(up.calls.nav[1].url)
  const s2 = storeUi(q2)
  await flush(); await flush()
  assert.deepEqual([s2.page.data.picked, s2.page.data.colorMode, s2.page.data.duplex, s2.page.data.copies], ['KSK-001', 'color', 'duplex_long_edge', 2])
})

// ── 确认提交页（print-pay）模板 ───────────────────────────────────────────

test('确认提交页：第 3 步叫「确认提交」；主按钮是蓝色 primary，不用微信绿；免费时不再单列只写「免费」的那块', () => {
  const wxml = stripComments(read('pages/print-pay/print-pay.wxml'))
  assert.match(wxml, /<view class="st on"><text class="n">3<\/text><text class="nl">确认提交<\/text><\/view>/)
  assert.match(wxml, /<view class="btn primary lg [^"]*" bindtap="continueFlow">/)
  assert.doesNotMatch(wxml, /class="btn wx/)
  assert.match(wxml, /<view wx:if="\{\{quoteState !== 'ready' \|\| !isFreeOrder\}\}" class="card flat fee rise-d4">/)
  for (const rel of ['pages/print-upload/print-upload.wxml', 'pages/print-store/print-store.wxml', 'pages/print-pay/print-pay.wxml']) {
    assert.match(read(rel), /<text class="nl">终端和参数<\/text>/, rel)
  }
})
