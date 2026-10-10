import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const require = createRequire(import.meta.url)
const entry = require('../../utils/kiosk-entry.js')
const TTL = 12 * 60 * 60 * 1000
const UPLOAD = 'pages/resume-upload/resume-upload'
const PAGES = [
  'resume-build', 'resume-upload', 'self-explore',
  'interview-entry', 'job-materials', 'assistant',
]

// 工具与页面都执行真实源码；wx 和接口由每例单独控制，不依赖宿主全局。
function utility(name, wx, modules = {}) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(new URL(`../../utils/${name}.js`, import.meta.url), 'utf8'), {
    module, wx, console,
    require(id) {
      const key = id.replace(/^.*\//, '').replace(/\.js$/, '')
      return modules[key] || require(`../../utils/${key}.js`)
    },
  }, { filename: `utils/${name}.js` })
  return module.exports
}

function harness(api = {}) {
  const saved = new Map()
  const calls = { navigate: [], redirect: [], requests: [], failNavigate: false }
  const wx = {
    getStorageSync: key => saved.get(key) ?? '',
    setStorageSync: (key, value) => saved.set(key, value),
    removeStorageSync: key => saved.delete(key),
    navigateTo: (opts) => { calls.navigate.push(opts.url); if (calls.failNavigate && opts.fail) opts.fail({ errMsg: 'navigateTo:fail' }) },
    redirectTo: opts => calls.redirect.push(opts.url),
    showLoading() {}, hideLoading() {}, showToast() {}, showModal() {},
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375 }),
  }
  const storage = utility('storage', wx)
  const kioskEntry = utility('kiosk-entry', wx, { storage })
  const auth = { getUser: () => null, isLoggedIn: () => false,
    sessionGeneration: () => 1, isSameSession: gen => gen === 1 }
  const modules = { api, storage, auth, 'kiosk-entry': kioskEntry }
  return { saved, calls, wx, storage, entry: kioskEntry, modules,
    page(name, timers = []) {
      return instantiate(loadPageDefinition(`pages/${name}/${name}.js`, { wx, modules, timers }))
    } }
}

for (const [label, raw, terminalCode, to] of [
  ['仅编号', 'k=KSK-001', 'KSK-001', ''],
  ['编号与意图', 'k=KSK-001&to=plan', 'KSK-001', 'plan'],
  ['仅意图', 'to=plan', '', 'plan'],
  ['占位', 'v=1', '', ''],
  ['顺序颠倒', 'to=fit&k=KSK-001', 'KSK-001', 'fit'],
  ['下划线与连字符', 'k=K_SK-001&to=opt', 'K_SK-001', 'opt'],
  ['三十位', `k=${'A'.repeat(30)}`, 'A'.repeat(30), ''],
  ['三十一位', `k=${'A'.repeat(31)}`, '', ''],
  ['连字符开头', 'k=-KSK-001&to=opt', '', 'opt'],
  ['空格', 'k=KSK 001', '', ''],
  ['中文', 'k=终端001', '', ''],
  ['换行结尾', 'k=KSK-001\n', '', ''],
  ['非法意图', 'k=KSK-001&to=other', 'KSK-001', ''],
  ['空串', '', '', ''],
  ['多余键忽略', 'person=someone&k=KSK-001&to=fit&token=secret', 'KSK-001', 'fit'],
]) {
  test(`场景解析：${label}`, () => {
    const result = entry.parseEntryScene(encodeURIComponent(raw))
    assert.equal(result.terminalCode, terminalCode)
    assert.equal(result.to, to)
    assert.equal(Object.keys(result).length, 2)
  })
}

for (const raw of ['k=KSK%ZZ&to=opt', '%', 'k=KSK%', null, undefined, 42, {}, []]) {
  test(`坏编码或非字符串不抛错：${String(raw)}`, () => {
    const result = entry.parseEntryScene(raw)
    assert.equal(result.terminalCode, '')
    assert.equal(result.to, '')
  })
}

