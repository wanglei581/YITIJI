// pages/package-code/package-code.js
const app = getApp()
const { guardPackageChain } = require('../../utils/package-feature')

Page({
  data: {
    // 默认 false：模板里的「材料包创建成功」是写死的，必须等守卫放行后才允许渲染。
    ready: false,
    statusBarHeight: 20,
    pickupCode: '',
    orderId: '',
    fileCount: 0,
    storeName: '',
    expireTime: '',
    totalPrice: '0.00',
  },

  onLoad(options) {
    // 这些字段全部来自 URL query，服务端零校验：不守住这一行，一条构造出来的链接
    // 就能渲染出一张带到机码的「创建成功」页。
    if (guardPackageChain()) return
    this.setData({
      ready: true,
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
      success() { wx.showToast({ title: '到机码已复制', icon: 'success' }) }
    })
  },

  copyOrderId() {
    wx.setClipboardData({
      data: this.data.orderId,
      success() { wx.showToast({ title: '订单号已复制', icon: 'success' }) }
    })
  },

  // 不提供 onShareAppMessage：这页原本可以把「材料包创建成功」当作分享标题转发出去，
  // 而收到的人打开的是一张没有任何订单支撑的成功页。功能真正开放前不恢复分享。
})
