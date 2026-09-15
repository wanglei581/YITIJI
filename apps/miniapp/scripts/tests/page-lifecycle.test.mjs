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

/** 假 canvas：让画码的 exec 回调能真的走到最后那句 `qrStatus: 'ready'`。 */
function fakeCanvasNode() {
  const ctx = { fillStyle: '', scale() {}, fillRect() {} }
  return { node: { width: 0, height: 0, getContext: () => ctx } }
}

/** 最小 wx 替身：只实现被测页面真正用到的那几个。storage 是一个普通 Map。 */
function createWx(storage = new Map()) {
  const calls = { navigateTo: [], redirectTo: [], showToast: [], showModal: [], switchTab: [], clipboard: [], qrExec: [] }
  // navFail=true 时 redirectTo / navigateTo 走 fail 回调（模拟跳转失败）。
  const control = { navFail: false }
  return {
    storage,
    calls,
    control,
    getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
    setStorageSync: (key, value) => { storage.set(key, value) },
    removeStorageSync: (key) => { storage.delete(key) },
    navigateTo: (opts) => {
      calls.navigateTo.push(opts.url)
      if (control.navFail) { if (opts.fail) opts.fail({ errMsg: 'navigateTo:fail' }); return }
      if (opts.success) opts.success()
    },
    redirectTo: (opts) => {
      calls.redirectTo.push(opts.url)
      if (control.navFail) { if (opts.fail) opts.fail({ errMsg: 'redirectTo:fail' }); return }
      if (opts.success) opts.success()
    },
    switchTab: (opts) => { calls.switchTab.push(opts.url) },
    navigateBack: (opts) => { if (opts && opts.fail) opts.fail({ errMsg: 'no page' }) },
    showToast: (opts) => { calls.showToast.push(opts.title) },
    showModal: (opts) => { calls.showModal.push(opts); if (opts && opts.success) opts.success({ confirm: false }) },
    showLoading: () => {},
    hideLoading: () => {},
    stopPullDownRefresh: () => {},
    setClipboardData: (opts) => { calls.clipboard.push(opts.data); if (opts.success) opts.success() },
    createSelectorQuery: () => ({
      in: () => ({
        select: () => ({
          fields: () => ({
            // exec 的回调不立即执行，交给测试决定什么时候跑（真机上它跨帧返回）。
            exec: (cb) => { calls.qrExec.push(cb) },
          }),
        }),
      }),
    }),
    getWindowInfo: () => ({ pixelRatio: 1 }),
  }
}

/** 可切换身份的 auth 替身。setUser(null) = 登出。 */
function createAuth(initialId) {
  let user = initialId ? { id: initialId } : null
  let loggedIn = !!user
  return {
    setUser(id) { user = id ? { id } : null; loggedIn = !!user },
    /** 登录态为真但 getUser() 拿不到 id —— request.js 静默续签后 user 字段缺失时的真实形态。 */
    setIdlessSession() { user = {}; loggedIn = true },
    isLoggedIn: () => loggedIn,
    getUser: () => user,
    logout() { user = null; loggedIn = false },
  }
}

/**
 * 在沙箱里真实执行一个页面源码，返回 Page() 收到的配置对象。
 * @param {string} relPath 相对 apps/miniapp 的路径
 */
