/**
 * 价格再确认（409 PRICE_CHANGED）的**真执行**测试（node:test）。
 *
 * 三层，自下而上：
 *   ① utils/price-confirmation.js 的严格解析与快照绑定（纯函数）；
 *   ② utils/request.js + utils/api.js 真跑：details 怎么搬、quotedAmountCents 怎么进 body；
 *   ③ print-pay / package-confirm 两页真跑，**api / request / auth / 幂等模块全部用真实实现**，
 *      替身只到 wx.request 为止 —— 「这一次 POST 带的是哪个金额、哪个键，发了几次」
 *      只有在那一层才看得见。
 *
 * 页面加载器与 page-lifecycle.test.mjs 共用 ./page-sandbox.mjs。wx.request 替身从不发出
 * 任何网络请求：认不出的路径直接抛错。由 `verify:price-confirmation` 拉起，串在 verify:static 里。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))

// utils/storage.js、utils/request.js 读**全局** wx；页面读沙箱 wx。两边必须是同一个对象。
let ACTIVE_WX = null
Object.defineProperty(globalThis, 'wx', { get: () => ACTIVE_WX, configurable: true })

const pc = requireMiniapp('../utils/price-confirmation.js')
const realAuth = requireMiniapp('../utils/auth.js')
const printIdem = requireMiniapp('../utils/print-order-idempotency.js')
const packageIdem = requireMiniapp('../utils/package-order-idempotency.js')

// ── 服务端 details 夹具（与 order-quote.service.ts 的 priceChanged 同形） ─────────────
const details = (amount, pages, ...lines) => [`currentAmountCents=${amount}`, `billablePages=${pages}`, ...lines]
const bw = (unit, qty) => `line=print_bw_page:${unit}:${qty}:${unit * qty}`
const priceChangedBody = (d) => ({ success: false, error: { code: 'PRICE_CHANGED', message: '价格已更新', details: d } })
const httpErr = (statusCode, code, d) => Object.assign(new Error(''), { statusCode, code, details: d })

// ══════════════════════════════════════════════════════════════════════
// ① 纯函数
// ══════════════════════════════════════════════════════════════════════

test('解析：涨价 / 降价 / 0→收费 / 收费→0 都读得出服务端当前金额', () => {
  const cases = [
    [150, details(200, 4, bw(50, 4)), 200, 4],
    [200, details(120, 4, bw(30, 4)), 120, 4],
    [0, details(100, 2, bw(50, 2)), 100, 2],
    [150, details(0, 3, bw(0, 3)), 0, 3],
    [100, details(300, 3, 'line=print_color_page:100:3:300'), 300, 3],
  ]
  for (const [quoted, d, amount, pages] of cases) {
    const decision = pc.classifyCreateError(httpErr(409, 'PRICE_CHANGED', d), quoted)
    assert.equal(decision.kind, pc.CHANGED, JSON.stringify(d))
    assert.equal(decision.amountCents, amount)
    assert.equal(decision.billablePages, pages)
  }
})

test('解析：材料包逐字重复的 line 是合法的，小计求和后等于总额', () => {
  const d = details(300, 6, bw(50, 3), bw(50, 3))
  assert.equal(d[2], d[3], '前提：两行逐字相同')
  assert.deepEqual({ ...pc.parsePriceChangedDetails(d) }, { amountCents: 300, billablePages: 6 })
})

test('解析：任何一处对不上都 fail-closed（读不懂 ≠ 猜一个金额）', () => {
  const bad = {
    'details 缺失': undefined,
    '不是数组': 'currentAmountCents=1',
    '空数组': [],
    '混进非字符串': ['currentAmountCents=100', 'billablePages=2', 100],
    '重复 currentAmountCents': [...details(100, 2, bw(50, 2)), 'currentAmountCents=100'],
    '重复 billablePages': [...details(100, 2, bw(50, 2)), 'billablePages=2'],
    '缺 currentAmountCents': ['billablePages=2', bw(50, 2)],
    '缺 billablePages': ['currentAmountCents=100', bw(50, 2)],
    '没有 line': details(100, 2),
    '认不出的条目': [...details(100, 2, bw(50, 2)), 'foo=1'],
    '认不出的计价项': details(100, 2, 'line=print_a3_page:50:2:100'),
    '前导零': details(100, 2, 'line=print_bw_page:050:2:100'),
    '负数': ['currentAmountCents=-100', 'billablePages=2', bw(50, 2)],
    '小数': ['currentAmountCents=100.0', 'billablePages=2', bw(50, 2)],
    '带空白': [' currentAmountCents=100', 'billablePages=2', bw(50, 2)],
    '小计 ≠ 单价×数量': details(100, 2, 'line=print_bw_page:50:2:90'),
    '小计之和 ≠ 总额': details(150, 2, bw(50, 2)),
    'billablePages=0': details(0, 0, bw(0, 1)),
    'quantity=0': details(0, 2, 'line=print_bw_page:50:0:0'),
    '超过 DTO 上限': details(100000100, 2, bw(50000050, 2)),
    '不安全整数': ['currentAmountCents=9007199254740993', 'billablePages=1', 'line=print_bw_page:1:9007199254740993:9007199254740993'],
    'line 段数不对': details(100, 2, 'line=print_bw_page:50:2:100:1'),
    '没有等号': [...details(100, 2, bw(50, 2)), 'currentAmountCents'],
  }
  for (const [label, d] of Object.entries(bad)) {
    assert.equal(pc.parsePriceChangedDetails(d), null, label)
    const decision = pc.classifyCreateError(httpErr(409, 'PRICE_CHANGED', d), 999)
    assert.equal(decision.kind, pc.UNREADABLE, label)
    assert.ok(!('amountCents' in decision), `${label}：读不懂时不给任何金额`)
  }
  // 说「变了」却给回用户刚确认的那个数：自相矛盾，也只能重新核价。
  assert.equal(pc.classifyCreateError(httpErr(409, 'PRICE_CHANGED', details(100, 2, bw(50, 2))), 100).kind, pc.UNREADABLE)
})

test('判定：只有 HTTP 409 + PRICE_CHANGED 同时成立才算价格变化', () => {
  const d = details(200, 4, bw(50, 4))
  for (const err of [
    null, new Error('network'), httpErr(-1, undefined, d), httpErr(500, 'PRICE_CHANGED', d),
    httpErr(200, 'PRICE_CHANGED', d), httpErr(undefined, 'PRICE_CHANGED', d), httpErr('409', 'PRICE_CHANGED', d),
    httpErr(409, 'IDEMPOTENCY_IN_PROGRESS', d), httpErr(409, undefined, d),
  ]) assert.equal(pc.classifyCreateError(err, 150), null, JSON.stringify(err && { s: err.statusCode, c: err.code }))
})

test('快照：金额只绑给发起时那位账号 + 那一组参数', () => {
  const ctx = pc.beginQuote('u:A', 'fp1')
  assert.equal(pc.bindQuote(ctx, 'u:B', 'fp1', 150, 3), null, '换了人')
  assert.equal(pc.bindQuote(ctx, 'u:A', 'fp2', 150, 3), null, '换了参数')
  assert.equal(pc.bindQuote(ctx, 'u:A', '', 150, 3), null, '没有参数')
  assert.equal(pc.bindQuote(ctx, 'u:A', 'fp1', 1.5, 3), null, '不是整数')
  assert.equal(pc.bindQuote(ctx, 'u:A', 'fp1', pc.MAX_AMOUNT_CENTS + 1, 3), null, '超出 DTO 上限')
  const snap = pc.bindQuote(ctx, 'u:A', 'fp1', 150, 3)
  assert.equal(pc.quotedAmount(snap, 'u:A', 'fp1'), 150)
  assert.equal(pc.quotedAmount(snap, 'u:B', 'fp1'), null)
  assert.equal(pc.quotedAmount(snap, 'u:A', 'fp2'), null)
  assert.equal(pc.quotedAmount(null, 'u:A', 'fp1'), null)
  // 补签把 '' 升级成本人不算换人；但建单只认确定的会员。
  const upgraded = pc.bindQuote(pc.beginQuote('', 'fp1'), 'u:A', 'fp1', 0, 1)
  assert.equal(pc.quotedAmount(upgraded, 'u:A', 'fp1'), 0)
  assert.equal(pc.quotedAmount(pc.bindQuote(pc.beginQuote('', 'fp1'), '', 'fp1', 0, 1), '', 'fp1'), null)
  // body 副本：调用方那一份（指纹来源）不动。
  const payload = { fileId: 'f', copies: 1 }
  assert.deepEqual({ ...pc.withQuotedAmount(payload, 150) }, { fileId: 'f', copies: 1, quotedAmountCents: 150 })
  assert.ok(!('quotedAmountCents' in payload))
  for (const bad of [-1, 1.5, '150', null, NaN, pc.MAX_AMOUNT_CENTS + 1]) assert.equal(pc.withQuotedAmount(payload, bad), null)
})

// ══════════════════════════════════════════════════════════════════════
// ② 真 request.js / api.js，替身只到 wx.request
// ══════════════════════════════════════════════════════════════════════

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (id) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: id, exp: Math.floor(Date.now() / 1000) + 1800 })}.sig`
const login = (id) => { realAuth.logout(); realAuth.saveSession({ token: jwt(id), user: { id } }) }

/** 最小 wx：存储 + 随机数 + 几个 UI 调用的记录。网络只到 server 路由为止。 */
function createWx() {
  const storage = new Map()
  const calls = { modal: [], redirectTo: [], toast: [] }
  const control = { navFail: false }
  let seed = 0
  return {
    storage, calls, control,
    getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
    setStorageSync: (k, v) => { storage.set(k, JSON.parse(JSON.stringify(v))) },
    removeStorageSync: (k) => { storage.delete(k) },
    showLoading() {}, hideLoading() {},
    showModal: (o) => { calls.modal.push(o) },
    showToast: (o) => { calls.toast.push(o) },
    navigateTo() {}, switchTab() {}, navigateBack() {},
    redirectTo: (o) => { calls.redirectTo.push(o.url); if (control.navFail) { if (o.fail) o.fail() } else if (o.success) o.success() },
    getRandomValues: (o) => {
      seed += 1
      const bytes = new Uint8Array(o.length || 16)
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (seed * 37 + i * 11) & 0xff
      o.success({ randomValues: bytes.buffer })
    },
  }
}

