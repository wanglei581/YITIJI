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
          // 放「想清楚再决定」而不是另起一组：它和岗位匹配/职业规划一样，
          // 产出的是帮你做判断的参考，不是可交付的材料。
          // 标题按后端口径写「自我探索」——不叫「测评」：测评是资格判定口吻。
          { id: 'explore',   icon: 'aim',     title: '自我探索', desc: '五维倾向参考，非资格评定', accent: 'slate' },
        ],
      },
      {
        key: 'onsite',
        title: '到机器前办',
        sub: '到机码、扫码登录、U盘',
        items: [
          { id: 'orders',    icon: 'history', title: '打印订单',   desc: '到机码与出纸状态',   accent: 'clay'  },
          { id: 'kiosk',     icon: 'scan',    title: '扫码登录',   desc: '连接现场服务终端',   accent: 'teal'  },
          { id: 'usb',       icon: 'printer', title: 'U盘打印指引', desc: '现场导入与打印步骤', accent: 'wheat' },
        ],
      },
    ],

    // 页面已经做完、但服务端接口还不存在的三项能力。
    // 既不能伪装成可用（点下去必然失败），也不该悄悄删掉入口假装从没规划过。
    //
    // 关键：不能只在「到达页面之后」才报错。用户在人才市场大厅点进去撞一堵墙，
    // 哪怕墙上写的是真话，体验也是坏的。所以 why 会直接渲染在入口卡片上，
    // 用户在点之前就知道这条路现在走不通；reason 是点开后的完整解释。
    // 卡片带 aria-disabled 让读屏软件也能听到「不可用」，但仍可点、可聚焦——
    // 点了没反应的死按钮会让用户以为是自己操作错了，反复去戳。
    pending: [
      {
        id: 'package',
        icon: 'folder',
        title: '材料包',
        desc: '一次备齐多份材料再到机器打印',
        why: '服务端下单接口尚未上线',
        reason: '页面已完成，但服务端 POST /orders/package 尚未实现，现在下单必然失败，所以入口不放开。接口上线后本功能会直接开放。',
      },
      {
        id: 'community',
        icon: 'comment',
        title: '职业圈',
        desc: '同城求职者的经验与提醒',
        why: '服务端内容接口尚未上线',
        reason: '页面已完成，但服务端 GET /community/feeds 尚未实现，暂时没有任何真实内容可读。与其给你一屏编出来的动态，不如先不放开。',
      },
      {
        id: 'daily',
        icon: 'file-text',
        title: '今日早报',
        desc: '每日岗位与政策要点摘要',
        why: '服务端早报接口尚未上线',
        reason: '页面已完成，但服务端 POST /assistant/daily-report 尚未实现。早报必须来自真实岗位与政策数据，没有接口就不能生成，也不会用模板文字冒充。',
      },
    ],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this._loadReportDate()
    this._loadFeeds()
  },

  // 能力禁用要可解释：不使用原生 disabled，条目仍可点、可聚焦，
  // 点开直接说明缺的是哪个后端接口，而不是一句「敬请期待」。
  tapPending(e) {
    const item = (this.data.pending || []).find((p) => p.id === e.currentTarget.dataset.id)
    if (!item) return
    wx.showModal({
      title: `${item.title} · 尚未开放`,
      content: item.reason,
      showCancel: false,
      confirmText: '知道了',
    })
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
      explore:   '/pages/self-explore/self-explore',
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