test('场景只解码一次，不把双重编码当作编号', () => {
  assert.equal(entry.parseEntryScene('k=KSK%252D001').terminalCode, '')
})

test('有效编号带当前时间存下，内容严格只有编号和时间', () => {
  const h = harness()
  const before = Date.now()
  const result = h.entry.absorb({ scene: encodeURIComponent('k=KSK-001&to=plan&person=someone') })
  const saved = h.saved.get(h.storage.KEYS.KIOSK_ENTRY)
  assert.equal(result.to, 'plan')
  assert.equal(saved.terminalCode, 'KSK-001')
  assert.ok(saved.ts >= before && saved.ts <= Date.now())
  assert.equal(Object.keys(saved).length, 2)
  assert.equal(h.saved.size, 1)
})

for (const scene of ['k=-bad', 'k=中文', 'to=plan', 'v=1', 'k=bad%ZZ', '']) {
  test(`无有效编号既不写也不清已有记录：${scene}`, () => {
    const h = harness()
    const previous = { terminalCode: 'KSK-old', ts: 1 }
    h.saved.set(h.storage.KEYS.KIOSK_ENTRY, previous)
    h.entry.absorb({ scene })
    assert.equal(h.saved.get(h.storage.KEYS.KIOSK_ENTRY), previous)
    assert.equal(h.saved.size, 1)
    const empty = harness()
    empty.entry.absorb({ scene })
    assert.equal(empty.saved.size, 0)
  })
}

test('普通网址入口先解整条网址一次，只取问号后的两项', () => {
  const h = harness()
  const result = h.entry.absorb({ q: encodeURIComponent('https://example.cn/start?k=K_SK-001&to=fit&person=someone#to=opt') })
  assert.equal(result.terminalCode, 'K_SK-001')
  assert.equal(result.to, 'fit')
  assert.equal(Object.keys(h.saved.get(h.storage.KEYS.KIOSK_ENTRY)).length, 2)
})

for (const q of ['https://example.cn/start?to=plan', 'https://example.cn/start?v=1',
  'https://example.cn/start?k=-bad', 'https://example.cn/start#k=KSK-001', 'bad%ZZ']) {
  test(`普通网址无编号入口：${q}`, () => {
    const h = harness()
    const result = h.entry.absorb({ q: q === 'bad%ZZ' ? q : encodeURIComponent(q) })
    assert.equal(result.terminalCode, '')
    assert.equal(result.to, q.includes('?to=plan') ? 'plan' : '')
    assert.equal(h.saved.size, 0)
  })
}

test('同次场景优先，普通页面参数仍验证意图', () => {
  const h = harness()
  const result = h.entry.absorb({ scene: 'k=KSK-001&to=opt',
    q: encodeURIComponent('https://example.cn/?k=KSK-002&to=fit'), to: 'plan' })
  assert.equal(result.terminalCode, 'KSK-001')
  assert.equal(result.to, 'opt')
  assert.equal(h.entry.absorb({ to: 'plan' }).to, 'plan')
  assert.equal(h.entry.absorb({ to: 'bad' }).to, '')
  assert.equal(h.entry.absorb(null).terminalCode, '')
})

for (const age of [0, TTL - 1, TTL, TTL + 1, -1]) {
  test(`记忆有效期：经过 ${age} 毫秒`, () => {
    const h = harness()
    h.saved.set(h.storage.KEYS.KIOSK_ENTRY, { terminalCode: 'KSK-001', ts: 1000 })
    const valid = age >= 0 && age < TTL
    assert.equal(h.entry.recallTerminal(1000 + age), valid ? 'KSK-001' : '')
    assert.equal(h.saved.has(h.storage.KEYS.KIOSK_ENTRY), valid)
  })
}

