// pages/fairs/fairs.js · P23 招聘会列表
const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    statusBarHeight: 20,
    filters: ['全部', '进行中', '即将开始', '线上', '现场'],
    activeFilter: 0,
    fairs: [],
    loading: true,
    loadError: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this.loadFairs()
  },

  loadFairs() {
    this.setData({ loading: true, loadError: '' })
    return api.getFairs()
      .then((list) => this.setData({ fairs: list || [], loading: false }))
      .catch((err) => this.setData({ loading: false, loadError: (err && err.message) || '加载失败' }))
  },

  reload() {
    this.loadFairs()
  },

  onPullDownRefresh() {
    this.loadFairs().then(() => wx.stopPullDownRefresh())
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  tapFilter(e) {
    this.setData({ activeFilter: e.currentTarget.dataset.index })
  },

  tapFair(e) {
    wx.navigateTo({ url: `/pages/fair-detail/fair-detail?id=${e.currentTarget.dataset.id}` })
  },

  onShareAppMessage() {
    return { title: '职易达 · 近期招聘会', path: '/pages/fairs/fairs' }
  },
})