function loadPageDefinition(relPath, { wx, modules, timers = [] }) {
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
    // 沙箱里的定时器**只登记不触发**。print-pickup 会每 3 秒轮询一次订单状态，
    // 用真的 setTimeout 会让这条链一直排下去，node:test 永远等不到事件循环清空
    // （实测：整个测试文件挂死，2 分钟超时）。测试要验的是回调里的判定，
    // 不是定时器本身，需要时由测试自己调 timers.run()。
    setTimeout: (fn) => { timers.push(fn); return timers.length },
    clearTimeout: () => {},
    setInterval: (fn) => { timers.push(fn); return timers.length },
    clearInterval: () => {},
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
  const timers = []
  const def = loadPageDefinition(relPath, { wx, modules: { api, auth }, timers })
  const page = instantiate(def)
  page._timers = timers
  return page
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

// ══════════════════════════════════════════════════════════════════════
// F. P0 打印参数：报价与建单必须发服务端 DTO 真正接受的取值
//
// 服务端两个 @IsIn 白名单：
//   报价 PrintJobParamsDto.duplex     ∈ simplex | duplex_long_edge | duplex_short_edge
//   建单 PackagePrintParamsDto.duplex ∈ single | simplex | duplex_long_edge | duplex_short_edge
// 两边都**没有** 'double'。此前两条链都原样发 'double'，双面材料包在报价那一步
// 就必然 400 —— 也就是说"双面"这个选项从来没有真正工作过。
// ══════════════════════════════════════════════════════════════════════

/** 服务端能接受的取值（两个 DTO 的交集）。测试只认这一份，不照实现抄。 */
const WIRE_DUPLEX_ACCEPTED = ['simplex', 'duplex_long_edge', 'duplex_short_edge']
const WIRE_COLOR_ACCEPTED = ['black_white', 'color']

function confirmPageWithDraft(wx, auth, api, { colorMode, duplex, copies }) {
  wx.storage.set('temp_package_data', {
    ownerKey: 'u:A', draftId: 'u:A|d1',
    files: [{ fileId: 'f-1', name: '简历.pdf' }],
    colorMode, duplex, copies,
  })
  wx.storage.set('temp_selected_store', { id: 't-1', name: '东城服务点', address: 'x', ownerKey: 'u:A', draftId: 'u:A|d1' })
  const page = makePage('pages/package-confirm/package-confirm.js', { auth, api, wx })
  page.onLoad()
  return page
}

test('P0 双面：报价与建单发出的 duplex 都在服务端白名单内，且两者逐字相同', async () => {
  for (const [uiDuplex, expected] of [['double', 'duplex_long_edge'], ['single', 'simplex']]) {
    const auth = createAuth('A')
    const wx = createWx()
    const quoteCalls = []; const createCalls = []
    const quote = deferred()
    const api = {
      quotePackageOrder: (payload) => { quoteCalls.push(payload); return quote.promise },
      createPackageOrder: (payload) => { createCalls.push(payload); return Promise.resolve({ orderId: 'o-1' }) },
    }
    const page = confirmPageWithDraft(wx, auth, api, { colorMode: 'bw', duplex: uiDuplex, copies: 1 })
    quote.resolve({ amountCents: 100, billablePages: 1 })
    await flush()
    assert.equal(page.data.quoteState, 'ready')

    assert.equal(quoteCalls.length, 1)
    assert.equal(quoteCalls[0].params.duplex, expected, `UI ${uiDuplex} → 报价应发 ${expected}`)
    assert.ok(WIRE_DUPLEX_ACCEPTED.includes(quoteCalls[0].params.duplex), '报价 duplex 必须在服务端白名单内')
    assert.ok(WIRE_COLOR_ACCEPTED.includes(quoteCalls[0].params.colorMode), '报价 colorMode 必须在服务端白名单内')

    page.setData({ agreedToTerms: true })
    page.submitOrder()
    await flush()
    assert.equal(createCalls.length, 1)
    assert.equal(createCalls[0].params.duplex, expected, `UI ${uiDuplex} → 建单应发 ${expected}`)
    assert.ok(WIRE_DUPLEX_ACCEPTED.includes(createCalls[0].params.duplex), '建单 duplex 必须在服务端白名单内')
    assert.ok(WIRE_COLOR_ACCEPTED.includes(createCalls[0].params.colorMode), '建单 colorMode 必须在服务端白名单内')
    assert.equal(createCalls[0].params.duplex, quoteCalls[0].params.duplex,
      '报价与建单必须是同一个取值，否则预览按一种参数算钱、出纸按另一种')
  }
})

test("P0 双面：'double' 一个字都不许出现在发给服务端的载荷里", async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const payloads = []
  const quote = deferred()
  const api = {
    quotePackageOrder: (p) => { payloads.push(p); return quote.promise },
    createPackageOrder: (p) => { payloads.push(p); return Promise.resolve({ orderId: 'o-1' }) },
  }
  const page = confirmPageWithDraft(wx, auth, api, { colorMode: 'color', duplex: 'double', copies: 3 })
  quote.resolve({ amountCents: 900, billablePages: 3 })
  await flush()
  page.setData({ agreedToTerms: true })
  page.submitOrder()
  await flush()
  assert.equal(payloads.length, 2)
  for (const payload of payloads) {
    assert.ok(!JSON.stringify(payload).includes('"double"'), '载荷里不得出现 UI 取值 double')
    assert.ok(!JSON.stringify(payload).includes('"bw"'), '载荷里不得出现 UI 取值 bw（报价 DTO 不接受）')
  }
})

// ══════════════════════════════════════════════════════════════════════
// G. P1-2 登录了但拿不到会员 id：一律 fail-closed
//
// 'u:' + (user.id || '') 会退化成 'u:' —— 一个所有 id 缺失会话**共享**的键。
// 共用设备上两个人先后遇到这种会话，第二个人会拿第一个人的 ownerKey 对上草稿。
// ══════════════════════════════════════════════════════════════════════

