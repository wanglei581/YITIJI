// pages/package-confirm/package-confirm.js
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { guardPackageChain } = require('../../utils/package-feature')

Page({
  data: {
    statusBarHeight: 44,
    packageData: null,
    storeData: null,
    submitting: false,
    finalPrice: '待确认',
    orderSummary: {
      fileCount: 0,
      totalPages: 0,
      copies: 1,
      colorMode: 'bw',
      duplex: 'single',
    },
    selectedPayment: 'wechat',
    paymentMethods: [
      { id: 'wechat', name: '微信支付', icon: 'credit-card', enabled: true },
      { id: 'balance', name: '余额支付', icon: 'wallet', enabled: false, tip: '余额不足' },
    ],
    agreedToTerms: true,
  },

  onLoad() {
    if (guardPackageChain()) return
    const { statusBarHeight } = app.globalData
    this.setData({ statusBarHeight: statusBarHeight || 44 })
    this._loadOrderData()
  },

  _loadOrderData() {
    const packageData = wx.getStorageSync('temp_package_data') || {}
    const storeData   = wx.getStorageSync('temp_selected_store') || {}

    const files = Array.isArray(packageData.files) ? packageData.files : []
    let totalPages = 0
    files.forEach(f => { totalPages += Number(f.pageCount || f.pages || 0) })

    this.setData({
      packageData,
      storeData,
      orderSummary: {
        fileCount:  files.length,
        totalPages,
        copies:    packageData.copies    || 1,
        colorMode: packageData.colorMode || 'bw',
        duplex:    packageData.duplex    || 'single',
      },
    })
  },

  selectPayment(e) {
    const { id } = e.currentTarget.dataset
    const method = this.data.paymentMethods.find(m => m.id === id)
    if (!method || !method.enabled) {
      wx.showToast({ title: method ? (method.tip || '该支付方式暂不可用') : '未知支付方式', icon: 'none' })
      return
    }
    this.setData({ selectedPayment: id })
  },

  toggleAgreement(e) {
    this.setData({ agreedToTerms: e.detail.value.length > 0 })
  },

  viewTerms() {
    wx.navigateTo({ url: '/pages/legal/legal' })
  },

  async submitOrder() {
    if (!this.data.agreedToTerms) {
      wx.showToast({ title: '请阅读并同意服务协议', icon: 'none' })
      return
    }
    if (this.data.submitting) return

    if (!auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/launch/launch' })
      return
    }

    const { packageData, storeData } = this.data
    if (!packageData || !storeData || !storeData.id) {
      wx.showModal({ title: '数据异常', content: '请返回重新选择服务点后再试', showCancel: false })
      return
    }

    const files = (packageData.files || []).map(f => ({
      fileId:    f.fileId || f.id || '',
      filename:  f.name   || f.filename || '',
      pageCount: Number(f.pageCount || f.pages || 0),
    }))

    if (!files.length || files.some(f => !f.fileId)) {
      wx.showModal({ title: '文件缺失', content: '材料包文件信息不完整，请返回重新添加', showCancel: false })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '创建订单中…', mask: true })

    try {
      const order = await api.createPackageOrder({
        terminalId:  storeData.id,
        files,
        params: {
          colorMode: packageData.colorMode || 'bw',
          duplex:    packageData.duplex    || 'single',
          copies:    packageData.copies    || 1,
        },
      })

      wx.hideLoading()

      // 服务端直接下发 orderId / pickupCode / qrCodeUrl / expiresAt，无需本地生成
      const url = '/pages/package-code/package-code' +
        '?orderId='    + encodeURIComponent(order.orderId    || '') +
        '&pickupCode=' + encodeURIComponent(order.pickupCode || '') +
        '&storeName='  + encodeURIComponent((storeData.displayName || storeData.name) || '') +
        '&expireTime=' + encodeURIComponent(order.expiresAt  || '') +
        '&fileCount='  + (files.length) +
        '&qrCodeUrl='  + encodeURIComponent(order.qrCodeUrl  || '')

      wx.redirectTo({
        url,
        success() {
          wx.removeStorageSync('temp_package_data')
          wx.removeStorageSync('temp_selected_store')
        },
      })
    } catch (err) {
      wx.hideLoading()
      this.setData({ submitting: false })
      const msg = (err && err.message) || '创建订单失败，请稍后重试'
      wx.showModal({ title: '提交失败', content: msg, showCancel: false, confirmText: '知道了' })
    }
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },
})
