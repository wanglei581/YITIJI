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
    // 胶囊右让。2026-09-03 实测：本页顶栏右侧按钮**整个落在微信胶囊矩形内**
    // （390pt 上胶囊 [296,383]，按钮 [329,374]），用户点不到，而模拟器截图看不出来
    // ——胶囊是系统绘制的另一层。值由 app.js 运行时按 getMenuButtonBoundingClientRect 算，
    // 不能在 wxss 里写死：胶囊位置随机型与系统版本变。
    capsuleInsetRight: 94,
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
    // 原「求职信息」区块（发现岗位 / 招聘会 / 就业政策）已随对应页面停放：
    // 无人力资源服务许可证期间小程序按非招聘类目提审，见 compliance-boundary.md §1.1。
  },

  onLoad() {
    const g = app.globalData || {}
    this.setData({
      statusBarHeight: g.statusBarHeight || 20,
      capsuleInsetRight: g.capsuleInsetRight || 94,
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
      '/pages/print/print',
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

  onShareAppMessage() {
    return {
      title: '职易达 · AI 简历与打印服务',
      path: '/pages/home/home',
    }
  },
})
