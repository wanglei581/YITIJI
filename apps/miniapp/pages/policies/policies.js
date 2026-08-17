// pages/policies/policies.js · P26 政策服务
const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    statusBarHeight: 20,
    cats: [
      { key: 'all', label: '全部政策', icon: 'file-text', accent: 'teal' },
      { key: 'graduate', label: '高校毕业生', icon: 'solution', accent: 'slate' },
      { key: 'flexible', label: '灵活就业', icon: 'compass', accent: 'wheat' },
      { key: 'startup', label: '创业者', icon: 'aim', accent: 'plum' },
      { key: 'hardship', label: '就业困难', icon: 'form', accent: 'clay' },
    ],
    activeCat: 'all',
    policies: [],
    loading: true,
    loadError: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this.loadPolicies()
  },

  loadPolicies() {
    this.setData({ loading: true, loadError: '' })
    const audience = this.data.activeCat === 'all' ? undefined : this.data.activeCat
    return api.getPolicies(audience ? { audience } : {})
      .then((list) => this.setData({ policies: list || [], loading: false }))
      .catch((err) => this.setData({ loading: false, loadError: (err && err.message) || '加载失败' }))
  },

  tapCat(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.activeCat) return
    this.setData({ activeCat: key }, () => this.loadPolicies())
  },

  reload() {
    this.loadPolicies()
  },

  onPullDownRefresh() {
    this.loadPolicies().then(() => wx.stopPullDownRefresh())
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  tapPolicy(e) {
    wx.navigateTo({ url: `/pages/policy-detail/policy-detail?id=${e.currentTarget.dataset.id}` })
  },

  onShareAppMessage() {
    return { title: '职易达 · 就业创业政策', path: '/pages/policies/policies' }
  },
})
