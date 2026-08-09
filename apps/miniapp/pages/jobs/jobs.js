// pages/jobs/jobs.js
const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    statusBarHeight: 20,
    filters: ['全部', '岗位', '招聘会', '找企业', '政策'],
    activeFilter: 0,
    jobs: [],
    loading: true,
    loadError: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this.loadJobs()
  },

  loadJobs() {
    this.setData({ loading: true, loadError: '' })
    return api.getJobs()
      .then((list) => this.setData({ jobs: list || [], loading: false }))
      .catch((err) => this.setData({ loading: false, loadError: (err && err.message) || '加载失败' }))
  },

  reload() {
    this.loadJobs()
  },

  onPullDownRefresh() {
    this.loadJobs().then(() => wx.stopPullDownRefresh())
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
  },

  tapFilter(e) {
    const idx = e.currentTarget.dataset.index
    // 招聘会 / 找企业 / 政策 为独立信息入口页，跳转；岗位在本页内筛选
    const routes = {
      2: '/pages/fairs/fairs',
      3: '/pages/companies/companies',
      4: '/pages/policies/policies',
    }
    if (routes[idx]) {
      wx.navigateTo({ url: routes[idx] })
      return
    }
    this.setData({ activeFilter: idx })
  },

  tapJob(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${id}` })
  },

  // M0.3：搜索尚未接入，诚实提示
  tapSearch() {
    wx.showToast({ title: '搜索将在后续版本上线', icon: 'none' })
  },

  // 合规：仅跳转来源平台，不做平台内投递
  tapSource() {
    wx.showToast({ title: '将跳转至来源平台投递', icon: 'none', duration: 1600 })
  },

  onShareAppMessage() {
    return { title: '职易达 · 发现求职机会', path: '/pages/jobs/jobs' }
  },
})
