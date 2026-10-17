const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { isRestorable, ensureMember } = require('../../utils/page-guard')

Page({
  data: {
    statusBarHeight: 20,
    isLoggedIn: false,
    // 上次登录过期但可恢复（FLOW1b）：照样给「退出登录」——只有在这里主动退出才算退出
    restorable: false,
    phoneMasked: '未绑定',
    loggingOut: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this.refreshSessionState()
  },

  onShow() { this.refreshSessionState() },

  /**
   * @param {boolean} [afterRestore] 一次恢复刚结束：只刷新显示，**不再自动发起下一次恢复**。
   *   恢复遇到临时失败时状态仍是「可恢复」，若照常再发起，断网时会无休止地重试 wx.login 与补签。
   */
  refreshSessionState(afterRestore) {
    // 先判「可恢复」：它要在 isLoggedIn 清掉过期令牌之前认出上次的会员（见 page-guard.isRestorable）。
    const restorable = isRestorable(auth)
    const isLoggedIn = auth.isLoggedIn()
    const user = isLoggedIn ? (auth.getUser() || {}) : {}
    this.setData({
      isLoggedIn,
      restorable,
      phoneMasked: user.phoneMasked || '未绑定',
      loggingOut: false,
    })
    if (restorable && afterRestore !== true && !this._restoreWait) {
      this._restoreWait = ensureMember(auth, api).then(() => {
        this._restoreWait = null
        this.refreshSessionState(true)
      })
    }
  },

  back() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
  toPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }) },
  toHelp() { wx.navigateTo({ url: '/pages/help/help' }) },
  toAbout() { wx.navigateTo({ url: '/pages/about/about' }) },
  toLogin() { wx.navigateTo({ url: '/pages/launch/launch' }) },
  toNotifications() { wx.navigateTo({ url: '/pages/notifications/notifications' }) },
  toDocuments() { wx.navigateTo({ url: '/pages/documents/documents' }) },

  logout() {
    // 过期但可恢复时也能退出：退出 = 撤销恢复资格，下次打开不再自动登录（FLOW1b）
    if (!this.data.isLoggedIn && !this.data.restorable) { this.toLogin(); return }
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
