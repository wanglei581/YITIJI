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
import test, { mock } from 'node:test'
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
  const calls = { navigateTo: [], redirectTo: [], showToast: [], showModal: [], switchTab: [], clipboard: [], qrExec: [], showLoading: [], hideLoading: [], getRandomValues: [] }
  // wx.showLoading / hideLoading 不是栈：hideLoading 无条件掀掉当前那一张遮罩，
  // 不管它是谁挂上去的。所以替身用一个布尔记"现在屏幕上有没有遮罩"——
  // 这正是 A 的迟到回调能掀掉 B 的遮罩那个缺陷的形状。
  const loading = { visible: false }
  // 每个 wx 替身一条独立的随机序列。
  const randomSeed = { n: 0 }
  // navFail=true 时 redirectTo / navigateTo 走 fail 回调（模拟跳转失败）。
  const control = { navFail: false }
  return {
    storage,
    calls,
    control,
    loading,
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
    showLoading: (opts) => { calls.showLoading.push((opts && opts.title) || ''); loading.visible = true },
    hideLoading: () => { calls.hideLoading.push(1); loading.visible = false },
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
    // wx.getRandomValues 是异步的（只有回调形态，没有同步版）。替身按调用序号灌字节，
    // 于是每次 mint 出来的 UUID 都不同 —— "复用了同一个键"和"又铸了一个新键"
    // 在断言里才分得开。**不是** Math.random：被测代码里也不许有。
    getRandomValues: (opts) => {
      const length = (opts && opts.length) || 16
      randomSeed.n += 1
      const bytes = new Uint8Array(length)
      for (let i = 0; i < length; i += 1) bytes[i] = (randomSeed.n * 37 + i * 11) & 0xff
      calls.getRandomValues.push(length)
      if (opts && opts.success) opts.success({ randomValues: bytes.buffer })
    },
  }
}

/** 可切换身份的 auth 替身。setUser(null) = 登出。 */
function createAuth(initialId) {
  let user = initialId ? { id: initialId } : null
  let loggedIn = !!user
  // 补签资格与「当前有没有 token」解耦，和 utils/auth.js 一样：
  // JWT 自然过期时 getToken() 会先 clearSession 再返回 null，于是「过期」与「登出」
  // 在 token 维度上完全同形；只有这面独立的旗子能把两者分开。
  let resigninEligible = !!user
  return {
    setUser(id) { user = id ? { id } : null; loggedIn = !!user; if (id) resigninEligible = true },
    /** 登录态为真但 getUser() 拿不到 id —— request.js 静默续签后 user 字段缺失时的真实形态。 */
    setIdlessSession() { user = {}; loggedIn = true },
    /** JWT 自然过期：本地没有可用会话了，但没主动登出，仍可静默补签。 */
    expireToken() { user = null; loggedIn = false; resigninEligible = true },
    setResigninEligible(v) { resigninEligible = !!v },
    canSilentResignin: () => resigninEligible,
    isLoggedIn: () => loggedIn,
    getUser: () => user,
    logout() { user = null; loggedIn = false; resigninEligible = false },
  }
}