/**
 * 服务端替身。报价默认按 `quote` 立即回；建单一律挂起，由测试决定回什么。
 * 每次建单记下 body、Header 里的键，以及**发出那一刻**本机幂等表的样子。
 */
function createServer(wx, quote = { amountCents: 150, billablePages: 3 }) {
  const server = { quote, quotes: [], creates: [], lookups: [] }
  wx.request = (opts) => {
    const url = String(opts.url)
    const call = {
      url, data: opts.data, key: opts.header && opts.header['idempotency-key'],
      table: JSON.parse(JSON.stringify(wx.storage.get(printIdem.STORE_KEY) || wx.storage.get(packageIdem.STORE_KEY) || [])),
      respond: (statusCode, data) => opts.success({ statusCode, data }),
      drop: () => opts.fail({ errMsg: 'request:fail timeout' }),
    }
    if (/\/files\/[^/]+\/preview-url$/.test(url)) return call.respond(200, { data: { printFileUrl: 'signed://file' } })
    if (/\/me\/documents$/.test(url)) return call.respond(200, { data: { items: [] } })
    if (/\/orders\/quote$/.test(url)) {
      server.quotes.push(call)
      if (server.quote) call.respond(200, { data: server.quote })
      return undefined
    }
    if (/\/me\/print-orders$/.test(url) || /\/orders\/package$/.test(url)) { server.creates.push(call); return undefined }
    if (/\/(me\/print-orders|orders\/package)\/[^/]+$/.test(url)) { server.lookups.push(call); return undefined }
    throw new Error(`测试替身不认识的请求：${opts.method} ${url}`)
  }
  return server
}

