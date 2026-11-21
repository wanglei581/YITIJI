/**
 * P2m-b 并发、会话代次与状态竞态回归套件（对应 Codex 独立收货复现的 D1–D8 + 同账号收银台 C4）。
 * 全部在 node:vm 中真实执行页面源码与真实 utils/auth.js / utils/storage.js。
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
const vpayModel = requireMiniapp('./virtual-pay-model.js')

const VALID_USCC = '91000000000000001N'
const BASE_WX = { showToast() {}, showModal() {}, stopPullDownRefresh() {}, navigateTo() {}, navigateBack() {}, switchTab() {} }
const orderRes = (outTradeNo) => ({
  outTradeNo,
  signData: `{"outTradeNo":"${outTradeNo}"}`,
  paySig: 'p',
  signature: 's',
  mode: 'short_series_goods',
})
const invItem = (orderKind, orderId, amountCents = 300) => ({
  orderKind, orderId, amountCents, canRequest: true, invoiceStatus: 'none', requestId: null,
})

function fakeJwt(sub, ttlSec = 3600) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, exp: Math.floor(Date.now() / 1000) + ttlSec })}.sig`
}

function createRealAuthEnv() {
  const store = new Map()
  const wx = {
    ...BASE_WX,
    getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
    setStorageSync: (k, v) => { store.set(k, v) },
    removeStorageSync: (k) => { store.delete(k) },
  }
  const cache = new Map()
  const loadUtil = (name) => {
    if (cache.has(name)) return cache.get(name)
    const mod = { exports: {} }
    cache.set(name, mod)
    const src = fs.readFileSync(path.join(MINIAPP, 'utils', `${name}.js`), 'utf8')
    const ctx = vm.createContext({
      wx, console, module: mod, exports: mod.exports,
      require: (id) => loadUtil(id.replace(/^.*\//, '').replace(/\.js$/, '')).exports,
    })
    vm.runInContext(src, ctx, { filename: `utils/${name}.js` })
    return mod
  }
  return { auth: loadUtil('auth').exports, wx, store }
}

function createTimerTracker() {
  let nextId = 1
  const active = new Map()
  return {
    active,
    setTimeout(fn, ms) { const id = nextId; nextId += 1; active.set(id, { fn, ms }); return id },
    clearTimeout(id) { active.delete(id) },
    runNext() {
      const first = active.entries().next()
      if (first.done) return false
      const [id, entry] = first.value
      active.delete(id)
      entry.fn()
      return true
    },
  }
}

function makeStatefulAuth(userId, withSubscribe = true) {
  let current = userId
  let gen = 1
  const listeners = new Set()
  const notify = (reason) => { listeners.forEach((fn) => fn({ generation: gen, reason })) }
  const auth = {
    setUser(nextId) { current = nextId; gen += 1; if (withSubscribe) notify('login') },
    logout() { current = ''; gen += 1; if (withSubscribe) notify('logout') },
    isLoggedIn: () => Boolean(current),
    getUser: () => (current ? { id: current, nickname: `用户${current}` } : null),
    sessionGeneration: () => gen,
    canSilentResignin: () => false,
  }
  if (withSubscribe) {
    auth.subscribeSessionChange = (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } }
  }
  return auth
}

function makeInvoicePage(auth, listInvoiceOrders, submitInvoiceRequest = () => Promise.resolve({})) {
  return instantiate(loadPageDefinition('pages/invoice-center/invoice-center.js', {
    wx: { ...BASE_WX },
    modules: {
      auth,
      'api-invoice': { listInvoiceOrders, submitInvoiceRequest, getInvoiceRequest: () => Promise.resolve({}) },
    },
  }))
}

function makeCreditsPage(auth, api, wxOverrides = {}, globals = {}) {
  const wx = {
    ...BASE_WX,
    login({ success }) { success({ code: 'fresh-code' }) },
    requestVirtualPayment({ success }) { success({}) },
    ...wxOverrides,
  }
  return instantiate(loadPageDefinition('pages/service-credits/service-credits.js', {
    wx,
    modules: { auth, 'api-virtual-pay': api },
    globals,
  }))
}

test('D1：账号切换 A→B 后未走 onShow 直接点击提交开票，不抛空指针且 0 POST', async () => {
  for (const withSubscribe of [false, true]) {
    let submitCalls = 0
    const auth = makeStatefulAuth('A', withSubscribe)
    const page = makeInvoicePage(
      auth,
      () => Promise.resolve({ items: [invItem('print', 'ord-A1')], nextCursor: null }),
      () => { submitCalls += 1; return Promise.resolve({ id: 'bad' }) },
    )
    page.onLoad({})
    page.onShow()
    await flush()

    page.openForm({ currentTarget: { dataset: { key: 'print:ord-A1' } } })
    page.selectTitleType({ currentTarget: { dataset: { type: 'company' } } })
    page.onFormInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '甲方公司' } })
    page.onFormInput({ currentTarget: { dataset: { field: 'taxId' } }, detail: { value: VALID_USCC } })
    page.onFormInput({ currentTarget: { dataset: { field: 'email' } }, detail: { value: 'a@example.com' } })

    auth.setUser('B')
    assert.doesNotThrow(() => page.submitForm())
    await flush()
    assert.equal(submitCalls, 0, `withSubscribe=${withSubscribe} 切号后不得发出 POST`)
    assert.equal(page.data.selectedOrder, null)
    assert.equal(page.data.form.taxId, '')
    assert.equal(page.data.form.email, '')
    assert.match(page.data.identityNotice, /账号已变更/)
  }
})

test('D2：带参目标订单位于第二页时，加载更多后自动应用预选；手动选单后不再抢切', async () => {
  const listFn = ({ cursor }) => Promise.resolve(
    !cursor
      ? { items: [invItem('print', 'ord-p1', 200)], nextCursor: 'cursor-p2' }
      : { items: [invItem('print', 'ord-p2-target', 500)], nextCursor: null },
  )
  const page = makeInvoicePage(makeStatefulAuth('A'), listFn)
  page.onLoad({ orderKind: 'print', orderId: 'ord-p2-target' })
  page.onShow()
  await flush()
  assert.equal(page.data.selectedOrder, null, '第 1 页尚无目标单')

  page.loadMore()
  await flush()
  assert.equal(page.data.orders.length, 2)
  assert.equal(page.data.selectedOrder.orderKind, 'print')
  assert.equal(page.data.selectedOrder.orderId, 'ord-p2-target', '第 2 页加载后必须自动应用预选')

  const page2 = makeInvoicePage(makeStatefulAuth('A'), listFn)
  page2.onLoad({ orderKind: 'print', orderId: 'ord-p2-target' })
  page2.onShow()
  await flush()
  page2.openForm({ currentTarget: { dataset: { key: 'print:ord-p1' } } })
  page2.loadMore()
  await flush()
  assert.equal(page2.data.selectedOrder.orderId, 'ord-p1', '手动选单后翻页不得强切')
})

test('D3：预选严格按 orderKind + orderId 精确匹配，不跨类型误选同 ID 订单', async () => {
  const page = makeInvoicePage(
    makeStatefulAuth('A'),
    () => Promise.resolve({ items: [invItem('service', 'wanted', 900)], nextCursor: null }),
  )
  page.onLoad({ orderKind: 'print', orderId: 'wanted' })
  page.onShow()
  await flush()
  assert.equal(page.data.selectedOrder, null, 'print:wanted 不得回退匹配 service:wanted')
})

test('D4：迟到的普通权益列表不得覆盖已确认的购买结果（共享版本守卫）', async () => {
  const slowRefresh = deferred()
  let listCalls = 0
  const page = makeCreditsPage(makeStatefulAuth('A'), {
    listServiceCredits: () => {
      listCalls += 1
      if (listCalls === 1) return Promise.resolve({ items: [] })
      if (listCalls === 2) return slowRefresh.promise
      return Promise.resolve({ items: [{ serviceKind: 'resume_optimize', createdAt: '2026-11-21T10:00:00.000Z' }] })
    },
    createVirtualPayOrder: () => Promise.resolve(orderRes('vp-d4')),
  })
  page.onLoad()
  page.onShow()
  await flush()
  assert.equal(page.data.baselineReady, true)

  page.retryLoad()
  await flush()
  const res = await page.tapBuy({ currentTarget: { dataset: { kind: 'resume_optimize' } } })
  await flush()
  assert.equal(res.status, 'confirmed')
  assert.equal(page.data.totalCount, 1)

  slowRefresh.resolve({ items: [] })
  await flush()
  assert.equal(page.data.totalCount, 1, '迟到的普通列表绝不能覆盖已确认的 1 次权益')
  assert.equal(page.data.summary[0].count, 1)
})

test('D5：首次基线未拿到前禁止购买；无基线或既有旧权益绝不误判为本次 confirmed', async () => {
  const pendingInitial = deferred()
  let loginCalls = 0
  let orderCalls = 0
  const wxObj = {
    login({ success }) { loginCalls += 1; success({ code: 'c' }) },
    requestVirtualPayment({ success }) { success({}) },
  }
  const page = makeCreditsPage(
    makeStatefulAuth('A'),
    {
      listServiceCredits: () => pendingInitial.promise,
      createVirtualPayOrder: () => { orderCalls += 1; return Promise.resolve({}) },
    },
    wxObj,
  )
  page.onLoad()
  page.onShow()
  await flush()
  assert.equal(page.data.baselineReady, false)
  assert.equal(page.tapBuy({ currentTarget: { dataset: { kind: 'resume_optimize' } } }), undefined)
  assert.equal(loginCalls, 0, '基线未就绪前不得调 wx.login')
  assert.equal(orderCalls, 0, '基线未就绪前不得下单')

  const existingItem = { serviceKind: 'resume_optimize', createdAt: '2026-11-18T00:00:00.000Z' }
  const untrusted = await vpayModel.buyServiceCredit({
    serviceKind: 'resume_optimize',
    wxObj,
    api: {
      createVirtualPayOrder: () => Promise.resolve(orderRes('vp-d5')),
      listServiceCredits: () => Promise.resolve({ items: [existingItem] }),
    },
    sleep: () => Promise.resolve(),
    maxPolls: 2,
    pollIntervalMs: 10,
  })
  assert.equal(untrusted.status, 'pending_confirm', '缺少可信基线时绝不能误判 confirmed')

  pendingInitial.resolve({ items: [existingItem] })
  await flush()
  assert.equal(page.data.baselineReady, true)
  assert.equal(page.data.totalCount, 1)

  const oldOnly = await vpayModel.buyServiceCredit({
    serviceKind: 'resume_optimize',
    baseline: vpayModel.createCreditsBaseline(vpayModel.summarizeCredits({ items: [existingItem] })),
    wxObj,
    api: {
      createVirtualPayOrder: () => Promise.resolve(orderRes('vp-d5b')),
      listServiceCredits: () => Promise.resolve({ items: [existingItem] }),
    },
    sleep: () => Promise.resolve(),
    maxPolls: 2,
    pollIntervalMs: 10,
  })
  assert.equal(oldOnly.status, 'pending_confirm', '只有购买前旧权益时绝不能误判 confirmed')
})

test('D6：同一会员 A 登出后重新登录，旧会话代次的开票列表响应必须丢弃', async () => {
  for (const withSubscribe of [false, true]) {
    const auth = makeStatefulAuth('A', withSubscribe)
    const oldList = deferred()
    const page = makeInvoicePage(auth, () => oldList.promise)
    page.onLoad({})
    page.onShow()
    await flush()

    auth.logout()
    auth.setUser('A')
    oldList.resolve({ items: [invItem('print', 'stale-gen-order', 400)], nextCursor: null })
    await flush()
    assert.equal(page.data.orders.length, 0, `withSubscribe=${withSubscribe} 同账号新代次不得接受旧会话订单`)
  }
})

test('D7：同一会员 A 购买在途登出并重新登录后，buyingKind 立即释放不锁死', async () => {
  for (const withSubscribe of [false, true]) {
    const auth = makeStatefulAuth('A', withSubscribe)
    const orderDeferred = deferred()
    const page = makeCreditsPage(auth, {
      listServiceCredits: () => Promise.resolve({ items: [] }),
      createVirtualPayOrder: () => orderDeferred.promise,
    })
    page.onLoad()
    page.onShow()
    await flush()

    const buyPromise = page.tapBuy({ currentTarget: { dataset: { kind: 'resume_optimize' } } })
    await flush()
    assert.equal(page.data.buyingKind, 'resume_optimize')

    auth.logout()
    auth.setUser('A')
    orderDeferred.resolve(orderRes('vp-d7'))
    const res = await buyPromise
    await flush()
    assert.equal(res.status, 'stale')
    assert.equal(page.data.buyingKind, '', `withSubscribe=${withSubscribe} 同会员重登后 buyingKind 不得残留锁死`)
  }
})

test('D8 + C4：轮询期间真实 auth 登出或切号无需生命周期回调即刻清零定时器；同账号收银台 onHide 保留确认链', async () => {
  for (const action of ['logout', 'switch']) {
    const { auth, wx } = createRealAuthEnv()
    const tracker = createTimerTracker()
    assert.equal(auth.saveSession({ token: fakeJwt('A'), user: { id: 'A', nickname: '甲' } }), true)
    const page = makeCreditsPage(
      auth,
      {
        listServiceCredits: () => Promise.resolve({ items: [] }),
        createVirtualPayOrder: () => Promise.resolve(orderRes('vp-d8')),
      },
      { ...wx, login({ success }) { success({ code: 'fresh-d8' }) }, requestVirtualPayment({ success }) { success({}) } },
      { setTimeout: (fn, ms) => tracker.setTimeout(fn, ms), clearTimeout: (id) => tracker.clearTimeout(id) },
    )
    page.onLoad()
    page.onShow()
    await flush()

    const buyPromise = page.tapBuy({ currentTarget: { dataset: { kind: 'resume_optimize' } } })
    await flush()
    await flush()
    assert.equal(tracker.active.size, 1, `${action} 前应有 1 个活动轮询定时器`)

    if (action === 'logout') auth.logout()
    else assert.equal(auth.saveSession({ token: fakeJwt('B'), user: { id: 'B', nickname: '乙' } }), true)

    assert.equal(tracker.active.size, 0, `${action} 后无需生命周期回调必须立即清零活动定时器`)
    assert.equal(page.data.buyingKind, '', `${action} 后立即释放 buyingKind`)
    assert.equal((await buyPromise).status, 'stale')
    page.onUnload()
  }

  // C4 回归保护：同账号调起微信收银台触发 onHide，回调 success 与轮询确认链必须照常完成
  const { auth, wx } = createRealAuthEnv()
  const tracker = createTimerTracker()
  assert.equal(auth.saveSession({ token: fakeJwt('A'), user: { id: 'A', nickname: '甲' } }), true)
  let listCalls = 0
  let triggerPaySuccess = null
  const page = makeCreditsPage(
    auth,
    {
      listServiceCredits: () => {
        listCalls += 1
        return Promise.resolve({
          items: listCalls <= 2 ? [] : [{ serviceKind: 'mock_interview', createdAt: '2026-11-21T12:00:00.000Z' }],
        })
      },
      createVirtualPayOrder: () => Promise.resolve(orderRes('vp-c4')),
    },
    { ...wx, login({ success }) { success({ code: 'fresh-c4' }) }, requestVirtualPayment({ success }) { triggerPaySuccess = success } },
    { setTimeout: (fn, ms) => tracker.setTimeout(fn, ms), clearTimeout: (id) => tracker.clearTimeout(id) },
  )
  page.onLoad()
  page.onShow()
  await flush()

  const buyPromise = page.tapBuy({ currentTarget: { dataset: { kind: 'mock_interview' } } })
  await flush()
  page.onHide()
  triggerPaySuccess({})
  await flush()
  await flush()
  assert.equal(tracker.active.size, 1, '同账号 onHide 不得误杀确认轮询')
  page.onShow()
  tracker.runNext()
  const c4Res = await buyPromise
  await flush()
  assert.equal(c4Res.status, 'confirmed')
  assert.equal(page.data.totalCount, 1)
  assert.equal(page.data.buyingKind, '')
  page.onUnload()
})
