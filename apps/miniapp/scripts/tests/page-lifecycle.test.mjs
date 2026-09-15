/**
 * 页面生命周期 / 请求竞态的**真执行**测试（node:test）。
 *
 * 为什么必须真跑，而不是再加几条正则：
 *   材料包侧链已有的门禁是静态断言，它能证明"某段守卫代码存在"，证明不了
 *   "旧响应真的写不进来"。而这一批缺陷的形态恰恰是"代码看着都在，顺序一换就漏"：
 *   A 的请求在途时切到 B，A 的 then 照常执行；onHide 刚把到机码清掉，迟到的响应
 *   又原样写回去；两次刷新乱序返回，旧的那次盖掉新的。
 *   这些只能把 Page 真的实例化、把 Promise 真的按乱序 resolve 一遍才能知道。
 *
 * 做法：用 node:vm 给页面源码一个最小沙箱（Page / getApp / wx / require），
 * 真正执行四条链上的页面源码，拿到 Page 配置对象后实例化成一个带 setData 的对象，
 * 然后按真实生命周期顺序调用 onLoad / onShow / onHide / onUnload。
 *   - utils/page-guard.js 与 utils/package-order.js 用**真实实现**（它们无 wx 依赖）；
 *   - utils/api.js、utils/auth.js 用可控替身，请求由测试决定什么时候、按什么顺序完成。
 *
 * 放在 scripts/tests/ 是刻意的：scripts/project-graph/gates.mjs 把 `/scripts/tests/`
 * 排除在"门禁脚本"之外，所以本文件不会被 verify-ci-gate-coverage 当成
 * "写完没接线的门禁"。它由 `verify:page-lifecycle` 拉起，并串在 verify:static 里进 CI。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))

// ── 沙箱 ────────────────────────────────────────────────────────────────

// ⚠ vm.createContext 建的是**另一个 realm**：沙箱里造出来的数组 / 对象不是宿主
//   Array、Object 的实例。所以断言一律用 length / 字段比较，不要用 deepStrictEqual
//   去比 `[]` —— 那会因为原型不同而恒红，看起来像被测代码有问题。

/** 可控 Promise：测试自己决定什么时候、按什么顺序完成它。 */
function deferred() {
  const d = {}
  d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject })
  // 未处理的 rejection 不该让整个测试进程炸掉 —— 被守卫丢弃的响应正是这种形态。
  d.promise.catch(() => {})
  return d
}

/** 让所有已 resolve 的微任务跑完（页面回调是链在 Promise 上的）。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 最小 wx 替身：只实现被测页面真正用到的那几个。storage 是一个普通 Map。 */
function createWx(storage = new Map()) {
  const calls = { navigateTo: [], redirectTo: [], showToast: [], showModal: [], switchTab: [] }
  return {
    storage,
    calls,
    getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
    setStorageSync: (key, value) => { storage.set(key, value) },
    removeStorageSync: (key) => { storage.delete(key) },
    navigateTo: (opts) => { calls.navigateTo.push(opts.url) },
    redirectTo: (opts) => { calls.redirectTo.push(opts.url); if (opts.success) opts.success() },
    switchTab: (opts) => { calls.switchTab.push(opts.url) },
    navigateBack: (opts) => { if (opts && opts.fail) opts.fail({ errMsg: 'no page' }) },
    showToast: (opts) => { calls.showToast.push(opts.title) },
    showModal: (opts) => { calls.showModal.push(opts); if (opts && opts.success) opts.success({ confirm: false }) },
    showLoading: () => {},
    hideLoading: () => {},
    stopPullDownRefresh: () => {},
    setClipboardData: () => {},
    createSelectorQuery: () => ({ in: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) }) }),
    getWindowInfo: () => ({ pixelRatio: 1 }),
  }
}

/** 可切换身份的 auth 替身。setUser(null) = 登出。 */
function createAuth(initialId) {
  let user = initialId ? { id: initialId } : null
  return {
    setUser(id) { user = id ? { id } : null },
    isLoggedIn: () => !!user,
    getUser: () => user,
    logout() { user = null },
  }
}

