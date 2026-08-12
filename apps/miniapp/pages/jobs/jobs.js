// pages/jobs/jobs.js
const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    statusBarHeight: 20,
    filters: ['全部', '岗位', '招聘会', '找企业', '政策'],
    activeFilter: 0,
    jobs: [],
    visibleJobs: [],
    query: '',
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
      .then((list) => {
        const jobs = list || []
        this.setData({ jobs, visibleJobs: this._filterJobs(jobs, this.data.query), loading: false })
      })
      .catch((err) => this.setData({ loading: false, loadError: (err && err.message) || '加载失败' }))
  },

  _filterJobs(jobs, query) {
    const q = (query || '').trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter((job) => [
      job.title,
      job.company,
      job.source,
      ...(Array.isArray(job.tags) ? job.tags : []),
    ].some((value) => String(value || '').toLowerCase().includes(q)))
  },

  onSearchInput(e) {
    const query = e.detail.value || ''
    this.setData({ query, visibleJobs: this._filterJobs(this.data.jobs, query) })
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
    // 校园招聘 / 招聘会 / 找企业 / 政策 为独立信息入口页，跳转；岗位在本页内筛选
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

  // Web 域名未统一配置前只复制后端返回的真实来源链接，不伪装成已跳转。
  tapSource(e) {
    const url = e.currentTarget.dataset.url || ''
    if (!url) {
      wx.showToast({ title: '来源链接暂不可用', icon: 'none' })
      return
    }
    wx.setClipboardData({ data: url })
  },

  onShareAppMessage() {
    return { title: '智引答 · 发现求职机会', path: '/pages/jobs/jobs' }
  },
})