for (const name of PAGES) {
  test(`起点页真实执行并吸收入口：${name}`, async () => {
    const requests = []
    const api = {
      getDocumentConversionCapabilities: (...args) => { requests.push(args); return Promise.resolve({}) },
      getSelfAssessmentQuestions: (...args) => { requests.push(args); return Promise.resolve([]) },
      getJobMaterialTemplates: (...args) => { requests.push(args); return Promise.resolve([]) },
      getAssistantVoiceCapability: (...args) => { requests.push(args); return Promise.resolve({}) },
    }
    const h = harness(api)
    const page = h.page(name)
    page.onLoad({ scene: encodeURIComponent('k=KSK-001&to=plan&person=someone') })
    await flush()
    assert.equal(h.entry.recallTerminal(), 'KSK-001')
    assert.equal(Object.keys(h.saved.get(h.storage.KEYS.KIOSK_ENTRY)).length, 2)
    assert.equal(JSON.stringify(requests).includes('KSK-001'), false)
    assert.equal(JSON.stringify(page.data).includes('KSK-001'), false)
  })
}

for (const to of ['opt', 'fit', 'plan', '', 'bad']) {
  test(`上传成功把合法意图带到解析页：${to || '无意图'}`, async () => {
    const requests = []
    const h = harness({ getDocumentConversionCapabilities: () => Promise.resolve({}),
      uploadResumeFile: (...args) => { requests.push(args); return Promise.resolve({ fileId: 'F1' }) } })
    const page = h.page('resume-upload')
    page.onLoad({ scene: encodeURIComponent(`k=KSK-001&to=${to}`) })
    page._upload('wxfile://a.pdf', 'a.pdf', 'resume_upload')
    await flush()
    assert.equal(h.calls.navigate.length, 1)
    const query = new URLSearchParams(h.calls.navigate[0].split('?')[1])
    assert.equal(query.get('fileId'), 'F1')
    assert.equal(query.get('to'), ['opt', 'fit', 'plan'].includes(to) ? to : null)
    assert.equal(h.calls.navigate[0].includes('KSK-001'), false)
    assert.equal(JSON.stringify(requests).includes('KSK-001'), false)
  })
}

function parseSetup(result) {
  const requests = []
  const h = harness({ parseResume: (payload, headers) => {
    requests.push({ payload, headers }); return Promise.resolve(result)
  } })
  const intent = {
    INTENT_HEADER: 'x-resume-parse-intent',
    prepare: async payload => ({ payload, headers: { 'x-resume-parse-intent': 'intent-1' } }),
    markSettled: async () => ({ ok: true }),
  }
  h.modules['resume-parse-intent'] = intent
  h.modules['resume-parse-session'] = utility('resume-parse-session', h.wx,
    { storage: h.storage, 'resume-parse-intent': intent })
  const timers = []
  return { ...h, parsePage: h.page('resume-parse', timers), requests, timers }
}

async function parsedHarness(to, result) {
  const h = parseSetup(result)
  h.parsePage.onLoad({ fileId: 'F1', fileName: 'a.pdf', fileFormat: 'pdf', to })
  await flush()
  for (const timer of h.timers) timer()
  return h
}

