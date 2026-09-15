// pages/orders/orders.js
// 本人打印订单的统一视图。三个来源，各自独立请求、独立失败、独立分页：
//   ① 云打印订单        GET /me/print-orders/cloud   （Order-only，单文件）
//   ② 一体机历史任务    GET /me/print-orders         （PrintTask，游标分页）
//   ③ 材料包订单        GET /orders/package          （多文件，游标分页）
//
// 为什么要分区而不是合成一条列表：①② 与 ③ 是**两套 id 空间和两个独立游标**。
// 合成一页就必须把两个 cursor 当成一个用 —— 触底时不知道该推进哪一个，推错就会
// 静默丢掉一整段订单（用户看到的是「我的订单少了」，而页面一切正常）。
// 所以材料包单独成区，带自己的 total、自己的「加载更多」和自己的失败态；
// ①② 仍走原来的触底分页。
//
// 材料包卡片点进去**只带 orderId**：到机码是去一体机取件的凭证，经 URL 传递等于
// 一条构造出来的链接或一张转发出去的卡片就能在别人手机上渲染出带码的成功页。
// package-code 自己带登录态去 GET /orders/package/:id 核一次（服务端 requireOwned）。
const app = getApp()
const auth = require('../../utils/auth')
const api = require('../../utils/api')
const pkg = require('../../utils/package-order')
const { createLifecycleGuard, memberIdentityKey, isMemberIdentity } = require('../../utils/page-guard')

const PAGE_SIZE = 20

// PrintTask.status (后端) → UI 展示状态映射
const STATUS_MAP = {
  pending:   { key: 'waiting',  label: '待取件', tone: 'wheat' },
  claimed:   { key: 'waiting',  label: '待取件', tone: 'wheat' },
  printing:  { key: 'printing', label: '打印中',  tone: 'teal'  },
  completed: { key: 'done',     label: '已完成', tone: 'ok'    },
  failed:    { key: 'done',     label: '打印失败', tone: 'danger'},
  cancelled: { key: 'done',     label: '已取消', tone: 'neutral'},
}

// 分 → 元、到机码分组：与材料包区共用 utils/package-order 的同一份实现，
// 不再在本页维护第二份（同一函数曾在全仓有三份拷贝，改一处漂一处）。
const parseAmountCents = pkg.parseAmountCents
const fmtCode = pkg.formatPickupCode

// payStatus 门控：未付款时覆盖显示
function resolveDisplayStatus(item) {
  const amountCents = parseAmountCents(item.amountCents)
  if (item.pickupStatus === 'pending') return { key: 'waiting', label: '待到机', tone: 'wheat' }
  if (item.pickupStatus === 'claimed' && !item.printTaskId) {
    return amountCents === 0
      ? { key: 'waiting', label: '正在进入队列', tone: 'teal' }
      : { key: 'waiting', label: '待现场支付', tone: 'wheat' }
  }
  if (item.pickupStatus === 'expired') return { key: 'done', label: '已过期', tone: 'neutral' }
  if (item.pickupStatus === 'cancelled') return { key: 'done', label: '已取消', tone: 'neutral' }
  const pay = item.payStatus
  if (pay === 'unpaid' || pay == null) {
    return { key: 'payment', label: '待付款', tone: 'wheat' }
  }
  return STATUS_MAP[item.status] || { key: 'done', label: item.status, tone: 'neutral' }
}

// colorMode + paperSize + copies + pages → 规格摘要
function buildSpec(item) {
  const parts = []
  if (item.paperSize) parts.push(item.paperSize.toUpperCase())
  if (item.colorMode) parts.push(item.colorMode === 'color' ? '彩色' : '黑白')
  if (item.copies)    parts.push(`${item.copies} 份`)
  if (item.billablePages) parts.push(`共 ${item.billablePages} 页`)
  return parts.join(' · ') || '—'
}

// 金额：分 → 元字符串（0 分 = 免费）
function formatPrice(cents) {
  const amountCents = parseAmountCents(cents)
  if (amountCents == null) return '—'
  if (amountCents === 0)   return '免费'
  return '¥' + (amountCents / 100).toFixed(2)
}

// MP-05：仅云打印 Order-only，且拍板第 5 条 unpaid + pending。材料包没有取消端点，不放该按钮。
function canCancelCloudOrder(item) {
  return !item.status
    && item.payStatus === 'unpaid'
    && item.pickupStatus === 'pending'
}