test('P1-2 无 id 会话：orders 不拉本人订单，按未登录渲染', async () => {
  const auth = createAuth('A')
  auth.setIdlessSession()
  const wx = createWx()
  let calls = 0
  const api = {
    getMyCloudPrintOrders: () => { calls++; return Promise.resolve([A_ORDER]) },
    getMyPrintOrders: () => { calls++; return Promise.resolve([]) },
    getPackageOrders: () => { calls++; return Promise.resolve({ items: [A_PACKAGE], total: 1 }) },
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  await flush()
  assert.equal(calls, 0, '身份不可用时一个本人数据请求都不许发')
  assert.equal(page.data.isLoggedIn, false, '按未登录渲染：用户的补救动作正是重新登录一次')
  assert.equal(page.data.orders.length, 0)
  assert.equal(page.data.pkgRows.length, 0)
})

test('P1-2 无 id 会话：package-confirm 不读草稿，不显示文件名', () => {
  const auth = createAuth('A')
  auth.setIdlessSession()
  const wx = createWx()
  seedDraft(wx, 'u:', 'u::1')       // 正是退化键写出来的那种草稿
  const api = { quotePackageOrder: () => { throw new Error('身份不可用时不该核价') } }
  const page = makePage('pages/package-confirm/package-confirm.js', { auth, api, wx })
  page.onLoad()
  assert.equal(page.data.draftState, 'missing')
  assert.equal(page.data.files.length, 0)
  assert.ok(!JSON.stringify(page.data).includes('A的体检报告'))
})

test('P1-2 无 id 会话：package-code 不显示到机码，且说清是登录状态不完整', async () => {
  const auth = createAuth('A')
  auth.setIdlessSession()
  const wx = createWx()
  let calls = 0
  const api = { getPackageOrder: () => { calls++; return Promise.resolve(A_PACKAGE) } }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  await flush()
  assert.equal(calls, 0, '身份不可用时不向服务端要订单')
  assert.equal(page.data.ready, false)
  assert.equal(page.data.pickupCode, '')
  assert.equal(page.data.loadErrorTitle, '登录状态不完整', '不能说成「请先登录」——用户会以为自己没登录')
  assert.equal(page.data.loadRecover, 'login')
})

test('P1-2 无 id 会话：package-create 不拉文件、不写草稿', () => {
  const auth = createAuth('A')
  auth.setIdlessSession()
  const wx = createWx()
  let calls = 0
  const api = { getMyDocuments: () => { calls++; return Promise.resolve({ items: [] }) } }
  const page = makePage('pages/package-create/package-create.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  assert.equal(calls, 0)
  assert.equal(page.data.isLoggedIn, false)
  page.setData({ docs: [{ id: 'f-1', name: 'x.pdf', selected: true, needsPii: false }], selectedCount: 1, piiPhase: 'ready' })
  page.createPackage()
  assert.equal(wx.storage.has('temp_package_data'), false, '身份不可用时不许写草稿')
  assert.equal(wx.calls.navigateTo[0], '/pages/launch/launch', '应当把人送去登录')
})

// ══════════════════════════════════════════════════════════════════════
// H. P1-3 首次进入 / 登录不是「换用户」，不许删本人的草稿
// ══════════════════════════════════════════════════════════════════════

test('P1-3 首次 onLoad→onShow：本人已有的草稿与服务点必须原样保留', () => {
  const auth = createAuth('A')
  const wx = createWx()
  seedDraft(wx, 'u:A', 'u:A|d1')
  const api = { getMyDocuments: () => Promise.resolve({ items: [] }) }
  const page = makePage('pages/package-create/package-create.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  assert.ok(wx.storage.has('temp_package_data'), '本人的草稿不得被自己的「首次进入」删掉')
  assert.ok(wx.storage.has('temp_selected_store'), '本人已选的服务点同样不得丢')
})

test('P1-3 未登录时进入、随后登录：本人草稿仍在（这不是换用户）', () => {
  const auth = createAuth(null)
  const wx = createWx()
  const api = { getMyDocuments: () => Promise.resolve({ items: [] }) }
  const page = makePage('pages/package-create/package-create.js', { auth, api, wx })
  page.onLoad()
  page.onShow()                       // 未登录：storage 里本来就没有草稿
  auth.setUser('A')
  seedDraft(wx, 'u:A', 'u:A|d1')      // 登录后本人做出了草稿
  page.onHide()
  page.onShow()                       // 从登录页回来
  assert.ok(wx.storage.has('temp_package_data'), '「未登录→本人」不是换人，不得清草稿')
})

test('P1-3 真的换了用户（A→B）：上一位的草稿与服务点必须清掉', () => {
  const auth = createAuth('A')
  const wx = createWx()
  seedDraft(wx, 'u:A', 'u:A|d1')
  const api = { getMyDocuments: () => Promise.resolve({ items: [] }) }
  const page = makePage('pages/package-create/package-create.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  page.onHide()
  auth.setUser('B')
  page.onShow()
  assert.equal(wx.storage.has('temp_package_data'), false)
  assert.equal(wx.storage.has('temp_selected_store'), false)
  assert.equal(page.data.docs.length, 0)
})

test('P1-3 别人的草稿即使没换人也要清掉（本机残留）', () => {
  const auth = createAuth('A')
  const wx = createWx()
  seedDraft(wx, 'u:B', 'u:B|d9')
  const api = { getMyDocuments: () => Promise.resolve({ items: [] }) }
  const page = makePage('pages/package-create/package-create.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  assert.equal(wx.storage.has('temp_package_data'), false, 'B 的草稿不该留给 A')
  assert.equal(wx.storage.has('temp_selected_store'), false)
})

test('P1-3 draftId 是内容指纹：选择没变则已选服务点不丢，变了则自动失效', () => {
  const auth = createAuth('A')
  const wx = createWx()
  const api = { getMyDocuments: () => Promise.resolve({ items: [] }) }
  const page = makePage('pages/package-create/package-create.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  const docs = [
    { id: 'f-1', name: 'a.pdf', selected: true, needsPii: false, piiStatus: 'ready' },
    { id: 'f-2', name: 'b.pdf', selected: false, needsPii: false, piiStatus: 'ready' },
  ]
  page.setData({ docs, selectedCount: 1, piiPhase: 'ready' })
  page.createPackage()
  const first = wx.storage.get('temp_package_data').draftId
  // 用户在服务点页选了一台机器
  wx.storage.set('temp_selected_store', { id: 't-1', name: 'S', address: 'x', ownerKey: 'u:A', draftId: first })

  // ① 退回来什么都没改，再按一次「继续」：指纹不变 → 服务点必须还在
  page.createPackage()
  assert.equal(wx.storage.get('temp_package_data').draftId, first, '内容没变就该是同一份草稿')
  assert.ok(wx.storage.has('temp_selected_store'), '没改任何东西却要重选服务点，是能力退化')

  // ② 加勾一个文件：指纹变了 → 旧的服务点绑定必须失效
  page.setData({ docs: docs.map((d) => ({ ...d, selected: true })), selectedCount: 2 })
  page.createPackage()
  assert.notEqual(wx.storage.get('temp_package_data').draftId, first, '换了文件就是另一份草稿')
  assert.equal(wx.storage.has('temp_selected_store'), false, '上一份草稿选的机器不得接到这一份上')
})

// ══════════════════════════════════════════════════════════════════════
// I. P1-4 建单成功之后：不删别人的草稿、不卡在提交中、不重复下单
// ══════════════════════════════════════════════════════════════════════

test('P1-4 跳转失败：不得卡在「提交中」，也不得让已创建的订单找不回来', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const quote = deferred()
  let creates = 0
  const api = {
    quotePackageOrder: () => quote.promise,
    createPackageOrder: () => { creates++; return Promise.resolve({ orderId: 'o-77' }) },
  }
  const page = confirmPageWithDraft(wx, auth, api, { colorMode: 'bw', duplex: 'single', copies: 1 })
  quote.resolve({ amountCents: 100, billablePages: 1 })
  await flush()
  page.setData({ agreedToTerms: true })

  wx.control.navFail = true          // redirectTo 跳不过去
  page.submitOrder()
  await flush()

  assert.equal(creates, 1)
  assert.equal(page.data.submitting, false, '订单已经建好了，不能永远停在「提交中…」')
  assert.ok(/订单已创建/.test(page.data.quoteErrorTitle), '必须如实说「订单已创建」')
  assert.equal(page.data.quoteRecover, 'orders', '必须给出找回这张订单的出口')
  assert.notEqual(page.data.quoteState, 'ready', '「确认下单」必须变灰，防止再下一单')

  // 再点一次「确认下单」：绝不许再 POST（服务端没有幂等键，那就是第二张订单）
  page.submitOrder()
  await flush()
  assert.equal(creates, 1, '跳转失败后重复点击不得再次建单')
})

test('P1-4 在途建单遇到换用户：不得删掉当前这位的草稿', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const quote = deferred(); const create = deferred()
  const api = { quotePackageOrder: () => quote.promise, createPackageOrder: () => create.promise }
  const page = confirmPageWithDraft(wx, auth, api, { colorMode: 'bw', duplex: 'single', copies: 1 })
  quote.resolve({ amountCents: 100, billablePages: 1 })
  await flush()
  page.setData({ agreedToTerms: true })
  page.submitOrder()

  // 建单在途时换成 B，并且 B 已经做好了自己的草稿
  auth.setUser('B')
  wx.storage.set('temp_package_data', { ownerKey: 'u:B', draftId: 'u:B|d1', files: [{ fileId: 'fb', name: 'B的简历.pdf' }] })
  wx.storage.set('temp_selected_store', { id: 't-2', name: 'SB', address: 'y', ownerKey: 'u:B', draftId: 'u:B|d1' })
  create.resolve({ orderId: 'o-88' })
  await flush()

  const draft = wx.storage.get('temp_package_data')
  assert.ok(draft && draft.ownerKey === 'u:B', 'A 的建单结果不得删掉 B 的草稿')
  assert.ok(wx.storage.has('temp_selected_store'), 'B 选的服务点同样不得被删')
  assert.equal(wx.calls.redirectTo.length, 0, '不得把 A 的 orderId 推给 B')
})

test('P1-4 本人建单成功：草稿被消费掉，并跳到只带 orderId 的到机码页', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const quote = deferred()
  const api = {
    quotePackageOrder: () => quote.promise,
    createPackageOrder: () => Promise.resolve({ orderId: 'o-99' }),
  }
  const page = confirmPageWithDraft(wx, auth, api, { colorMode: 'bw', duplex: 'single', copies: 1 })
  quote.resolve({ amountCents: 100, billablePages: 1 })
  await flush()
  page.setData({ agreedToTerms: true })
  page.submitOrder()
  await flush()
  assert.equal(wx.storage.has('temp_package_data'), false)
  assert.equal(wx.storage.has('temp_selected_store'), false)
  assert.equal(wx.calls.redirectTo.length, 1)
  assert.equal(wx.calls.redirectTo[0], '/pages/package-code/package-code?orderId=o-99')
  for (const field of ['pickupCode', 'amountCents', 'expiresAt', 'paymentSessionToken']) {
    assert.ok(!wx.calls.redirectTo[0].includes(field), `跳转 URL 不得携带 ${field}`)
  }
})

// ══════════════════════════════════════════════════════════════════════
// J. P1-5 前台静默登出 / 换账号：已经渲染出来的码必须当场清掉
// ══════════════════════════════════════════════════════════════════════

test('P1-5 成功渲染后前台登出（没有 onHide）：到机码必须当场清掉', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let pending = deferred()
  const api = { getPackageOrder: () => pending.promise }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  pending.resolve(A_PACKAGE)
  await flush()
  assert.equal(page.data.ready, true)
  assert.equal(page.data.pickupCode, '87-65-43-21')

  // request.js 静默续签最终失败会 auth.logout()：页面还在前台，没有任何生命周期回调。
  auth.logout()
  pending = deferred()
  page.retryLoad()                 // 用户在前台点了「重新加载」

  assert.equal(page.data.pickupCode, '', '登出后屏幕上那张码必须消失')
  assert.equal(page.data.ready, false)
  assert.ok(!page._codeRaw, '画码用的明文副本同样要清')
  assert.equal(page.data.loadRecover, 'login')
  assert.ok(!JSON.stringify(page.data).includes('87654321'))
})

test('P1-5 成功渲染后前台换账号：码清掉，并指向「我的打印订单」', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const pending = deferred()
  const api = { getPackageOrder: () => pending.promise }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  pending.resolve(A_PACKAGE)
  await flush()
  assert.equal(page.data.ready, true)

  auth.setUser('B')
  page.retryLoad()
  assert.equal(page.data.pickupCode, '')
  assert.equal(page.data.ready, false)
  assert.equal(page.data.loadErrorTitle, '账号已切换')
  assert.equal(page.data.loadRecover, 'orders')
})

