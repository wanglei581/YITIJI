// pages/print-store/print-store.js
// 选择门店（终端）。调 GET /api/v1/terminals/public 获取真实在线终端列表。
const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    statusBarHeight: 20,
    q: {},
    isFreeOrder: false,
    stores: [],
    picked: '',
    loading: true,
    loadError: '',
  },

  onLoad(opts) {
    const q = opts || {}
    const amountCents = Number(q.amountCents)
    const hasAmount = q.amountCents !== undefined && q.amountCents !== '' && Number.isSafeInteger(amountCents) && amountCents >= 0
    this.setData({
      statusBarHeight: getApp().globalData.statusBarHeight || 20,
      q,
      isFreeOrder: hasAmount && amountCents === 0,
    })
    this._loadTerminals()
  },

  _loadTerminals() {
    this.setData({ loading: true, loadError: '' })
    api.getPublicTerminals()
      .then(data => {
        // 后端返回 PublicTerminalView[] 或包装在 data 字段里
        const list = Array.isArray(data) ? data : (data && data.data) || []
        this.setData({
          stores: list,
          loading: false,
          // 只有一个终端时自动选中
          picked: list.length === 1 ? list[0].id : '',
        })
      })
      .catch(err => {
        this.setData({
          loading: false,
          loadError: (err && err.error && err.error.message) || '加载终端列表失败，请重试',
        })
      })
  },

  reload() { this._loadTerminals() },

  pick(e) {
    this.setData({ picked: e.currentTarget.dataset.id })
  },

  toPay() {
    const { q, picked, stores } = this.data
    const store = stores.find(s => s.id === picked)
    if (!store) {
      wx.showToast({ title: '请先选择门店', icon: 'none' })
      return
    }
    if (!store.isOnline) {
      wx.showModal({
        title: '该终端暂时离线',
        content: '所选门店的打印终端暂时离线，请选择其他门店或稍后再试。',
        showCancel: false,
      })
      return
    }
    const amountCents = q.amountCents === undefined ? '' : q.amountCents
    wx.navigateTo({
      url: `/pages/print-pay/print-pay?fileId=${encodeURIComponent(q.fileId || '')}&pages=${encodeURIComponent(q.pages || '')}&color=${encodeURIComponent(q.color || '')}&duplex=${encodeURIComponent(q.duplex || '')}&copies=${encodeURIComponent(q.copies || '')}&total=${encodeURIComponent(q.total || '')}&amountCents=${encodeURIComponent(amountCents)}&store=${encodeURIComponent(store.displayName)}&storeId=${encodeURIComponent(store.id)}&name=${encodeURIComponent(q.name || '')}&bundleId=${encodeURIComponent(q.bundleId || '')}&pickupCode=${encodeURIComponent(q.pickupCode || '')}&expiresAt=${encodeURIComponent(q.expiresAt || '')}`,
    })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