/** 本机幂等表（单件 / 材料包两张）里这个键**现在**那一行。 */
function rowByKey(wx, key) {
  const rows = [...(wx.storage.get(printIdem.STORE_KEY) || []), ...(wx.storage.get(packageIdem.STORE_KEY) || [])]
  return rows.find((r) => r.key === key) || null
}

function freshWorld(id = 'A') {
  const wx = createWx()
  ACTIVE_WX = wx
  login(id)
  const server = createServer(wx)
  return { wx, server }
}

test('request.js：details 只在整份都是 string[] 时才搬到 err 上', async () => {
  const { wx } = freshWorld()
  const api = requireMiniapp('../utils/api.js')
  const d = details(200, 4, bw(50, 4))
  const shapes = [[d, true], [[...d, 7], false], ['currentAmountCents=200', false], [{ 0: 'x' }, false], [undefined, false]]
  for (const [value, kept] of shapes) {
    wx.request = (opts) => opts.success({ statusCode: 409, data: { success: false, error: { code: 'PRICE_CHANGED', message: 'x', details: value } } })
    const err = await api.createCloudPrintOrder({ fileId: 'f' }, { idempotencyKey: '11111111-2222-4333-8444-555555555555', quotedAmountCents: 150 })
      .then(() => null, (e) => e)
    assert.equal(err.statusCode, 409)
    assert.equal(err.code, 'PRICE_CHANGED')
    if (kept) assert.deepEqual([...err.details], d)
    else assert.equal(err.details, undefined, `不得把半合法的 details 筛成一份看起来合法的：${JSON.stringify(value)}`)
  }
})

