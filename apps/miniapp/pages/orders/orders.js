// pages/orders/orders.js
// 本人打印订单列表。接真实 GET /api/v1/me/print-orders。
const app = getApp()
const auth = require('../../utils/auth')
const api = require('../../utils/api')

// PrintTask.status (后端) → UI 展示状态映射
const STATUS_MAP = {
  pending:   { key: 'waiting',  label: '待取件', tone: 'wheat' },
  claimed:   { key: 'waiting',  label: '待取件', tone: 'wheat' },
  printing:  { key: 'printing', label: '打印中',  tone: 'teal'  },
  completed: { key: 'done',     label: '已完成', tone: 'ok'    },
  failed:    { key: 'done',     label: '打印失败', tone: 'danger'},
  cancelled: { key: 'done',     label: '已取消', tone: 'neutral'},
}

function parseAmountCents(value) {
  if (value === undefined || value === null || value === '') return null
  const amountCents = Number(value)
  return Number.isSafeInteger(amountCents) && amountCents >= 0 ? amountCents : null
}

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

// 到机码格式化：每 2 位一组方便阅读，如 "AB-C3-9M"
function fmtCode(raw) {
  if (!raw) return ''
  const s = raw.replace(/\s/g, '').toUpperCase()
  return s.match(/.{1,2}/g).join('-')
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
    orders: [],    // 全量（已转换为 uiItem）
    filtered: [],  // 当前 tab 显示
    loading: false,
    error: '',
    nextCursor: null,
    loadingMore: false,
    isLoggedIn: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    const loggedIn = auth.isLoggedIn()
    this.setData({ isLoggedIn: loggedIn })
    if (loggedIn) {
      this._load()
    } else {
      this.setData({ orders: [], filtered: [], error: '' })
    }
  },

  // 始终返回 Promise：下拉刷新要等真实请求结束才能收起指示器，
  // 提前 stopPullDownRefresh 会让「下拉刷新重试」看起来刷过但其实什么都没等到。
  _load(append = false) {
    if (!auth.isLoggedIn()) return Promise.resolve()
    const cursor = append ? this.data.nextCursor : null
    this.setData({ [append ? 'loadingMore' : 'loading']: true, error: '' })
    const legacyPromise = api.getMyPrintOrders({ pageSize: 20, ...(cursor ? { cursor } : {}) })
    const requestPromise = append ? legacyPromise.then(items => [[], items]) : Promise.all([api.getMyCloudPrintOrders(), legacyPromise])
    return requestPromise
      .then(([cloudItems, items]) => {
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
        console.error('getMyPrintOrders error', err)
        this.setData({ loading: false, loadingMore: false, error: '加载失败，下拉刷新重试' })
      })
  },

  _filterTab(key, orders) {
    const all = orders || this.data.orders
    const filtered = key === 'all' ? all : all.filter(o => o.status === key)
    this.setData({ activeTab: key, filtered })
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  setTab(e) {
    this._filterTab(e.currentTarget.dataset.key)
  },

  onPullDownRefresh() {
    const stop = () => wx.stopPullDownRefresh()
    this._load().then(stop, stop)
  },

  onReachBottom() {
    if (this.data.nextCursor && !this.data.loadingMore) {
      this._load(true)
    }
  },

  // 主操作按钮
  primary(e) {
    const item = this.data.filtered.find(o => o.id === e.currentTarget.dataset.id)
    if (!item) return
    if (item.action === 'pickup') {
      // 取件页先用列表字段首屏渲染，再按 orderId 轮询本人订单详情实时撤码/更新状态。
      const query = [
        `pickupCode=${encodeURIComponent(item.pickupRaw)}`,
        `orderId=${encodeURIComponent(item.orderId)}`,
        `orderNo=${encodeURIComponent(item.orderNo)}`,
        `taskStatus=${encodeURIComponent(item.taskStatus)}`,
        `expiresAt=${encodeURIComponent(item.expiresAt)}`,
        `amountCents=${encodeURIComponent(item.amountCents == null ? '' : item.amountCents)}`,
        'source=orders',
      ].join('&')
      wx.navigateTo({ url: `/pages/print-pickup/print-pickup?${query}` })
    } else if (item.action === 'reprint') {
      wx.navigateTo({ url: '/pages/documents/documents' })
    }
  },

  // 列表卡片保持轻量只读；详情页按 orderId 读取真实详情。
  detail(e) {
    const item = this.data.filtered.find(o => o.id === e.currentTarget.dataset.id)
    if (!item) return
    wx.navigateTo({ url: `/pages/order-detail/order-detail?orderId=${encodeURIComponent(item.id)}` })
  },

  // 去登录
  toLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  toPrint() {
    wx.navigateTo({ url: '/pages/documents/documents' })
  },
})
