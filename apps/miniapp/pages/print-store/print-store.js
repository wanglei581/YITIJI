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
    // 只把**非敏感且下一页确实需要**的四项交出去：本人文件 id、终端 id、
    // 终端公开显示名（/terminals/public 的公开字段）、份数。
    //
    // 拿掉的是 pickupCode / expiresAt / amountCents / total / name / bundleId：
    //   - pickupCode / expiresAt 在这一步**根本还不存在**（订单还没建），
    //     它们是从上游原样转发下来的空壳参数，却给了一条"到机码可以走 URL"的现成路子；
    //   - amountCents / total 是金额：下一页现在向服务端 /orders/quote 要真值，
    //     不再由调用方"告诉"它该显示多少钱；
    //   - name 是文件名，而求职材料的文件名里常常就写着本人姓名
    //     （「张三的简历.pdf」）。一条构造出来或转发出去的链接就能把它渲染在别人手机上。
    //   - bundleId 下一页从来没读过，是纯粹的死参数。
    // 同 package-confirm → package-code 的口径：凭证与金额只能来自带登录态的服务端响应。
    wx.navigateTo({
      url: `/pages/print-pay/print-pay?fileId=${encodeURIComponent(q.fileId || '')}&storeId=${encodeURIComponent(store.id)}&store=${encodeURIComponent(store.displayName)}&copies=${encodeURIComponent(q.copies || '')}`,
    })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
