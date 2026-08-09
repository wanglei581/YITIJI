// pages/me/me.js（我的：M0.2 登录态；M0.4 起接本人数据只读）
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

Page({
  data: {
    statusBarHeight: 20,
    title: '我的',
    isLoggedIn: false,
    userName: '同学',
    copy: '登录后，本人简历、文档、订单与权益将在 M0.4 起分批接入。',
  },
  onLoad() {
    const g = app.globalData || {}
    this.setData({ statusBarHeight: g.statusBarHeight || 20 })
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    this._refresh()
  },
  _refresh() {
    const loggedIn = auth.isLoggedIn()
    const user = loggedIn ? auth.getUser() : null
    const name = (user && (user.nickname || user.name || user.phone)) || '同学'
    this.setData({ isLoggedIn: loggedIn, userName: name })
  },
  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' })
  },
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后会清理本机登录会话，本人数据不会删除。',
      confirmText: '确认退出',
      success: (res) => {
        if (!res.confirm) return
        api.logout()
          .catch(() => {})
          .finally(() => {
            auth.clearSession()
            this._refresh()
            wx.showToast({ title: '已退出登录', icon: 'none' })
          })
      },
    })
  },
})