/**
 * 在沙箱里真实执行一个页面源码，返回 Page() 收到的配置对象。
 * @param {string} relPath 相对 apps/miniapp 的路径
 */
function loadPageDefinition(relPath, { wx, modules }) {
  const src = fs.readFileSync(path.join(MINIAPP, relPath), 'utf8')
  let pageDef = null
  const sandbox = {
    console,
    wx,
    Page: (def) => { pageDef = def },
    getApp: () => ({ globalData: { statusBarHeight: 20 } }),
    require: (id) => {
      const name = id.replace(/^.*\//, '').replace(/\.js$/, '')
      if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name]
      // 其余一律用真实实现（它们都是无 wx 依赖的纯模块）。
      return requireMiniapp(`../utils/${name}.js`)
    },
    module: { exports: {} },
    exports: {},
    setTimeout,
    clearTimeout,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: relPath })
  assert.ok(pageDef, `${relPath} 没有调用 Page()`)
  return pageDef
}

/** Page 配置 → 可调用的页面实例（带一个真会合并的 setData）。 */
function instantiate(def) {
  const page = Object.assign(Object.create(null), def)
  page.data = JSON.parse(JSON.stringify(def.data || {}))
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch)
    if (typeof callback === 'function') callback()
  }
  return page
}

function makePage(relPath, { auth, api, wx }) {
  const def = loadPageDefinition(relPath, { wx, modules: { api, auth } })
  return instantiate(def)
}

// ── 固定夹具 ────────────────────────────────────────────────────────────

const A_ORDER = {
  id: 'ord-A', orderNo: 'NO-A', payStatus: 'unpaid', pickupStatus: 'pending',
  pickupCode: '12345678', amountCents: 100, fileName: 'A的简历.pdf',
}
const A_PACKAGE = {
  id: 'pkg-A', orderNo: 'PKG-A', pickupStatus: 'pending', payStatus: 'unpaid',
  taskStatus: 'pending_release', pickupCode: '87654321', amountCents: 200,
  expiresAt: new Date(Date.now() + 3600e3).toISOString(),
}

// ══════════════════════════════════════════════════════════════════════
// A. 在途请求遇到身份切换 / 登出
// ══════════════════════════════════════════════════════════════════════

test('orders：A 的请求在途时切到 B，A 的响应一个字都不许写进 data', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const cloud = deferred(); const legacy = deferred(); const pkgList = deferred()
  const api = {
    getMyCloudPrintOrders: () => cloud.promise,
    getMyPrintOrders: () => legacy.promise,
    getPackageOrders: () => pkgList.promise,
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()

  // A 还在等响应时换成 B：真机上这条路径是「去登录页 → 登录 → 回到本页」。
  page.onHide()
  auth.setUser('B')
  const cloud2 = deferred(); const legacy2 = deferred(); const pkg2 = deferred()
  api.getMyCloudPrintOrders = () => cloud2.promise
  api.getMyPrintOrders = () => legacy2.promise
  api.getPackageOrders = () => pkg2.promise
  page.onShow()

  // A 的响应现在才姗姗来迟。
  cloud.resolve([A_ORDER]); legacy.resolve([]); pkgList.resolve({ items: [A_PACKAGE], total: 1 })
  await flush()

  assert.equal(page.data.orders.length, 0, 'A 的单件订单不得出现在 B 的列表里')
  assert.equal(page.data.pkgRows.length, 0, 'A 的材料包订单不得出现在 B 的列表里')
  assert.ok(!JSON.stringify(page.data).includes('12345678'), 'A 的到机码不得残留在 data 里')
  assert.ok(!JSON.stringify(page.data).includes('A的简历'), 'A 的文件名不得残留在 data 里')

  // B 自己的响应必须正常写进去 —— 守卫不能把活人一起挡掉。
  cloud2.resolve([{ id: 'ord-B', orderNo: 'NO-B', payStatus: 'paid', pickupStatus: 'claimed' }])
  legacy2.resolve([]); pkg2.resolve({ items: [], total: 0 })
  await flush()
  assert.equal(page.data.orders.length, 1)
  assert.equal(page.data.orders[0].orderNo, 'NO-B')
})