// ── 真实 auth：用真 JWT 跑 utils/auth.js 里那一步破坏性的过期清理 ─────────
//
// R5 这一批缺陷的成因全在 utils/auth.js 的一个真实副作用里：`getToken()` 发现 JWT
// 过期会**先 `clearSession()`（token 与 user 一起清）再返回 null**。上面那个 auth 替身
// 没有这一步 —— 「自然过期」只能靠 `expireToken()` 手工摆出来，摆得对不对全凭写测试的
// 人对生产代码的理解。R4 摆出来的那一种（快照与当前身份**相等**）恰好绕开了缺陷，
// 于是门禁全绿而缺陷还在。所以这一组一律换成真的那一份：真 JWT、真 storage
//（就是沙箱 wx 的那个 Map）、真 clearSession、真 RESIGNIN_ELIGIBLE。
//
// utils/storage.js 读的是**全局** wx，而页面读的是自己沙箱里的 wx。两边必须是同一个
// 对象，否则真 auth 写进去的会话页面看不见。这里用一个 getter 把全局 wx 转发到当前
// 这条测试的沙箱 wx 上（node:test 顶层用例串行执行，不会互相串台）。
let ACTIVE_WX = null
Object.defineProperty(globalThis, 'wx', { get: () => ACTIVE_WX, configurable: true })
const realAuth = requireMiniapp('../utils/auth.js')
const realStorage = requireMiniapp('../utils/storage.js')

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** 一张只有 exp 有意义的 JWT —— utils/auth.js 只解 payload.exp。 */
function jwt(expiresAtMs) {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'member', exp: Math.floor(expiresAtMs / 1000) })}.sig`
}

/** enduser JWT 的真实时长：member-print-orders.module.ts 签发 expiresIn:'30m'。 */
const JWT_TTL_MS = 30 * 60 * 1000

/** 把全局 wx 接到这条测试的沙箱上，并用**真** auth 建一个本人会话。 */
function useRealAuth(wx, id) {
  ACTIVE_WX = wx
  wx.storage.clear()
  realAuth.saveSession({ token: jwt(Date.now() + JWT_TTL_MS), user: { id } })
  return realAuth
}

/**
 * JWT **自然过期**：只把 token 换成一张过期的，user 与 RESIGNIN_ELIGIBLE 都不动。
 * 下一次 `auth.getToken()` 会自己触发 `clearSession()` —— 那正是被测的那一步。
 * 与 `realAuth.logout()`（主动登出，连补签资格一起撤销）是两件完全不同的事。
 */
function expireNaturally(wx) {
  wx.storage.set(realStorage.KEYS.TOKEN, jwt(Date.now() - 60 * 1000))
}

/** 真实的换账号：先登出（撤销补签资格），再登一个别人。 */
function switchAccount(id) {
  realAuth.logout()
  realAuth.saveSession({ token: jwt(Date.now() + JWT_TTL_MS), user: { id } })
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

/**
 * 写一个带路径的 setData 键，例如 `'fee.total'` / `'files[0].name'`。
 * 真机 setData 支持这种写法；替身若只做 Object.assign，就会在 data 上造出一个
 * **名字里带点的普通键**，页面读 `data.fee.total` 永远是旧值 —— 测试会把一个
 * 好端端的实现判成"金额没写进去"。
 */
function setByPath(target, path, value) {
  const keys = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cursor = target
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i]
    if (cursor[key] === null || typeof cursor[key] !== 'object') {
      cursor[key] = /^\d+$/.test(keys[i + 1]) ? [] : {}
    }
    cursor = cursor[key]
  }
  cursor[keys[keys.length - 1]] = value
}

/** Page 配置 → 可调用的页面实例（带一个真会合并的 setData）。 */
function instantiate(def) {
  const page = Object.assign(Object.create(null), def)
  page.data = JSON.parse(JSON.stringify(def.data || {}))
  page.setData = function setData(patch, callback) {
    for (const key of Object.keys(patch || {})) {
      if (key.indexOf('.') >= 0 || key.indexOf('[') >= 0) setByPath(this.data, key, patch[key])
      else this.data[key] = patch[key]
    }
    if (typeof callback === 'function') callback()
  }
  return page
}

function makePage(relPath, { auth, api, wx }) {
  // 真机上只有**一个**全局 wx，页面和 utils 共用它。替身必须照做：
  // utils/storage.js、utils/print-order-idempotency.js 走的是 globalThis.wx，
  // 而页面走的是沙箱 wx —— 两者不是同一个对象的话，工具模块会读到一个空的
  // （或上一条测试遗留的）存储，随机数能力也会凭空消失。
  ACTIVE_WX = wx
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

// ══════════════════════════════════════════════════════════════════════
// Q. R4-1 print-pickup：身份不可用不得永久 loading；可补签态必须放行真实请求
//
// 修的是把四种处境压成一个布尔的那段判定：未登录 / 无会员 id / JWT 过期 / 换了人，
// 此前统统落到「与快照一致 → 不算换人 → 返回 false → 直接 return」，
// 而 state 原地停在 'loading'。用户看到的是一页永远转不完的「正在读取订单实时状态…」：
// 既没有请求在跑，也没有任何出口。
// ══════════════════════════════════════════════════════════════════════

test('R4-1 未登录且无补签资格打开取件页：不得停在 loading，要给登录出口', async () => {
  const auth = createAuth(null)
  auth.setResigninEligible(false)
  const wx = createWx()
  const calls = []
  const api = { getCloudPrintOrder: (id) => { calls.push(id); return deferred().promise } }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  await flush()

  assert.notEqual(page.data.state, 'loading', '未登录时不得把页面永久停在 loading')
  assert.equal(page.data.state, 'error')
  assert.equal(page.data.errorAction, 'login', '必须给出「去登录」这个真正有效的下一步')
  assert.equal(calls.length, 0, '没有可用身份时不发本人订单请求')
  assert.equal(page.data.codeRaw, '')
})

test('R4-1 登录了却拿不到会员 id：同样不得停在 loading，且不显示任何码', async () => {
  const auth = createAuth(null)
  auth.setIdlessSession()
  auth.setResigninEligible(false)
  const wx = createWx()
  const calls = []
  const api = { getCloudPrintOrder: (id) => { calls.push(id); return deferred().promise } }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  await flush()

  assert.equal(page.data.state, 'error')
  assert.equal(page.data.errorAction, 'login')
  assert.equal(calls.length, 0)
  // 「登录状态不完整」和「请先登录」是两句话：后者会让一个明明登录着的人反复确认自己登录了。
  assert.ok(page.data.errorMsg.includes('会员标识'), page.data.errorMsg)
})

test('R4-1 JWT 过期但可补签：请求必须真的发出去（交给 request.js 静默续签）', async () => {
  const auth = createAuth('A')
  auth.expireToken()            // 本地 token 没了，但没主动登出
  const wx = createWx()
  const detail = deferred()
  const calls = []
  const api = { getCloudPrintOrder: (id) => { calls.push(id); return detail.promise } }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })

  assert.equal(calls.length, 1, '可补签态必须放行真实请求，不能在本页先把它拦下来')
  assert.equal(page.data.state, 'loading')

  // request.js 补签成功 → auth.saveSession 写回带 id 的会话，然后重发拿到响应。
  auth.setUser('A')
  detail.resolve({ orderNo: 'NO-A', pickupStatus: 'pending', taskStatus: '', pickupCode: '12345678', amountCents: 100 })
  await flush()

  assert.equal(page.data.state, 'ready', '补签救回来的响应必须能写进来')
  assert.equal(page.data.codeRaw, '12345678')
  assert.notEqual(page.data.errorAction, 'login')
  assert.ok(!String(page.data.errorMsg).includes('不是同一个'), '补签成功不是换人，不得说成换了账号')
})

test('R4-1 补签也没救回来（401）：当场清码并指向登录', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let detail = deferred()
  const api = { getCloudPrintOrder: () => detail.promise }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  detail.resolve({ orderNo: 'NO-A', pickupStatus: 'pending', taskStatus: '', pickupCode: '12345678', amountCents: 100 })
  await flush()
  assert.equal(page.data.codeRaw, '12345678')

  // request.js 续签失败会 auth.logout()，随后把原始 401 抛给页面。
  detail = deferred()
  page._polling = false
  auth.logout()
  page._refreshOrder(false)
  detail.reject(Object.assign(new Error('unauthorized'), { statusCode: 401 }))
  await flush()

  assert.equal(page.data.codeRaw, '', '401 之后屏幕上那张码必须当场清掉')
  assert.equal(page.data.showQr, false)
  assert.equal(page.data.expiresAt, 0, '有效期是码的派生物，要一起清')
  assert.equal(page.data.state, 'error')
  assert.equal(page.data.errorAction, 'login')
})

test('R4-1 在途响应遇到前台换账号：一个字都不许写进来，并当场清场', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const detail = deferred()
  const api = { getCloudPrintOrder: () => detail.promise }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  auth.setUser('B')             // 没有经过任何生命周期回调
  detail.resolve({ orderNo: 'NO-A', pickupStatus: 'pending', taskStatus: '', pickupCode: '12345678', amountCents: 100 })
  await flush()

  assert.equal(page.data.codeRaw, '', 'A 的码不得渲染给 B')
  assert.ok(!JSON.stringify(page.data).includes('12345678'))
  assert.equal(page.data.state, 'error')
  assert.equal(page.data.errorAction, 'orders')
})

// ══════════════════════════════════════════════════════════════════════
// R. R4-8 print-pickup：核销 / 失联之后不得继续显示旧码与旧有效期
// ══════════════════════════════════════════════════════════════════════

test('R4-8 成功响应不再从旧 data 继承有效期（核销后服务端不再下发它）', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let detail = deferred()
  const api = { getCloudPrintOrder: () => detail.promise }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  const future = new Date(Date.now() + 3600e3).toISOString()
  detail.resolve({ pickupStatus: 'pending', taskStatus: '', pickupCode: '12345678', amountCents: 100, pickupCodeExpiresAt: future })
  await flush()
  assert.ok(page.data.expiresAt > Date.now(), '第一轮应该拿到服务端下发的有效期')

  // 到机核销：服务端撤码，也不再下发 pickupCodeExpiresAt。
  detail = deferred()
  page._polling = false
  page._refreshOrder(false)
  detail.resolve({ pickupStatus: 'claimed', taskStatus: 'awaiting_payment', amountCents: 100 })
  await flush()

  assert.equal(page.data.codeRaw, '', '核销后不得继续显示旧码')
  assert.equal(page.data.showQr, false)
  assert.equal(page.data.expiresAt, 0, '核销后不得继续挂着上一轮那个有效期')
  assert.equal(page.data.countdown, '', '倒计时是那张码的说明文字，码撤下它也要撤')
})

test('R4-8 轮询短暂失败：码仍留在屏幕上（一次抖动不该让用户当场没码可扫）', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let detail = deferred()
  const api = { getCloudPrintOrder: () => detail.promise }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  detail.resolve({ pickupStatus: 'pending', taskStatus: '', pickupCode: '12345678', amountCents: 100 })
  await flush()

  detail = deferred()
  page._polling = false
  page._refreshOrder(false)
  detail.reject(Object.assign(new Error('network down'), { statusCode: -1 }))
  await flush()

  assert.equal(page.data.codeRaw, '12345678', '信任窗口内的一次失败不得撤码')
  assert.equal(page.data.state, 'ready')
})

test('R4-8 持续拉不到状态：超过信任窗口必须撤码并说清为什么', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let detail = deferred()
  const api = { getCloudPrintOrder: () => detail.promise }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  detail.resolve({ pickupStatus: 'pending', taskStatus: '', pickupCode: '12345678', amountCents: 100 })
  await flush()
  assert.equal(page.data.codeRaw, '12345678')

  // 用户在机器上把码扫掉了，而手机这边从那以后一直拉不到状态。
  page._codeConfirmedAt = Date.now() - 60000
  detail = deferred()
  page._polling = false
  page._refreshOrder(false)
  detail.reject(Object.assign(new Error('network down'), { statusCode: -1 }))
  await flush()

  assert.equal(page.data.codeRaw, '', '长时间无法与服务端确认时，这张码可能已被核销，必须撤下')
  assert.equal(page.data.showQr, false)
  assert.equal(page.data.expiresAt, 0)
  assert.ok(page.data.errorMsg.includes('确认'), page.data.errorMsg)
})

// ══════════════════════════════════════════════════════════════════════
// S. R4-2 orders：前台失效时立即清列表凭证，不依赖「离页再回来」
// ══════════════════════════════════════════════════════════════════════

test('R4-2 列表渲染好之后前台登出：下一条响应到达时必须当场清掉列表与到机码', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let cloud = deferred(); let legacy = deferred(); let pkgList = deferred()
  const api = {
    getMyCloudPrintOrders: () => cloud.promise,
    getMyPrintOrders: () => legacy.promise,
    getPackageOrders: () => pkgList.promise,
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  cloud.resolve([A_ORDER]); legacy.resolve([]); pkgList.resolve({ items: [A_PACKAGE], total: 1 })
  await flush()
  assert.equal(page.data.orders.length, 1)
  assert.ok(JSON.stringify(page.data).includes('12345678'), '前提：到机码确实渲染出来了')

  // request.js 补签失败 → auth.logout()。页面仍在前台，没有任何生命周期回调。
  auth.logout()
  cloud = deferred(); legacy = deferred(); pkgList = deferred()
  page._load()
  cloud.reject(Object.assign(new Error('unauthorized'), { statusCode: 401 }))
  legacy.reject(Object.assign(new Error('unauthorized'), { statusCode: 401 }))
  await flush()

  assert.equal(page.data.orders.length, 0, '登出后列表必须当场清空，不能等离页再回来')
  assert.equal(page.data.pkgRows.length, 0)
  assert.equal(page.data.isLoggedIn, false)
  assert.ok(!JSON.stringify(page.data).includes('12345678'), '到机码不得残留')
  assert.ok(!JSON.stringify(page.data).includes('87654321'))
})

test('R4-2 下拉刷新时已被静默登出：必须当场清场，而不是"刷新"出上一位的订单', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const api = {
    getMyCloudPrintOrders: () => Promise.resolve([A_ORDER]),
    getMyPrintOrders: () => Promise.resolve([]),
    getPackageOrders: () => Promise.resolve({ items: [A_PACKAGE], total: 1 }),
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  await flush()
  assert.equal(page.data.orders.length, 1)

  auth.logout()
  page.onPullDownRefresh()
  await flush()

  assert.equal(page.data.orders.length, 0, '下拉刷新必须先核身份并清场')
  assert.equal(page.data.pkgRows.length, 0)
  assert.equal(page.data.isLoggedIn, false)
  assert.ok(!JSON.stringify(page.data).includes('12345678'))
})

test('R4-2 会话仍然是本人时，下拉刷新照常刷新（守卫不得把活人挡掉）', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let rows = [A_ORDER]
  const api = {
    getMyCloudPrintOrders: () => Promise.resolve(rows),
    getMyPrintOrders: () => Promise.resolve([]),
    getPackageOrders: () => Promise.resolve({ items: [], total: 0 }),
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  await flush()

  rows = [A_ORDER, { id: 'ord-A2', orderNo: 'NO-A2', payStatus: 'paid', pickupStatus: 'claimed' }]
  page.onPullDownRefresh()
  await flush()
  assert.equal(page.data.orders.length, 2, '本人刷新必须真的刷出新内容')
})

// ══════════════════════════════════════════════════════════════════════
// T. R4-3 package-create：选择一变，在途的隐私检查与逐条确认必须当场作废
// ══════════════════════════════════════════════════════════════════════

const TWO_DOCS = {
  items: [
    { id: 'f-1', filename: '简历.pdf', purpose: 'print_doc', sizeBytes: 100 },
    { id: 'f-2', filename: '证明.pdf', purpose: 'print_doc', sizeBytes: 100 },
  ],
}

async function createPageWithTwoDocs(auth, wx, api) {
  const page = makePage('pages/package-create/package-create.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  await flush()
  return page
}

test('R4-3 扫描在途时加勾新文件：迟到的扫描完成不得把隐私检查说成「已完成」', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const scan = deferred()
  const scanned = []
  const api = {
    getMyDocuments: () => Promise.resolve(TWO_DOCS),
    createPrintPiiScan: (id) => { scanned.push(id); return scan.promise },
  }
  const page = await createPageWithTwoDocs(auth, wx, api)

  page.toggleDoc({ currentTarget: { dataset: { id: 'f-1' } } })
  page.runPrivacyScan()
  assert.equal(page.data.piiPhase, 'scanning')
  assert.deepEqual(scanned, ['f-1'])

  // 扫描还在跑，用户又加勾了 f-2 —— 它从来没有被扫过。
  page.toggleDoc({ currentTarget: { dataset: { id: 'f-2' } } })
  assert.equal(page.data.piiPhase, 'idle')

  scan.resolve({ id: 't-1', piiFindings: [] })
  await flush()

  assert.equal(page.data.piiPhase, 'idle',
    '被作废的扫描不得把 piiPhase 写成 ready —— f-2 从没扫过，那是一个假成功')
  assert.equal(page.data.selectedCount, 2)

  // 而 createPackage 的闸门必须真的拦住它（不是只有 data 好看）。
  page.createPackage()
  assert.equal(wx.calls.navigateTo.length, 0, '隐私检查未完成时不得进入下一步')
  assert.ok(wx.calls.showModal.some((m) => String(m.content).includes('隐私检查')), '要说清为什么不能继续')
})

test('R4-3 逐条确认在途时改选择：不得写成 ready，且按钮锁必须解开', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const scan = deferred()
  const decide = deferred()
  const api = {
    getMyDocuments: () => Promise.resolve(TWO_DOCS),
    createPrintPiiScan: () => scan.promise,
    decidePrintPiiFindings: () => decide.promise,
  }
  const page = await createPageWithTwoDocs(auth, wx, api)

  page.toggleDoc({ currentTarget: { dataset: { id: 'f-1' } } })
  page.runPrivacyScan()
  scan.resolve({ id: 't-1', piiFindings: [{ id: 'fd-1', action: 'pending' }] })
  await flush()
  assert.equal(page.data.piiPhase, 'review')

  page.confirmPrivacy()
  assert.equal(page.data.piiSubmitting, true)

  // 确认请求还在途，用户又加勾了 f-2。
  page.toggleDoc({ currentTarget: { dataset: { id: 'f-2' } } })
  assert.equal(page.data.piiSubmitting, false, '作废那条链之后按钮锁必须解开，否则重扫完也点不动')
  assert.equal(page.data.piiPhase, 'idle')

  decide.resolve({})
  await flush()
  assert.equal(page.data.piiPhase, 'idle', '被作废的确认链不得把页面写成「隐私检查已完成」')
})

test('R4-3 选择没变时，扫描照常走到 ready（守卫不得把正常流程挡掉）', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const api = {
    getMyDocuments: () => Promise.resolve(TWO_DOCS),
    createPrintPiiScan: () => Promise.resolve({ id: 't-1', piiFindings: [] }),
  }
  const page = await createPageWithTwoDocs(auth, wx, api)
  page.toggleDoc({ currentTarget: { dataset: { id: 'f-1' } } })
  page.runPrivacyScan()
  await flush()
  assert.equal(page.data.piiPhase, 'ready', '没有任何选择变动时扫描必须能正常完成')
})

// ══════════════════════════════════════════════════════════════════════
// U. R4-4 package-confirm：身份切换必须复位建单锁 / 提交锁 / 协议同意
// ══════════════════════════════════════════════════════════════════════


test('R4-4 A 的建单响应迟到时已经换成 B：不得锁死 B，也不得动 B 的草稿', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  seedDraft(wx, 'u:A', 'd-1')
  const submit = deferred()
  const api = {
    quotePackageOrder: () => Promise.resolve({ amountCents: 200, billablePages: 2 }),
    createPackageOrder: () => submit.promise,
  }
  const page = makePage('pages/package-confirm/package-confirm.js', { auth, api, wx })
  page.onLoad()
  await flush()
  page.setData({ agreedToTerms: true })
  page.submitOrder()
  assert.equal(page.data.submitting, true)

  // 换成 B，B 做好了自己的草稿并重新进入本页。
  auth.setUser('B')
  seedDraft(wx, 'u:B', 'd-2')
  page.onShow()
  await flush()

  submit.resolve({ orderId: 'ord-A' })     // A 的响应现在才到
  await flush()

  assert.ok(!page._createdOrderId, 'A 的订单号不得写到 B 的页面上（写了就永久锁死 B）')
  assert.ok(wx.storage.get('temp_package_data'), 'B 自己的草稿不得被 A 的响应删掉')
  assert.equal(page.data.quoteState, 'ready', 'B 必须还能正常核价下单')
  assert.ok(!String(page.data.quoteErrorTitle).includes('订单已创建'))
})

test('R4-4 A 的建单失败迟到时已经换成 B：不得把失败/锁定打在 B 头上', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  seedDraft(wx, 'u:A', 'd-1')
  const submit = deferred()
  const api = {
    quotePackageOrder: () => Promise.resolve({ amountCents: 200, billablePages: 2 }),
    createPackageOrder: () => submit.promise,
  }
  const page = makePage('pages/package-confirm/package-confirm.js', { auth, api, wx })
  page.onLoad()
  await flush()
  page.setData({ agreedToTerms: true })
  page._createdOrderId = null
  page.submitOrder()

  auth.setUser('B')
  seedDraft(wx, 'u:B', 'd-2')
  page.onShow()
  await flush()

  submit.reject(Object.assign(new Error('boom'), { code: 'PRINT_TERMINAL_OFFLINE' }))
  await flush()

  assert.equal(page.data.submitErrorTitle, '', 'A 的失败不得显示给 B')
  assert.equal(page.data.quoteState, 'ready')
  assert.ok(!page._createdOrderId)
})

test('R4-4 建单锁定后换用户：建单锁 / 提交锁 / 协议同意必须一起复位', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  seedDraft(wx, 'u:A', 'd-1')
  const api = {
    quotePackageOrder: () => Promise.resolve({ amountCents: 200, billablePages: 2 }),
    createPackageOrder: () => Promise.resolve({ orderId: 'ord-A' }),
  }
  const page = makePage('pages/package-confirm/package-confirm.js', { auth, api, wx })
  page.onLoad()
  await flush()
  page.setData({ agreedToTerms: true })
  wx.control.navFail = true               // 跳转失败 → 走 _lockAfterCreated
  page.submitOrder()
  await flush()
  assert.equal(page._createdOrderId, 'ord-A')
  assert.ok(page.data.quoteErrorTitle.includes('订单已创建'))

  wx.control.navFail = false
  auth.setUser('B')
  seedDraft(wx, 'u:B', 'd-2')
  page.onShow()
  await flush()

  assert.ok(!page._createdOrderId, 'B 不该继承 A 的「已建单」锁')
  assert.equal(page.data.submitting, false, 'B 不该继承 A 的提交锁')
  assert.equal(page.data.agreedToTerms, false, '协议同意是本人行为，不得替下一位保留')
  assert.equal(page.data.quoteState, 'ready', 'B 必须能正常核价')
  assert.ok(!page.data.quoteErrorTitle.includes('订单已创建'))
})

test('R4-4 同一个人建单成功：锁照常生效，再点一次不得发第二次 POST', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  seedDraft(wx, 'u:A', 'd-1')
  let posts = 0
  const api = {
    quotePackageOrder: () => Promise.resolve({ amountCents: 200, billablePages: 2 }),
    createPackageOrder: () => { posts += 1; return Promise.resolve({ orderId: 'ord-A' }) },
  }
  const page = makePage('pages/package-confirm/package-confirm.js', { auth, api, wx })
  page.onLoad()
  await flush()
  page.setData({ agreedToTerms: true })
  wx.control.navFail = true
  page.submitOrder()
  await flush()
  assert.equal(posts, 1)

  page.submitOrder()
  await flush()
  assert.equal(posts, 1, '已建过单就不许再 POST（服务端没有幂等键，第二次就是第二张订单）')
  assert.equal(page.data.submitting, false)
})

// ══════════════════════════════════════════════════════════════════════
// V. R4-7 单件链：URL 只传非敏感/必要参数；建单后先锁 orderId
// ══════════════════════════════════════════════════════════════════════

test('R4-7 print-store 进支付页只带 fileId/storeId/store/copies，敏感项一个都不带', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const api = { getPublicTerminals: () => Promise.resolve([{ id: 'term-1', displayName: '一号店', isOnline: true }]) }
  const page = makePage('pages/print-store/print-store.js', { auth, api, wx })
  page.onLoad({ fileId: 'f-1', copies: '2', name: '张三的简历.pdf', total: '1.50', amountCents: '150', pages: '3' })
  await flush()
  page.toPay()

  const url = wx.calls.navigateTo[0]
  assert.ok(url.indexOf('/pages/print-pay/print-pay?') === 0, url)
  for (const field of ['pickupCode', 'expiresAt', 'amountCents', 'total', 'name', 'bundleId']) {
    assert.ok(!url.includes(`${field}=`), `支付页 URL 不得携带 ${field}：${url}`)
  }
  assert.ok(!url.includes('%E5%BC%A0%E4%B8%89'), '文件名（常含本人姓名）绝不进 URL')
  assert.ok(url.includes('fileId=f-1') && url.includes('storeId=term-1') && url.includes('copies=2'), url)
})

test('R4-7 print-pay 金额与页数来自服务端报价，不来自 URL', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const quoted = []
  const api = {
    quoteMyPrintOrder: (fileId, params) => { quoted.push({ fileId, params }); return Promise.resolve({ amountCents: 150, billablePages: 3 }) },
    getMyDocuments: () => Promise.resolve({ items: [{ id: 'f-1', filename: '张三的简历.pdf' }] }),
  }
  const page = makePage('pages/print-pay/print-pay.js', { auth, api, wx })
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '2' })
  await flush()

  assert.equal(quoted.length, 1)
  assert.equal(quoted[0].params.colorMode, 'black_white')
  assert.equal(quoted[0].params.duplex, 'simplex')
  assert.equal(quoted[0].params.copies, 2)
  assert.equal(page.data.quoteState, 'ready')
  assert.equal(page.data.fee.total, '1.50')
  assert.equal(page.data.pageCountLabel, '3 页')
  assert.equal(page.data.files[0].name, '张三的简历.pdf', '文件名从本人文件库取，不从 URL 取')
})

test('R4-7 print-pay 报价失败：不本地补一个金额，也不把下单挡死', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const api = {
    quoteMyPrintOrder: () => Promise.reject(Object.assign(new Error(''), { statusCode: -1 })),
    getMyDocuments: () => Promise.resolve({ items: [] }),
    createCloudPrintOrder: () => Promise.resolve({ id: 'ord-A' }),
  }
  const page = makePage('pages/print-pay/print-pay.js', { auth, api, wx })
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  await flush()

  assert.equal(page.data.quoteState, 'error')
  assert.equal(page.data.fee.total, '—', '取不到报价时不得编一个金额出来')
  assert.equal(page.data.isFreeOrder, false, '取不到报价不等于免费')
  assert.equal(page.data.files[0].name, '本人文件', '取不到文件名时用中性标签，不回显 URL 里的值')

  page.continueFlow()
  await flush()
  await flush()
  assert.equal(wx.calls.redirectTo.length, 1, '展示失败不该取消一次真实的下单能力')
})

test('R4-7 print-pay 建单成功但跳转失败：锁住页面并指路，不得重复 POST', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  let posts = 0
  const api = {
    quoteMyPrintOrder: () => Promise.resolve({ amountCents: 150, billablePages: 3 }),
    getMyDocuments: () => Promise.resolve({ items: [] }),
    createCloudPrintOrder: () => { posts += 1; return Promise.resolve({ id: 'ord-A', pickupCode: '12345678' }) },
  }
  const page = makePage('pages/print-pay/print-pay.js', { auth, api, wx })
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  await flush()

  wx.control.navFail = true
  page.continueFlow()
  await flush()
  await flush()

  assert.equal(posts, 1)
  assert.equal(page.data.createdLocked, true, '订单已建成必须锁页面，否则用户会以为没下成再点一次')
  assert.equal(page.data.submitting, false, '不得卡在「正在提交…」')

  page.continueFlow()
  await flush()
  await flush()
  assert.equal(posts, 1, '再点一次不得发第二次 POST（同一个幂等键也只会回放同一张单）')

  page.toOrders()
  assert.ok(wx.calls.navigateTo.some((u) => u.includes('/pages/orders/orders')), '要能去找回这张订单')
})

test('R4-7 print-pay 跳转到取件页只带 orderId，凭证一个都不进 URL', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const api = {
    quoteMyPrintOrder: () => Promise.resolve({ amountCents: 150, billablePages: 3 }),
    getMyDocuments: () => Promise.resolve({ items: [] }),
    createCloudPrintOrder: () => Promise.resolve({
      id: 'ord-A', orderNo: 'NO-A', pickupCode: '12345678',
      pickupCodeExpiresAt: '2030-01-01T00:00:00.000Z', taskStatus: 'pending_release', amountCents: 150,
    }),
  }
  const page = makePage('pages/print-pay/print-pay.js', { auth, api, wx })
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  await flush()
  page.continueFlow()
  await flush()
  await flush()

  const url = wx.calls.redirectTo[0]
  assert.equal(url, '/pages/print-pickup/print-pickup?orderId=ord-A')
  for (const field of ['pickupCode', 'expiresAt', 'amountCents', 'taskStatus', 'orderNo', 'name', 'store']) {
    assert.ok(!url.includes(`${field}=`), `取件页 URL 不得携带 ${field}`)
  }
  assert.ok(!url.includes('12345678'))
})

test('R4-7 print-pay 建单在途换了人：不锁当前这位的页面，也不把他带去别人的到机码', async () => {
  const auth = createAuth('A')
  const wx = createWx()
  const submit = deferred()
  const api = {
    quoteMyPrintOrder: () => Promise.resolve({ amountCents: 150, billablePages: 3 }),
    getMyDocuments: () => Promise.resolve({ items: [] }),
    createCloudPrintOrder: () => submit.promise,
  }
  const page = makePage('pages/print-pay/print-pay.js', { auth, api, wx })
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  await flush()
  page.continueFlow()
  await flush()

  auth.setUser('B')
  submit.resolve({ id: 'ord-A', pickupCode: '12345678' })
  await flush()

  assert.ok(!page._createdOrderId, 'A 的订单不得锁住 B 的页面')
  assert.equal(page.data.createdLocked, false)
  assert.equal(page.data.submitting, false, '按钮锁必须解开，否则 B 的页面永远按不动')
  assert.equal(wx.calls.redirectTo.length, 0, '不得把 B 带去 A 的到机码页')
})

// ══════════════════════════════════════════════════════════════════════
// W. R5 身份与幂等：**用真的 utils/auth.js 跑**（见上面 useRealAuth 的注释）
//
// 这一组修的是 R4 修过一遍、却只修掉一半的那条判据：`auth.getToken()` 在 JWT 自然
// 过期时会先 `clearSession()` 把 token 与 user 一起清掉，于是「同一个人的 30 分钟
// JWT 到点了」与「用户主动登出」在页面看来完全同形（都是 `'u:A' → ''`）。
// 三条凭证/下单链把前者也判成换人，后果各不相同但都很硬：
//   取件页 / 材料包码页 —— 当场清掉屏幕上那张服务端还认的码，并且**一个请求都不发**，
//                          request.js 的 401 静默补签永远没机会跑；
//   确认支付页         —— 订单已经在服务端建出来了，页面却不锁 orderId、还把按钮解开，
//                          用户以为没下成再点一次 = 第二张订单、第二笔钱（没有幂等键）。
// ══════════════════════════════════════════════════════════════════════

const PICKUP_ORDER = {
  id: 'ord-A', orderNo: 'NO-A', pickupStatus: 'pending', taskStatus: '',
  pickupCode: '12345678', amountCents: 100,
  pickupCodeExpiresAt: new Date(Date.now() + 3600e3).toISOString(),
}

/** 取件页轮询是 setTimeout 注册的；沙箱只登记不触发，这里按生产路径手动放行一次。 */
function firePoll(page) {
  const tick = page._timers[page._timers.length - 1]
  assert.equal(typeof tick, 'function', '前提：轮询定时器确实排上了')
  tick()
}

test('R5-1 取件页：码已显示后 JWT 自然过期 —— 必须放行恰好一次请求，码不得被误清', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getCloudPrintOrder: (id) => { const d = deferred(); pending.push({ id, d }); return d.promise } }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  pending[0].d.resolve(PICKUP_ORDER)
  await flush()
  assert.equal(page.data.codeRaw, '12345678', '前提：码确实显示出来了')
  assert.equal(pending.length, 1)

  // 中午下单、下午走到一体机前：30 分钟的 enduser JWT 已经到点，但**没有任何人登出**。
  expireNaturally(wx)
  firePoll(page)

  assert.equal(pending.length, 2, '自然过期必须放行一次真实请求 —— 补签只能由 request.js 在 401 上做')
  assert.equal(pending[1].id, 'ord-A')
  assert.equal(page.data.codeRaw, '12345678', '没有人登出，屏幕上这张服务端还认的码不该被撤下')
  assert.notEqual(page.data.state, 'error')
  assert.ok(!String(page.data.errorMsg).includes('登录已失效'), page.data.errorMsg)

  // request.js 静默补签成功 → auth.saveSession 写回带 id 的新会话 → 重发拿到响应。
  realAuth.saveSession({ token: jwt(Date.now() + JWT_TTL_MS), user: { id: 'A' } })
  pending[1].d.resolve(PICKUP_ORDER)
  await flush()
  assert.equal(page.data.state, 'ready', '被补签救回来的响应必须能写进来')
  assert.equal(page.data.codeRaw, '12345678')
  assert.equal(page.data.showQr, true)
})

test('R5-1 取件页：主动登出 —— 一个请求都不发（不得自动登回），码与有效期一起清掉', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getCloudPrintOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  pending[0].resolve(PICKUP_ORDER)
  await flush()
  assert.equal(page.data.codeRaw, '12345678')

  auth.logout()
  firePoll(page)

  assert.equal(pending.length, 1, '主动登出后不得再发本人订单请求')
  assert.equal(realAuth.canSilentResignin(), false, '登出必须撤销补签资格，否则共用设备上会被自动登回')
  assert.equal(page.data.codeRaw, '', '主动登出：屏幕上那张码必须当场清掉')
  assert.equal(page.data.code, '')
  assert.equal(page.data.showQr, false)
  assert.equal(page.data.expiresAt, 0, '有效期是码的派生物，留着就是替一张撤下的码宣称"还有效"')
  assert.equal(page.data.state, 'error')
  assert.equal(page.data.errorAction, 'login')
  assert.ok(!JSON.stringify(page.data).includes('12345678'))
})

test('R5-1 取件页：换了账号 —— 码清掉且指向「我的打印订单」，不是「去登录」', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getCloudPrintOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  pending[0].resolve(PICKUP_ORDER)
  await flush()

  switchAccount('B')
  firePoll(page)

  assert.equal(pending.length, 1, '换了人之后不得再拿 A 的订单号去要数据')
  assert.equal(page.data.codeRaw, '', 'A 的码不得留给 B')
  assert.ok(!JSON.stringify(page.data).includes('12345678'))
  assert.equal(page.data.errorAction, 'orders')
})

test('R5-2 材料包码页：切后台期间 JWT 自然过期 —— 回来要真的发请求，补签后码照常取回', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getPackageOrder: (id) => { const d = deferred(); pending.push({ id, d }); return d.promise } }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  pending[0].d.resolve(A_PACKAGE)
  await flush()
  assert.equal(page._codeRaw, '87654321', '前提：码确实取回来了')

  // 用户收起小程序、走到一体机前再点开 —— 中间 30 分钟的 JWT 已经到点。
  page.onHide()
  expireNaturally(wx)
  page.onShow()

  assert.equal(pending.length, 2, '自然过期必须放行真实请求，交给 request.js 去补签')
  assert.equal(pending[1].id, 'pkg-A')
  assert.notEqual(page.data.loadRecover, 'login', '没有人登出，不该把它说成「登录已失效」')

  realAuth.saveSession({ token: jwt(Date.now() + JWT_TTL_MS), user: { id: 'A' } })
  pending[1].d.resolve(A_PACKAGE)
  await flush()
  assert.equal(page.data.ready, true, '被补签救回来的响应必须能写进来，不得停在 loading')
  assert.equal(page.data.loading, false)
  assert.equal(page._codeRaw, '87654321')
  assert.equal(page.data.loadError, '')
})

test('R5-2 材料包码页：打开时 JWT 已经过期 —— 照常发请求，补签成功后码要写得进来', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  expireNaturally(wx)                 // 中午下单、下午才点开：进页面之前 token 就到点了
  const pending = []
  const api = { getPackageOrder: (id) => { const d = deferred(); pending.push({ id, d }); return d.promise } }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  assert.equal(pending.length, 1, '有补签资格就必须放行真实请求（补签只能由 request.js 在 401 上做）')

  // request.js 补签成功 → auth.saveSession 写回带 id 的会话 → 重发拿到响应。
  // 这一跳是 `'' → 'u:A'`：**不是换人**，代次不许 +1，账号比对也不许把它判成换人 ——
  // 作废掉的恰好是那条刚刚被救回来的响应，页面就停在一页转不完的 loading 上。
  realAuth.saveSession({ token: jwt(Date.now() + JWT_TTL_MS), user: { id: 'A' } })
  pending[0].d.resolve(A_PACKAGE)
  await flush()

  assert.equal(page.data.ready, true, '补签救回来的响应必须能写进来，不得停在 loading')
  assert.equal(page.data.loading, false)
  assert.equal(page._codeRaw, '87654321')
  assert.equal(page.data.loadError, '')
})

test('R5-2 材料包码页：主动登出 —— 不发请求、不自动补签，码与明文副本一起清掉', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getPackageOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  pending[0].resolve(A_PACKAGE)
  await flush()
  assert.equal(page._codeRaw, '87654321')

  auth.logout()
  page.onShow()

  assert.equal(pending.length, 1, '主动登出后不得再发请求，更不得自动补签')
  assert.equal(realAuth.canSilentResignin(), false)
  assert.equal(page._codeRaw, '', '画码用的明文副本必须和 data 里的码一起清')
  assert.equal(page.data.pickupCode, '')
  assert.equal(page.data.showQr, false)
  assert.equal(page.data.ready, false)
  assert.equal(page.data.loadRecover, 'login')
  assert.ok(!JSON.stringify(page.data).includes('87654321'))
})

test('R5-2 材料包码页：换了账号 —— 上一位的码一个字都不许留给下一位', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getPackageOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  pending[0].resolve(A_PACKAGE)
  await flush()
  assert.equal(page._codeRaw, '87654321')

  switchAccount('B')
  page.onShow()

  assert.equal(page._codeRaw, '', 'A 的码不得留给 B')
  assert.equal(page.data.pickupCode, '')
  assert.equal(page.data.showQr, false)
  assert.ok(!JSON.stringify(page.data).includes('87654321'))
})

test('R5-2 材料包码页：A 的响应迟到时已经换成 B —— 一个字都不许写进来', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getPackageOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  assert.equal(pending.length, 1)

  // 请求已经发出（入口守卫那一刻是通过的），之后才换的人 —— 没有任何生命周期回调。
  switchAccount('B')
  pending[0].resolve(A_PACKAGE)
  await flush()

  assert.equal(page._codeRaw, '', 'A 的码不得渲染给 B')
  assert.equal(page.data.ready, false)
  assert.ok(!JSON.stringify(page.data).includes('87654321'))
})

/** print-pay 的公共夹具：每次建单各占一个可控 Promise，便于按乱序完成。 */
function payPage(wx, { quote = { amountCents: 150, billablePages: 3 }, docs = { items: [] } } = {}) {
  const creates = []
  const quotes = []
  // 本页恢复出一张"已建成"的订单时会向服务端核一次它现在的状态（R7-6）。
  // 一律 defer：什么时候回、回什么，由每条测试自己决定。
  const lookups = []
  const sentKeys = []
  const api = {
    quoteMyPrintOrder: () => {
      if (quote === 'defer') { const d = deferred(); quotes.push(d); return d.promise }
      return Promise.resolve(quote)
    },
    getMyDocuments: () => Promise.resolve(docs),
    createCloudPrintOrder: (data, opts) => {
      sentKeys.push(opts && opts.idempotencyKey)
      const d = deferred(); creates.push(d); return d.promise
    },
    getCloudPrintOrder: (orderId) => {
      const d = deferred(); d.orderId = orderId; lookups.push(d); return d.promise
    },
  }
  const page = makePage('pages/print-pay/print-pay.js', { auth: realAuth, api, wx })
  return { page, creates, quotes, lookups, sentKeys }
}

test('R5-3 确认支付页：建单在途时 JWT 自然过期 —— 只 POST 一次，订单号照常锁住', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, creates } = payPage(wx)
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  await flush()

  wx.control.navFail = true            // 跳转失败时页面还留在这里，锁不锁得住看得最清楚
  page.continueFlow()
  await flush()                        // 幂等键要等 wx.getRandomValues 回调，POST 排在它之后
  assert.equal(creates.length, 1)

  // 用户在确认页上多看了两眼，30 分钟的 JWT 正好在 POST 在途期间到点。没人登出。
  expireNaturally(wx)
  creates[0].resolve({ id: 'ord-A' })
  await flush()

  assert.equal(creates.length, 1, '一次提交只能有一次建单请求')
  assert.equal(page._createdOrderId, 'ord-A',
    '订单已经在服务端建出来了：必须锁住，否则用户以为没下成再点一次 = 第二张订单、第二笔钱')
  assert.equal(page.data.createdLocked, true)
  assert.equal(page.data.submitting, false, '不得卡在「正在提交…」')
  assert.ok(wx.calls.redirectTo.some((u) => u === '/pages/print-pickup/print-pickup?orderId=ord-A'),
    '同一位账号的自然过期不得挡住去取件页')

  page.continueFlow()
  await flush()
  assert.equal(creates.length, 1, '再点一次不得发第二次 POST')
})

test('R5-3 确认支付页：POST 在途时连点三次 —— 只能有一次 POST', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, creates } = payPage(wx)
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  await flush()

  page.continueFlow()
  page.continueFlow()
  page.continueFlow()
  await flush()
  assert.equal(creates.length, 1, '在途期间的重复点击一次都不许穿透（锁必须跨过取幂等键那一步）')

  // 就算有别的路径把 submitting 写回 false（R5 之前"换了人"那一支就是这么干的），
  // 绑在这次尝试上的锁仍然挡得住 —— 服务端那张订单可能已经建出来了。
  page.setData({ submitting: false })
  page.continueFlow()
  await flush()
  assert.equal(creates.length, 1, '尝试锁不能只依赖 setData 出去的 submitting')
})

test('R5-3 确认支付页：建单在途时真的换了人 —— 不跳 A 的到机码，B 能安全发起自己的那一次', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, creates } = payPage(wx)
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  await flush()
  page.continueFlow()
  await flush()
  assert.equal(creates.length, 1)

  switchAccount('B')
  creates[0].resolve({ id: 'ord-A' })
  await flush()

  assert.equal(wx.calls.redirectTo.length, 0, '不得把 B 带去 A 的到机码页')
  assert.ok(!page._createdOrderId, 'A 的订单不得锁住 B 的页面')
  assert.equal(page.data.createdLocked, false)
  assert.equal(page.data.submitting, false, '按钮锁必须解开，否则 B 的页面永远按不动')
  assert.ok(!JSON.stringify(page.data).includes('ord-A'), 'A 的订单号不得出现在 B 看到的任何字段里')

  // B 自己的那一次：必须是一次**新的** POST，并且跳的是 B 自己的订单。
  const before = wx.calls.redirectTo.length
  page.continueFlow()
  await flush()
  assert.equal(creates.length, 2, 'B 必须能安全地发起自己的建单')
  creates[1].resolve({ id: 'ord-B' })
  await flush()
  assert.equal(wx.calls.redirectTo[before], '/pages/print-pickup/print-pickup?orderId=ord-B')
})

test('R5-3 确认支付页：建单锁定后换账号回到本页 —— onShow 必须复位 A 的锁与 A 的文件名', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, creates } = payPage(wx, { docs: { items: [{ id: 'f-1', filename: '张三的简历.pdf' }] } })
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  await flush()
  assert.equal(page.data.files[0].name, '张三的简历.pdf', '前提：A 的文件名确实渲染出来了')

  wx.control.navFail = true
  page.continueFlow()
  await flush()
  creates[0].resolve({ id: 'ord-A' })
  await flush()
  assert.equal(page.data.createdLocked, true)

  switchAccount('B')
  page.onShow()

  assert.equal(page.data.createdLocked, false, 'A 的建单锁不得锁死 B 的页面')
  assert.ok(!page._createdOrderId)
  assert.equal(page.data.submitting, false)
  assert.equal(page.data.files[0].name, '本人文件', 'A 的文件名（常含本人姓名）不得留给 B')
  assert.equal(page.data.fee.total, '—', 'A 的金额是本人订单状态，不得留给 B')
  assert.ok(!JSON.stringify(page.data).includes('张三'))

  // 而且 B 点提交发的是 B 自己的那一次，不是被带去 A 的订单。
  wx.control.navFail = false
  const before = wx.calls.redirectTo.length
  page.continueFlow()
  await flush()
  assert.equal(creates.length, 2)
  creates[1].resolve({ id: 'ord-B' })
  await flush()
  assert.equal(wx.calls.redirectTo[before], '/pages/print-pickup/print-pickup?orderId=ord-B')
})

test('R5-3 确认支付页：建单在途时**主动登出** —— 不得跳 A 的订单，也不得靠缓存身份补签回去', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const { page, creates } = payPage(wx)
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  await flush()
  page.continueFlow()
  await flush()
  assert.equal(creates.length, 1)

  // 与「自然过期」在 token 维度上完全同形（都是没有可用 token 了），
  // 区别只在 RESIGNIN_ELIGIBLE 这面持久旗子：logout() 把它撤了。
  // 内存里那份稳定账号快照**不许**替代它 —— 否则页面就能自己给自己发补签通行证。
  realAuth.logout()
  creates[0].resolve({ id: 'ord-A' })
  await flush()

  assert.equal(realAuth.canSilentResignin(), false)
  assert.equal(wx.calls.redirectTo.length, 0, '登出之后不得把人带去这张订单的到机码页')
  assert.ok(!page._createdOrderId, '登出之后不得用缓存身份把 A 的订单锁回来')
  assert.equal(page.data.createdLocked, false)
  assert.ok(!JSON.stringify(page.data).includes('ord-A'), 'A 的订单号不得留在屏幕上')

  // 而且登出状态下再点提交必须 fail-closed：建单会在服务端落一张带钱的订单，
  // 不像报价那样可以放行 'resignable'。
  page.continueFlow()
  await flush()
  await flush()
  assert.equal(creates.length, 1, '没有确定身份时不得建单')
  assert.ok(wx.calls.showModal.some((m) => m && m.title === '请先登录'), '要说清下一步是重新登录')
})

test('R5-4 确认支付页报价：A 的旧报价迟到，不得盖掉 B 的金额', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, quotes } = payPage(wx, { quote: 'defer' })
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  assert.equal(quotes.length, 1, '前提：A 的报价已经发出去了')

  switchAccount('B')
  page.onShow()                       // B 回到这一页：换人被当场发现并复位
  page.retryQuote()                   // B 重新核价
  assert.equal(quotes.length, 2)

  quotes[1].resolve({ amountCents: 700, billablePages: 7 })
  await flush()
  assert.equal(page.data.fee.total, '7.00')

  quotes[0].resolve({ amountCents: 150, billablePages: 3 })   // A 的旧报价这才回来
  await flush()
  assert.equal(page.data.fee.total, '7.00', 'A 的旧报价不得盖掉 B 的金额')
  assert.equal(page.data.pageCountLabel, '7 页')
})

test('R5-4 确认支付页报价：同一位用户两次核价乱序返回 —— 只认最新那一次', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, quotes } = payPage(wx, { quote: 'defer' })
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  // 直接再发一次：`quoteState !== 'loading'` 那道 UI 闸只是第二层，任何一条路径把
  // quoteState 写掉它就失效了。代次令牌那一层必须自己站得住。
  page._loadQuote()
  assert.equal(quotes.length, 2)

  quotes[1].resolve({ amountCents: 700, billablePages: 7 })
  await flush()
  assert.equal(page.data.fee.total, '7.00')

  quotes[0].resolve({ amountCents: 150, billablePages: 3 })
  await flush()
  assert.equal(page.data.fee.total, '7.00', '先发的那次晚到，不得把金额回滚')
  assert.equal(page.data.pageCountLabel, '7 页')
})

test('R5-5 打印订单页：请求发出时还登录着、响应回来前才被登出 —— 回调必须当场清场', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  let cloud = deferred(); let legacy = deferred(); let pkgList = deferred()
  const api = {
    getMyCloudPrintOrders: () => cloud.promise,
    getMyPrintOrders: () => legacy.promise,
    getPackageOrders: () => pkgList.promise,
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  cloud.resolve([A_ORDER]); legacy.resolve([]); pkgList.resolve({ items: [A_PACKAGE], total: 1 })
  await flush()
  assert.equal(page.data.orders.length, 1)
  assert.ok(JSON.stringify(page.data).includes('12345678'), '前提：到机码确实渲染出来了')

  // **关键顺序**：入口守卫这一刻是通过的（人还登录着），请求真的发出去了；
  // 之后 request.js 才在 401 补签失败时 auth.logout() —— 全程没有任何生命周期回调。
  // 于是能清掉屏幕的只剩回调里那一次身份判定。R4 那条测试是先登出再 _load()，
  // 入口守卫就把场清了，把回调里的清场删掉照样全绿 —— 那是假覆盖。
  cloud = deferred(); legacy = deferred(); pkgList = deferred()
  page.onPullDownRefresh()
  assert.equal(page.data.orders.length, 1, '前提：请求发出的这一刻，屏幕上还是 A 的数据')
  assert.ok(JSON.stringify(page.data).includes('12345678'))

  auth.logout()
  cloud.reject(Object.assign(new Error('unauthorized'), { statusCode: 401 }))
  legacy.reject(Object.assign(new Error('unauthorized'), { statusCode: 401 }))
  // 材料包这一条甚至是**成功**返回的：清场不能只挂在失败分支上。
  pkgList.resolve({ items: [A_PACKAGE], total: 1 })
  await flush()
  await flush()

  assert.equal(page.data.orders.length, 0, '回调必须当场清掉上一个会话的订单')
  assert.equal(page.data.pkgRows.length, 0)
  assert.equal(page.data.isLoggedIn, false)
  assert.ok(!JSON.stringify(page.data).includes('12345678'), '到机码不得残留')
  assert.ok(!JSON.stringify(page.data).includes('87654321'))
})

test('R5-5 打印订单页：请求在途时换账号（成功响应）—— A 的订单与到机码不得落到 B 头上', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  let cloud = deferred(); let legacy = deferred(); let pkgList = deferred()
  const api = {
    getMyCloudPrintOrders: () => cloud.promise,
    getMyPrintOrders: () => legacy.promise,
    getPackageOrders: () => pkgList.promise,
  }
  const page = makePage('pages/orders/orders.js', { auth, api, wx })
  page.onLoad()
  page.onShow()
  assert.ok(page.data.loading, '前提：A 的请求已经发出去了')

  switchAccount('B')
  cloud.resolve([A_ORDER]); legacy.resolve([]); pkgList.resolve({ items: [A_PACKAGE], total: 1 })
  await flush()

  assert.equal(page.data.orders.length, 0, 'A 的订单不得渲染给 B')
  assert.equal(page.data.pkgRows.length, 0)
  assert.ok(!JSON.stringify(page.data).includes('12345678'))
  assert.ok(!JSON.stringify(page.data).includes('87654321'))
})

// ══════════════════════════════════════════════════════════════════════
// X. R5 收口：补签**失败**之后的残留态，以及遮罩 / 请求的归属
//
// R5 主体证明的是「补签成功那条路走得通」。最终只读复审发现它漏了另一半：
// request.js 补签**失败**时会 auth.logout() 撤销补签资格，于是回调那一刻账号状态从
// 'resignable' 掉成 'unusable' —— 而 'unusable' 这一支只是让 _accepts 返回 false，
// **没有任何人把页面从 loading 里解出来**。屏幕上留下一个永远转不完的圈：
// 既没有请求在跑，也没有任何出口。这与 R4-1 修过的那个形态是同一种病，换了个触发点。
// ══════════════════════════════════════════════════════════════════════

test('R5-6 材料包码页：过期后补签也失败 —— 不得留下永久转圈，要给可执行的登录出口', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  expireNaturally(wx)                 // 打开之前 30 分钟的 JWT 就已经到点
  const pending = []
  const api = { getPackageOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  assert.equal(pending.length, 1, '前提：有补签资格时照常发请求')
  assert.equal(page.data.loading, true, '前提：页面正为这条请求转着圈')

  // request.js 的静默补签失败时会 auth.logout()（**撤销补签资格**），
  // 然后把原始 401 抛给页面。于是回调这一刻账号状态从 resignable 掉成 unusable。
  realAuth.logout()
  pending[0].reject(Object.assign(new Error('unauthorized'), { statusCode: 401 }))
  await flush()

  assert.equal(page.data.loading, false, '不得停在「正在向服务端核对订单」上转不完')
  assert.equal(page.data.ready, false)
  assert.equal(page._codeRaw, '', '认不出人的会话不许留着到机码的明文副本')
  assert.equal(page.data.pickupCode, '')
  assert.equal(page.data.loadRecover, 'login', '必须给一条真正有效的下一步')
  assert.ok(page.data.loadError, '必须说清为什么，不能只是空白')
})

test('R5-6 确认支付页报价：过期后补签也失败 —— 金额不得永远停在「正在核定」', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  expireNaturally(wx)
  const { page, quotes } = payPage(wx, { quote: 'defer' })
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  assert.equal(quotes.length, 1, '前提：有补签资格时照常发报价')
  assert.equal(page.data.quoteState, 'loading', '前提：金额那一块正在转圈')

  realAuth.logout()
  quotes[0].reject(Object.assign(new Error('unauthorized'), { statusCode: 401 }))
  await flush()

  // 必须落到 error：模板只在 quoteState === 'error' 时才给出「重新核价」，
  // 而 retryQuote 又只在 quoteState !== 'loading' 时才动 —— 停在 loading
  // 等于同时锁死了展示和重试两条路。
  assert.equal(page.data.quoteState, 'error', '不得永远停在 loading（那会让「重新核价」变成死按钮）')
  assert.ok(page.data.quoteError, page.data.quoteError)
  assert.equal(page.data.fee.total, '—', '取不到报价时不得编一个金额出来')

  // 重试这条路必须是活的，且在没有身份时不得真的再打一次接口。
  page.retryQuote()
  assert.equal(quotes.length, 1, '认不出人的会话不该再发本人金额请求')
  assert.equal(page.data.quoteState, 'error')
})

test('R5-6 材料包码页：换账号后回到本页 —— 不得拿 B 的 token 去要 A 的订单，说明也不许被覆盖', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getPackageOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  pending[0].resolve(A_PACKAGE)
  await flush()
  assert.equal(page._codeRaw, '87654321', '前提：A 的码确实取回来了')
  const before = pending.length

  switchAccount('B')
  page.onShow()

  // 身份只判一次。判成 changed 之后再调一次 loadOrder，会用 B 的 token 去要 A 的
  // orderId（服务端 requireOwned 必然 404），并且把「账号已切换」覆盖成 loading。
  assert.equal(pending.length, before, 'B 的 token 不得拿去要 A 的 orderId')
  assert.equal(page.data.loadErrorTitle, '账号已切换', '这句说明不许被紧随其后的 loadOrder 覆盖掉')
  assert.equal(page.data.loadRecover, 'orders', 'B 的落点是「我的 · 打印订单」，不是重试')
  assert.equal(page.data.loading, false)
  assert.equal(page._codeRaw, '')
  assert.ok(!JSON.stringify(page.data).includes('87654321'))
})

test('R5-6 确认支付页：A 的迟到建单回调不得掀掉 B 正在进行的提交遮罩', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, creates } = payPage(wx)
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  await flush()

  page.continueFlow()                       // A 提交，遮罩挂上
  await flush()
  assert.equal(creates.length, 1)
  assert.equal(wx.loading.visible, true, '前提：A 的遮罩确实挂上了')

  switchAccount('B')
  page.onShow()                             // B 回到本页：A 的一切被复位
  assert.equal(wx.loading.visible, false, '换人复位时不该把上一位的遮罩留在屏幕上')

  page.continueFlow()                       // B 自己提交，遮罩再次挂上
  await flush()
  assert.equal(creates.length, 2, 'B 必须能发起自己的那一次')
  assert.equal(wx.loading.visible, true)

  // A 的响应这才回来。hideLoading 无条件掀掉当前那一张遮罩，所以它必须排在归属判定之后。
  creates[0].resolve({ id: 'ord-A' })
  await flush()
  assert.equal(wx.loading.visible, true,
    'A 的迟到回调不得掀掉 B 的遮罩 —— B 的按钮还锁着、请求还在飞，屏幕却什么都没有了')
  assert.equal(wx.calls.redirectTo.length, 0, '更不得把 B 带去 A 的到机码页')
  assert.ok(!page._createdOrderId)

  // B 的响应回来时才收起遮罩，并且跳的是 B 自己的订单。
  creates[1].resolve({ id: 'ord-B' })
  await flush()
  assert.equal(wx.loading.visible, false, 'B 自己的回调必须收起遮罩，不能永远挂着')
  assert.equal(wx.calls.redirectTo[0], '/pages/print-pickup/print-pickup?orderId=ord-B')
})

// ══════════════════════════════════════════════════════════════════════
// Y. 幂等建单：一次「下单意图」一个 UUID，跨失败 / 跨重进 / 跨换人都认同一张订单
//
// 服务端（ed576f3cb）现在要求 `POST /me/print-orders` 必带 Header `idempotency-key`，
// 并按 (endUserId, key) 回放同一张 Order，同键不同参数则 409 IDEMPOTENCY_KEY_REUSED。
// 前端要做对的不是"传一个 UUID"，而是**什么时候该复用、什么时候该换、以及键和
// 已建成的 orderId 归谁**。下面每条都对应一个会真的多扣一笔钱的处境。
// ══════════════════════════════════════════════════════════════════════

/** 用**真** utils/api.js + utils/request.js 发一次请求，把 wx.request 的入参截下来。 */
function captureRequest(wx, run) {
  ACTIVE_WX = wx
  const seen = []
  wx.request = (opts) => {
    seen.push(opts)
    opts.success({ statusCode: 200, data: { data: { id: 'ord-A' } } })
  }
  const realApi = requireMiniapp('../utils/api.js')
  return Promise.resolve(run(realApi)).then(() => seen, (err) => { seen.error = err; return seen })
}

test('R6-1 建单请求把幂等键放在 Header `idempotency-key` 上，**不在 body 里**', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const key = '11111111-2222-4333-8444-555555555555'
  const seen = await captureRequest(wx, (realApi) => realApi.createCloudPrintOrder(
    { fileId: 'f-1', terminalId: 'term-1', copies: 1, colorMode: 'black_white', duplex: 'simplex' },
    { idempotencyKey: key },
  ))

  assert.equal(seen.length, 1, '真的发出去了一次请求')
  const sent = seen[0]
  assert.ok(String(sent.url).endsWith('/me/print-orders'), sent.url)
  assert.equal(sent.method, 'POST')
  // 服务端从 Header 取（assertMemberPrintOrderIdempotencyKey），大小写不敏感但字段名固定。
  const headerKey = Object.keys(sent.header).find((k) => k.toLowerCase() === 'idempotency-key')
  assert.ok(headerKey, `Header 里没有 idempotency-key：${JSON.stringify(sent.header)}`)
  assert.equal(sent.header[headerKey], key)
  // body 里出现它有两个后果：服务端读不到（照样 400），且 DTO 会把多出来的字段判成非法参数。
  assert.ok(!('idempotencyKey' in sent.data) && !('idempotency-key' in sent.data),
    `幂等键不得进 body：${JSON.stringify(sent.data)}`)
  assert.ok(!JSON.stringify(sent.data).includes(key))
})

test('R6-1 没带幂等键时本地就挡下来，不发一个必然 400 的请求', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const seen = await captureRequest(wx, (realApi) => realApi.createCloudPrintOrder({ fileId: 'f-1' }, {}))
  assert.equal(seen.length, 0, '缺键时不该发请求')
  assert.ok(seen.error, '必须 reject，而不是静默成功')
})

test('R6-2 同一位用户、同一组参数：失败重试复用同一个键；参数一变就换键', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const idem = requireMiniapp('../utils/print-order-idempotency.js')
  const payload = { fileId: 'f-1', terminalId: 'term-1', copies: 1, colorMode: 'black_white', duplex: 'simplex' }
  const print = idem.fingerprintOf(payload)

  const first = await idem.ensureKey('u:A', print)
  const again = await idem.ensureKey('u:A', print)
  assert.ok(idem.KEY_RE.test(first.key), `不是合法 UUID：${first.key}`)
  assert.equal(again.key, first.key, '同账号同参数必须复用 —— 换一个键就是第二张订单、第二笔钱')

  // 参数变了必须换键：同键不同参数在服务端是 409 IDEMPOTENCY_KEY_REUSED。
  const other = await idem.ensureKey('u:A', idem.fingerprintOf({ ...payload, copies: 3 }))
  assert.notEqual(other.key, first.key, '份数变了就是另一单')
  const otherTerminal = await idem.ensureKey('u:A', idem.fingerprintOf({ ...payload, terminalId: 'term-2' }))
  assert.notEqual(otherTerminal.key, first.key, '换了终端也是另一单')

  // B 绝不能读到 / 复用 A 的记录。
  const bKey = await idem.ensureKey('u:B', print)
  assert.notEqual(bKey.key, first.key, 'B 不得复用 A 的幂等键')
  assert.equal(idem.findRecord('u:B', print).key, bKey.key)
  assert.equal(idem.findRecord('u:A', print).key, first.key, 'B 的写入不得动 A 的记录')
  // 认不出人的会话一条都不给。
  await assert.rejects(() => idem.ensureKey('', print))
  await assert.rejects(() => idem.ensureKey('!', print))
  assert.equal(idem.findRecord('', print), null)
})

test('R6-2 幂等键是 UUID v4 形态，且不存到机码 / 文件名 / 金额', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const idem = requireMiniapp('../utils/print-order-idempotency.js')
  const print = idem.fingerprintOf({ fileId: 'f-1', terminalId: 'term-1', copies: 1, colorMode: 'black_white', duplex: 'simplex' })
  const record = await idem.ensureKey('u:A', print)
  idem.rememberOrderId('u:A', print, record.key, 'ord-A')

  const raw = JSON.stringify(wx.storage.get(idem.STORE_KEY))
  assert.ok(raw.includes('ord-A'), '恢复要用的 orderId 必须留下')
  for (const forbidden of ['12345678', '张三', 'pickupCode', 'amountCents', 'filename']) {
    assert.ok(!raw.includes(forbidden), `本机存储里不得出现 ${forbidden}：${raw}`)
  }
  assert.deepEqual(Object.keys(JSON.parse(raw)[0]).sort(), ['account', 'createdAt', 'fingerprint', 'key', 'orderId'])
})

test('R6-3 A 的 200 晚于换人：orderId 落进 A 的恢复记录，但一个字都不写进 B 的页面', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const idem = requireMiniapp('../utils/print-order-idempotency.js')
  const { page, creates } = payPage(wx)
  const query = { fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' }
  page.onLoad(query)
  await flush()
  page.continueFlow()
  await flush()
  assert.equal(creates.length, 1)

  switchAccount('B')
  page.onShow()
  creates[0].resolve({ id: 'ord-A' })          // A 的 200 这才到
  await flush()

  // 写给 A 的那条恢复记录必须存在 —— 服务端那张订单已经建成了。
  const print = idem.fingerprintOf({ fileId: 'f-1', terminalId: 'term-1', copies: 1, colorMode: 'black_white', duplex: 'simplex' })
  assert.equal(idem.findRecord('u:A', print).orderId, 'ord-A', 'A 的订单必须能被找回')
  assert.equal(idem.findRecord('u:B', print), null, 'B 不得看到 A 的记录')
  // 但 B 的页面一个字都不许被写。
  assert.ok(!page._createdOrderId)
  assert.equal(page.data.createdLocked, false)
  assert.equal(wx.calls.redirectTo.length, 0)
  assert.ok(!JSON.stringify(page.data).includes('ord-A'))

  // A 重新登录回到本页：看得见「订单已创建」，而且再点也不会发第二次 POST。
  switchAccount('A')
  page.onShow()
  assert.equal(page._createdOrderId, 'ord-A', 'A 回来必须能恢复成已创建')
  assert.equal(page.data.createdLocked, true)
  page.continueFlow()
  await flush()
  assert.equal(creates.length, 1, '恢复态下再点一次不得发第二次 POST')
})

test('R6-4 响应丢在路上：第二次提交带**同一个键**回放，不是第二张订单', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const sentKeys = []
  const creates = []
  const api = {
    quoteMyPrintOrder: () => Promise.resolve({ amountCents: 150, billablePages: 3 }),
    getMyDocuments: () => Promise.resolve({ items: [] }),
    createCloudPrintOrder: (data, opts) => {
      sentKeys.push(opts && opts.idempotencyKey)
      const d = deferred(); creates.push(d); return d.promise
    },
  }
  const page = makePage('pages/print-pay/print-pay.js', { auth: realAuth, api, wx })
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  await flush()

  page.continueFlow()
  await flush()
  creates[0].reject(Object.assign(new Error('网络连接失败'), { statusCode: -1 }))   // 200 丢了
  await flush()
  assert.equal(page.data.submitting, false, '失败之后要能重试')

  page.continueFlow()                         // 用户再点一次
  await flush()
  assert.equal(sentKeys.length, 2)
  assert.equal(sentKeys[1], sentKeys[0], '第二次必须带同一个键，由服务端回放同一张订单')
  assert.ok(sentKeys[0], '键不能是空的')

  // 服务端回放回来（哪怕原单已 cancelled / expired，前端也照它给的 orderId 处理）。
  creates[1].resolve({ id: 'ord-A', pickupStatus: 'cancelled' })
  await flush()
  assert.equal(page._createdOrderId, 'ord-A', '按服务端返回的 orderId 处理，不自己另铸一个键')
  assert.equal(sentKeys.length, 2, '不得为了"重新下单"偷偷再发一次')
})

test('R6-5 跳转成功才清恢复记录；跳转失败要留着 orderId 并锁页', async () => {
  const idem = requireMiniapp('../utils/print-order-idempotency.js')
  const print = idem.fingerprintOf({ fileId: 'f-1', terminalId: 'term-1', copies: 1, colorMode: 'black_white', duplex: 'simplex' })
  const query = { fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' }

  // ① 跳转失败：记录必须留着 —— 它是唯一能找回这张订单的线索，页面还留在原地。
  const wxFail = createWx()
  useRealAuth(wxFail, 'A')
  const failPage = payPage(wxFail)
  failPage.page.onLoad(query)
  await flush()
  wxFail.control.navFail = true
  failPage.page.continueFlow()
  await flush()
  failPage.creates[0].resolve({ id: 'ord-A' })
  await flush()
  assert.equal(failPage.page.data.createdLocked, true, '跳转失败必须锁页并指路')
  assert.equal(idem.findRecord('u:A', print).orderId, 'ord-A', '跳转失败不得清掉恢复记录')

  // ② 跳转成功：人已经在到机码页了，这条记录可以退休。
  const wxOk = createWx()
  useRealAuth(wxOk, 'A')
  const okPage = payPage(wxOk)
  okPage.page.onLoad(query)
  await flush()
  okPage.page.continueFlow()
  await flush()
  okPage.creates[0].resolve({ id: 'ord-A' })
  await flush()
  assert.equal(wxOk.calls.redirectTo[0], '/pages/print-pickup/print-pickup?orderId=ord-A')
  assert.equal(idem.findRecord('u:A', print), null, '确实跳走之后才清')
})

test('R6-6 材料包码页换到 B：第一次和第二次 onShow 都零新增请求，说明不变', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getPackageOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  pending[0].resolve(A_PACKAGE)
  await flush()
  assert.equal(page._codeRaw, '87654321')
  const before = pending.length

  switchAccount('B')
  page.onShow()
  assert.equal(pending.length, before, '第一次 onShow：不得拿 B 的 token 去要 A 的 orderId')
  assert.equal(page.data.loadErrorTitle, '账号已切换')

  // 第二次才是此前漏掉的那一支：`_account` 已经被清成 ''，`'' → 'u:B'` 在状态机眼里
  // 是一次正常的补签升级 = 'ok'，于是本页又会拿着上一位的 orderId 发请求。
  page.onShow()
  assert.equal(pending.length, before, '第二次 onShow 同样不许发请求')
  page.onShow()
  assert.equal(pending.length, before, '第三次也一样')
  assert.equal(page.data.loadErrorTitle, '账号已切换', '说明必须一直在，不许被 loading 覆盖')
  assert.equal(page.data.loadRecover, 'orders')
  assert.ok(!JSON.stringify(page.data).includes('87654321'))

  // 开页那位自己回来：必须解除封锁，能重新加载。
  switchAccount('A')
  page.onShow()
  assert.equal(pending.length, before + 1, '本人回来必须能再取一次')
})

test('R6-6 材料包码页显式登出后同一位 A 重新登录：仍能恢复加载（登出不粘）', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getPackageOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  pending[0].resolve(A_PACKAGE)
  await flush()
  const before = pending.length

  auth.logout()
  page.onShow()
  assert.equal(pending.length, before, '登出后不得再发请求')
  assert.equal(page.data.loadRecover, 'login')

  // 同一位 A 重新登录 —— 这不是换人，不该被粘性封锁挡住。
  realAuth.saveSession({ token: jwt(Date.now() + JWT_TTL_MS), user: { id: 'A' } })
  page.onShow()
  assert.equal(pending.length, before + 1, '同一位重新登录必须能恢复加载')
  pending[before].resolve(A_PACKAGE)
  await flush()
  assert.equal(page._codeRaw, '87654321')
})

test('R6-7 报价失效态给的是**去登录**按钮，点了真的跳 launch', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  expireNaturally(wx)
  const { page, quotes } = payPage(wx, { quote: 'defer' })
  page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  realAuth.logout()                            // 补签失败
  quotes[0].reject(Object.assign(new Error('unauthorized'), { statusCode: 401 }))
  await flush()

  assert.equal(page.data.quoteState, 'error')
  // 判据是**状态字段**，不是文案里有没有「登录」两个字。
  assert.equal(page.data.quoteRecover, 'login', '认不出人时必须指向登录，而不是「重新核价」死循环')

  // **从模板里把处理函数名读出来再调它**，而不是直接 page.toLogin()。
  // 直接调等于绕过接线：把 wxml 里那个按钮整个删掉，测试照样绿，而用户屏幕上
  // 只剩一个「重新核价」死循环。模板才是真正发货的那一份，所以由它决定调谁。
  const payWxml = fs.readFileSync(path.join(MINIAPP, 'pages/print-pay/print-pay.wxml'), 'utf8')
  const loginBranch = /wx:if="\{\{quoteRecover === 'login'\}\}"[^>]*bindtap="([A-Za-z_$][\w$]*)"/.exec(payWxml)
  assert.ok(loginBranch, '模板里没有按 quoteRecover === \'login\' 分流的可点按钮')
  const handler = loginBranch[1]
  assert.equal(typeof page[handler], 'function', `模板绑了 ${handler}，页面却没有这个方法`)
  page[handler]()
  assert.ok(wx.calls.navigateTo.some((u) => u === '/pages/launch/launch'), wx.calls.navigateTo.join(','))

  // 普通的报价失败仍然是「重试」，不能一律推去登录。
  const wx2 = createWx()
  useRealAuth(wx2, 'A')
  const second = payPage(wx2, { quote: 'defer' })
  second.page.onLoad({ fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' })
  second.quotes[0].reject(Object.assign(new Error('网络连接失败'), { statusCode: -1 }))
  await flush()
  assert.equal(second.page.data.quoteState, 'error')
  assert.equal(second.page.data.quoteRecover, 'retry', '网络失败重试是有意义的，不该推去登录')
})

// ══════════════════════════════════════════════════════════════════════
// Z. R7 收口：幂等键"真的落住了吗 / 真的只有一个吗 / 真的还留着吗"，
//    换人的第二种形态（A 登出之后 B 才登录），以及一条过期七天的恢复记录。
//
// R6 证明的是「键被用对了」。这一批修的是它下面那一层 ——「键到底在不在」：
//   ① storage.set 失败被忽略 → 订单在服务端建成、键一个字节都没落本机 → 第二张订单；
//   ② 取随机数是异步的，两次重叠的 ensureKey 各铸一个键 → 第二张订单；
//   ③ 淘汰只按 createdAt 留最新 N 条，最先被挤掉的恰好是**正在飞**的那一条；
//   ④ wx.getRandomValues 两个回调一个都不来时页面永远停在「正在提交…」；
//   ⑤ A 登出→B 登录这一跳在账号状态机眼里是 `'' → 'u:B'` = 正常补签升级，
//      凭证页会拿着**开页那位**的 orderId 带着 B 的登录态发请求；
//   ⑥ 本机恢复记录活 7 天，而它锁住的是"这一组参数不许再下单"——
//      订单早就取消/过期/打完了，用户却面对一个按不动的按钮。
// ══════════════════════════════════════════════════════════════════════

const PAY_QUERY = { fileId: 'f-1', storeId: 'term-1', store: '一号店', copies: '1' }
const PAY_PAYLOAD = { fileId: 'f-1', terminalId: 'term-1', copies: 1, colorMode: 'black_white', duplex: 'simplex' }
const payWxmlSrc = () => fs.readFileSync(path.join(MINIAPP, 'pages/print-pay/print-pay.wxml'), 'utf8')
/** 从模板里把某个分支绑的处理函数名读出来——测试调它，而不是直接调页面方法（见 R6-7）。 */
function handlerFor(wxml, branch) {
  const hit = new RegExp(`${branch}[^>]*bindtap="([A-Za-z_$][\\w$]*)"`).exec(wxml)
  assert.ok(hit, `模板里没有 ${branch} 这一支的可点按钮`)
  return hit[1]
}

test('R7-1 本机存储写不进去：键没落住就一个 POST 都不许发，之后仍能恢复', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const idem = requireMiniapp('../utils/print-order-idempotency.js')
  const print = idem.fingerprintOf(PAY_PAYLOAD)
  const { page, creates, sentKeys } = payPage(wx)
  page.onLoad(PAY_QUERY)
  await flush()

  // 存储满 / 被系统清理 / 被隐私策略拦截：utils/storage.js 的 set() 吞掉异常返回 false。
  const realSet = wx.setStorageSync
  wx.setStorageSync = () => { throw new Error('exceed max storage size 10MB') }

  page.continueFlow()
  await flush()
  await flush()
  assert.equal(creates.length, 0,
    '键没落住就发 POST：订单会在服务端建成，而本机一条线索都没有 —— 那正是第二张订单的来源')
  assert.equal(sentKeys.length, 0)
  assert.equal(page.data.submitting, false, '按钮必须解开，否则页面永远停在「正在提交…」')
  assert.equal(wx.loading.visible, false, '遮罩必须收起')
  assert.ok(wx.calls.showModal.some((m) => m && m.title === '提交失败'), '必须说清这次没提交成功')

  // 存储还坏着的时候再点一次：仍然不许铸出一个"只活在内存里"的键就交出去。
  page.continueFlow()
  await flush()
  await flush()
  assert.equal(creates.length, 0, '重试同样不许发 POST')

  // 存储恢复之后必须能真的下单，而且只有一个键。
  wx.setStorageSync = realSet
  page.continueFlow()
  await flush()
  await flush()
  assert.equal(creates.length, 1, '存储恢复后要能正常下单（fail-closed 不等于把功能关死）')
  assert.ok(idem.KEY_RE.test(sentKeys[0] || ''), `发出去的不是合法 UUID：${sentKeys[0]}`)
  assert.equal(idem.findRecord('u:A', print).key, sentKeys[0], '这一次的键必须真的在本机留下了')
})

test('R7-1 存储不抛异常、但也没真写进去：读回来核不上，同样必须失败', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const idem = requireMiniapp('../utils/print-order-idempotency.js')
  const print = idem.fingerprintOf(PAY_PAYLOAD)
  const { page, creates } = payPage(wx)
  page.onLoad(PAY_QUERY)
  await flush()

  // 这一种从返回值上完全看不出来：set() 返回 true，而那条记录根本没进去。
  // 判据只能是"再读一遍，它逐字还在"。
  wx.setStorageSync = () => {}

  page.continueFlow()
  await flush()
  await flush()
  assert.equal(creates.length, 0, '读回来核不上就等于没落住，一个 POST 都不许发')
  assert.equal(idem.findRecord('u:A', print), null)
  assert.equal(page.data.submitting, false)
  assert.equal(wx.loading.visible, false)
})

test('R7-2 同账号同参数的重叠 ensureKey：只铸一个键，存储里也只许有一条', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const idem = requireMiniapp('../utils/print-order-idempotency.js')
  const print = idem.fingerprintOf(PAY_PAYLOAD)

  // 取随机数是异步的，所以"没有记录 → 铸一个"这一段可以被完整地穿插执行三遍。
  const [a, b, c] = await Promise.all([
    idem.ensureKey('u:A', print),
    idem.ensureKey('u:A', print),
    idem.ensureKey('u:A', print),
  ])
  assert.equal(b.key, a.key, '重叠的调用必须共用同一个键 —— 两个键就是两张订单、两笔钱')
  assert.equal(c.key, a.key)
  assert.equal(wx.calls.getRandomValues.length, 1, '只该真的铸一次')
  const rows = wx.storage.get(idem.STORE_KEY).filter((r) => r.account === 'u:A' && r.fingerprint === print)
  assert.equal(rows.length, 1, `同一格不许留下两条记录：${JSON.stringify(rows)}`)

  // 不同参数 / 不同账号仍然各铸各的（串行化不得把它们也并到一起）。
  const other = await idem.ensureKey('u:A', idem.fingerprintOf({ ...PAY_PAYLOAD, copies: 3 }))
  assert.notEqual(other.key, a.key)
  const bKey = await idem.ensureKey('u:B', print)
  assert.notEqual(bKey.key, a.key)
})

test('R7-2 两个页面实例同时提交：发给服务端的必须是同一个键', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const one = payPage(wx)
  const two = payPage(wx)
  one.page.onLoad(PAY_QUERY)
  two.page.onLoad(PAY_QUERY)
  await flush()

  one.page.continueFlow()
  two.page.continueFlow()
  await flush()
  await flush()

  assert.equal(one.creates.length, 1, '两个实例各自都真的提交了一次')
  assert.equal(two.creates.length, 1)
  assert.ok(one.sentKeys[0], '键不能是空的')
  assert.equal(two.sentKeys[0], one.sentKeys[0],
    '两个页面实例各铸一个键 = 服务端按 (endUserId, key) 建出两张订单、扣两笔钱')
})

test('R7-3 淘汰不得挤掉"已经 POST 出去、还没落定"的那条记录', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const idem = requireMiniapp('../utils/print-order-idempotency.js')
  const print = idem.fingerprintOf(PAY_PAYLOAD)
  const flying = await idem.ensureKey('u:A', print)     // 这一条的 POST 正在飞

  // 之后又发生了一批更新的下单意图（改份数、换终端、别的页面实例）。
  // 按"只留最新 N 条"淘汰，最先被挤掉的恰恰是仍在飞的那一条 —— 而它一旦没了，
  // 响应丢在路上时下一次提交就会铸一个新键，服务端于是再建一张。
  const now = Date.now()
  const fakeKey = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
  const rows = wx.storage.get(idem.STORE_KEY)
    .map((r) => Object.assign({}, r, { createdAt: now - 60000 }))
  for (let i = 0; i < 25; i += 1) {
    rows.push({ account: 'u:A', fingerprint: `later-${i}`, key: fakeKey(i), orderId: `ord-${i}`, createdAt: now - i })
  }
  wx.storage.set(idem.STORE_KEY, rows)
  idem.rememberOrderId('u:A', 'later-0', fakeKey(0), 'ord-0')   // 任何一次写入都会走一遍淘汰

  const still = idem.findRecord('u:A', print)
  assert.ok(still, '在飞的那条记录被淘汰掉了 —— 响应一丢，下一次提交就是第二张订单')
  assert.equal(still.key, flying.key)
  // 但存储仍然有界：**已落定**的那一档（有 orderId）照样只留 MAX_SETTLED_RECORDS 条。
  // 未落定的那一档一条都不淘汰，它的上界由 ensureKey 在入口处 fail-closed 兜住（R8-6）。
  const kept = wx.storage.get(idem.STORE_KEY)
  const settled = kept.filter((r) => r.orderId)
  const pending = kept.filter((r) => !r.orderId)
  assert.equal(settled.length, idem.MAX_SETTLED_RECORDS, `已落定的那批必须有界，实际留了 ${settled.length} 条`)
  assert.equal(pending.length, 1, `未落定的那一条必须原样留着，实际 ${pending.length} 条`)
})

test('R7-4 wx.getRandomValues 不存在 / 回 fail / 字节不足：都干净失败，零 POST', async () => {
  for (const [label, install] of [
    ['接口不存在', (wx) => { delete wx.getRandomValues }],
    ['回 fail', (wx) => { wx.getRandomValues = (opts) => opts.fail({ errMsg: 'getRandomValues:fail' }) }],
    ['字节不足', (wx) => { wx.getRandomValues = (opts) => opts.success({ randomValues: new Uint8Array(8).buffer }) }],
    ['同步抛', (wx) => { wx.getRandomValues = () => { throw new Error('boom') } }],
    // 只回 complete、不回 success/fail 的实现存在（也包括被宿主拦截后直接收尾）。
    // 走到 complete 还没落定 = 一个字节都没拿到，必须当失败。
    ['只回 complete', (wx) => { wx.getRandomValues = (opts) => opts.complete({ errMsg: 'getRandomValues:ok' }) }],
  ]) {
    const wx = createWx()
    useRealAuth(wx, 'A')
    const idem = requireMiniapp('../utils/print-order-idempotency.js')
    const { page, creates } = payPage(wx)
    page.onLoad(PAY_QUERY)
    await flush()
    install(wx)

    page.continueFlow()
    await flush()
    await flush()
    assert.equal(creates.length, 0, `${label}：没有可靠的键就不该发这个请求（Math.random 也不许顶上）`)
    assert.equal(page.data.submitting, false, `${label}：按钮必须解开`)
    assert.equal(wx.loading.visible, false, `${label}：遮罩必须收起`)
    assert.ok(wx.calls.showModal.some((m) => m && m.title === '提交失败'), `${label}：必须说清没提交成功`)
    assert.equal(idem.findRecord('u:A', idem.fingerprintOf(PAY_PAYLOAD)), null, `${label}：不许留下半截记录`)
  }
})

test('R7-4 wx.getRandomValues 两个回调一个都不来：超时收场，不把页面永远锁在「正在提交…」', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const idem = requireMiniapp('../utils/print-order-idempotency.js')
  // 低版本基础库 / 被宿主拦截的 API：success 与 fail 一个都不来。
  wx.getRandomValues = () => {}
  const { page, creates } = payPage(wx)
  page.onLoad(PAY_QUERY)
  await flush()

  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    page.continueFlow()
    assert.equal(page.data.submitting, true, '前提：按钮已经锁上')
    assert.equal(wx.loading.visible, true, '前提：遮罩已经挂上')
    mock.timers.tick(idem.RANDOM_TIMEOUT_MS + 1)
  } finally {
    mock.timers.reset()
  }
  await flush()
  await flush()

  assert.equal(creates.length, 0, '超时说明连字节都没拿到，不许发 POST')
  assert.equal(page.data.submitting, false, '不得把页面永远锁在「正在提交…」上')
  assert.equal(wx.loading.visible, false, '遮罩必须收起，否则屏幕被一张掀不掉的遮罩盖死')
  assert.ok(wx.calls.showModal.some((m) => m && m.title === '提交失败'))
  assert.equal(idem.findRecord('u:A', idem.fingerprintOf(PAY_PAYLOAD)), null)

  // 超时之后接口恢复正常：必须还能重试成功（fail-closed 不等于把功能关死）。
  wx.getRandomValues = createWx().getRandomValues
  page.continueFlow()
  await flush()
  await flush()
  assert.equal(creates.length, 1, '接口恢复后要能正常下单')
})

test('R7-5 材料包码页 A → 登出 → B 登录：一个 getPackageOrder 都不许发', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getPackageOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/package-code/package-code.js', { auth, api, wx })
  page.onLoad({ orderId: 'pkg-A' })
  page.onShow()
  pending[0].resolve(A_PACKAGE)
  await flush()
  assert.equal(page._codeRaw, '87654321', '前提：A 的码确实取回来了')
  const before = pending.length

  // 关键：**先登出、再登 B**。这一跳不是 'u:A' → 'u:B'，而是 'u:A' → '' → 'u:B'；
  // 登出那一步已经把快照清成 ''，于是后半跳在账号状态机眼里是一次正常的补签升级 = 'ok'。
  realAuth.logout()
  page.onShow()
  assert.equal(pending.length, before, '登出之后不发请求')

  realAuth.saveSession({ token: jwt(Date.now() + JWT_TTL_MS), user: { id: 'B' } })
  page.onShow()
  assert.equal(pending.length, before, 'B 的 token 不得拿去要 A 的 orderId（服务端 requireOwned 必然 404）')
  assert.equal(page.data.loadErrorTitle, '账号已切换')
  assert.equal(page.data.loadRecover, 'orders', 'B 的落点是「我的 · 打印订单」，不是重试')
  assert.equal(page._codeRaw, '')
  assert.ok(!JSON.stringify(page.data).includes('87654321'))

  page.onShow()
  page.onShow()
  assert.equal(pending.length, before, '之后每一次 onShow 都一样')
  assert.equal(page.data.loadErrorTitle, '账号已切换', '说明不许被 loading 覆盖')

  // 开页那位自己回来：必须解除封锁。
  realAuth.saveSession({ token: jwt(Date.now() + JWT_TTL_MS), user: { id: 'A' } })
  page.onShow()
  assert.equal(pending.length, before + 1, '开页那位回来必须能再取一次')
  pending[before].resolve(A_PACKAGE)
  await flush()
  assert.equal(page._codeRaw, '87654321')
})

test('R7-5 取件页 A → 登出 → B 登录：一个 getCloudPrintOrder 都不许发', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getCloudPrintOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  pending[0].resolve(PICKUP_ORDER)
  await flush()
  assert.equal(page.data.codeRaw, '12345678', '前提：A 的码确实显示出来了')
  const before = pending.length

  realAuth.logout()
  page.onShow()
  assert.equal(pending.length, before, '登出之后不发请求')

  realAuth.saveSession({ token: jwt(Date.now() + JWT_TTL_MS), user: { id: 'B' } })
  page.onShow()
  assert.equal(pending.length, before, 'B 的 token 不得拿去要 A 的 orderId')
  assert.equal(page.data.errorAction, 'orders', 'B 的落点是「我的 · 打印订单」')
  assert.equal(page.data.codeRaw, '', 'A 的码一个字都不许留给 B')
  assert.equal(page.data.showQr, false)
  assert.ok(!JSON.stringify(page.data).includes('12345678'))

  page.onShow()
  page.onShow()
  assert.equal(pending.length, before, '之后每一次 onShow 都一样')

  realAuth.saveSession({ token: jwt(Date.now() + JWT_TTL_MS), user: { id: 'A' } })
  page.onShow()
  assert.equal(pending.length, before + 1, '开页那位回来必须能再取一次')
  pending[before].resolve(PICKUP_ORDER)
  await flush()
  assert.equal(page.data.codeRaw, '12345678')
})

/** 造一条"本机还留着一张已建成订单"的恢复记录，并把页面开起来。 */
async function payPageWithStoredOrder(wx, orderId) {
  const idem = requireMiniapp('../utils/print-order-idempotency.js')
  const print = idem.fingerprintOf(PAY_PAYLOAD)
  const record = await idem.ensureKey('u:A', print)
  idem.rememberOrderId('u:A', print, record.key, orderId)
  const ctx = payPage(wx)
  ctx.page.onLoad(PAY_QUERY)
  await flush()
  return Object.assign(ctx, { idem, print, oldKey: record.key })
}

test('R7-6 恢复出来的那张订单已取消：服务端证明之后才解锁，并给出「重新下单」', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, creates, lookups, sentKeys, idem, print, oldKey } = await payPageWithStoredOrder(wx, 'ord-old')

  assert.equal(page.data.createdLocked, true, '前提：本机还留着一张"已建成"的记录')
  assert.equal(lookups.length, 1, '必须向服务端核一次这张订单现在是什么状态')
  assert.equal(lookups[0].orderId, 'ord-old')
  assert.equal(page.data.createdCanReorder, false, '还没核完就不许给「重新下单」')

  page.continueFlow()
  await flush()
  assert.equal(creates.length, 0, '核对期间一次 POST 都不许发')

  lookups[0].resolve({ id: 'ord-old', pickupStatus: 'cancelled', taskStatus: 'cancelled' })
  await flush()
  assert.equal(page.data.createdState, 'terminal')
  assert.equal(page.data.createdCanReorder, true, '服务端证明它已经取消：必须给出一条重新下单的路')
  assert.ok(page.data.createdNotice.includes('取消'), page.data.createdNotice)
  assert.equal(creates.length, 0, '**不**自动换键重下 —— 那等于替用户做了一次下单决定')
  assert.equal(idem.findRecord('u:A', print).orderId, 'ord-old', '用户点之前那条记录必须还在')

  // 按钮从模板里读处理函数名再调（直接调页面方法等于绕过接线，见 R6-7）。
  const handler = handlerFor(payWxmlSrc(), "wx:if=\"\\{\\{createdCanReorder\\}\\}\"")
  assert.equal(typeof page[handler], 'function', `模板绑了 ${handler}，页面却没有这个方法`)
  page[handler]()
  assert.equal(page.data.createdLocked, false, '点过之后「提交」必须真的能按了')
  assert.equal(idem.findRecord('u:A', print), null, '旧记录必须清掉，否则下一次还是复用那个键')

  page.continueFlow()
  await flush()
  await flush()
  assert.equal(creates.length, 1, '现在才允许建新的一单')
  assert.ok(sentKeys[0], '新的一单要带键')
  assert.notEqual(sentKeys[0], oldKey, '带旧键只会回放那张已取消的订单，用户永远打不出东西')
})

test('R7-6 恢复出来的那张订单还活着：继续锁着，不给「重新下单」', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, creates, lookups, idem, print } = await payPageWithStoredOrder(wx, 'ord-live')

  lookups[0].resolve({ id: 'ord-live', pickupStatus: 'pending', taskStatus: 'pending' })
  await flush()
  assert.equal(page.data.createdState, 'live')
  assert.equal(page.data.createdCanReorder, false, '订单还在，不该引导用户再下一单')
  assert.equal(page.data.createdLocked, true)
  assert.equal(idem.findRecord('u:A', print).orderId, 'ord-live', '记录必须原样留着')

  page.continueFlow()
  await flush()
  assert.equal(creates.length, 0, '锁着就是锁着')
  assert.equal(page.data.createdState, 'live', '点一下不得把结论改掉')
})

test('R7-6 核不上（网络失败）：保持锁定、零 POST，也不得因此铸一个新键', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, creates, lookups, idem, print, oldKey } = await payPageWithStoredOrder(wx, 'ord-unknown')

  lookups[0].reject(Object.assign(new Error('网络连接失败'), { statusCode: -1 }))
  await flush()
  assert.equal(page.data.createdState, 'unknown')
  assert.equal(page.data.createdCanReorder, false,
    '查询失败证明不了那张订单已经作废 —— 放开一格的代价就是第二张订单、第二笔钱')
  assert.equal(page.data.createdLocked, true)
  assert.equal(idem.findRecord('u:A', print).key, oldKey, '查不到就换新键，等于让服务端连回放的机会都没有')

  page.continueFlow()
  await flush()
  await flush()
  assert.equal(creates.length, 0)

  // 但必须给一条可执行的下一步，而不是一句「加载失败」。
  const handler = handlerFor(payWxmlSrc(), "wx:elif=\"\\{\\{createdState === 'unknown'\\}\\}\"")
  assert.equal(typeof page[handler], 'function')
  page[handler]()
  assert.equal(lookups.length, 2, '「重新核对」必须真的再打一发')
  lookups[1].resolve({ id: 'ord-unknown', pickupStatus: 'expired', taskStatus: 'expired' })
  await flush()
  assert.equal(page.data.createdState, 'terminal', '这一次核上了：过期同样是终态')
  assert.equal(page.data.createdCanReorder, true)
})

test('R7-6 服务端 404 明说没有这张订单：算终态，允许重新下单', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, lookups } = await payPageWithStoredOrder(wx, 'ord-gone')

  lookups[0].reject(Object.assign(new Error('打印订单不存在'), {
    statusCode: 404, code: 'PRINT_ORDER_NOT_FOUND',
  }))
  await flush()
  assert.equal(page.data.createdState, 'terminal',
    'requireOwned 的 404 是服务端状态，不是网络问题：那个 orderId 再也换不出任何东西')
  assert.equal(page.data.createdCanReorder, true)
})

test('R7-6 已打印完成 / 打印失败同样算终态（否则同一份材料再也打不了第二次）', async () => {
  for (const [label, order] of [
    ['已完成', { id: 'o', pickupStatus: 'used', taskStatus: 'completed' }],
    ['打印失败', { id: 'o', pickupStatus: 'used', taskStatus: 'failed' }],
    ['任务终止', { id: 'o', pickupStatus: 'used', taskStatus: 'abandoned' }],
    ['码已过期', { id: 'o', pickupStatus: 'expired', taskStatus: 'expired' }],
  ]) {
    const wx = createWx()
    useRealAuth(wx, 'A')
    const { page, lookups } = await payPageWithStoredOrder(wx, 'ord-old')
    lookups[0].resolve(order)
    await flush()
    assert.equal(page.data.createdState, 'terminal', `${label} 必须判成终态`)
    assert.equal(page.data.createdCanReorder, true, `${label} 必须允许重新下单`)
  }
})

test('R7-6 核对在途时换了人：结论不得落到 B 头上，B 的页面是干净的', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, lookups, creates } = await payPageWithStoredOrder(wx, 'ord-old')
  assert.equal(lookups.length, 1)

  switchAccount('B')
  page.onShow()
  assert.equal(page.data.createdLocked, false, 'A 的建单锁不得锁死 B')
  assert.equal(page.data.createdState, '', 'A 那张订单的核对结论同样属于 A')

  lookups[0].resolve({ id: 'ord-old', pickupStatus: 'cancelled', taskStatus: 'cancelled' })
  await flush()
  assert.equal(page.data.createdState, '', 'A 的迟到结论一个字都不许写进 B 的页面')
  assert.equal(page.data.createdCanReorder, false, '更不得给 B 一个「重新下单」按钮')
  assert.equal(creates.length, 0)
})

// ══════════════════════════════════════════════════════════════════════
// R8. 幂等/凭证链的复审：上一轮"修好了"的六件事，各自还差最后一步
//
// R7 修的是"键在不在、锁对不对"。这一批修的是它们各自被绕过的那条路 ——
// 每一条都不是理论上的，都是把上一轮的代码原样跑一遍就能复现的：
//   A 取件页 onShow 在判身份**之前**就因为"已经有一发在飞"early-return，
//     于是 A 的码留在屏幕上，一直留到那发请求自己落定（多久由网络决定）；
//   B 请求合法发出之后 JWT 才自然到点，成功分支只认 'ok'，把一张服务端仍然认的码清掉；
//   C clearRecord 不读回、不返回，调用方照着"清掉了"解锁 —— 而它可能一个字节都没写；
//   D 淘汰保护挂在**内存**里的钉子上，小程序被杀掉重进之后一条都不剩；
//   E 'live' 被缓存成永久结论，用户去把订单取消了再回来，页面永远说"它还在"；
//   F 设备时钟往回拨，自己刚写的记录落在"未来"被整条丢掉 → 新键 → 第二张订单。
// ══════════════════════════════════════════════════════════════════════

/**
 * 重新 require 一份幂等模块 —— 模拟**小程序被杀掉重进**。
 *
 * 这是 R8-5 的全部要害：新实例的 `minting` 是空的、内存里任何"钉子"也都不在了。
 * 于是"那条未落定的记录还受不受保护"这件事，只能由**已经落盘的数据本身**回答。
 */
function freshIdem() {
  const resolved = requireMiniapp.resolve('../utils/print-order-idempotency.js')
  delete requireMiniapp.cache[resolved]
  return requireMiniapp(resolved)
}

const fakeKey = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

test('R8-A 取件页：码已显示 + 轮询在飞 → A 登出 → B 登录 → onShow：码当场清掉，零 B 请求', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getCloudPrintOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  pending[0].resolve(PICKUP_ORDER)
  await flush()
  assert.equal(page.data.codeRaw, '12345678', '前提：A 的码确实画在屏幕上了')

  // 轮询真的打出去一发，并且**停在半路**（服务端慢 / 弱网 / 卡住）。
  firePoll(page)
  assert.equal(pending.length, 2, '前提：有一发 A 的请求正在飞')
  const inflight = pending.length

  // 共用设备上的真实一跳：A 登出、B 登录、回到本页。全程没有任何 onHide。
  realAuth.logout()
  realAuth.saveSession({ token: jwt(Date.now() + JWT_TTL_MS), user: { id: 'B' } })
  page.onShow()

  // 这一刻屏幕上就必须是干净的。**不能等那发请求落定**：什么时候落定是网络说了算，
  // 而这段时间里 B 正拿着手机看着 A 的取件凭证。
  assert.equal(page.data.codeRaw, '', 'A 的码必须在 onShow 当场清掉，不能等在飞的请求回来')
  assert.equal(page.data.showQr, false)
  assert.equal(page.data.expiresAt, 0, '有效期跟着码一起清（留着就是替一张不显示的码宣称"还有效"）')
  assert.ok(!JSON.stringify(page.data).includes('12345678'), '整份 data 里一个字节的码都不许留')
  assert.equal(page.data.state, 'error')
  assert.equal(page.data.errorAction, 'orders', 'B 的落点是「我的 · 打印订单」，不是「去登录」')
  assert.equal(pending.length, inflight, 'B 的登录态一个请求都不许发（服务端 requireOwned 会 404，但请求已经代表 B 发出去了）')

  // 迟到的 A 响应不得把码复活。
  pending[inflight - 1].resolve(PICKUP_ORDER)
  await flush()
  assert.equal(page.data.codeRaw, '', '迟到的 A 响应不得把码写回来')
  assert.equal(page.data.showQr, false)
  assert.equal(page.data.state, 'error')
  assert.equal(pending.length, inflight, '迟到的响应也不许触发新一轮轮询')
})

test('R8-B 取件页：请求发出后、200 回来前 JWT 自然到点 —— 这条响应仍是本人的，码不得被清', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getCloudPrintOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  assert.equal(pending.length, 1, '前提：这一发是带着 A 的登录态、在 A 还没过期时发出去的')

  // 请求在飞的这段时间里 enduser JWT（只签 30 分钟）自然到点。**没有任何人登出**，
  // 服务端那张码也还是好的 —— 它刚刚按 A 的归属校验放行了这条响应。
  expireNaturally(wx)

  pending[0].resolve(PICKUP_ORDER)
  await flush()
  assert.equal(page.data.state, 'ready')
  assert.equal(page.data.codeRaw, '12345678', '服务端刚刚确认过这条响应属于 A，不能反手把码清掉')
  assert.equal(page.data.showQr, true)
  assert.notEqual(page.data.errorAction, 'login', '不得把一张服务端仍然认的码换成一句「请登录」')

  // 但 fail-closed 的那几条一个都不许松：真的换了人仍然当场清场。
  switchAccount('B')
  page.onShow()
  assert.equal(page.data.codeRaw, '', '「过期可放行」不得外溢成「换人也放行」')
  assert.equal(page.data.errorAction, 'orders')
})

test('R8-B2 取件页：请求在飞时主动登出 —— 归属证不出来，码照样清掉（fail-closed 不松）', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const pending = []
  const api = { getCloudPrintOrder: () => { const d = deferred(); pending.push(d); return d.promise } }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  pending[0].resolve(PICKUP_ORDER)
  await flush()
  firePoll(page)
  assert.equal(pending.length, 2)

  realAuth.logout()          // 主动登出：补签资格一起撤销
  pending[1].resolve(PICKUP_ORDER)
  await flush()
  assert.equal(page.data.codeRaw, '', '主动登出之后那张码不属于任何还在的会话')
  assert.equal(page.data.showQr, false)
  assert.equal(page.data.errorAction, 'login')
})

test('R8-C 清不掉恢复记录：startNewOrder 保持锁定、保留旧键、零 POST，并说清下一步', async () => {
  for (const [label, breakStorage] of [
    ['set 抛异常（存储满）', (wx) => { wx.setStorageSync = () => { throw new Error('storage full') } }],
    ['set 不抛也不写（被系统回收 / 隐私策略拦截）', (wx) => { wx.setStorageSync = () => {} }],
  ]) {
    const wx = createWx()
    useRealAuth(wx, 'A')
    const { page, creates, lookups, idem, print, oldKey } = await payPageWithStoredOrder(wx, 'ord-old')
    lookups[0].resolve({ id: 'ord-old', pickupStatus: 'cancelled', taskStatus: 'cancelled' })
    await flush()
    assert.equal(page.data.createdCanReorder, true, `${label}：前提是服务端已经证明它是终态`)

    const realSet = wx.setStorageSync
    breakStorage(wx)
    const handler = handlerFor(payWxmlSrc(), 'wx:if="\\{\\{createdCanReorder\\}\\}"')
    page[handler]()

    assert.equal(page.data.createdLocked, true,
      `${label}：记录没清掉就解锁 = 下一次提交复用旧键，服务端一遍遍回放那张已取消的订单`)
    assert.equal(page.data.createdState, 'terminal', `${label}：结论不变`)
    assert.ok(page.data.createdNotice.includes('存储'), `${label}：${page.data.createdNotice}`)
    assert.ok(page.data.createdNotice.includes('重新下单'), `${label}：必须给出可执行的下一步`)

    page.continueFlow()
    await flush(); await flush()
    assert.equal(creates.length, 0, `${label}：一个 POST 都不许发`)
    const held = idem.findRecord('u:A', print)
    assert.ok(held && held.key === oldKey, `${label}：旧键必须原样留着（丢了它服务端连回放的机会都没有）`)

    // 存储恢复之后，同一个按钮必须真的能把锁解开 —— 这不是一条死路。
    wx.setStorageSync = realSet
    page[handler]()
    assert.equal(page.data.createdLocked, false, `${label}：存储恢复后必须真的能重新下单`)
    assert.equal(idem.findRecord('u:A', print), null, `${label}：这一次记录是真的清掉了`)
  }
})

test('R8-C2 orderId 没能落进恢复记录：页面保持锁定并指路，不跳转、不解锁、不重试', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const idem = requireMiniapp('../utils/print-order-idempotency.js')
  const { page, creates, sentKeys } = payPage(wx)
  page.onLoad(PAY_QUERY)
  await flush()
  page.continueFlow()
  await flush(); await flush()
  assert.equal(creates.length, 1, '前提：键落住了，POST 真的发出去了')
  const mintedKey = sentKeys[0]

  // 200 回来这一刻本机已经写不进去了（不抛异常，也不真的写进去）。
  wx.setStorageSync = () => {}
  creates[0].resolve({ id: 'ord-new' })
  await flush()

  assert.equal(wx.calls.redirectTo.length, 0,
    'orderId 没落住还跳走 = 跳转成功回调 clearRecord 把仅剩的那个键也清掉，回来就是第二张订单')
  assert.equal(page.data.createdLocked, true)
  assert.equal(page.data.submitting, false, '不得把用户留在「正在提交…」里')
  assert.ok(page.data.createdNotice.includes('打印订单'), page.data.createdNotice)
  assert.ok(page.data.createdNotice.includes('不要重复提交'), page.data.createdNotice)

  page.continueFlow()
  await flush(); await flush()
  assert.equal(creates.length, 1, '不得重试 POST（订单在服务端已经建成了）')

  // 键必须还在：真要再提交，也只能是同键回放同一张单。
  const held = idem.findRecord('u:A', idem.fingerprintOf(PAY_PAYLOAD))
  assert.ok(held && held.key === mintedKey, '那个键是唯一还能指回这张订单的东西，不许丢')
})

test('R8-D 小程序被杀掉重进：未落定的那条记录仍然受保护（钉子在内存里，重进就没了）', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const idem = requireMiniapp('../utils/print-order-idempotency.js')
  const print = idem.fingerprintOf(PAY_PAYLOAD)
  const flying = await idem.ensureKey('u:A', print)   // 这一条的 POST 正在飞，还没拿到 orderId

  // 杀掉重进：模块换一份新的，内存里的 minting / 钉子全是空的。
  const reloaded = freshIdem()
  assert.notEqual(reloaded, idem, '前提：确实拿到了一份全新的模块实例')

  // 重进之后又发生了一批**已经落定**的下单（改份数、换终端、别的文件）。
  const now = Date.now()
  const rows = wx.storage.get(idem.STORE_KEY).map((r) => Object.assign({}, r, { createdAt: now - 60000 }))
  for (let i = 0; i < 40; i += 1) {
    rows.push({ account: 'u:A', fingerprint: `done-${i}`, key: fakeKey(i), orderId: `ord-${i}`, createdAt: now - i })
  }
  wx.storage.set(idem.STORE_KEY, rows)
  reloaded.rememberOrderId('u:A', 'done-0', fakeKey(0), 'ord-0')   // 任何一次写入都会走一遍淘汰

  const still = reloaded.findRecord('u:A', print)
  assert.ok(still, '重进之后那条未落定的记录被挤掉了 —— 响应一丢，下一次提交就是第二张订单')
  assert.equal(still.key, flying.key, '而且必须是同一个键')

  const kept = wx.storage.get(idem.STORE_KEY)
  assert.equal(kept.filter((r) => r.orderId).length, reloaded.MAX_SETTLED_RECORDS,
    '已落定的那一档照样有界（它丢了最多多一张订单，不像未落定那档会多一张且无从判断）')
  assert.equal(kept.filter((r) => !r.orderId).length, 1, '未落定的那一条一直在')
})

test('R8-D2 未落定的名额用尽：拒绝铸新键（fail-closed），一条既有记录都不删', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const idem = freshIdem()
  const now = Date.now()
  const rows = []
  for (let i = 0; i < idem.MAX_PENDING_RECORDS; i += 1) {
    rows.push({ account: 'u:A', fingerprint: `flying-${i}`, key: fakeKey(i), orderId: '', createdAt: now - i })
  }
  wx.storage.set(idem.STORE_KEY, rows)
  const randomsBefore = wx.calls.getRandomValues.length

  const print = idem.fingerprintOf(PAY_PAYLOAD)
  await assert.rejects(() => idem.ensureKey('u:A', print), /没有落定/,
    '名额满了就必须拒绝，而不是挤掉一条在飞的记录')
  assert.equal(wx.calls.getRandomValues.length, randomsBefore, '拒绝要发生在铸键之前，不必白取一次随机数')

  const after = wx.storage.get(idem.STORE_KEY)
  assert.equal(after.length, rows.length, '拒绝的代价是用户重试一次；挤掉的代价是第二张订单、第二笔钱')
  for (let i = 0; i < idem.MAX_PENDING_RECORDS; i += 1) {
    assert.equal(idem.findRecord('u:A', `flying-${i}`).key, fakeKey(i), `flying-${i} 必须原样还在`)
  }

  // 名额满**不该把自己也挡住**：同一格已经有记录时照常复用它。
  const reuse = await idem.ensureKey('u:A', 'flying-0')
  assert.equal(reuse.key, fakeKey(0), '复用既有记录不占新名额，挡掉它等于把已经在飞的那一单也废了')
})

test('R8-E 恢复出来的订单当时还活着：回到本页必须重新核一次（它可能已经被取消 / 过期）', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, lookups, creates } = await payPageWithStoredOrder(wx, 'ord-live')
  lookups[0].resolve({ id: 'ord-live', pickupStatus: 'pending', taskStatus: 'pending' })
  await flush()
  assert.equal(page.data.createdState, 'live', '前提：这一刻它确实还活着')
  assert.equal(page.data.createdCanReorder, false)

  // 用户照着提示去「我的 · 打印订单」，把那张订单取消了，然后回到本页。
  page.onShow()
  assert.equal(lookups.length, 2, '「还活着」是一个会到期的结论，不能缓存成永久判定')
  assert.equal(page.data.createdState, 'checking', '重新核的时候要如实说在核，不能继续显示上一次的结论')
  lookups[1].resolve({ id: 'ord-live', pickupStatus: 'cancelled', taskStatus: 'cancelled' })
  await flush()
  assert.equal(page.data.createdState, 'terminal')
  assert.equal(page.data.createdCanReorder, true, '服务端已经证明它作废了：必须给出一条重新下单的路')

  // 终态可以缓存：它不会再变回活的。
  page.onShow()
  assert.equal(lookups.length, 2, '终态不必反复问服务端')
  assert.equal(page.data.createdCanReorder, true)
  assert.equal(creates.length, 0, '整个过程一个 POST 都不许发')
})

test('R8-E2 同一张订单在核的时候连着 onShow 两次：只打一发 GET', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const { page, lookups } = await payPageWithStoredOrder(wx, 'ord-live')
  assert.equal(lookups.length, 1)
  page.onShow()
  page.onShow()
  assert.equal(lookups.length, 1, '在飞时不得重复打（_verifyingOrderId 就是为这个在的）')
  lookups[0].resolve({ id: 'ord-live', pickupStatus: 'pending', taskStatus: 'pending' })
  await flush()
  assert.equal(page.data.createdState, 'live')
})

test('R8-F 设备时钟往回拨：未来时间戳的记录仍然有效，不得因此铸第二个键', async () => {
  const wx = createWx()
  useRealAuth(wx, 'A')
  const idem = freshIdem()
  const print = idem.fingerprintOf(PAY_PAYLOAD)
  const first = await idem.ensureKey('u:A', print)

  // 时钟回跳（用户手动改时间 / NTP 回退 / 换运营商时间）：这台设备自己刚写下的那条
  // 记录于是落在"未来"。它不是坏数据 —— 键是好的，服务端也认。
  const future = wx.storage.get(idem.STORE_KEY).map((r) => Object.assign({}, r, { createdAt: Date.now() + 86400e3 }))
  wx.storage.set(idem.STORE_KEY, future)
  const randomsBefore = wx.calls.getRandomValues.length
  const again = await idem.ensureKey('u:A', print)
  assert.equal(again.key, first.key, '把"未来"当无效 = 铸一个新键 = 服务端按新键再建一张订单')
  assert.equal(wx.calls.getRandomValues.length, randomsBefore, '连一次新的铸键都不该发生')

  // 但形状不对的 createdAt 仍然一律作废：那不是时钟问题，是坏数据。
  wx.storage.set(idem.STORE_KEY, future.map((r) => Object.assign({}, r, { createdAt: Number.NaN })))
  assert.equal(idem.findRecord('u:A', print), null, 'NaN 时间戳算不出任何可信结论，必须作废')
  wx.storage.set(idem.STORE_KEY, future.map((r) => Object.assign({}, r, { createdAt: '昨天' })))
  assert.equal(idem.findRecord('u:A', print), null, '非数字时间戳同样作废')

  // 真正过期的（7 天以上）照常淘汰 —— 放宽的只有未来那一侧。
  wx.storage.set(idem.STORE_KEY, future.map((r) => Object.assign({}, r, { createdAt: Date.now() - idem.TTL_MS - 1000 })))
  assert.equal(idem.findRecord('u:A', print), null, '真的过期了还是要过期')
})

test('R8-B3 取件页 _ownsResponse 的放行条件：三条缺一不可，其余一律 fail-closed', async () => {
  const wx = createWx()
  const auth = useRealAuth(wx, 'A')
  const api = { getCloudPrintOrder: () => deferred().promise }
  const page = makePage('pages/print-pickup/print-pickup.js', { auth, api, wx })
  page.onLoad({ orderId: 'ord-A' })
  assert.equal(page._openerAccount, 'u:A', '前提：开这一页的是 A')
  assert.equal(page._account, 'u:A')

  // 这一条**直接测判定函数本身**，而不是绕着页面摆一个能触发它的状态。
  // 理由：今天这几条里有两条在页面上暂时到不了 —— `_resolveIdentity` 的粘性 foreign
  // 标记会先一步把换人那条路截掉。但那是**那个函数的实现细节**（一面内存里的旗子），
  // 而"什么样的响应才配画到屏幕上"是**这个函数的契约**。只测得到的那条路，等于把契约
  // 的正确性押在另一个函数的当前写法上：那边哪天被重构掉，这边就会静默地放行一张
  // 不属于当前这位的取件凭证，而所有门禁全绿。所以契约自己钉自己。
  assert.equal(page._ownsResponse('ok', 'u:A'), true, "'ok' 是确定的本人，直接放行")
  assert.equal(page._ownsResponse('resignable', 'u:A'), true,
    '同一位 A 在请求在途期间自然过期：服务端刚确认过这条响应属于他，必须放行')

  assert.equal(page._ownsResponse('changed', 'u:A'), false, "'changed' 一律 fail-closed")
  assert.equal(page._ownsResponse('unusable', 'u:A'), false, "'unusable' 一律 fail-closed")

  assert.equal(page._ownsResponse('resignable', 'u:B'), false,
    '这一发是别人的登录态发出去的，它的响应不属于屏幕上这位')

  page._openerAccount = 'u:B'
  assert.equal(page._ownsResponse('resignable', 'u:A'), false,
    '开这一页、也就是这张 orderId 所属的那位，不是当前这位')

  page._openerAccount = 'u:A'
  page._account = ''
  assert.equal(page._ownsResponse('resignable', ''), false,
    '没有一个确定的会员键就证不出归属（宁可多一次登录，不可把凭证给一个认不出的会话）')
  page._account = '!'
  assert.equal(page._ownsResponse('resignable', '!'), false,
    "登录着却拿不到会员 id（'!'）是所有无 id 会话共享的键，一律不算本人")

  // **开页那位也认不出来**的那一种，单独钉一次。
  // 它是真实形态：打开本页时本地 JWT 已经过期（快照为空、`_openerAccount` 从来没被写过），
  // 请求照常带着补签资格发出去。此时"当前这位 === 发起那位 === 开页那位"三个条件
  // 全部退化成 `'' === ''` —— 全都成立，而屏幕上其实一个能认出来的人都没有。
  // 唯一挡得住的就是「快照必须是一个确定的会员键」那一条。
  page._openerAccount = ''
  page._account = ''
  assert.equal(page._ownsResponse('resignable', ''), false,
    '三个"相等"全是空串相等，证明不了任何归属；这一格必须靠"是不是会员键"挡住')
  page._account = '!'
  assert.equal(page._ownsResponse('resignable', '!'), false,
    '无 id 会话同理：认不出人就不显示凭证')
})