test('api.js：quotedAmountCents 进 body 副本、键仍在 Header；缺省 = 旧 body；非法金额一个请求都不发', async () => {
  const { wx } = freshWorld()
  const api = requireMiniapp('../utils/api.js')
  const seen = []
  wx.request = (opts) => { seen.push(opts); opts.success({ statusCode: 200, data: { data: { id: 'o', orderId: 'o' } } }) }
  const key = '11111111-2222-4333-8444-555555555555'
  const payload = { terminalId: 't', files: [{ fileId: 'f' }], params: { copies: 1 } }
  await api.createPackageOrder(payload, { idempotencyKey: key, quotedAmountCents: 0 })
  await api.createCloudPrintOrder({ fileId: 'f' }, { idempotencyKey: key, quotedAmountCents: 150 })
  await api.createCloudPrintOrder({ fileId: 'f' }, { idempotencyKey: key })
  assert.equal(seen[0].data.quotedAmountCents, 0, '0 分（免费）也是一个要确认的金额')
  assert.equal(seen[0].header['idempotency-key'], key)
  assert.ok(!('quotedAmountCents' in payload), '调用方那一份是指纹来源，不得被改')
  assert.equal(seen[1].data.quotedAmountCents, 150)
  assert.ok(!('quotedAmountCents' in seen[2].data), '缺省时 body 与旧客户端一致')
  for (const bad of [-1, 1.5, '150', null, pc.MAX_AMOUNT_CENTS + 1]) {
    assert.throws(() => api.createCloudPrintOrder({ fileId: 'f' }, { idempotencyKey: key, quotedAmountCents: bad }))
    assert.throws(() => api.createPackageOrder(payload, { idempotencyKey: key, quotedAmountCents: bad }))
  }
  assert.equal(seen.length, 3, '非法金额不发请求')
})

// ══════════════════════════════════════════════════════════════════════
// ③ 两页真跑
// ══════════════════════════════════════════════════════════════════════

