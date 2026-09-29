// pages/home/home.js
const app = getApp()
const auth = require('../../utils/auth')
const { createLifecycleGuard, memberIdentityKey, isMemberIdentity } = require('../../utils/page-guard')
const pickup = require('./pickup-summary')
const { AI_ENABLED } = require('../../utils/build-variant')
const { pagePath } = require('../../utils/page-path')
const { syncTabBar } = require('../../utils/tab-bar-index')

const PRIMARY_SERVICES = [
  { title: '简历诊断', icon: 'file-search', tone: 'blue', url: pagePath('resume-diagnose') },
  { title: '简历优化', icon: 'edit', tone: 'violet', url: pagePath('resume-optimize') },
  { title: '模拟面试', icon: 'comment', tone: 'cyan', url: pagePath('interview-entry') },
  // 原「创建材料包」指向未实现的材料包下单，改为已实现的职业规划。
  { title: '职业规划', icon: 'compass', tone: 'orange', url: pagePath('career-plan') },
]

function tabPageSet() {
  const pages = new Set([pagePath('home'), pagePath('print'), pagePath('me')])
  if (AI_ENABLED) pages.add(pagePath('ai'))
  return pages
}

// 首页是 Tab 页，每次切回来都会 onShow：同一个人 30 秒内不重复拉订单。
const PICKUP_FRESH_MS = 30 * 1000

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
    aiEnabled: AI_ENABLED,
    assistantUrl: pagePath('assistant'),
    voiceUrl: pagePath('resume-voice'),
    primaryServices: AI_ENABLED ? PRIMARY_SERVICES : [],
    // 原「求职信息」区块（发现岗位 / 招聘会 / 就业政策）已随对应页面停放：
    // 无人力资源服务许可证期间小程序按非招聘类目提审，见 compliance-boundary.md §1.1。

    // 待取件（两端打通）：只有登录且真有待取件的单才出卡片；最近订单只在没有待取件时给一行去处。
    // 读失败就不出卡片（订单页有完整的失败态），不拿旧数据充当现在的状态。
    pickupCount: 0,
    pickupNearest: null,
    latestOrderAt: '',
  },

  onLoad() {
    this._guard = createLifecycleGuard()
    this._pickupAt = 0
    const g = app.globalData || {}
    this.setData({
      statusBarHeight: g.statusBarHeight || 20,
      capsuleInsetRight: g.capsuleInsetRight || 94,
      greetWord: greetWord(),
      todayStr: todayStr(),
    })
  },

  onShow() {
    syncTabBar(this, pagePath('home'))
    this._guard.activate()
    this._refresh()
    this._loadPickup()
  },

  onHide() {
    this._guard.deactivate()
  },

  /**
   * 待取件卡片。身份一变（登出 / 换号）当场清掉上一位的数据，在途响应一并作废（page-guard）。
   */
  _loadPickup() {
    const identity = memberIdentityKey(auth)
    const changed = this._guard.setIdentity(identity)
    if (changed || !isMemberIdentity(identity)) {
      this._pickupAt = 0
      this.setData({ pickupCount: 0, pickupNearest: null, latestOrderAt: '' })
    }
    if (!isMemberIdentity(identity)) return
    if (this._pickupAt && Date.now() - this._pickupAt < PICKUP_FRESH_MS) return
    const token = this._guard.issue('pickup')
    pickup.load().then((sum) => {
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      this._pickupAt = Date.now()
      this.setData({ pickupCount: sum.pendingCount, pickupNearest: sum.nearest, latestOrderAt: sum.latestAt })
    }, () => {
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      this.setData({ pickupCount: 0, pickupNearest: null, latestOrderAt: '' })
    })
  },

  tapPickup() {
    const url = pickup.pickupUrl(this.data.pickupNearest)
    if (url) wx.navigateTo({ url })
  },

  tapOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' })
  },

  // 扫一体机屏幕上的码：登录码或上传码都认（kiosk-login 页按码型分流），进页就开扫码。
  tapScanKiosk() {
    wx.navigateTo({ url: '/pages/kiosk-login/kiosk-login?autoScan=1' })
  },

  tapDaily() {
    if (!AI_ENABLED) return
    wx.navigateTo({ url: pagePath('daily-report') })
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
    if (tabPageSet().has(url)) {
      wx.switchTab({ url })
    } else {
      wx.navigateTo({ url })
    }
  },

  tapNotify() {
    wx.navigateTo({ url: '/pages/notifications/notifications' })
  },

  tapLifeCircle() {
    if (!AI_ENABLED) return
    wx.switchTab({ url: pagePath('ai') })
  },

  // 页脚两条法务文档：只放这两类，别的类型不从首页开。
  tapLegal(e) {
    const type = e.currentTarget.dataset.type
    if (type !== 'operator_info' && type !== 'ai_disclaimer') return
    wx.navigateTo({ url: `/pages/legal/legal?type=${type}` })
  },

  onShareAppMessage() {
    return {
      title: AI_ENABLED ? '职易达 · AI 简历与打印服务' : '职易达 · 求职材料与文档打印',
      path: '/pages/home/home',
    }
  },
})
