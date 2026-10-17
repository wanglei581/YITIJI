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
        // 等恢复期间页面已关（例如退出后回到首页）：不再往已卸载的页面写状态。
        if (!this._unloaded) this.refreshSessionState(true)
      })
    }
  },

  onUnload() { this._unloaded = true },

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
        if (!r.confirm || this.data.loggingOut) return
        // 确认即退出（FLOW1b）：本机作废并落盘，不等网络——请求挂起时用户关掉小程序，重开也不会被恢复。
        // 服务端退出尽力而为，而且要**先发**：请求在发出的这一刻带走退出前的令牌；随后本机作废，
        // 撤销位与代际让它即使回 401 也补签不了，不会凭补签把人登回来。
        const server = auth.isLoggedIn() ? api.logout() : null
        // 同设备恢复凭证（FLOW1c）：本机作废之前取出来，作废之后交服务端也作废；网络不通也不影响本机已退出。
        const restoreToken = auth.storedRestoreToken()
        const saved = auth.logout()
        if (restoreToken) api.revokeRestore(restoreToken).catch(() => {})
        this.setData({ loggingOut: true })
        let finished = false
        const finish = (message) => {
          if (finished) return
          finished = true
          this.finishLogout(message, saved)
        }
        if (!server) { finish('已退出登录'); return }
        server.then(() => finish('已退出登录'), () => finish('已退出本机登录'))
        // 服务端迟迟不回：本机已经退出，不让人干等。
        setTimeout(() => finish('已退出本机登录'), 1500)
      },
    })
  },

  /** @param {boolean} saved auth.logout() 的返回值：退出是否已在本机落盘。 */
  finishLogout(message, saved) {
    if (saved === false) {
      // 本机存储写不进、或读不出来确认不了：本次已经退出，但重开可能仍是登录状态——如实说，不报「已退出」了事。
      wx.showModal({
        title: '退出没有完全保存',
        content: '本次已退出，但手机存储暂时出了问题，没能确认退出已保存。下次打开小程序可能仍是登录状态，可以重新打开后再退出一次。',
        showCancel: false,
        complete: () => wx.reLaunch({ url: '/pages/home/home' }),
      })
      return
    }
    wx.showToast({ title: message, icon: 'none', duration: 1000 })
    setTimeout(() => wx.reLaunch({ url: '/pages/home/home' }), 250)
  },
})
