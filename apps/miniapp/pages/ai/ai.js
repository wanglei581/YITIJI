// pages/ai/ai.js（AI 百宝箱：M1 功能分批上线）
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    title: 'AI 百宝箱',
    copy: '简历诊断、优化、岗位匹配、模拟面试、职业规划等 AI 求职工具将在 M1 分批上线。',
  },
  onLoad() {
    const g = app.globalData || {}
    this.setData({ statusBarHeight: g.statusBarHeight || 20 })
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
  },
})