// 后端 item → UI 展示对象
function toUiItem(item) {
  const ds = resolveDisplayStatus(item)
  const amountCents = parseAmountCents(item.amountCents)
  const effectiveStatus = item.status || item.taskStatus || ''
  // 到机码只在尚未核销的 Order-only 阶段展示；扫码 claimed 或创建 PrintTask 后立即撤下。
  const pickupRaw = !item.status && item.pickupStatus === 'pending' ? (item.pickupCode || '') : ''
  const action = ds.key === 'done' && effectiveStatus === 'completed' ? 'reprint'
               : (pickupRaw && ds.key === 'waiting')              ? 'pickup'
               : null
  return {
    id:          item.id,
    // 列表把两套 id 空间拼在一起：cloud 段来自 Order（toView 只发 taskStatus），
    // legacy 段来自 PrintTask（select 里带 status）。详情端点 requireOwned() 只查
    // prisma.order，拿 PrintTask.id 去打必回 PRINT_ORDER_NOT_FOUND。
    // 所以「订单详情」只能对 Order 行开放；这个判别位和下面到机码那行用的是同一个。
    cloudOrder:  !item.status,
    orderNo:     item.orderNo || item.id,
    store:       item.terminalDisplayName || item.terminalName || item.storeName || item.locationLabel || '打印服务终端',
    title:       item.fileName || '打印文件',
    spec:        buildSpec(item),
    price:       formatPrice(amountCents),
    status:      ds.key,
    statusLabel: ds.label,
    statusTone:  ds.tone,
    pickup:      fmtCode(pickupRaw),
    pickupRaw,
    expiresAt:   item.pickupCodeExpiresAt || item.expiresAt || item.pickupExpiresAt || '',
    taskStatus:  effectiveStatus,
    payStatus:   item.payStatus || '',
    pickupStatus: item.pickupStatus || '',
    canCancel:   canCancelCloudOrder(item),
    cancelling:  false,
    // 已完成可再打一份；到机码可见时显示"查看到机码"
    action,
    actionLabel: action === 'pickup' ? '查看到机码'
               : action === 'reprint' ? '再打印一份'
               : '',
    orderId: item.id,
    amountCents,
  }
}

