// pages/companies/companies.js · P21 找企业
const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    statusBarHeight: 20,
    filters: ['全部', '互联网', '制造业', '金融', '教育', '医疗'],
    activeFilter: 0,
    companies: [],
    loading: true,
    loadError: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this.loadCompanies()
  },

  loadCompanies() {
    this.setData({ loading: true, loadError: '' })
    return api.getCompanies()
      .then((list) => {
        // 列表卡片绑定字段为 meta / jobs,与数据层的 listMeta / jobCount 映射
        const mapped = (list || []).map((c) => ({
          id: c.id, emoji: c.emoji, name: c.name, tags: c.tags,
          meta: c.listMeta !== undefined ? c.listMeta : c.meta,
          jobs: c.jobCount !== undefined ? c.jobCount : c.jobs,
        }))
        this.setData({ companies: mapped, loading: false })
      })
      .catch((err) => this.setData({ loading: false, loadError: (err && err.message) || '加载失败' }))
  },

  reload() {
    this.loadCompanies()
  },

  onPullDownRefresh() {
    this.loadCompanies().then(() => wx.stopPullDownRefresh())
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  tapFilter(e) {
    this.setData({ activeFilter: e.currentTarget.dataset.index })
  },

  tapSearch() {
    wx.showToast({ title: '企业搜索即将上线', icon: 'none' })
  },

  tapCompany(e) {
    wx.navigateTo({ url: `/pages/company-detail/company-detail?id=${e.currentTarget.dataset.id}` })
  },

  onShareAppMessage() {
    return { title: '职易达 · 找企业', path: '/pages/companies/companies' }
  },
})