const PAY_QUERY = { fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' }
const DRAFT = { ownerKey: 'u:A', draftId: 'd1', copies: 1, colorMode: 'bw', duplex: 'single', files: [{ fileId: 'f1', name: '简历.pdf' }, { fileId: 'f2', name: '证书.pdf' }] }
const STORE = { id: 't-1', ownerKey: 'u:A', draftId: 'd1', name: '一号服务点', address: '某路 1 号' }

function makePage(relPath, wx) {
  ACTIVE_WX = wx
  return instantiate(loadPageDefinition(relPath, { wx, modules: {} }))
}

/** 两页的差异收在这里：怎么打开、怎么点提交、按钮文案、屏幕金额、成功体。 */
const PAGES = {
  print: {
    async open(wx) {
      const page = makePage('pages/print-pay/print-pay.js', wx)
      page.onLoad({ ...PAY_QUERY })
      page.onShow()
      await flush()
      return page
    },
    tap: (page) => page.continueFlow(),
    requote: (page) => page.retryQuote(),
    label: (page) => page.data.priceConfirmLabel,
    shown: (page) => (page.data.quoteState === 'ready' ? (page.data.isFreeOrder ? '免费' : '¥' + page.data.fee.total) : ''),
    notice: (page) => page.data.priceChangeText,
    ok: (id, amountCents) => ({ data: { id, amountCents } }),
    submitLabel: '确认提交',
  },
  package: {
    async open(wx) {
      wx.storage.set('temp_package_data', JSON.parse(JSON.stringify(DRAFT)))
      wx.storage.set('temp_selected_store', JSON.parse(JSON.stringify(STORE)))
      const page = makePage('pages/package-confirm/package-confirm.js', wx)
      page.onLoad()
      page.onShow()
      await flush()
      page.toggleAgreement({ detail: { value: ['agreed'] } })
      return page
    },
    tap: (page) => page.submitOrder(),
    requote: (page) => page.recover({ currentTarget: { dataset: { recover: page.data.quoteRecover } } }),
    label: (page) => page.data.priceConfirmLabel,
    shown: (page) => (page.data.quoteState === 'ready' ? page.data.quoteAmountText : ''),
    notice: (page) => (page.data.submitErrorTitle === '价格已更新' ? page.data.submitErrorText : ''),
    ok: (orderId, amountCents) => ({ data: { orderId, amountCents, pickupStatus: 'pending', payStatus: 'unpaid', taskStatus: 'pending_release' } }),
    submitLabel: '确认下单',
  },
}

const yuan = (cents) => (cents === 0 ? '免费' : '¥' + (cents / 100).toFixed(2))

for (const [name, P] of Object.entries(PAGES)) {
  test(`${name}：涨价 / 降价 / 0→收费 / 收费→0 —— 不自动重发，只有用户再点一次才按新金额、同一个键提交`, async () => {
    for (const [before, after] of [[150, 210], [210, 150], [0, 120], [150, 0]]) {
      const { wx, server } = freshWorld()
      server.quote = { amountCents: before, billablePages: 3 }
      const page = await P.open(wx)
      assert.equal(P.shown(page), yuan(before))

      P.tap(page)
      await flush()
      assert.equal(server.creates.length, 1)
      const first = server.creates[0]
      assert.equal(first.data.quotedAmountCents, before, '带出去的是屏幕上那个金额')
      assert.ok(first.key, '键在 Header 里')
      const row = first.table.find((r) => r.key === first.key)
      assert.ok(row && row.submittedAt, '出门之前键已经标成已提交')

      first.respond(409, priceChangedBody(details(after, 3, bw(after / 3, 3))))
      await flush()
      await flush()
      assert.equal(server.creates.length, 1, '价格变化后不得自动重发')
      assert.equal(P.shown(page), yuan(after), '屏幕换成服务端当前金额')
      assert.equal(P.label(page), `按新金额${P.submitLabel}`, '主按钮写明是按新金额确认')
      assert.ok(P.notice(page).includes(yuan(before)) && P.notice(page).includes(yuan(after)), P.notice(page))
      assert.ok(P.notice(page).includes('没有建单'), '要说清这一次没有建单')
      assert.equal(page.data.submitting, false)
      assert.equal(wx.calls.redirectTo.length, 0)
      assert.ok(!JSON.stringify([...wx.storage.values()]).includes('quotedAmountCents'), '金额不落盘')

      P.tap(page)
      P.tap(page)                                     // 连点：只能有一次 POST
      await flush()
      assert.equal(server.creates.length, 2)
      assert.equal(server.creates[1].key, first.key, '确认新价格沿用原来那个键')
      assert.equal(server.creates[1].data.quotedAmountCents, after)
      server.creates[1].respond(200, P.ok('ord-1', after))
      await flush()
      assert.equal(wx.calls.redirectTo.length, 1)
      assert.ok(wx.calls.redirectTo[0].endsWith('orderId=ord-1'))
    }
  })

  test(`${name}：409 PRICE_CHANGED 但 details 读不懂 —— 说清没建单，要求重新核价，键不变，零自动 POST`, async () => {
    const { wx, server } = freshWorld()
    const page = await P.open(wx)
    P.tap(page)
    await flush()
    const key = server.creates[0].key
    server.creates[0].respond(409, priceChangedBody(['currentAmountCents=abc']))
    await flush()
    assert.equal(page.data.quoteState, 'error')
    assert.equal(page.data.quoteRecover, 'retry', '下一步是「重新核价」')
    assert.equal(P.shown(page), '', '读不懂就不显示任何金额')
    assert.equal(P.label(page), '')
    const text = name === 'print' ? page.data.quoteError : page.data.quoteErrorText
    assert.ok(text.includes('没有建单') && text.includes('重新核价'), text)

    P.tap(page)                                       // 不核价就点：挡住
    await flush()
    assert.equal(server.creates.length, 1, '读不懂的价格变化之后，不重新核价不许提交')

    server.quote = { amountCents: 180, billablePages: 3 }
    P.requote(page)
    await flush()
    assert.equal(P.shown(page), yuan(180))
    P.tap(page)
    await flush()
    assert.equal(server.creates.length, 2)
    assert.equal(server.creates[1].key, key, '重新核价后仍是同一个键')
    assert.equal(server.creates[1].data.quotedAmountCents, 180)
  })

  test(`${name}：结果未知（断网 / 5xx / 状态码证明不了）留在原有恢复路径，不说成价格变化、不换键`, async () => {
    const d = details(220, 3, bw(50, 3), 'line=print_bw_page:70:1:70')
    const unknowns = [
      (c) => c.drop(),
      (c) => c.respond(500, priceChangedBody(d)),
      (c) => c.respond(200, { code: 'PRICE_CHANGED', message: 'x' }),
      (c) => c.respond(409, { success: false, error: { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'x', details: d } }),
    ]
    for (const reply of unknowns) {
      const { wx, server } = freshWorld()
      const page = await P.open(wx)
      P.tap(page)
      await flush()
      const key = server.creates[0].key
      reply(server.creates[0])
      await flush()
      await flush()
      assert.equal(P.label(page), '', '不得标成价格变化')
      assert.equal(P.notice(page), '')
      assert.equal(P.shown(page), yuan(150), '屏幕金额不动')
      assert.equal(server.creates.length, 1, '不自动重发')
      assert.ok(rowByKey(wx, key) && rowByKey(wx, key).submittedAt, '键与 submittedAt 原样留着')
      P.tap(page)
      await flush()
      assert.equal(server.creates.length, 2)
      assert.equal(server.creates[1].key, key, '重试带同一个键')
      assert.equal(server.creates[1].data.quotedAmountCents, 150, '重试带同一个已确认金额')
    }
  })

  test(`${name}：报价在途 / 报价失败时一律不提交；重新核价在途时旧金额也不算数`, async () => {
    const { wx, server } = freshWorld()
    server.quote = null
    const page = await P.open(wx)
    P.tap(page)
    await flush()
    assert.equal(server.creates.length, 0, '报价还在途')
    server.quotes[0].respond(500, { error: { code: 'INTERNAL_ERROR', message: 'x' } })
    await flush()
    assert.equal(page.data.quoteState, 'error')
    P.tap(page)
    await flush()
    assert.equal(server.creates.length, 0, '报价失败')
    assert.ok(!wx.storage.get(printIdem.STORE_KEY) && !wx.storage.get(packageIdem.STORE_KEY),
      '被挡住的提交连幂等键都不铸、不标记（挡在 ensureKey 之前）')

    P.requote(page)
    await flush()
    server.quotes[1].respond(200, { data: { amountCents: 150, billablePages: 3 } })
    await flush()
    P.requote(page)                                   // 再核一次，挂着不回
    await flush()
    P.tap(page)
    await flush()
    assert.equal(server.creates.length, 0, '正在重新核价时，上一次的金额不再算数')
    server.quotes[2].respond(200, { data: { amountCents: 170, billablePages: 3 } })
    await flush()
    P.tap(page)
    await flush()
    assert.equal(server.creates.length, 1)
    assert.equal(server.creates[0].data.quotedAmountCents, 170)
  })

  test(`${name}：屏幕显示就绪、但快照绑的不是当前账号 —— 不铸键、不提交，要求重新核价`, async () => {
    const { wx, server } = freshWorld()
    const page = await P.open(wx)
    assert.equal(P.shown(page), yuan(150), '前提：屏幕上是就绪的金额')
    const fp = page._quote.fingerprint
    page._quote = pc.bindQuote(pc.beginQuote('u:B', fp), 'u:B', fp, 150, 3)
    P.tap(page)
    await flush()
    assert.equal(server.creates.length, 0, '只认绑给当前账号 + 当前参数的那个金额')
    assert.ok(!wx.storage.get(printIdem.STORE_KEY) && !wx.storage.get(packageIdem.STORE_KEY), '一个键都不铸')
    assert.equal(page.data.quoteState, 'error')
    assert.equal(page.data.quoteRecover, 'retry')
  })

  test(`${name}：409 之后退出重进 —— 金额不带过去，重新核价，键与 submittedAt 不变`, async () => {
    const { wx, server } = freshWorld()
    const page = await P.open(wx)
    P.tap(page)
    await flush()
    const first = server.creates[0]
    const submittedAt = first.table.find((r) => r.key === first.key).submittedAt
    first.respond(409, priceChangedBody(details(210, 3, bw(70, 3))))
    await flush()
    assert.equal(P.shown(page), yuan(210))
    page.onUnload()

    if (name === 'package') {
      // 草稿只在建单成功后才删；重进时它必须还在。
      assert.ok(wx.storage.get('temp_package_data'))
    }
    server.quote = { amountCents: 240, billablePages: 3 }
    const again = name === 'print' ? makePage('pages/print-pay/print-pay.js', wx) : makePage('pages/package-confirm/package-confirm.js', wx)
    if (name === 'print') again.onLoad({ ...PAY_QUERY }); else again.onLoad()
    again.onShow()
    await flush()
    if (name === 'package') again.toggleAgreement({ detail: { value: ['agreed'] } })
    assert.equal(P.shown(again), yuan(240), '重进后显示的是重新核出来的金额')
    assert.equal(P.label(again), '', '重进后不沿用上一次的「按新金额确认」')
    P.tap(again)
    await flush()
    assert.equal(server.creates.length, 2)
    assert.equal(server.creates[1].key, first.key, '重进后仍是原来那个键')
    assert.equal(server.creates[1].data.quotedAmountCents, 240)
    assert.equal(rowByKey(wx, first.key).submittedAt, submittedAt, 'submittedAt 不因价格变化被改写')
  })

  test(`${name}：换了账号 —— 上一位的报价与 409 都不得写进新账号的页面`, async () => {
    // (a) A 的报价迟到
    {
      const { wx, server } = freshWorld()
      server.quote = null
      const page = await P.open(wx)
      login('B')
      page.onShow()
      server.quotes[0].respond(200, { data: { amountCents: 150, billablePages: 3 } })
      await flush()
      assert.equal(P.shown(page), '', 'A 的金额不得出现在 B 的页面上')
      P.tap(page)
      await flush()
      assert.equal(server.creates.length, 0, 'B 不能拿 A 的报价下单')
    }
    // (b) A 的 409 迟到
    {
      const { wx, server } = freshWorld()
      const page = await P.open(wx)
      P.tap(page)
      await flush()
      login('B')
      page.onShow()
      server.creates[0].respond(409, priceChangedBody(details(210, 3, bw(70, 3))))
      await flush()
      assert.equal(P.label(page), '', 'A 的价格变化不得出现在 B 的页面上')
      assert.equal(P.notice(page), '')
      assert.equal(P.shown(page), '')
      assert.ok(!JSON.stringify(page.data).includes('2.10'))
      P.tap(page)
      await flush()
      assert.equal(server.creates.length, 1, 'B 没有自己的报价就不能提交')
    }
  })

  test(`${name}：服务端回放已建成的原单 —— 走原有订单路径，屏幕只认原单金额`, async () => {
    const { wx, server } = freshWorld()
    wx.control.navFail = true                         // 留在本页，才看得见屏幕上写了什么
    const page = await P.open(wx)
    P.tap(page)
    await flush()
    server.creates[0].respond(200, P.ok('ord-old', 100))
    await flush()
    assert.equal(page._createdOrderId, 'ord-old')
    assert.equal(P.label(page), '')
    assert.equal(P.notice(page), '')
    if (name === 'print') {
      assert.equal(page.data.createdLocked, true)
      assert.equal(page.data.fee.total, '1.00', '显示原单落库的金额，不是之后那次报价')
    } else {
      assert.equal(page.data.quoteRecover, 'orders', '锁在原单上，指路去「我的 · 打印订单」')
      assert.equal(page.data.quoteState, 'error', '不再显示之后那次报价')
      assert.ok(page.data.quoteErrorText.includes('原订单金额：¥1.00'), page.data.quoteErrorText)
    }
    P.tap(page)
    await flush()
    assert.equal(server.creates.length, 1, '已建成就不再 POST')
    if (name !== 'print') return
    // 原单后来被取消 →「重新下单」：屏幕上的 ¥1.00 是原单金额、不是报价，不许带着它出门。
    page.onShow()
    server.lookups[0].respond(200, { data: { id: 'ord-old', amountCents: 100, pickupStatus: 'cancelled', taskStatus: 'cancelled' } })
    await flush()
    assert.equal(page.data.fee.total, '1.00', '终态原单同样只显示它自己的金额')
    server.quote = { amountCents: 160, billablePages: 3 }
    page.startNewOrder()
    assert.equal(page.data.fee.total, '—', '重新下单先撤掉原单金额')
    assert.equal(page.data.quoteState, 'loading', '并当场重新核价')
    P.tap(page)
    await flush()
    assert.equal(server.creates.length, 1, '新报价回来之前不提交')
    assert.equal(P.shown(page), yuan(160))
    P.tap(page)
    await flush()
    assert.equal(server.creates.length, 2)
    assert.equal(server.creates[1].data.quotedAmountCents, 160, '新的一单带的是新报价')
    assert.notEqual(server.creates[1].key, server.creates[0].key, '重新下单是新的下单意图，换新键')
  })
}

// ── 已建成的原单：金额只显示、不成快照（Grok 复核 2026-09-23 的反例） ─────────────────

/** 在本机落一条「这一组参数已经建成过 orderId」的记录（与建单成功后写下的一模一样）。 */
async function seedOrder(idem, fingerprint, orderId) {
  const row = await idem.ensureKey('u:A', fingerprint)
  assert.ok(idem.markSubmitted('u:A', fingerprint, row.key))
  assert.ok(idem.rememberOrderId('u:A', fingerprint, row.key, orderId))
  return row.key
}

test('print：带着已建成的原单重进 —— 先锁再核价；原单金额只显示不成快照；重新下单先撤再重新核价', async () => {
  const { wx, server } = freshWorld()
  const first = await PAGES.print.open(wx)
  const fingerprint = printIdem.fingerprintOf(first._orderPayload())
  first.onUnload()
  const oldKey = await seedOrder(printIdem, fingerprint, 'ord-old')
  server.quote = null
  const quotes = server.quotes.length

  const page = await PAGES.print.open(wx)
  assert.equal(page.data.createdLocked, true)
  assert.equal(server.quotes.length, quotes, '锁在原单上时不核价（否则一份无关的现价会写上屏）')
  assert.equal(page._quote, null)
  server.lookups[0].respond(200, { data: { id: 'ord-old', amountCents: 100, pickupStatus: 'pending', taskStatus: 'pending_release' } })
  await flush()
  assert.equal(page.data.fee.total, '1.00', '显示原单落库的金额')
  assert.equal(page._quote, null, '原单金额不是报价，不成快照')
  page.continueFlow()
  await flush()
  assert.equal(server.creates.length, 0)

  page.onShow()                                   // 原单后来被取消
  server.lookups[1].respond(200, { data: { id: 'ord-old', amountCents: 100, pickupStatus: 'cancelled', taskStatus: 'cancelled' } })
  await flush()
  assert.equal(page.data.createdCanReorder, true)
  page.startNewOrder()
  assert.equal(page.data.fee.total, '—', '重新下单先撤掉原单金额')
  assert.equal(page.data.quoteState, 'loading')
  assert.equal(page._quote, null)
  page.continueFlow()
  await flush()
  assert.equal(server.quotes.length, quotes + 1, '重新下单当场重新核价（报价先换 printFileUrl，再发出）')
  assert.equal(server.creates.length, 0, '新报价回来之前不提交')
  server.quotes[quotes].respond(200, { data: { amountCents: 240, billablePages: 3 } })
  await flush()
  assert.equal(page.data.fee.total, '2.40')
  page.continueFlow()
  await flush()
  assert.equal(server.creates.length, 1)
  assert.equal(server.creates[0].data.quotedAmountCents, 240, '带的是重新核出来的金额')
  assert.notEqual(server.creates[0].key, oldKey, '重新下单是新的下单意图，换新键')
})

test('print：报价在途时本页锁到一张已建成的订单上 —— 迟到的报价（成功或失败）既不写屏也不成快照', async () => {
  for (const reply of [
    (c) => c.respond(200, { data: { amountCents: 240, billablePages: 3 } }),
    (c) => c.respond(500, { error: { code: 'INTERNAL_ERROR', message: 'x' } }),
  ]) {
    const { wx, server } = freshWorld()
    server.quote = null
    const page = await PAGES.print.open(wx)
    assert.equal(page.data.quoteState, 'loading', '前提：报价在途')
    await seedOrder(printIdem, printIdem.fingerprintOf(page._orderPayload()), 'ord-old')
    page.onShow()                                 // 本机出现一张已建成的订单（例如另一页刚建成）
    assert.equal(page.data.createdLocked, true)
    reply(server.quotes[0])
    await flush()
    assert.equal(page._quote, null)
    assert.equal(page.data.fee.total, '—', '迟到的报价不写屏')
    assert.equal(page.data.quoteState, 'idle', '「正在核定」收起，等原单自己的金额')
    assert.equal(page.data.quoteError, '')
    server.lookups[0].respond(200, { data: { id: 'ord-old', amountCents: 100, pickupStatus: 'pending', taskStatus: 'pending_release' } })
    await flush()
    assert.equal(page.data.fee.total, '1.00')
    assert.equal(page._quote, null)
  }
})

test('package：带着已建成的原单重进 —— 锁定说明写出原单金额，但页面不因此变成可提交', async () => {
  const { wx, server } = freshWorld()
  const first = await PAGES.package.open(wx)
  const fingerprint = packageIdem.fingerprintOf(first._orderPayload())
  first.onUnload()
  await seedOrder(packageIdem, fingerprint, 'pkg-old')
  const quotes = server.quotes.length

  const page = await PAGES.package.open(wx)
  assert.equal(server.quotes.length, quotes, '锁在原单上时不核价')
  server.lookups[0].respond(200, { data: { orderId: 'pkg-old', amountCents: 100, pickupStatus: 'cancelled', payStatus: 'unpaid', taskStatus: 'cancelled' } })
  await flush()
  assert.ok(page.data.quoteErrorText.includes('原订单金额：¥1.00'), page.data.quoteErrorText)
  assert.equal(page.data.quoteState, 'error', '原单金额只写进说明，不变成就绪报价')
  assert.equal(PAGES.package.shown(page), '')
  assert.ok(!page._quote, '原单金额不成快照')
  PAGES.package.tap(page)
  await flush()
  assert.equal(server.creates.length, 0, '原单金额不能拿去下单')
})