for (const [to, url] of [
  ['opt', '/pages/resume-optimize/resume-optimize?taskId=T1'],
  ['fit', '/pages/job-fit/job-fit'],
  ['plan', '/pages/career-plan/career-plan'],
  ['', '/pages/resume-diagnose/resume-diagnose?taskId=T1'],
  ['bad', '/pages/resume-diagnose/resume-diagnose?taskId=T1'],
]) {
  test(`解析成功沿原入口进入：${to || '诊断'}`, async () => {
    const h = await parsedHarness(to, { taskId: 'T1', status: 'completed', accessToken: 'anon-token' })
    assert.equal(h.parsePage.data.done, true)
    // 解析页是过场：四种去向都换页，返回时回上传页，不停在「解析完成」。
    assert.equal(h.calls.navigate.length, 0, '解析页不该留在返回路径上')
    assert.equal(h.calls.redirect.length, 1)
    assert.equal(h.calls.redirect[0], url)
    assert.equal(h.saved.get(h.storage.KEYS.RESUME_TASK).taskId, 'T1')
    assert.equal(h.saved.get(h.storage.KEYS.RESUME_TASK).accessToken, 'anon-token')
    assert.equal(Object.hasOwn(h.requests[0].payload, 'to'), false)
    if (to === 'fit' || to === 'plan') {
      h.modules.api.getJobFitConsent = () => Promise.resolve({ active: false })
      h.modules.api.getCareerPlan = () => Promise.reject({ code: 'CAREER_PLAN_NOT_FOUND', statusCode: 404 })
      const target = h.page(to === 'fit' ? 'job-fit' : 'career-plan')
      target.onLoad({})
      await flush()
      assert.equal(target.data.historyMode, false)
      assert.equal(target.data.taskId, 'T1')
      assert.equal(target.data.phase, to === 'fit' ? 'consent' : 'ready')
      assert.equal(target._token, 'anon-token')
    }
    if (to === 'opt') {
      const asked = []
      h.modules.api.getResumeOptimize = (...args) => { asked.push(args); return new Promise(() => {}) }
      const target = h.page('resume-optimize')
      target._loadPricing = () => {}
      target.onLoad({ taskId: url.split('taskId=')[1] })
      await flush()
      assert.equal(target.data.phase, 'loading', '带着任务编号进优化页，不能落到「未指定优化任务」')
      assert.equal(asked.length, 1)
      assert.equal(asked[0][0], 'T1')
      assert.equal(asked[0][1], 'anon-token')
    }
  })
}

for (const result of [
  { taskId: 'T1', status: 'failed', failReason: '未完成', accessToken: 'anon-token' },
  { taskId: 'T1', status: 'unknown', accessToken: 'anon-token' },
  { status: 'completed' },
  { taskId: 'T1', status: 'completed' },
]) {
  test(`解析失败或结果未知不进入办理：${JSON.stringify(result)}`, async () => {
    const h = await parsedHarness('opt', result)
    assert.equal(h.calls.navigate.length, 0)
    assert.equal(h.calls.redirect.length, 0)
    assert.equal(h.parsePage.data.done, false)
    assert.equal(h.parsePage.data.phase, result.status === 'failed' ? 'failed' : 'unknown')
  })
}

for (const [to, url] of [
  ['opt', '/pages/resume-upload/resume-upload?to=opt'],
  ['fit', '/pages/resume-upload/resume-upload?to=fit'],
  ['plan', '/pages/resume-upload/resume-upload?to=plan'],
  ['', '/pages/resume-upload/resume-upload'],
  ['bad', '/pages/resume-upload/resume-upload'],
]) {
  test(`解析失败后回上传页重传，原意图不丢：${to || '无意图'}`, async () => {
    const h = await parsedHarness(to, { taskId: 'T1', status: 'failed', failReason: '未完成', accessToken: 'anon-token' })
    assert.equal(h.parsePage.data.phase, 'failed')
    h.parsePage.toUpload()
    assert.equal(h.calls.redirect.length, 1)
    assert.equal(h.calls.redirect[0], url)
    assert.equal(h.calls.navigate.length, 0)
  })

  test(`缺文件进了解析页，点重试回上传页，原意图不丢：${to || '无意图'}`, () => {
    const h = parseSetup({})
    h.parsePage.onLoad({ to })
    assert.equal(h.parsePage.data.phase, 'missing')
    h.parsePage.retry()
    assert.equal(h.calls.redirect.length, 1)
    assert.equal(h.calls.redirect[0], url)
    assert.equal(h.requests.length, 0)
  })
}

