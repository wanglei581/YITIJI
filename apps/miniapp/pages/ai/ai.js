// pages/ai/ai.js
const app = getApp()
const api = require('../../utils/api')

/** 头像背景色轮转，按名字首字符哈希 */
const AV_COLORS = ['#7a5a86', '#1f9e86', '#c8622a', '#2563eb', '#be7c30']
function avColor(name) {
  const c = (name || '?').charCodeAt(0)
  return AV_COLORS[c % AV_COLORS.length]
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}天前`
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function processFeed(item) {
  const name = item.authorName || (item.author && item.author.name) || '匿名'
  return {
    ...item,
    _authorName: name,
    _initials:   name.slice(0, 1),
    _color:      avColor(name),
    _timeAgo:    timeAgo(item.createdAt || item.publishedAt),
  }
}

Page({
  data: {
    statusBarHeight: 20,
    // 今日早报
    reportDate:  '',
    // 职业圈
    tools: [
      { id: 'diagnose',  icon: 'file-search', title: '简历诊断',  desc: '逐条给出问题与依据',     accent: 'plum' },
      { id: 'optimize',  icon: 'edit',        title: '简历优化',  desc: '改写前后对照可选用',     accent: 'teal' },
      { id: 'interview', icon: 'comment',      title: '模拟面试',  desc: '按岗位出题并复盘',       accent: 'clay' },
      { id: 'plan',      icon: 'compass',      title: '职业规划',  desc: '方向建议仅供参考',       accent: 'wheat' },
      { id: 'match',     icon: 'link',         title: '岗位匹配',  desc: '三档参考，不代表录用结果', accent: 'plum' },
    ],
    services: [
      { id: 'print',     icon: 'printer', title: '打印服务',      desc: '选本人文档、终端与打印参数' },
      { id: 'documents', icon: 'folder',  title: '我的文档',      desc: '管理材料并再次发起打印' },
      { id: 'usb',       icon: 'printer', title: 'U盘打印指引',  desc: '查看现场导入与打印步骤' },
      { id: 'orders',    icon: 'history', title: '打印订单',      desc: '查看取件码与出纸状态' },
      { id: 'kiosk',     icon: 'scan',    title: '扫码登录一体机', desc: '快速连接现场服务终端' },
    ],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this._loadReportDate()
    this._loadFeeds()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
  },

  _loadReportDate() {
    const now = new Date()
    const reportDate = `${now.getMonth() + 1}月${now.getDate()}日`
    this.setData({ reportDate })
    // 今日早报 UI 已移除：服务端 /assistant/daily-report 并不存在，
    // 保留请求只会每次进页面产生一次必然失败的调用。
  },

  // 职业圈 UI 已移除：服务端无 community/feeds 实现，不再发起请求。
  _loadFeeds() {},




  tapTool(e) {
    const { id } = e.currentTarget.dataset
    const routes = {
      diagnose:  '/pages/resume-diagnose/resume-diagnose',
      optimize:  '/pages/resume-optimize/resume-optimize',
      interview: '/pages/interview-entry/interview-entry',
      plan:      '/pages/career-plan/career-plan',
      match:     '/pages/job-fit/job-fit',
    }
    const url = routes[id]
    if (url) wx.navigateTo({ url })
  },

  tapChat() {
    wx.navigateTo({ url: '/pages/assistant/assistant' })
  },

  tapService(e) {
    const { id } = e.currentTarget.dataset
    const routes = {
      print:     '/pages/print/print',
      documents: '/pages/documents/documents',
      usb:       '/pages/usb-import/usb-import',
      orders:    '/pages/orders/orders',
      kiosk:     '/pages/kiosk-login/kiosk-login',
    }
    const url = routes[id]
    if (url) wx.navigateTo({ url })
  },

  toRecords() {
    wx.navigateTo({ url: '/pages/ai-records/ai-records' })
  },

  onShareAppMessage() {
    return {
      title: '职业生活圈 · 求职与社区',
      path:  '/pages/ai/ai',
    }
  },
})