test('P1-5 重新加载开始时，不得同时显示旧的成功块与 loading', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let pending = deferred()
  const api = { getPackageOrder: () => pending.promise }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  pending.resolve(A_PACKAGE)
  await flush()
  assert.equal(page.data.ready, true)

  pending = deferred()
  page.retryLoad()
  // 模板里 loading 块与 ready 成功块是两个独立的 wx:if，不是 if/elif 链。
  assert.equal(page.data.loading, true)
  assert.equal(page.data.ready, false, 'ready 与 loading 不得同时为真')
})

test('P1-9 二维码：exec 回调迟到时，不得把旧码的画布说成新码已就绪', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let pending = deferred()
  const api = { getPackageOrder: () => pending.promise }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onReady()
  page.onShow()
  pending.resolve(A_PACKAGE)
  await flush()
  assert.equal(wx.calls.qrExec.length, 1, '应当发起过一次画码')
  const staleExec = wx.calls.qrExec[0]

  // 第二轮取到了另一张码
  pending = deferred()
  page.retryLoad()
  pending.resolve({ ...A_PACKAGE, pickupCode: '11112222' })
  await flush()
  assert.equal(page.data.pickupCode, '11-11-22-22')

  page.setData({ qrStatus: 'loading' })
  staleExec([{ node: null }])        // 上一轮那个回调这时才回来
  assert.notEqual(page.data.qrStatus, 'error', '旧回调不得改写新码的画码状态')
  assert.notEqual(page.data.qrStatus, 'ready')
})

