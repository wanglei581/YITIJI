// pages/order-detail/order-detail.js
const app = getApp()
const api = require('../../utils/api')

const STATUS_MAP = {
  pending:   '待取件',
  claimed:   '待取件',
  printing:  '打印中',
  completed: '已完成',
  failed:    '打印失败',
  cancelled: '已取消',
}

const STATUS_TONE = {
  pending: 'wheat', claimed: 'wheat', printing: 'teal',
  completed: 'ok', failed: 'danger', cancelled: 'neutral',
}

function fmtCode(raw) {
  if (!raw) return ''
  const s = String(raw).replace(/\s/g, '').toUpperCase()
  // groups 判空：纯空白入参 replace 后为空串，match 返回 null，直接 .join 会 THROW
  const groups = s.match(/.{1,2}/g)
  return groups ? groups.join('-') : ''
}

function fmtPrice(cents) {
  const n = Number(cents)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n === 0) return '免费'
  return '¥' + (n / 100).toFixed(2)
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function buildSpec(item) {
  const parts = []
  if (item.paperSize)     parts.push(String(item.paperSize).toUpperCase())
  if (item.colorMode)     parts.push(item.colorMode === 'color' ? '彩色' : '黑白')
  if (item.copies)        parts.push(`${item.copies} 份`)
  if (item.billablePages) parts.push(`共 ${item.billablePages} 页`)
  return parts.join(' · ') || '—'
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    error: '',
    detail: null,
  },

  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this._orderId = options.orderId || ''
    this._load()
  },

  _load() {
    if (!this._orderId) {
      this.setData({ loading: false, error: '订单 ID 缺失' })
      return
    }
    this.setData({ loading: true, error: '' })
    api.getCloudPrintOrder(this._orderId)
      .then((raw) => {
        const status = raw.status || raw.taskStatus || ''
        const pickupRaw = (!raw.status && raw.pickupStatus === 'pending') ? (raw.pickupCode || '') : ''
        this.setData({
          loading: false,
          detail: {
            fileName:    raw.fileName || '打印文件',
            store:       raw.terminalDisplayName || raw.terminalName || raw.storeName || '打印服务终端',
            spec:        buildSpec(raw),
            price:       fmtPrice(raw.amountCents),
            statusLabel: STATUS_MAP[status] || status || '未知',
            statusTone:  STATUS_TONE[status] || 'neutral',
            pickup:      fmtCode(pickupRaw),
            createdAt:   fmtTime(raw.createdAt),
          },
        })
      })
      .catch((err) => {
        this.setData({
          loading: false,
          error: (err && err.message) || '加载失败，请稍后重试',
        })
      })
  },

  retry() { this._load() },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.navigateTo({ url: '/pages/orders/orders' }) } })
  },

  toPrint() {
    wx.navigateTo({ url: '/pages/documents/documents' })
  },
})
