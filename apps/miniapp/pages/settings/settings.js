const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

Page({
  data: {
    statusBarHeight: 20,
    isLoggedIn: false,
    phoneMasked: '未绑定',
    loggingOut: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this.refreshSessionState()
  },

  onShow() { this.refreshSessionState() },

  refreshSessionState() {
    const isLoggedIn = auth.isLoggedIn()
    const user = isLoggedIn ? (auth.getUser() || {}) : {}
    this.setData({
      isLoggedIn,
      phoneMasked: user.phoneMasked || '未绑定',
      loggingOut: false,
    })
  },

  back() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
  toPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }) },
  toHelp() { wx.navigateTo({ url: '/pages/help/help' }) },
  toAbout() { wx.navigateTo({ url: '/pages/about/about' }) },
  toLogin() { wx.navigateTo({ url: '/pages/launch/launch' }) },
  toNotifications() { wx.navigateTo({ url: '/pages/notifications/notifications' }) },
  toDocuments() { wx.navigateTo({ url: '/pages/documents/documents' }) },

  logout() {
    if (!this.data.isLoggedIn) { this.toLogin(); return }
    if (this.data.loggingOut) return
    wx.showModal({
      title: '退出登录',
      content: '退出后需重新登录才能同步简历、文档与打印记录。',
      confirmText: '退出',
      confirmColor: '#b5643c',
      success: (r) => {
        if (!r.confirm) return
        this.setData({ loggingOut: true })
        api.logout()
          .then(() => this.finishLogout('已退出登录'))
          .catch(() => this.finishLogout('已退出本机登录'))
      },
    })
  },

  finishLogout(message) {
    auth.logout()
    wx.showToast({ title: message, icon: 'none', duration: 1000 })
    setTimeout(() => wx.reLaunch({ url: '/pages/home/home' }), 250)
  },
})