test('P1-9 复制到机码：复制服务端真正比对的原始串，不是屏幕上的分组形式', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const pending = deferred()
  const api = { getPackageOrder: () => pending.promise }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  pending.resolve(A_PACKAGE)
  await flush()
  page.copyCode()
  // 服务端 pickup-order.service.claim 只做 trim().toUpperCase()，**不去分隔符**，
  // 带横杠的串算出来的 hash 对不上任何订单。
  assert.equal(wx.calls.clipboard[0], '87654321')
  assert.ok(!wx.calls.clipboard[0].includes('-'))
})

// ══════════════════════════════════════════════════════════════════════
// K. P1-6 文件列表翻页失败：UI 状态必须仍然是「有内容」
// ══════════════════════════════════════════════════════════════════════

test('P1-6 翻页失败：docState 必须留在 ready，错误只进页脚', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const firstPage = deferred(); const morePage = deferred()
  let call = 0
  const api = { getMyDocuments: () => (++call === 1 ? firstPage.promise : morePage.promise) }
  const page = makePage('pages/package-create/package-create.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  firstPage.resolve({ items: [{ id: 'f-1', filename: '简历.pdf', purpose: 'print_doc', sizeBytes: 10 }], nextCursor: 'c1' })
  await flush()
  page.setData({ docs: page.data.docs.map((d) => ({ ...d, selected: true })) })

  page.loadMoreDocs()
  morePage.reject(Object.assign(new Error('boom'), { statusCode: 500 }))
  await flush()

  assert.equal(page.data.docState, 'ready', "docState 变成 error 会让模板把整段文件列表换成错误卡片")
  assert.equal(page.data.docs.length, 1)
  assert.equal(page.data.docs[0].selected, true, '用户勾好的选择不得被翻页失败清掉')
  assert.ok(page.data.docMoreErrorText, '翻页失败必须有一句看得见的说明')
  assert.equal(page.data.docLoadingMore, false)
})

