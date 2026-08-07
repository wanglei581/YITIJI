// pages/me/me.js（我的：M0.2 登录后接本人数据只读）
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    title: '我的',
    copy: '登录、本人简历与文档、订单与权益将在 M0.2–M0.4 分批接入，目前保持真实空态。',
  },
  onLoad() {
    const g = app.globalData || {}
    this.setData({ statusBarHeight: g.statusBarHeight || 20 })
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
  },
})