Page({
  data: {
    statusBarHeight: 20,
    activeTab: 'all',
    tabs: [
      { key: 'all',      label: '全部' },
      { key: 'waiting',  label: '待取件' },
      { key: 'printing', label: '打印中' },
      { key: 'done',     label: '已完成' },
    ],
    orders: [],    // 单件打印：全量（已转换为 uiItem）
    filtered: [],  // 单件打印：当前 tab 显示
    loading: false,
    error: '',
    nextCursor: null,
    loadingMore: false,
    isLoggedIn: false,

    // ── 材料包分区（独立来源、独立游标、独立失败态）──────────────────
    pkgRows: [],
    pkgFiltered: [],
    pkgState: 'idle',      // idle | loading | ready | error
    pkgErrorTitle: '',
    pkgErrorText: '',
    pkgCursor: null,
    pkgLoadingMore: false,
    // 「加载更多」失败单独成一个字段：写进 pkgState 会让整段已加载的订单被错误态顶掉 ——
    // 用户已经看到的订单不该因为下一页失败而消失。
    pkgMoreErrorText: '',
    pkgTotal: 0,
    pkgOnsiteNotice: pkg.PACKAGE_ONSITE_NOTICE,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this._toUiItem = toUiItem
    this._cancelLocks = {}
    // 两个分区各占一个通道（single / package）：各自 latest-wins，互不牵连 ——
    // 一个分区的重新加载不该让另一个分区在途的响应失效。
    this._guard = createLifecycleGuard()
    this._guard.activate()
  },

  /**
   * 当前身份的稳定快照。判据是会员 id 而不是「有没有 token」：token 每次登录都换，
   * 但同一个人重登不该清空他自己的列表。三态：`''` 未登录 / `'!'` 登录但无 id（不可用）/
   * `'u:<id>'`。每次都现读，不缓存。见 page-guard.memberIdentityKey。
   */
  _identityKey() {
    return memberIdentityKey(auth)
  },

  /**
   * 身份判定 + **当场清场**。每个入口和每个异步回调都要过这里。
   *
   * 此前本页只在 `onShow` 里清：`_accepts()` 发现身份变了只是**丢弃那条响应**，
   * 屏幕上已经渲染出来的订单与到机码原样留着。可真实的失效链路里根本没有 onShow ——
   * `utils/request.js` 拿到 401 时会静默续签一次，续签失败就 `auth.logout()`，
   * 全程没有任何生命周期回调，页面还停在前台。于是共用设备上，一份带着到机码的
   * 订单列表就这么停在一个已经不存在的会话上，等着下一位来看。
   *
   * setIdentity 变化时会 +1 代次，上一位**在途**的请求一并作废 —— 只清 data 不作废请求，
   * 那几个迟到的响应会把上一位的订单又写回来。
   *
   * @returns {boolean} 现在还能不能用当前身份读写本人数据
   */
  _enforceIdentity() {
    const identity = this._identityKey()
    const usable = isMemberIdentity(identity)
    if (this._guard.setIdentity(identity)) {
      this._resetAll()
      this.setData({ isLoggedIn: usable })
      return usable
    }
    // 身份"没变"但本来就不可用（未登录 / 登录了却拿不到会员 id），而屏幕上还留着
    // 上一轮渲染出来的内容：同样要清。setIdentity 在这种情况下返回 false，
    // 只靠它判定会漏掉这一支。
    if (!usable && (this.data.orders.length || this.data.pkgRows.length || this.data.isLoggedIn)) {
      this._resetAll()
      this.setData({ isLoggedIn: false })
    }
    return usable
  },

  /** 这个响应还能不能写进 data：身份没变 + 页面在前台 + 是本通道最新一次请求。 */
  _accepts(token) {
    return this._guard.accepts(token, this._identityKey())
  },

  /**
   * 只按身份判定，不看前台/后台。
   *
   * 给"结果必须落地、否则会留下一个解不开的锁"的链用（取消订单）：
   * 切后台不该让那一行永远停在「取消中…」，只有换了人才必须停手。
   */
  _sameIdentity(token) {
    return !!token && this._identityKey() === token.identity
  },

  onShow() {
    this._guard.activate()
    // A 用户登出、B 用户登录后回到本页时，上一位的订单和到机码绝不能还留在 data 里。
    // 登录了却拿不到会员 id 时按未登录渲染：那种会话无法确认"我的"是谁的，
    // 拉列表等于拿一个所有人共享的身份键去要本人数据。用户的补救动作恰好就是重新登录。
    const usable = this._enforceIdentity()
    this.setData({ isLoggedIn: usable })
    if (usable) {
      this._load()
      this._loadPackages()
    }
  },

  // 切后台 / 离开本页：在途请求全部作废。
  // 只靠 loading 布尔锁挡不住这件事 —— 锁在请求发出时是开的，回调执行时早被清掉了。
  onHide() {
    this._guard.deactivate()
  },

  onUnload() {
    this._guard.deactivate()
  },

  /** 清空两个分区的全部数据与游标。跨用户、登出、下拉刷新前都必须走这里。 */
  _resetAll() {
    this.setData({
      orders: [], filtered: [], error: '', nextCursor: null, loadingMore: false,
      pkgRows: [], pkgFiltered: [], pkgState: 'idle', pkgErrorTitle: '', pkgErrorText: '',
      pkgCursor: null, pkgLoadingMore: false, pkgMoreErrorText: '', pkgTotal: 0,
    })
  },

  // 始终返回 Promise：下拉刷新要等真实请求结束才能收起指示器，
  // 提前 stopPullDownRefresh 会让「下拉刷新重试」看起来刷过但其实什么都没等到。
  _load(append = false) {
    if (!this._enforceIdentity()) return Promise.resolve()
    const token = this._guard.issue('single')
    const cursor = append ? this.data.nextCursor : null
    this.setData({ [append ? 'loadingMore' : 'loading']: true, error: '' })
    const legacyPromise = api.getMyPrintOrders({ pageSize: PAGE_SIZE, ...(cursor ? { cursor } : {}) })
    const requestPromise = append ? legacyPromise.then(items => [[], items]) : Promise.all([api.getMyCloudPrintOrders(), legacyPromise])
    return requestPromise
      .then(([cloudItems, items]) => {
        // 先**执行**身份判定再判能不能写：换了人 / 前台静默登出时，光丢弃这条响应
        // 不够 —— 屏幕上已经渲染出来的订单与到机码要在这一刻就清掉。
        this._enforceIdentity()
        // 迟到的响应到此为止：换了人、切了后台，或本通道已被重新发起过一次。
        if (!this._accepts(token)) return
        const combined = [...(Array.isArray(cloudItems) ? cloudItems : []), ...(Array.isArray(items) ? items : [])]
        const seen = new Set()
        const uiItems = combined.filter(item => {
          const key = item.id || item.printTaskId
          if (!key || seen.has(key)) return false
          seen.add(key)
          return true
        }).map(toUiItem)
        const orders  = append ? [...this.data.orders, ...uiItems] : uiItems
        const nextCursor = items.nextCursor || null
        this.setData({
          orders,
          nextCursor,
          loading: false, loadingMore: false,
        })
        this._filterTab(this.data.activeTab, orders)
      })
      .catch(err => {
        // 401 走到这里说明 request.js 连静默续签都没救回来（它续签失败时会 auth.logout()）。
        // 那一刻起列表里的到机码属于一个已经不存在的会话，必须当场清掉，
        // 不能等用户离开本页再回来才清。
        this._enforceIdentity()
        if (!this._accepts(token)) return
        console.error('getMyPrintOrders error', err)
        // 失败只写 error，**绝不清空 orders / filtered**：刷新或翻页失败不该让用户
        // 已经看到的订单消失（模板里「已有内容」的分支排在失败分支之前，
        // 错误落在列表页脚，既看得见又不顶掉内容）。
        this.setData({ loading: false, loadingMore: false, error: '加载失败，下拉刷新重试' })
      })
  },

  /**
   * 材料包订单分区。
   *
   * 游标只推进自己的 pkgCursor，与单件打印的 nextCursor 完全隔离。
   * 失败只染红本分区：单件打印那一段照常显示 —— 一个来源挂掉不该让整页订单消失。
   */
  _loadPackages(append = false) {
    if (!this._enforceIdentity()) return Promise.resolve()
    if (append && !this.data.pkgCursor) return Promise.resolve()
    const token = this._guard.issue('package')
    const cursor = append ? this.data.pkgCursor : null
    this.setData(append
      ? { pkgLoadingMore: true, pkgMoreErrorText: '' }
      : { pkgState: 'loading', pkgErrorTitle: '', pkgErrorText: '', pkgMoreErrorText: '' })
    return api.getPackageOrders({ pageSize: PAGE_SIZE, ...(cursor ? { cursor } : {}) })
      .then(page => {
        this._enforceIdentity()
        if (!this._accepts(token)) return
        const incoming = (Array.isArray(page && page.items) ? page.items : []).map(row => pkg.toPackageRow(row))
        const rows = append ? pkg.mergePackageRows(this.data.pkgRows, incoming) : incoming
        const total = Number(page && page.total)
        this.setData({
          pkgRows: rows,
          pkgCursor: (page && page.nextCursor) || null,
          pkgTotal: Number.isFinite(total) && total >= 0 ? total : rows.length,
          pkgState: 'ready',
          pkgLoadingMore: false,
          pkgErrorTitle: '', pkgErrorText: '', pkgMoreErrorText: '',
        })
        this._filterTab(this.data.activeTab)
      })
      .catch(err => {
        this._enforceIdentity()
        if (!this._accepts(token)) return
        const shown = pkg.describePackageError(err, '材料包订单加载失败，请稍后重试。')
        // 下一页失败只写 pkgMoreErrorText，已加载的那几页照常留在屏幕上；
        // 首屏/刷新失败才进 pkgState=error（此时本来也没有可保留的内容）。
        if (append) {
          this.setData({ pkgLoadingMore: false, pkgMoreErrorText: shown.text })
          return
        }
        this.setData({
          pkgState: 'error',
          pkgLoadingMore: false,
          pkgErrorTitle: shown.title,
          pkgErrorText: shown.text,
        })
      })
  },

  _filterTab(key, orders) {
    const all = orders || this.data.orders
    const filtered = key === 'all' ? all : all.filter(o => o.status === key)
    const pkgAll = this.data.pkgRows
    const pkgFiltered = key === 'all' ? pkgAll : pkgAll.filter(o => o.statusKey === key)
    this.setData({ activeTab: key, filtered, pkgFiltered })
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  setTab(e) {
    this._filterTab(e.currentTarget.dataset.key)
  },

  onPullDownRefresh() {
    const stop = () => wx.stopPullDownRefresh()
    // 下拉刷新也要先核一次身份。用户完全可能在本页停留期间被静默登出
    //（request.js 补签失败 → auth.logout()，没有任何生命周期回调），
    // 此时不核就会"刷新"出一页仍然属于上一个会话的订单与到机码：
    // 两个 _load 会各自早返回，而屏幕一个字都没变，看起来像刷新成功了。
    if (!this._enforceIdentity()) { stop(); return }
    // 两个来源并行重拉；任一失败只写自己的失败态，不会互相牵连。
    Promise.all([this._load(), this._loadPackages()]).then(stop, stop)
  },

  onReachBottom() {
    // 触底只推进单件打印的游标。材料包用本分区自己的「加载更多」按钮，
    // 两个游标结构上不可能被当成一个用。
    if (this.data.nextCursor && !this.data.loadingMore) {
      this._load(true)
    }
  },

  loadMorePackages() {
    if (this.data.pkgCursor && !this.data.pkgLoadingMore) this._loadPackages(true)
  },

  retryPackages() {
    this._loadPackages()
  },

  /**
   * 进入材料包到机码页。**只带 orderId**：到机码、金额、有效期由下一页凭登录态向
   * 服务端查（requireOwned 归属校验），不经 URL 传递。
   */
  openPackage(e) {
    const orderId = e.currentTarget.dataset.id
    if (!orderId) return
    wx.navigateTo({ url: `/pages/package-code/package-code?orderId=${encodeURIComponent(orderId)}` })
  },

  toPackageCreate() {
    wx.navigateTo({ url: '/pages/package-create/package-create' })
  },

  // 主操作按钮
  primary(e) {
    const item = this.data.filtered.find(o => o.id === e.currentTarget.dataset.id)
    if (!item) return
    if (item.action === 'pickup') {
      // **只带 orderId**（`source` 只是返回路径的提示，不是任何凭证或状态）。
      //
      // 此前这里把 pickupCode / amountCents / expiresAt / taskStatus / orderNo 一起拼进 URL。
      // 到机码是去一体机取件的凭证：进了 URL，一条构造出来的链接或一张转发出去的卡片
      // 就能在别人手机上渲染出一张带码的取件页；金额与有效期同样是本人订单状态，
      // 不该由调用方"告诉"下一页。print-pickup 自己带登录态查
      // GET /me/print-orders/:orderId（requireOwned 归属校验）拿真值。
      if (!item.orderId) return
      const query = `orderId=${encodeURIComponent(item.orderId)}&source=orders`
      wx.navigateTo({ url: `/pages/print-pickup/print-pickup?${query}` })
    } else if (item.action === 'reprint') {
      wx.navigateTo({ url: '/pages/documents/documents' })
    }
  },

  // 列表卡片保持轻量只读；详情页按 orderId 读取真实详情。
  detail(e) {
    const item = this.data.filtered.find(o => o.id === e.currentTarget.dataset.id)
    if (!item) return
    // 兜一道：一体机任务没有线上详情，点了只会 404。按钮本身已按 cloudOrder 隐藏。
    if (!item.cloudOrder) return
    wx.navigateTo({ url: `/pages/order-detail/order-detail?orderId=${encodeURIComponent(item.id)}` })
  },

  cancelOrder(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.filtered.find(o => o.id === id) || this.data.orders.find(o => o.id === id)
    if (!item || !item.canCancel || item.cancelling) return
    wx.showModal({
      title: '取消订单',
      content: '取消后到机码立即失效，且不能恢复。确定取消这张未付款订单？',
      confirmText: '确认取消',
      cancelText: '再想想',
      confirmColor: '#b5643c',
      success: (res) => {
        if (!res.confirm) return
        this._submitCancel(id)
      },
    })
  },

  _patchOrder(id, patch) {
    const apply = (list) => list.map(o => o.id === id ? Object.assign({}, o, patch) : o)
    const orders = apply(this.data.orders)
    this.setData({ orders, filtered: apply(this.data.filtered) })
    return orders
  },

  _submitCancel(id) {
    this._cancelLocks = this._cancelLocks || {}
    if (this._cancelLocks[id]) return
    const current = this.data.orders.find(o => o.id === id)
    if (!current || !current.canCancel) return
    this._cancelLocks[id] = true
    // 取消也是一条会回写列表的异步链：换了人 / 离开了本页之后，它的结果
    // 同样不能落到新身份的列表上。
    const token = this._guard.issue('cancel:' + id)
    this._patchOrder(id, { cancelling: true })
    api.cancelCloudPrintOrder(id)
      .then((raw) => {
        this._enforceIdentity()
        // 按身份而不是按前台判定：切后台不该让这一行永远停在「取消中…」。
        if (!this._sameIdentity(token)) return
        // 用服务端回读整行替换，不在本地写「已取消」。
        const next = toUiItem(raw)
        const orders = this.data.orders.map(o => o.id === id ? next : o)
        this.setData({ orders })
        this._filterTab(this.data.activeTab, orders)
      })
      .catch((err) => {
        this._enforceIdentity()
        if (!this._sameIdentity(token)) return
        // 先解锁再弹窗：早返回会把这一行永远留在「取消中…」，而它其实没有在取消。
        this._patchOrder(id, { cancelling: false })
        wx.showModal({
          title: '取消失败',
          content: (err && err.message) || '请稍后重试',
          showCancel: false,
        })
      })
      .then(() => { delete this._cancelLocks[id] })
  },

  // 去登录
  toLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  toPrint() {
    wx.navigateTo({ url: '/pages/documents/documents' })
  },
})
