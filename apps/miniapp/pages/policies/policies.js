// pages/policies/policies.js · P26 政策服务
const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    statusBarHeight: 20,
    cats: [
      { label: '应届生', emoji: '🎓', accent: 'slate' },
      { label: '求职补贴', emoji: '💰', accent: 'teal' },
      { label: '创业扶持', emoji: '🚀', accent: 'wheat' },
      { label: '落户住房', emoji: '🏠', accent: 'clay' },
      { label: '技能认证', emoji: '📜', accent: 'plum' },
    ],
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
    return api.getPolicies()
      .then((list) => this.setData({ policies: list || [], loading: false }))
      .catch((err) => this.setData({ loading: false, loadError: (err && err.message) || '加载失败' }))
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