test('P1-6 翻页在途时切后台再回来：docLoadingMore 不得卡住', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const firstPage = deferred(); const morePage = deferred()
  let call = 0
  const api = { getMyDocuments: () => { call++; return call === 1 ? firstPage.promise : morePage.promise } }
  const page = makePage('pages/package-create/package-create.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  firstPage.resolve({ items: [{ id: 'f-1', filename: '简历.pdf', purpose: 'print_doc', sizeBytes: 10 }], nextCursor: 'c1' })
  await flush()
  page.loadMoreDocs()
  assert.equal(page.data.docLoadingMore, true)

  page.onHide()
  page.onShow()
  morePage.resolve({ items: [] })
  await flush()
  assert.equal(page.data.docLoadingMore, false, '按钮锁必须解开，否则「加载更多」永远点不动')
})

// ══════════════════════════════════════════════════════════════════════
// L. P1-7 单件取件：凭证不进 URL
// ══════════════════════════════════════════════════════════════════════

test('P1-7 orders 进取件页只带 orderId，凭证与金额一个都不进 URL', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const api = {
    getMyCloudPrintOrders: () => Promise.resolve([A_ORDER]),
    getMyPrintOrders: () => Promise.resolve([]),
    getPackageOrders: () => Promise.resolve({ items: [], total: 0 }),
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  await flush()
  const row = page.data.filtered[0]
  assert.equal(row.action, 'pickup')
  page.primary({ currentTarget: { dataset: { id: row.id } } })

  const url = wx.calls.navigateTo[0]
  assert.ok(url.indexOf('/pages/print-pickup/print-pickup?orderId=') === 0, url)
  for (const field of ['pickupCode', 'amountCents', 'expiresAt', 'taskStatus', 'orderNo', 'paymentSessionToken']) {
    assert.ok(!url.includes(field), `取件页 URL 不得携带 ${field}`)
  }
  assert.ok(!url.includes('12345678'), '到机码明文绝不进 URL')
})

test('P1-7 print-pickup 只认服务端：URL 里塞的码不得被渲染', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const detail = deferred()
  const api = { getCloudPrintOrder: () => detail.promise }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  // 构造出来的链接：带一个别人的真码
  page.onLoad({ orderId: 'ord-A', pickupCode: '99998888', amountCents: '0', expiresAt: '2030-01-01T00:00:00.000Z' })
  assert.equal(page.data.codeRaw, '', 'URL 里的码一个字节都不许进 data')
  assert.equal(page.data.code, '')
  assert.equal(page.data.showQr, false)
  assert.equal(page.data.amountCents, null, 'URL 里的金额同样不作数')

  detail.resolve({ orderNo: 'NO-A', pickupStatus: 'pending', taskStatus: '', pickupCode: '12345678', amountCents: 100 })
  await flush()
  assert.equal(page.data.codeRaw, '12345678', '只认服务端给的码')
  assert.equal(page.data.state, 'ready')
})

