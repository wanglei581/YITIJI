const app = getApp()

Page({
  data: { statusBarHeight: 20 },
  onLoad() { this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 }) },
  toPolicy() { wx.navigateTo({ url: '/pages/legal/legal?type=privacy_policy' }) },
  toDocuments() { wx.navigateTo({ url: '/pages/documents/documents' }) },
  explainSensitiveAction() {
    wx.showModal({
      title: '当前小程序端暂未开放',
      content: '数据导出和账号注销需要短信二次验证及服务端审计。相关接口已保留，但本版本尚未完成安全交互，暂不提供可能产生误操作的按钮。',
      showCancel: false,
    })
  },
  back() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
