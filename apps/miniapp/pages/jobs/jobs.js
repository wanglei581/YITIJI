// pages/jobs/jobs.js（求职：M0.3 起接入真实来源浏览）
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    title: '求职',
    copy: '岗位、招聘会、政策与企业信息将在这里以第三方 / 官方来源形式提供，接入真实数据后展示。',
  },
  onLoad() {
    const g = app.globalData || {}
    this.setData({ statusBarHeight: g.statusBarHeight || 20 })
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
  },
})