test('P1-7 print-pickup 首次请求失败：不得退回 URL 里的码，诚实进错误态', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const detail = deferred()
  const api = { getCloudPrintOrder: () => detail.promise }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A', pickupCode: '99998888' })
  detail.reject(Object.assign(new Error('boom'), { statusCode: 500 }))
  await flush()
  assert.equal(page.data.state, 'error')
  assert.equal(page.data.codeRaw, '')
  assert.equal(page.data.showQr, false)
})

test('P1-7 print-pickup 前台登出：屏幕上那张码必须当场清掉', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let detail = deferred()
  const api = { getCloudPrintOrder: () => detail.promise }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  detail.resolve({ orderNo: 'NO-A', pickupStatus: 'pending', taskStatus: '', pickupCode: '12345678', amountCents: 100 })
  await flush()
  assert.equal(page.data.codeRaw, '12345678')

  auth.logout()
  detail = deferred()
  page.onShow()
  assert.equal(page.data.codeRaw, '', '登出后不得继续显示到机码')
  assert.equal(page.data.showQr, false)
  assert.equal(page.data.state, 'error')
})

// ══════════════════════════════════════════════════════════════════════
// M. P1-8 守卫不得制造解不开的锁
// ══════════════════════════════════════════════════════════════════════

test('P1-8 取消在途时切后台：这一行不得永远停在「取消中…」', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const cancel = deferred()
  const api = {
    getMyCloudPrintOrders: () => Promise.resolve([A_ORDER]),
    getMyPrintOrders: () => Promise.resolve([]),
    getPackageOrders: () => Promise.resolve({ items: [], total: 0 }),
    cancelCloudPrintOrder: () => cancel.promise,
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  await flush()
  page._submitCancel('ord-A')
  assert.equal(page.data.orders[0].cancelling, true)

  page.onHide()
  cancel.reject(Object.assign(new Error('boom'), { statusCode: 500 }))
  await flush()
  assert.equal(page.data.orders[0].cancelling, false, '取消失败必须解锁，否则这一行永远是「取消中…」')
})

// ══════════════════════════════════════════════════════════════════════
// N. P1-9 首次进入不得重复报价 / 服务点列表 latest-wins
// ══════════════════════════════════════════════════════════════════════

test('P1-9 package-confirm 首次 onLoad+onShow 只报一次价', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let calls = 0
  const quote = deferred()
  const api = { quotePackageOrder: () => { calls++; return quote.promise } }
  const page = confirmPageWithDraft(wx, auth, api, { colorMode: 'bw', duplex: 'single', copies: 1 })
  page.onShow()
  assert.equal(calls, 1, 'onLoad 已经发过一次；紧随其后的 onShow 不得再发一次')
  quote.resolve({ amountCents: 100, billablePages: 1 })
  await flush()
  assert.equal(page.data.quoteState, 'ready')
  assert.equal(calls, 1)
})

test('P1-9 package-confirm 切后台作废报价后回来，必须重发一次', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let calls = 0
  let quote = deferred()
  const api = { quotePackageOrder: () => { calls++; return quote.promise } }
  const page = confirmPageWithDraft(wx, auth, api, { colorMode: 'bw', duplex: 'single', copies: 1 })
  assert.equal(calls, 1)
  page.onHide()
  quote = deferred()
  page.onShow()
  assert.equal(calls, 2, '在途那次已被作废，不重发页面会永远停在「正在核价」')
  quote.resolve({ amountCents: 100, billablePages: 1 })
  await flush()
  assert.equal(page.data.quoteState, 'ready')
})

test('P1-9 store-select 列表乱序返回：旧响应不得盖掉新结果', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const first = deferred(); const second = deferred()
  let call = 0
  const api = { getPublicTerminals: () => (++call === 1 ? first.promise : second.promise) }
  const page = makePage('pages/store-select/store-select.js', { auth, api, wx })
  page.onLoad()
  page.retryStores()
  second.resolve([{ id: 't-new', displayName: '新结果', isOnline: true }])
  await flush()
  assert.equal(page.data.stores[0].id, 't-new')
  first.resolve([{ id: 't-old', displayName: '旧结果', isOnline: true }])
  await flush()
  assert.equal(page.data.stores.length, 1)
  assert.equal(page.data.stores[0].id, 't-new', '旧响应不得覆盖新结果')
})

// ══════════════════════════════════════════════════════════════════════
// O. P1-10 协议同意默认不勾选
// ══════════════════════════════════════════════════════════════════════

