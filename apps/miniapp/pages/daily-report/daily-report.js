// pages/daily-report/daily-report.js
// 今日提醒：服务端规则清单。需登录。
// 小程序首发只展示「到机码即将过期」和「平台通知」两类：服务端同一接口还会给
// 一体机下发「即将开始的招聘会」「城市新增岗位」，那两类指向的页面已停放
// （首发按非招聘类目提审，compliance-boundary.md §1.1），在 mapModule 里丢掉。
// 原先按岗位页 storage 里的城市查询，也只服务于「新增岗位」，一并不再传。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

const TAB_PATHS = {
  '/pages/home/home': true,
  '/pages/ai/ai': true,
  '/pages/print/print': true,
  '/pages/me/me': true,
}

function openMiniappRoute(route) {
  if (!route) return
  const path = String(route).split('?')[0]
  if (TAB_PATHS[path]) {
    wx.switchTab({ url: path })
    return
  }
  wx.navigateTo({ url: route })
}

function mapModule(mod) {
  if (!mod || !mod.type) return null
  if (mod.type === 'pickup_expiring') {
    const rows = (mod.items || []).map((it) => ({
      key: it.orderId,
      title: '打印订单到机码',
      sub: it.hoursLeft != null ? `还剩 ${it.hoursLeft} 小时` : '',
      actionLabel: '查看订单',
      route: it.route || '',
    })).filter((row) => row.route)
    if (!rows.length) return null
    return { type: 'pickup_expiring', title: '到机码即将过期', summary: '', rows, actionLabel: '', route: '' }
  }
  // fair_countdown / city_new 不展示：见文件头注释。
  if (mod.type === 'broadcast' && mod.item && mod.item.route) {
    return {
      type: 'broadcast',
      title: mod.item.title || '平台通知',
      summary: '',
      rows: [],
      actionLabel: '查看通知',
      route: mod.item.route,
    }
  }
  return null
}

Page({
  data: {
    statusBarHeight: 20,
    loggedIn: false,
    loading: false,
    error: '',
    empty: false,
    dateStr: '',
    modules: [],
  },

  onLoad() {
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      loggedIn: auth.isLoggedIn(),
    })
  },

  onShow() {
    const loggedIn = auth.isLoggedIn()
    this.setData({ loggedIn })
    if (loggedIn) this._loadReport()
    else this.setData({ loading: false, error: '', empty: false, modules: [] })
  },

  _loadReport() {
    this.setData({ loading: true, error: '', empty: false })
    api.getDailyBrief({})
      .then((res) => {
        const modules = Array.isArray(res && res.modules)
          ? res.modules.map(mapModule).filter(Boolean)
          : []
        this.setData({
          dateStr: (res && res.date) || '',
          empty: !!(res && res.empty) || modules.length === 0,
          modules,
          loading: false,
        })
      })
      .catch((err) => {
        if (err && err.statusCode === 401) {
          this.setData({ loggedIn: false, loading: false, error: '', modules: [] })
          return
        }
        this.setData({
          loading: false,
          error: (err && err.message) || '加载失败，请稍后重试',
        })
      })
  },

  retry() { this._loadReport() },

  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/ai/ai' }) } }) },

  goLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  goPrint() {
    wx.switchTab({ url: '/pages/print/print' })
  },

  openRoute(e) {
    openMiniappRoute(e.currentTarget.dataset.route)
  },

  onShareAppMessage() {
    return { title: '今日提醒', path: '/pages/daily-report/daily-report' }
  },
})