test('orders：请求在途时登出（没有经过 onHide），响应同样不得落地', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const cloud = deferred(); const legacy = deferred(); const pkgList = deferred()
  const api = {
    getMyCloudPrintOrders: () => cloud.promise,
    getMyPrintOrders: () => legacy.promise,
    getPackageOrders: () => pkgList.promise,
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()

  // 会话被后端判失效：token 没了，但页面还停在前台，onHide 根本没触发。
  // 这一层只能靠「回调执行那一刻重读身份」挡住。
  auth.setUser(null)
  cloud.resolve([A_ORDER]); legacy.resolve([]); pkgList.resolve({ items: [A_PACKAGE], total: 1 })
  await flush()

  assert.equal(page.data.orders.length, 0, '登出后到达的响应不得写进列表')
  assert.equal(page.data.pkgRows.length, 0)
  assert.ok(!JSON.stringify(page.data).includes('87654321'), '材料包到机码不得残留')
})

test('package-create：上传后的列表刷新在换用户后不得回写上一位的文件', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const docs = deferred()
  const api = { getMyDocuments: () => docs.promise }
  const page = makePage('pages/package-create/package-create.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  assert.equal(page.data.docState, 'loading')

  page.onHide()
  auth.setUser('B')
  const docsB = deferred()
  api.getMyDocuments = () => docsB.promise
  page.onShow()

  docs.resolve({ items: [{ id: 'f-A', filename: 'A的身份证.pdf', purpose: 'print_doc', sizeBytes: 10 }] })
  await flush()
  assert.equal(page.data.docs.length, 0, 'A 的文件不得出现在 B 的列表里')
  assert.ok(!JSON.stringify(page.data).includes('A的身份证'))

  docsB.resolve({ items: [{ id: 'f-B', filename: 'B的简历.pdf', purpose: 'print_doc', sizeBytes: 10 }] })
  await flush()
  assert.equal(page.data.docs.length, 1)
  assert.equal(page.data.docs[0].id, 'f-B')
})

// ══════════════════════════════════════════════════════════════════════
// B. package-code：onHide / onUnload 之后到达的响应不得复活凭证
// ══════════════════════════════════════════════════════════════════════

test('package-code：请求在途时 onHide，迟到的响应不得把到机码写回来', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const detail = deferred()
  const api = { getPackageOrder: () => detail.promise }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  assert.equal(page.data.loading, true)

  page.onHide()          // 切后台：凭证已被 _clearCredentials 清掉
  detail.resolve(A_PACKAGE)
  await flush()

  assert.equal(page.data.pickupCode, '', '切后台后到达的响应不得复活到机码')
  assert.equal(page.data.ready, false, '不得把页面重新标成「已创建」')
  assert.equal(page.data.showQr, false, '不得重新显示二维码')
  assert.ok(!page._codeRaw, '画码用的明文副本 _codeRaw 必须仍是空的')
  assert.ok(!JSON.stringify(page.data).includes('87654321'))
})

test('package-code：请求在途时 onUnload，迟到的响应同样不得复活凭证', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const detail = deferred()
  const api = { getPackageOrder: () => detail.promise }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  page.onUnload()
  detail.resolve(A_PACKAGE)
  await flush()

  assert.equal(page.data.pickupCode, '')
  assert.equal(page.data.ready, false)
  assert.ok(!page._codeRaw)
})

test('package-code：切后台再回来，拿到的是重新取的码，而不是上一次的残留', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let pending = deferred()
  const api = { getPackageOrder: () => pending.promise }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  page.onHide()

  const stale = pending
  pending = deferred()
  page.onShow()                       // 回到前台：重新发起
  stale.resolve(A_PACKAGE)            // 上一轮的响应这时才到
  await flush()
  assert.equal(page.data.pickupCode, '', '上一轮的响应不得写进来')

  pending.resolve({ ...A_PACKAGE, pickupCode: '11112222' })
  await flush()
  assert.equal(page.data.pickupCode, '11-11-22-22', '新一轮的响应必须正常渲染')
  assert.equal(page.data.ready, true)
})

