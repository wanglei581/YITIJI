// pages/package-code/package-code.js
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    pickupCode: '',
    orderId: '',
    fileCount: 0,
    storeName: '',
    expireTime: '',
    totalPrice: '0.00',
  },

  onLoad(options) {
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      pickupCode:  options.pickupCode  ? decodeURIComponent(options.pickupCode)  : '',
      orderId:     options.orderId     ? decodeURIComponent(options.orderId)     : '',
      fileCount:   parseInt(options.fileCount) || 0,
      storeName:   options.storeName   ? decodeURIComponent(options.storeName)   : '',
      expireTime:  options.expireTime  ? decodeURIComponent(options.expireTime)  : '',
      totalPrice:  options.price       ? decodeURIComponent(options.price)       : '0.00',
    })
  },

  goBack() {
    wx.navigateBack()
  },

  viewOrder() {
    const { orderId } = this.data
    if (!orderId) return
    wx.navigateTo({ url: '/pages/order-detail/order-detail?orderId=' + encodeURIComponent(orderId) })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },

  copyCode() {
    wx.setClipboardData({
      data: this.data.pickupCode,
      success() { wx.showToast({ title: '取件码已复制', icon: 'success' }) }
    })
  },

  copyOrderId() {
    wx.setClipboardData({
      data: this.data.orderId,
      success() { wx.showToast({ title: '订单号已复制', icon: 'success' }) }
    })
  },

  onShareAppMessage() {
    return {
      title: '材料包创建成功 · 职易达',
      path: '/pages/package-code/package-code',
    }
  },
})
