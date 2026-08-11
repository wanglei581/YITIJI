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

// payStatus 门控：未付款时覆盖显示
function resolveDisplayStatus(item) {
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
  if (cents == null) return '—'
  if (cents === 0)   return '免费'
  return '¥' + (cents / 100).toFixed(2)
}

// 取件码格式化：每 2 位一组方便阅读，如 "AB-C3-9M"
function fmtCode(raw) {
  if (!raw) return ''
  const s = raw.replace(/\s/g, '').toUpperCase()
  return s.match(/.{1,2}/g).join('-')
}

// 后端 item → UI 展示对象
function toUiItem(item) {
  const ds = resolveDisplayStatus(item)
  const action = ds.key === 'done' && item.status === 'completed' ? 'reprint'
               : (item.pickupCode && ds.key === 'waiting')        ? 'pickup'
               : null
  return {
    id:          item.id,
    store:       item.terminalDisplayName || item.terminalName || item.storeName || item.locationLabel || '打印服务终端',
    title:       item.fileName || '打印文件',
    spec:        buildSpec(item),
    price:       formatPrice(item.amountCents),
    status:      ds.key,
    statusLabel: ds.label,
    statusTone:  ds.tone,
    pickup:      fmtCode(item.pickupCode),
    pickupRaw:   item.pickupCode || '',
    expiresAt:   item.expiresAt || item.pickupExpiresAt || '',
    taskStatus:  item.status || '',
    // 已完成可再打一份；取件码可见时显示"查看取件码"
    action,
    actionLabel: action === 'pickup' ? '查看取件码'
               : action === 'reprint' ? '再打印一份'
               : '',
    orderId: item.id,  // printTaskId 即 orderId（pickup 端点用）
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

  _load(append = false) {
    if (!auth.isLoggedIn()) return
    const cursor = append ? this.data.nextCursor : null
    this.setData({ [append ? 'loadingMore' : 'loading']: true, error: '' })
    api.getMyPrintOrders({ pageSize: 20, ...(cursor ? { cursor } : {}) })
      .then(items => {
        const uiItems = (Array.isArray(items) ? items : []).map(toUiItem)
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
    this._load()
    wx.stopPullDownRefresh()
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
      // 当前主项目没有独立取件详情端点；只传订单列表真实返回的取件码。
      const query = [
        `pickupCode=${encodeURIComponent(item.pickupRaw)}`,
        `orderNo=${encodeURIComponent(item.orderId)}`,
        `taskStatus=${encodeURIComponent(item.taskStatus)}`,
        `expiresAt=${encodeURIComponent(item.expiresAt)}`,
      ].join('&')
      wx.navigateTo({ url: `/pages/print-pickup/print-pickup?${query}` })
    } else if (item.action === 'reprint') {
      wx.navigateTo({ url: '/pages/documents/documents' })
    }
  },

  // 当前后端没有独立的订单详情端点；用列表返回的真实字段展示只读详情。
  detail(e) {
    const item = this.data.filtered.find(o => o.id === e.currentTarget.dataset.id)
    if (!item) return
    const lines = [
      `状态：${item.statusLabel}`,
      `规格：${item.spec}`,
      `金额：${item.price}`,
    ]
    if (item.pickup) lines.push(`取件码：${item.pickup}`)
    wx.showModal({
      title: item.title,
      content: lines.join('\n'),
      showCancel: false,
      confirmText: '知道了',
    })
  },

  // 去登录
  toLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  toPrint() {
    wx.navigateTo({ url: '/pages/documents/documents' })
  },
})
