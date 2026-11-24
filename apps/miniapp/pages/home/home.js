// pages/home/home.js
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const storage = require('../../utils/storage')
const orgEntryUtil = require('../../utils/org-entry')
const orgEntryApi = require('../../utils/api-org-entry')
const { createLifecycleGuard, memberIdentityKey, isMemberIdentity } = require('../../utils/page-guard')
const pickup = require('./pickup-summary')
const entryWays = require('../../utils/resume-optimize-entry')

// 首页是 Tab 页，每次切回来都会 onShow：同一个人 / 同一机构 30 秒内不重复拉取。
const PICKUP_FRESH_MS = 30 * 1000
const ORG_FRESH_MS = 30 * 1000

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

function emptyOrgView() {
  return {
    orgEntry: null,
    orgBrandTitle: '',
    orgSealText: '',
    orgTerminalCount: 0,
    orgTopTerminalName: '',
  }
}

function formatOrgView(entry) {
  const terminals = Array.isArray(entry && entry.terminals) ? entry.terminals : []
  const brandTitle = (entry && (entry.brandName || entry.orgName)) || ''
  const seal = (entry && entry.brandMark) || (brandTitle ? brandTitle.slice(0, 1) : '职')
  return {
    orgEntry: entry,
    orgBrandTitle: brandTitle,
    orgSealText: seal,
    orgTerminalCount: terminals.length,
    orgTopTerminalName: terminals[0] ? (terminals[0].displayName || '') : '',
  }
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
    userName: '',
    greetTitle: '你好',
    greetWord: '你好',
    todayStr: '',
    orgEntry: null,
    orgBrandTitle: '',
    orgSealText: '',
    orgTerminalCount: 0,
    orgTopTerminalName: '',
    primaryServices: [
      { title: '简历诊断', icon: 'file-search', tone: 'blue', url: '/pages/resume-diagnose/resume-diagnose' },
      { title: '简历优化', icon: 'edit', tone: 'violet', url: entryWays.OPTIMIZE_URL },
      { title: '模拟面试', icon: 'comment', tone: 'cyan', url: '/pages/interview-entry/interview-entry' },
      // 原「创建材料包」指向 pages/package-create（未实现页面，调 /orders/package 不存在的后端），
      // 会形成死路由。改为已实现的职业规划，四格构成完整 AI 服务集：诊断→优化→面试→规划。
      { title: '职业规划', icon: 'compass', tone: 'orange', url: '/pages/career-plan/career-plan' },
    ],
    // 原「求职信息」区块（发现岗位 / 招聘会 / 就业政策）已随对应页面停放：
    // 无人力资源服务许可证期间小程序按非招聘类目提审，见 compliance-boundary.md §1.1。

    // 待取件（两端打通）：只有登录且真有待取件的单才出卡片；最近订单只在没有待取件时给一行去处。
    // 读失败就不出卡片（订单页有完整的失败态），不拿旧数据充当现在的状态。
    pickupCount: 0,
    pickupNearest: null,
    latestOrderAt: '',
  },

  onLoad(options) {
    this._guard = createLifecycleGuard()
    this._pickupAt = 0
    this._orgLoadedId = ''
    this._orgLoadedAt = 0
    const g = app.globalData || {}
    this.setData({
      statusBarHeight: g.statusBarHeight || 20,
      capsuleInsetRight: g.capsuleInsetRight || 94,
      greetWord: greetWord(),
      todayStr: todayStr(),
    })
    const directOrgId = orgEntryUtil.parseOrgIdFromLaunch(options)
    if (directOrgId) orgEntryUtil.rememberLaunchOrgId(directOrgId)
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this._guard.activate()
    this._refresh()
    this._loadPickup()
    this._syncOrgEntry()
  },

  onHide() {
    this._guard.deactivate()
    entryWays.cancelEntry(this, wx)
  },

  /**
   * 同步「一机构一码」官方采购联名入口。
   * 新扫码/菜单参数优先于本机已记住的视图偏好；服务端 404 / 停用 / 授权失效时立即清回默认视图。
   */
  _syncOrgEntry() {
    const freshLaunchId = orgEntryUtil.consumePendingLaunchOrgId()
    const stored = orgEntryUtil.getStoredOrgContext()
    const targetId = freshLaunchId || (stored && stored.orgId) || ''
    if (!targetId) {
      if (this.data.orgEntry) this.setData(emptyOrgView())
      this._orgLoadedId = ''
      this._orgLoadedAt = 0
      return
    }
    if (!freshLaunchId && this._orgLoadedId === targetId && this._orgLoadedAt && Date.now() - this._orgLoadedAt < ORG_FRESH_MS) {
      return
    }
    // 切换到新机构时先清掉上一家机构的旧展示，避免异步加载期间出现「张冠李戴」
    if (this.data.orgEntry && this.data.orgEntry.orgId !== targetId) {
      this.setData(emptyOrgView())
    }
    const token = this._guard.issue('orgEntry')
    orgEntryApi.getPublicOrgEntry(targetId).then((entry) => {
      if (!this._guard.accepts(token)) return
      this._orgLoadedId = entry.orgId
      this._orgLoadedAt = Date.now()
      orgEntryUtil.saveOrgContext(entry)
      this.setData(formatOrgView(entry))
    }).catch(() => {
      if (!this._guard.accepts(token)) return
      this._orgLoadedId = ''
      this._orgLoadedAt = 0
      orgEntryUtil.clearOrgContext()
      this.setData(emptyOrgView())
    })
  },

  clearOrgMode() {
    // 递增代次：即使有在途机构请求正在返回，也不得覆盖用户已主动恢复的默认视图
    this._guard.issue('orgEntry')
    this._orgLoadedId = ''
    this._orgLoadedAt = 0
    orgEntryUtil.clearOrgContext()
    this.setData(emptyOrgView())
    wx.showToast({ title: '已恢复职易达默认首页', icon: 'none' })
  },

  tapOrgSwitch() {
    if (!this.data.orgEntry) return
    wx.showActionSheet({
      itemList: ['查看本机构打印服务点', '恢复职易达默认首页'],
      success: (res) => {
        if (res.tapIndex === 0) this.tapOrgNameplate()
        else if (res.tapIndex === 1) this.clearOrgMode()
      },
    })
  },

  tapOrgNameplate() {
    const entry = this.data.orgEntry
    if (!entry) return
    const terminals = Array.isArray(entry.terminals) ? entry.terminals : []
    const lines = terminals.length
      ? terminals.map((t, i) => `${i + 1}. ${t.displayName}${t.locationLabel ? '（' + t.locationLabel + '）' : ''}`)
      : ['当前暂无实时在线终端，请稍后刷新或选择其他可用服务点。']
    const note = entry.terminalSelectionNote || '在线列表为实时预筛，实际是否可打印以选点后服务端核验为准。'
    wx.showModal({
      title: `${entry.orgName} · 服务点`,
      content: `${lines.join('\n')}\n\n${note}`,
      confirmText: '前往打印',
      cancelText: '知道了',
      success: (res) => {
        if (res.confirm) wx.switchTab({ url: '/pages/print/print' })
      },
    })
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
    wx.navigateTo({ url: '/pages/daily-report/daily-report' })
  },

  _refresh() {
    const loggedIn = auth.isLoggedIn()
    const user = loggedIn ? auth.getUser() : null
    const name = (user && (user.nickname || user.name)) || ''
    const gw = greetWord()
    this.setData({
      isLoggedIn: loggedIn,
      userName: name,
      greetWord: gw,
      greetTitle: name ? `${gw}，${name}` : gw,
    })
  },

  // ── 事件处理 ──

  tapService(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    if (url === entryWays.OPTIMIZE_URL) {
      entryWays.openEntry(this, { api, auth, storage, wx })
      return
    }
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

  // 页脚两条法务文档：只放这两类，别的类型不从首页开。
  tapLegal(e) {
    const type = e.currentTarget.dataset.type
    if (type !== 'operator_info' && type !== 'ai_disclaimer') return
    wx.navigateTo({ url: `/pages/legal/legal?type=${type}` })
  },

  onShareAppMessage() {
    const orgId = this.data.orgEntry && this.data.orgEntry.orgId
    return {
      title: orgId ? `${this.data.orgBrandTitle} × 职易达 · AI 简历与打印服务` : '职易达 · AI 简历与打印服务',
      path: orgId ? `/pages/home/home?orgId=${encodeURIComponent(orgId)}` : '/pages/home/home',
    }
  },
})