test('P1-10 《打印服务协议》默认不勾选，不勾不许下单', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const quote = deferred()
  let creates = 0
  const api = {
    quotePackageOrder: () => quote.promise,
    createPackageOrder: () => { creates++; return Promise.resolve({ orderId: 'o-1' }) },
  }
  const page = confirmPageWithDraft(wx, auth, api, { colorMode: 'bw', duplex: 'single', copies: 1 })
  quote.resolve({ amountCents: 100, billablePages: 1 })
  await flush()
  assert.equal(page.data.agreedToTerms, false, '法律文件的同意不得预先替用户勾上')

  page.submitOrder()
  await flush()
  assert.equal(creates, 0, '没勾同意就不许建单')
  assert.ok(wx.calls.showToast.some((t) => /同意/.test(t)))

  page.toggleAgreement({ detail: { value: ['agreed'] } })
  assert.equal(page.data.agreedToTerms, true)
  page.submitOrder()
  await flush()
  assert.equal(creates, 1)
})

// ══════════════════════════════════════════════════════════════════════
// P. P1-11 守卫自身的代次语义（删掉 +1 就必须红）
// ══════════════════════════════════════════════════════════════════════

test('P1-11 deactivate 必须 +1 代次：切后台期间发出的响应，回前台后仍然进不来', () => {
  const guard = requireMiniapp('../utils/page-guard.js').createLifecycleGuard()
  guard.activate()
  guard.setIdentity('u:A')
  const token = guard.issue('c')
  assert.equal(guard.accepts(token, 'u:A'), true)

  guard.deactivate()
  guard.activate()          // 回到前台，但**没有**重新发起请求
  assert.equal(guard.accepts(token, 'u:A'), false,
    'deactivate 只置 active=false 而不 +1 代次的话，这条在途响应回前台后就又"合法"了')
})

test('P1-11 setIdentity 变化必须 +1 代次：上一位在途的请求当场作废', () => {
  const guard = requireMiniapp('../utils/page-guard.js').createLifecycleGuard()
  guard.activate()
  guard.setIdentity('u:A')
  const token = guard.issue('c')
  guard.setIdentity('u:B')
  assert.equal(guard.accepts(token), false, '换人后连不带身份参数的判定也必须拒绝')
})

test('P1-11 身份三态：登录但无 id 不得与未登录、也不得与任何人相等', () => {
  const mod = requireMiniapp('../utils/page-guard.js')
  const mk = (loggedIn, user) => ({ isLoggedIn: () => loggedIn, getUser: () => user })
  assert.equal(mod.memberIdentityKey(mk(false, null)), '')
  assert.equal(mod.memberIdentityKey(mk(true, {})), mod.IDENTITY_UNUSABLE)
  assert.equal(mod.memberIdentityKey(mk(true, { id: '' })), mod.IDENTITY_UNUSABLE)
  assert.equal(mod.memberIdentityKey(mk(true, { id: 'A' })), 'u:A')
  assert.equal(mod.isMemberIdentity(''), false)
  assert.equal(mod.isMemberIdentity(mod.IDENTITY_UNUSABLE), false)
  assert.equal(mod.isMemberIdentity('u:'), false, "'u:' 是 id 缺失时的退化键，绝不能算有效身份")
  assert.equal(mod.isMemberIdentity('u:A'), true)
})

test('P1-5 在途响应遇到前台静默登出：走 _accepts 那条路也必须清场', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let pending = deferred()
  const api = { getPackageOrder: () => pending.promise }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  pending.resolve(A_PACKAGE)
  await flush()
  assert.equal(page.data.pickupCode, '87-65-43-21')

  // 再发一次请求（用户下拉/重试），在它回来之前 request.js 的续签最终失败 → auth.logout()。
  // 这条路径没有任何生命周期回调，清场只能发生在响应回调的身份判定里。
  pending = deferred()
  page.loadOrder()
  auth.logout()
  pending.resolve(A_PACKAGE)
  await flush()

  assert.equal(page.data.pickupCode, '', '前台静默登出后，响应回调必须清掉屏幕上的码')
  assert.equal(page.data.ready, false)
  assert.ok(!page._codeRaw)
  assert.ok(!JSON.stringify(page.data).includes('87654321'))
})

test('P1-9 画码：进入异步后码被换掉，旧 exec 回调不得把画布标成 ready', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const pending = deferred()
  const api = { getPackageOrder: () => pending.promise }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onReady()
  page.onShow()
  pending.resolve(A_PACKAGE)
  await flush()
  assert.equal(wx.calls.qrExec.length, 1)
  const staleExec = wx.calls.qrExec[0]

  // exec 还没回来，这张码已经被换成另一张（真机上核销后重取就是这样）。
  // 此时旧回调若照画，用户看到的是一张作废的码，而状态写着"已就绪"。
  page._codeRaw = '11112222'
  page.setData({ pickupCode: '11-11-22-22', qrStatus: 'loading' })
  staleExec([fakeCanvasNode()])
  assert.notEqual(page.data.qrStatus, 'ready', '旧回调画的是旧码，不得标成新码已就绪')
})
