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
    // 按「用户此刻在什么处境」分组，而不是按「这是不是 AI」分组。
    // 用户不会想「我要用一个 AI 工具」，他想的是「我明天面试，材料还没弄好」。
    // 三段对应一条真实动线：准备材料 → 想清楚 → 到机器前办完。
    groups: [
      {
        key: 'prepare',
        title: '准备材料',
        sub: '改简历、管文档、发起打印',
        items: [
          { id: 'diagnose',  icon: 'file-search', title: '简历诊断', desc: '逐条给出问题与依据', accent: 'plum'  },
          { id: 'optimize',  icon: 'edit',        title: '简历优化', desc: '改写前后对照可选用', accent: 'teal'  },
          { id: 'documents', icon: 'folder',      title: '我的文档', desc: '管理材料并再次打印', accent: 'clay'  },
          { id: 'print',     icon: 'printer',     title: '发起打印', desc: '选文档、终端与参数', accent: 'cyan'  },
        ],
      },
      {
        key: 'decide',
        title: '想清楚再决定',
        sub: '岗位、面试、方向',
        items: [
          { id: 'contract',  icon: 'file-search', title: '合同审查', desc: '拍照逐条提示需留意条款', accent: 'clay'  },
          { id: 'match',     icon: 'link',    title: '岗位匹配', desc: '三档参考，不代表录用结果', accent: 'teal'  },
          { id: 'interview', icon: 'comment', title: '模拟面试', desc: '按岗位出题并复盘',       accent: 'plum'  },
          { id: 'plan',      icon: 'compass', title: '职业规划', desc: '方向建议仅供参考',       accent: 'wheat' },
        ],
      },
      {
        key: 'onsite',
        title: '到机器前办',
        sub: '取件码、扫码登录、U盘',
        items: [
          { id: 'orders',    icon: 'history', title: '打印订单',   desc: '取件码与出纸状态',   accent: 'clay'  },
          { id: 'kiosk',     icon: 'scan',    title: '扫码登录',   desc: '连接现场服务终端',   accent: 'teal'  },
          { id: 'usb',       icon: 'printer', title: 'U盘打印指引', desc: '现场导入与打印步骤', accent: 'wheat' },
        ],
      },
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




  tapEntry(e) {
    const { id } = e.currentTarget.dataset
    const routes = {
      diagnose:  '/pages/resume-diagnose/resume-diagnose',
      optimize:  '/pages/resume-optimize/resume-optimize',
      documents: '/pages/documents/documents',
      print:     '/pages/print/print',
      contract:  '/pages/contract-review/contract-review',
      match:     '/pages/job-fit/job-fit',
      interview: '/pages/interview-entry/interview-entry',
      plan:      '/pages/career-plan/career-plan',
      orders:    '/pages/orders/orders',
      kiosk:     '/pages/kiosk-login/kiosk-login',
      usb:       '/pages/usb-import/usb-import',
    }
    const url = routes[id]
    if (url) wx.navigateTo({ url })
  },

  tapChat() {
    wx.navigateTo({ url: '/pages/assistant/assistant' })
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