// ══════════════════════════════════════════════════════════════════════
// C. 乱序返回：旧响应不得覆盖新响应
// ══════════════════════════════════════════════════════════════════════

test('package-code：两次加载乱序返回，终态由最新一次决定（latest-wins）', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const first = deferred(); const second = deferred()
  let call = 0
  const api = { getPackageOrder: () => (++call === 1 ? first.promise : second.promise) }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()        // 第 1 次
  page.retryLoad()     // 第 2 次

  // 第 2 次先回来：订单已核销，到机码已撤下（这是终态）。
  second.resolve({ ...A_PACKAGE, pickupStatus: 'claimed', pickupCode: '' })
  await flush()
  assert.equal(page.data.pickupStatus, 'claimed')
  assert.equal(page.data.pickupCode, '')

  // 第 1 次的旧响应这时才到，里面还带着那张已经作废的码。
  first.resolve(A_PACKAGE)
  await flush()
  assert.equal(page.data.pickupStatus, 'claimed', '旧响应不得把终态改回 pending')
  assert.equal(page.data.pickupCode, '', '旧响应不得把已撤下的到机码画回来')
  assert.ok(!page._codeRaw)
})

test('orders：材料包两次加载乱序返回，旧的那一页不得盖掉新结果', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const first = deferred(); const second = deferred()
  let call = 0
  const api = {
    getMyCloudPrintOrders: () => Promise.resolve([]),
    getMyPrintOrders: () => Promise.resolve([]),
    getPackageOrders: () => (++call === 1 ? first.promise : second.promise),
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()            // 第 1 次
  page.retryPackages()     // 第 2 次
  second.resolve({ items: [{ ...A_PACKAGE, id: 'pkg-new', orderNo: 'PKG-NEW' }], total: 1 })
  await flush()
  assert.equal(page.data.pkgRows[0].orderNo, 'PKG-NEW')

  first.resolve({ items: [{ ...A_PACKAGE, id: 'pkg-old', orderNo: 'PKG-OLD' }], total: 9 })
  await flush()
  assert.equal(page.data.pkgRows.length, 1, '旧响应不得追加或替换')
  assert.equal(page.data.pkgRows[0].orderNo, 'PKG-NEW')
  assert.equal(page.data.pkgTotal, 1, '旧响应的 total 不得盖掉新值')
})

// ══════════════════════════════════════════════════════════════════════
// D. 草稿归属：B / 未登录读到 A 的草稿
// ══════════════════════════════════════════════════════════════════════

function seedDraft(wx, ownerKey, draftId) {
  wx.storage.set('temp_package_data', {
    ownerKey, draftId,
    files: [{ fileId: 'f-A', name: 'A的体检报告.pdf' }],
    colorMode: 'bw', duplex: 'single', copies: 1,
  })
  wx.storage.set('temp_selected_store', { id: 't-1', name: '东城服务点', address: '东城区 1 号', ownerKey, draftId })
}

test('package-confirm：B 打开时 A 的草稿必须被同步删除，且一个文件名都不渲染', async () => {
  const auth = createAuth('B')
  const wx = createWx()
  seedDraft(wx, 'u:A', 'u:A:1')
  const api = { quotePackageOrder: () => { throw new Error('不该核价：草稿不属于本人') } }
  const page = makePage('pages/package-confirm/package-confirm.js', { auth, api, wx })
  page.onLoad()

  assert.equal(page.data.draftState, 'missing')
  assert.equal(page.data.files.length, 0)
  assert.ok(!JSON.stringify(page.data).includes('A的体检报告'), '不得渲染上一位的文件名')
  assert.ok(!JSON.stringify(page.data).includes('东城服务点'), '不得渲染上一位选的服务点')
  assert.equal(wx.storage.has('temp_package_data'), false, 'A 的草稿必须被同步删除')
  assert.equal(wx.storage.has('temp_selected_store'), false, 'A 选的服务点必须一并删除')
})