test('优化无任务态按钮用原按钮类，跳上传并保留优化意图', async () => {
  const h = harness()
  const page = h.page('resume-optimize')
  page._loadPricing = () => {}
  page.onLoad({})
  assert.equal(page.data.phase, 'no-task')
  const wxml = fs.readFileSync(new URL('../../pages/resume-optimize/resume-optimize.wxml', import.meta.url), 'utf8')
  const block = wxml.split('class="no-task-state"')[1].split('</view>\n\n')[0]
  assert.match(block, /class="btn ghost tap nt-btn" bindtap="toEntryUpload">去上传简历/)
  page.toEntryUpload()
  assert.equal(h.calls.navigate[0], '/pages/resume-upload/resume-upload?to=opt')
  const upload = harness({ getDocumentConversionCapabilities: () => Promise.resolve({}),
    uploadResumeFile: () => Promise.resolve({ fileId: 'F1' }) })
  const next = upload.page('resume-upload')
  next.onLoad({ to: 'opt' })
  next._upload('wxfile://a.pdf', 'a.pdf', 'resume_upload')
  await flush()
  assert.ok(upload.calls.navigate[0].endsWith('&to=opt'))
  assert.equal(upload.saved.size, 0)
})

const online = { id: 'one', terminalCode: 'KSK-001', isOnline: true, displayName: '一楼大厅 1 号机' }
const other = { id: 'two', terminalCode: 'KSK-002', isOnline: true, displayName: '二楼自助区 2 号机' }
const PICKED = '已为你选好扫码的那台：一楼大厅 1 号机。不是这台，可在下面换一台；核对后点「确认终端」。'
const GONE = '你扫码的那台现在不在可选终端里（可能暂时离线），请在下面选别的终端，或稍后再试。'
const GONE_EMPTY = '你扫码的那台现在不在线，请稍后再试。'
// 真实接口（terminals-admin.service.ts 的 listPublicTerminals）只返回在线终端：那台离线、停用或编号对不上时，
// 它根本不在列表里。这时要说明白，而且不替他选别的——只剩另一台时自动选中，回原来那台就取不了件。
for (const [label, list, code, expired, picked, hint] of [
  ['那台在线、还有别的', [other, online], 'KSK-001', false, 'one', PICKED],
  ['那台在线、只有它', [online], 'KSK-001', false, 'one', PICKED],
  ['那台不在列表里、只剩另一台', [other], 'KSK-001', false, '', GONE],
  ['那台不在列表里、还有多台', [online, other], 'KSK-003', false, '', GONE],
  ['那台在列表里但标着离线、还有别的', [{ ...online, isOnline: false }, other], 'KSK-001', false, '', GONE],
  ['那台标着离线、只有它', [{ ...online, isOnline: false }], 'KSK-001', false, '', GONE],
  ['那台不在列表里、列表为空', [], 'KSK-001', false, '', GONE_EMPTY],
  ['没扫过码、只有一台', [online], '', false, 'one', ''],
  ['没扫过码、多台', [online, other], '', false, '', ''],
  ['记录过期、只有一台', [online], 'KSK-001', true, 'one', ''],
  ['记录过期、多台', [online, other], 'KSK-001', true, '', ''],
  ['没扫过码、列表为空', [], '', false, '', ''],
]) {
  test(`选机页：${label}，预选不自动往下走`, async () => {
    const requests = []
    const h = harness({ getPublicTerminals: (...args) => { requests.push(args); return Promise.resolve({ data: list }) } })
    if (code) h.saved.set(h.storage.KEYS.KIOSK_ENTRY,
      { terminalCode: code, ts: Date.now() - (expired ? TTL + 1000 : 0) })
    const page = h.page('print-store')
    page.onLoad({ fileId: 'F1', copies: '1' })
    await flush()
    assert.equal(page.data.picked, picked)
    assert.equal(page.data.entryHint, hint)
    assert.equal(page.data.entryHintWarn, hint === GONE || hint === GONE_EMPTY)
    assert.equal(h.calls.navigate.length, 0)
    assert.equal(h.calls.redirect.length, 0)
    assert.equal(requests[0].length, 0, '终端编号只在本机比对，不发给接口')
    if (expired) assert.equal(h.saved.has(h.storage.KEYS.KIOSK_ENTRY), false)
    page.toPay()
    if (picked) {
      assert.equal(h.calls.navigate.length, 1)
      assert.ok(h.calls.navigate[0].includes(`storeId=${picked}`))
      assert.equal(h.calls.navigate[0].includes('KSK-00'), false, '编号不进下一页的地址')
    } else {
      assert.equal(h.calls.navigate.length, 0, '没选终端不能往下走')
    }
  })
}

