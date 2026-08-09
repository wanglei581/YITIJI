// pages/home/home.js
const app = getApp()
const auth = require('../../utils/auth')

// M0.1 壳阶段：首页入口只映射到四个 Tab；未上线功能统一提示，不伪造页面。
const TAB_PATHS = ['/pages/home/home', '/pages/ai/ai', '/pages/jobs/jobs', '/pages/me/me']

function greetWord() {
  const h = new Date().getHours()
  if (h < 6)  return '夜深了'
  if (h < 12) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
}

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
    greetWord: '你好',
    todayStr: '',
    userName: '同学',
    preparationTools: [
      { title: '生成简历', icon: 'edit', tab: '/pages/ai/ai' },
      { title: '模拟面试', icon: 'comment', tab: '/pages/ai/ai' },
      { title: '职业规划', icon: 'aim', tab: '/pages/ai/ai' },
      { title: '岗位匹配', icon: 'solution', tab: '/pages/ai/ai' },
    ],
    materialLinks: [
      { title: '我的简历', icon: 'file-text', tab: '/pages/me/me' },
      { title: '我的文档', icon: 'folder', tab: '/pages/me/me' },
      { title: '打印订单', icon: 'history', tab: '/pages/me/me', wide: true },
      { title: '扫描同步', icon: 'scan', tab: '/pages/me/me' },
      { title: '在线打印', icon: 'printer', tab: '/pages/me/me' },
    ],
    discoveryLinks: [
      { title: '招聘会', icon: 'calendar', tab: '/pages/jobs/jobs' },
      { title: '就业政策', icon: 'form', tab: '/pages/jobs/jobs' },
      { title: '企业信息', icon: 'bank', tab: '/pages/jobs/jobs' },
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
    const user = auth.isLoggedIn() ? auth.getUser() : null
    this.setData({ userName: (user && (user.nickname || user.name || user.phone)) || '同学' })
  },

  tapService(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    if (TAB_PATHS.includes(url)) {
      wx.switchTab({ url })
    } else {
      wx.showToast({ title: '该功能在 M1 上线，敬请期待', icon: 'none' })
    }
  },

  tapComingSoon() {
    wx.showToast({ title: '该功能在 M1 上线，敬请期待', icon: 'none' })
  },

  onShareAppMessage() {
    return {
      title: '职易达 · AI 求职与职业生活服务',
      path: '/pages/home/home',
    }
  },
})