test('package-confirm：未登录打开时不解析草稿，也不显示文件名', async () => {
  const auth = createAuth(null)
  const wx = createWx()
  seedDraft(wx, 'u:A', 'u:A:1')
  const api = { quotePackageOrder: () => { throw new Error('不该核价：未登录') } }
  const page = makePage('pages/package-confirm/package-confirm.js', { auth, api, wx })
  page.onLoad()

  assert.equal(page.data.isLoggedIn, false)
  assert.equal(page.data.draftState, 'missing')
  assert.equal(page.data.files.length, 0)
  assert.ok(!JSON.stringify(page.data).includes('A的体检报告'))
})

test('package-confirm：本人的草稿照常解析并核价（守卫不得把活人挡掉）', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  seedDraft(wx, 'u:A', 'u:A:1')
  const quote = deferred()
  const api = { quotePackageOrder: () => quote.promise }
  const page = makePage('pages/package-confirm/package-confirm.js', { auth, api, wx })
  page.onLoad()
  assert.equal(page.data.draftState, 'draft')
  assert.equal(page.data.files.length, 1)
  assert.equal(page.data.quoteState, 'loading')
  quote.resolve({ amountCents: 300, billablePages: 3 })
  await flush()
  assert.equal(page.data.quoteState, 'ready')
  assert.equal(page.data.quotePages, 3)
})

test('package-confirm：服务点属于另一份草稿时不认，且不把它渲染出来', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  seedDraft(wx, 'u:A', 'u:A:2')
  // 服务点还停在上一份草稿上（draftId 对不上）。
  wx.storage.set('temp_selected_store', { id: 't-9', name: '上一份草稿选的机器', address: 'x', ownerKey: 'u:A', draftId: 'u:A:1' })
  const api = { quotePackageOrder: () => { throw new Error('不该核价：服务点未绑定本草稿') } }
  const page = makePage('pages/package-confirm/package-confirm.js', { auth, api, wx })
  page.onLoad()
  assert.equal(page.data.draftState, 'missing')
  assert.ok(!JSON.stringify(page.data).includes('上一份草稿选的机器'))
  assert.equal(wx.storage.has('temp_selected_store'), false, '对不上的服务点必须被清掉')
})

test('package-confirm：在途报价遇到换用户，旧报价不得显示给新用户', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  seedDraft(wx, 'u:A', 'u:A:1')
  const quote = deferred()
  const api = { quotePackageOrder: () => quote.promise }
  const page = makePage('pages/package-confirm/package-confirm.js', { auth, api, wx })
  page.onLoad()
  assert.equal(page.data.quoteState, 'loading')

  page.onHide()
  auth.setUser('B')
  page.onShow()
  quote.resolve({ amountCents: 9900, billablePages: 99 })
  await flush()

  assert.notEqual(page.data.quoteState, 'ready', 'A 的报价不得对 B 显示成已就绪')
  assert.equal(page.data.quotePages, 0)
  assert.equal(page.data.quoteAmountText, '')
  assert.equal(page.data.draftState, 'missing')
})

test('package-create：createPackage 写出的草稿必须带本人归属与 draftId', () => {
  const auth = createAuth('A')
  const wx = createWx()
  const api = { getMyDocuments: () => Promise.resolve({ items: [] }) }
  const page = makePage('pages/package-create/package-create.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  page.setData({
    docs: [{ id: 'f-1', name: '我的简历.pdf', selected: true, needsPii: false, piiStatus: 'ready' }],
    selectedCount: 1, piiPhase: 'ready',
  })
  page.createPackage()

  const draft = wx.storage.get('temp_package_data')
  assert.ok(draft, '草稿必须写出')
  assert.equal(draft.ownerKey, 'u:A', '草稿必须绑定稳定的会员身份')
  assert.ok(draft.draftId && draft.draftId.indexOf('u:A') === 0, 'draftId 必须能追溯到本人')
  assert.equal(wx.storage.has('temp_selected_store'), false, '新草稿开始时必须清掉上一次选的服务点')
  assert.equal(wx.calls.navigateTo.length, 1)
})