for (const [label, list, picked] of [
  ['预选后本人可以改选别的终端', [online, other], 'one'],
  ['那台不在列表里时，本人手选另一台照常能办', [other], ''],
]) {
  test(`选机页：${label}`, async () => {
    const h = harness({ getPublicTerminals: () => Promise.resolve({ data: list }) })
    h.saved.set(h.storage.KEYS.KIOSK_ENTRY, { terminalCode: 'KSK-001', ts: Date.now() })
    const page = h.page('print-store')
    page.onLoad({ fileId: 'F1', copies: '1' })
    await flush()
    assert.equal(page.data.picked, picked)
    page.pick({ currentTarget: { dataset: { id: 'two' } } })
    page.toPay()
    assert.equal(h.calls.navigate.length, 1)
    assert.ok(h.calls.navigate[0].includes('storeId=two'))
  })
}

test('选机页：提示条只用本页已有的提示条写法，机器名称取自服务端列表', async () => {
  const wxml = fs.readFileSync(new URL('../../pages/print-store/print-store.wxml', import.meta.url), 'utf8')
  assert.match(wxml, /<view wx:if="\{\{entryHint\}\}" class="notice \{\{entryHintWarn \? 'warn' : 'info'\}\} rise-d2">\s*<text class="ficon \{\{entryHintWarn \? 'i-warning' : 'i-location'\}\} n-ic"><\/text>\s*<text>\{\{entryHint\}\}<\/text>\s*<\/view>/)
  // 码里就算混进别的字，也进不了提示：名称只来自接口返回的 displayName。
  const h = harness({ getPublicTerminals: () => Promise.resolve({ data: [{ ...online, displayName: '人才市场西门 3 号机' }] }) })
  h.entry.absorb({ scene: encodeURIComponent('k=KSK-001&name=someone') })
  const page = h.page('print-store')
  page.onLoad({ fileId: 'F1', copies: '1' })
  await flush()
  assert.equal(page.data.entryHint, '已为你选好扫码的那台：人才市场西门 3 号机。不是这台，可在下面换一台；核对后点「确认终端」。')
  assert.equal(page.data.entryHint.includes('someone'), false)
})

for (const name of PAGES) {
  test(`扫码起点页保留场景并重新编码：${name}`, () => {
    const h = harness()
    const page = h.page('kiosk-login')
    page.onLoad({})
    const scene = encodeURIComponent('k=KSK-001&to=plan')
    page._handleScanResult('', `pages/${name}/${name}?scene=${scene}&person=someone`)
    assert.equal(h.calls.navigate[0], `/pages/${name}/${name}?scene=${scene}`)
    assert.equal(page.data.phase, 'idle')
    assert.equal(h.saved.size, 0)
  })
}

