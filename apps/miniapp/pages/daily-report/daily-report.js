// pages/daily-report/daily-report.js
const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    error:   '',
    report:  null,
    dateStr: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    const now = new Date()
    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
    this.setData({ dateStr })
    this._loadReport()
  },

  _loadReport() {
    this.setData({ loading: true, error: '' })
    api.getDailyReport()
      .then(r => {
        this.setData({ report: r || null, loading: false })
      })
      .catch(err => {
        const msg = err && err.statusCode === 501
          ? '今日早报需连接真实后端，当前为演示模式'
          : '加载失败，请稍后重试'
        this.setData({ loading: false, error: msg })
      })
  },

  retry() { this._loadReport() },

  goBack() { wx.navigateBack() },

  tapJob(e) {
    const { id } = e.currentTarget.dataset
    if (id) wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${id}` })
  },

  onShareAppMessage() {
    return { title: '今日求职早报', path: '/pages/daily-report/daily-report' }
  },
})
