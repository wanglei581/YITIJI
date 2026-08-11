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
    preparationTools: [
      { title: '上传简历', icon: 'edit', url: '/pages/resume-upload/resume-upload' },
      { title: '模拟面试', icon: 'comment', url: '/pages/interview-entry/interview-entry' },
      { title: '职业规划', icon: 'aim', url: '/pages/career-plan/career-plan' },
      { title: '岗位匹配', icon: 'solution', url: '/pages/job-fit/job-fit' },
    ],
    materialLinks: [
      { title: '我的简历', icon: 'file-text', url: '/pages/resumes/resumes' },
      { title: '打印订单', icon: 'history', url: '/pages/orders/orders', wide: true },
      { title: '在线打印', icon: 'printer', url: '/pages/print/print' },
    ],
    discoveryLinks: [
      { title: '招聘会', icon: 'calendar', url: '/pages/fairs/fairs' },
      { title: '就业政策', icon: 'form', url: '/pages/policies/policies' },
      { title: '企业信息', icon: 'bank', url: '/pages/companies/companies' },
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
    if (url === '/pages/jobs/jobs') {
      wx.switchTab({ url })
    } else {
      wx.navigateTo({ url })
    }
  },

  tapNotify() {
    wx.navigateTo({ url: '/pages/notifications/notifications' })
  },

  onShareAppMessage() {
    return {
      title: '求职通 · AI求职打印服务',
      path: '/pages/home/home',
    }
  },
})