for (const [label, query, scene] of [
  ['没编码、意图散成并列参数', '?scene=k=KSK-001&to=plan', 'k=KSK-001&to=plan'],
  ['顺序颠倒', '?scene=' + encodeURIComponent('to=fit&k=KSK-001'), 'k=KSK-001&to=fit'],
  ['夹着不认识的键', '?scene=' + encodeURIComponent('k=KSK-001&person=someone&to=opt') + '&token=secret', 'k=KSK-001&to=opt'],
  ['编号不合法只留意图', '?scene=' + encodeURIComponent('k=-bad&to=plan'), 'to=plan'],
  ['意图不合法只留编号', '?scene=' + encodeURIComponent('k=KSK-001&to=other'), 'k=KSK-001'],
  ['坏编码照常进页、什么都不带', '?scene=bad%ZZ', ''],
  ['只有占位', '?scene=' + encodeURIComponent('v=1'), ''],
  ['井号后面的不读', '#scene=' + encodeURIComponent('k=KSK-001'), ''],
]) {
  test(`扫到起点页的小程序码只带认得的两项：${label}`, () => {
    const h = harness()
    const page = h.page('kiosk-login')
    page.onLoad({})
    page._handleScanResult('', UPLOAD + query)
    assert.equal(h.calls.navigate.length, 1)
    assert.equal(h.calls.navigate[0], '/' + UPLOAD + (scene ? '?scene=' + encodeURIComponent(scene) : ''))
    assert.equal(page.data.phase, 'idle')
    // 落地页按同一套规则再读一遍，读到的就是这两项。
    const landed = h.entry.parseEntryScene((h.calls.navigate[0].split('?scene=')[1]) || '')
    const expected = entry.parseEntryScene(encodeURIComponent(scene))
    assert.equal(landed.terminalCode, expected.terminalCode)
    assert.equal(landed.to, expected.to)
  })
}

test('起点页跳不过去时给出说明，不是没有反应', () => {
  const h = harness()
  h.calls.failNavigate = true
  const page = h.page('kiosk-login')
  page.onLoad({})
  page._handleScanResult('', UPLOAD + '?scene=' + encodeURIComponent('k=KSK-001&to=plan'))
  assert.equal(h.calls.navigate.length, 1)
  assert.equal(page.data.phase, 'scan-error')
  assert.equal(page.data.errorMsg, '这张码要去的页面现在打不开，请稍后再扫，或回一体机直接办理')
})

for (const path of [
  'pages/home/home?scene=k%3DKSK-001', 'other/' + UPLOAD, UPLOAD + '/extra',
  'pages/kiosk-login/kiosk-login?scene=k%3DKSK-001', null, 42,
]) {
  test(`白名单外或读不出的小程序码仍走原报错：${path}`, () => {
    const h = harness()
    const page = h.page('kiosk-login')
    page.onLoad({})
    page._handleScanResult('', path)
    assert.equal(h.calls.navigate.length, 0)
    assert.equal(page.data.phase, 'scan-error')
    assert.match(page.data.errorMsg, /这不是一体机上的二维码/)
  })
}

test('接力页短码优先且保持原跳转', () => {
  const h = harness()
  const page = h.page('kiosk-login')
  page.onLoad({})
  const scene = 'Abcdefghijklmnop012345_-'
  page._handleScanResult('', `pages/kiosk-send/kiosk-send?scene=${scene}`)
  assert.equal(h.calls.navigate[0], `/pages/kiosk-send/kiosk-send?scene=${scene}`)
  page._handleScanResult(`https://example.cn/?scene=${scene}`, `${UPLOAD}?scene=k%3DKSK-001`)
  assert.equal(h.calls.navigate[1], `/pages/kiosk-send/kiosk-send?scene=${scene}`)
  assert.equal(h.saved.size, 0)
})

for (const [scene, kept] of [['to=plan', 'to=plan'], ['v=1', ''], ['', '']]) {
  test(`扫码不带编号仍能进入：${scene || '无场景'}`, () => {
    const result = entry.parseEntryCodePath('/' + UPLOAD + (scene ? '?scene=' + encodeURIComponent(scene) : ''))
    assert.equal(result.kind, 'entry')
    assert.equal(result.url, '/' + UPLOAD + (kept ? '?scene=' + encodeURIComponent(kept) : ''))
  })
}

for (const path of ['', null, undefined, 42, {}, 'pages/home/home', 'pages/resume-upload', UPLOAD + 'x']) {
  test(`不是起点页的路径不当入口：${String(path)}`, () => {
    assert.equal(entry.parseEntryCodePath(path).kind, 'invalid')
  })
}
