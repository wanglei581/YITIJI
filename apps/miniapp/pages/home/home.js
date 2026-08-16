// pages/home/home.js
const app = getApp()
const auth = require('../../utils/auth')

// 问候语按时段
function greetWord() {
  const h = new Date().getHours()
  if (h < 6)  return '夜深了'
  if (h < 12) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
}

// 今日日期字符串
function todayStr() {
  const d = new Date()
  const M = d.getMonth() + 1
  const D = d.getDate()
  const days = ['日','一','二','三','四','五','六']
  return `${M}月${D}日 · 周${days[d.getDay()]}`
}

Page({
  data: {
    statusBarHeight: 20,
    isLoggedIn: false,
    userName: '同学',
    greetWord: '你好',
    todayStr: '',
    primaryServices: [
      { title: '简历诊断', icon: 'file-search', tone: 'blue', url: '/pages/resume-diagnose/resume-diagnose' },
      { title: '简历优化', icon: 'edit', tone: 'violet', url: '/pages/resume-optimize/resume-optimize' },
      { title: '模拟面试', icon: 'comment', tone: 'cyan', url: '/pages/interview-entry/interview-entry' },
      // 原「创建材料包」指向 pages/package-create（未实现页面，调 /orders/package 不存在的后端），
      // 会形成死路由。改为已实现的职业规划，四格构成完整 AI 服务集：诊断→优化→面试→规划。
      { title: '职业规划', icon: 'compass', tone: 'orange', url: '/pages/career-plan/career-plan' },
    ],
    discoveryLinks: [
      { title: '发现岗位', desc: '查看第三方或官方来源岗位', icon: 'solution', tone: 'indigo', url: '/pages/jobs/jobs' },
      { title: '招聘会', desc: '查看时间、地点与来源信息', icon: 'calendar', tone: 'rose', url: '/pages/fairs/fairs' },
      { title: '就业政策', desc: '了解官方政策与办事入口', icon: 'form', tone: 'amber', url: '/pages/policies/policies' },
    ],
  },

  onLoad() {
    const g = app.globalData || {}
    this.setData({
      statusBarHeight: g.statusBarHeight || 20,
      greetWord: greetWord(),
      todayStr: todayStr(),
    })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this._refresh()
  },

  _refresh() {
    const loggedIn = auth.isLoggedIn()
    const user = loggedIn ? auth.getUser() : null
    const name = (user && (user.nickname || user.name)) || '同学'
    this.setData({ isLoggedIn: loggedIn, userName: name })
  },

  // ── 事件处理 ──

  tapService(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const tabPages = new Set([
      '/pages/home/home',
      '/pages/ai/ai',
      '/pages/jobs/jobs',
      '/pages/me/me',
    ])
    if (tabPages.has(url)) {
      wx.switchTab({ url })
    } else {
      wx.navigateTo({ url })
    }
  },

  tapNotify() {
    wx.navigateTo({ url: '/pages/notifications/notifications' })
  },

  tapLifeCircle() {
    wx.switchTab({ url: '/pages/ai/ai' })
  },

  tapJobs() {
    wx.switchTab({ url: '/pages/jobs/jobs' })
  },

  onShareAppMessage() {
    return {
      title: '职易达 · AI 求职与打印服务',
      path: '/pages/home/home',
    }
  },
})