test('store-select：只把服务点绑到本人的当前草稿上；草稿不属于本人时不写', () => {
  const auth = createAuth('A')
  const wx = createWx()
  const api = { getPublicTerminals: () => Promise.resolve([]) }
  const page = makePage('pages/store-select/store-select.js', { auth, api, wx })

  // ① 草稿是 B 的：本页必须判定为"没有可下单的材料包"，且不写服务点。
  wx.storage.set('temp_package_data', { ownerKey: 'u:B', draftId: 'u:B:1', files: [{ fileId: 'f-B' }] })
  page.onLoad()
  assert.equal(page.data.hasPackageData, false)
  page.setData({ stores: [{ id: 't-1', name: '东城服务点', address: 'x', isOnline: true }], selectedStore: 't-1' })
  page.confirmAndContinue()
  assert.equal(wx.storage.has('temp_selected_store'), false, '不得把服务点接到别人的草稿上')

  // ② 换成本人的草稿：正常写出，并且带上归属与 draftId。
  wx.storage.set('temp_package_data', { ownerKey: 'u:A', draftId: 'u:A:7', files: [{ fileId: 'f-A' }] })
  page.onShow()
  assert.equal(page.data.hasPackageData, true)
  page.confirmAndContinue()
  const store = wx.storage.get('temp_selected_store')
  assert.equal(store.id, 't-1')
  assert.equal(store.ownerKey, 'u:A')
  assert.equal(store.draftId, 'u:A:7')
})

// ══════════════════════════════════════════════════════════════════════
// E. 加载更多失败：已经看到的内容不得消失
// ══════════════════════════════════════════════════════════════════════

test('orders：材料包「加载更多」失败，已加载的订单必须原样留在屏幕上', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const firstPage = deferred(); const morePage = deferred()
  let call = 0
  const api = {
    getMyCloudPrintOrders: () => Promise.resolve([]),
    getMyPrintOrders: () => Promise.resolve([]),
    getPackageOrders: () => (++call === 1 ? firstPage.promise : morePage.promise),
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  firstPage.resolve({ items: [A_PACKAGE, { ...A_PACKAGE, id: 'pkg-2', orderNo: 'PKG-2' }], total: 5, nextCursor: 'c1' })
  await flush()
  assert.equal(page.data.pkgRows.length, 2)

  page.loadMorePackages()
  morePage.reject(Object.assign(new Error('boom'), { statusCode: 500 }))
  await flush()

  assert.equal(page.data.pkgRows.length, 2, '翻页失败不得清空已加载的订单')
  assert.equal(page.data.pkgState, 'ready', '翻页失败不得把整段换成错误态')
  assert.ok(page.data.pkgMoreErrorText, '翻页失败必须有一句看得见的说明')
  assert.equal(page.data.pkgLoadingMore, false)
})

test('orders：单件打印刷新失败，已加载的订单同样不得被清空', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let cloud = deferred()
  const api = {
    getMyCloudPrintOrders: () => cloud.promise,
    getMyPrintOrders: () => Promise.resolve([]),
    getPackageOrders: () => Promise.resolve({ items: [], total: 0 }),
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  cloud.resolve([A_ORDER])
  await flush()
  assert.equal(page.data.orders.length, 1)

  cloud = deferred()
  page.onPullDownRefresh()
  cloud.reject(Object.assign(new Error('boom'), { statusCode: 500 }))
  await flush()

  assert.equal(page.data.orders.length, 1, '刷新失败不得清空已有列表')
  assert.equal(page.data.filtered.length, 1)
  assert.ok(page.data.error, '刷新失败必须有一句看得见的说明')
})

test('package-create：文件列表翻页失败不得丢掉已经加载出来的文件', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const firstPage = deferred(); const morePage = deferred()
  let call = 0
  const api = { getMyDocuments: () => (++call === 1 ? firstPage.promise : morePage.promise) }
  const page = makePage('pages/package-create/package-create.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  firstPage.resolve({
    items: [{ id: 'f-1', filename: '简历.pdf', purpose: 'print_doc', sizeBytes: 10 }],
    nextCursor: 'c1',
  })
  await flush()
  assert.equal(page.data.docs.length, 1)

  page.loadMoreDocs()
  morePage.reject(Object.assign(new Error('boom'), { statusCode: 500 }))
  await flush()
  assert.equal(page.data.docs.length, 1, '翻页失败不得清空已加载的文件')
})
