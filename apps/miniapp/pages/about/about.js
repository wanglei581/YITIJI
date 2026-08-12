// pages/about/about.js
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    links1: [
      { id: 'terms',   title: '用户服务协议' },
      { id: 'privacy', title: '隐私政策' },
    ],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  back() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  tapLink(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/legal/legal?type=${id === 'terms' ? 'terms_of_service' : 'privacy_policy'}`,
    })
  },

  onShareAppMessage() {
    return {
      title: '关于智引答',
      path: '/pages/about/about',
    }
  },
})
