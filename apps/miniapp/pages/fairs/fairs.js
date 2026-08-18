// pages/fairs/fairs.js · P23 招聘会列表
const app = getApp()
const api = require('../../utils/api')
const reminders = require('../../utils/reminders')

Page({
  data: {
    statusBarHeight: 20,
    filters: ['全部', '进行中', '即将开始'],
    activeFilter: 0,
    fairs: [],
    filteredFairs: [],
    loading: true,
    loadError: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this.loadFairs()
  },

  onShow() {
    // 从 fair-detail 返回后同步提醒状态
    if (this.data.fairs.length) {
      const ids = reminders.getIdSet()
      const fairs = this.data.fairs.map((f) => ({ ...f, reminded: ids.has(String(f.id)) }))
      this.setData({ fairs, filteredFairs: this._filterFairs(fairs, this.data.activeFilter) })
    }
  },

  loadFairs() {
    this.setData({ loading: true, loadError: '' })
    return api.getFairs()
      .then((list) => {
        const ids = reminders.getIdSet()
        const fairs = (list || []).map((f) => ({ ...f, reminded: ids.has(String(f.id)) }))
        this.setData({ fairs, filteredFairs: this._filterFairs(fairs, this.data.activeFilter), loading: false })
      })
      .catch((err) => this.setData({ loading: false, loadError: (err && err.message) || '加载失败' }))
  },

  _filterFairs(list, index) {
    if (index === 1) return list.filter((item) => item.live === true || item.tag === '进行中')
    if (index === 2) return list.filter((item) => item.tag === '即将开始')
    return list
  },

  reload() {
    this.loadFairs()
  },

  onPullDownRefresh() {
    this.loadFairs().then(() => wx.stopPullDownRefresh())
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  tapFilter(e) {
    const activeFilter = Number(e.currentTarget.dataset.index) || 0
    this.setData({
      activeFilter,
      filteredFairs: this._filterFairs(this.data.fairs, activeFilter),
    })
  },

  tapFair(e) {
    wx.navigateTo({ url: `/pages/fair-detail/fair-detail?id=${e.currentTarget.dataset.id}` })
  },

  onShareAppMessage() {
    return { title: '职易达 · 近期招聘会', path: '/pages/fairs/fairs' }
  },
})
