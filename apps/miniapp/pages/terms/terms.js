const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
  },
  onLoad() {
    const g = app.globalData || {}
    this.setData({ statusBarHeight: g.statusBarHeight || 20 })
  },
  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
