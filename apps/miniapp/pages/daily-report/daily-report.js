// pages/daily-report/daily-report.js
// 今日提醒：服务端规则清单。需登录；城市从岗位页 storage 读取，没有就不传。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

const TAB_PATHS = {
  '/pages/home/home': true,
  '/pages/ai/ai': true,
  '/pages/jobs/jobs': true,
  '/pages/me/me': true,
}
const CITY_KEYS = ['zyd_job_city', 'selectedCity', 'jobCity']

function readStoredCity() {
  for (let i = 0; i < CITY_KEYS.length; i += 1) {
    try {
      const value = wx.getStorageSync(CITY_KEYS[i])
      if (typeof value === 'string' && value.trim()) return value.trim()
    } catch (_) { /* storage 读失败视为没有城市 */ }
  }
  return ''
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
  if (mod.type === 'fair_countdown') {
    const rows = (mod.items || []).map((it) => ({
      key: it.fairId,
      title: it.title || '招聘会',
      sub: it.daysLeft != null ? `还有 ${it.daysLeft} 天开始` : '',
      actionLabel: '查看招聘会',
      route: it.route || '',
    })).filter((row) => row.route)
    if (!rows.length) return null
    return { type: 'fair_countdown', title: '即将开始的招聘会', summary: '', rows, actionLabel: '', route: '' }
  }
  if (mod.type === 'city_new') {
    if (!mod.route) return null
    const jobs = Number(mod.newJobs) || 0
    const policies = Number(mod.newPolicies) || 0
    const city = mod.city ? `${mod.city}` : ''
    return {
      type: 'city_new',
      title: city ? `${city}今日新增` : '今日新增',
      summary: `岗位 ${jobs} 条，政策 ${policies} 条`,
      rows: [],
      actionLabel: '看岗位',
      route: mod.route,
    }
  }
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
    const city = readStoredCity()
    api.getDailyBrief(city ? { city } : {})
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

  goJobs() {
    wx.switchTab({ url: '/pages/jobs/jobs' })
  },

  openRoute(e) {
    openMiniappRoute(e.currentTarget.dataset.route)
  },

  onShareAppMessage() {
    return { title: '今日提醒', path: '/pages/daily-report/daily-report' }
  },
})
