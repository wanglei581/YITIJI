// pages/resumes/resumes.js
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

function relDate(iso) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now - d) / 86400000)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    if (diffDays === 0) return '今天 ' + hh + ':' + mm
    if (diffDays === 1) return '昨天'
    if (diffDays < 7) return diffDays + ' 天前'
    return (d.getMonth() + 1) + '/' + d.getDate()
  } catch (_) { return '' }
}

/**
 * 将后端 MemberResumeItem 映射到 WXML 所需字段。
 * 后端字段: { id, taskId, kind, status, provider, optimized, createdAt, updatedAt, expiresAt }
 * WXML 期待: { id, name, format, updated, isDefault, score, tag, tagTone }
 */
function mapResume(item, index) {
  const name = item.kind === 'generate' ? 'AI 生成简历' : '上传简历'
  let tag = '', tagTone = ''
  if (item.optimized) {
    tag = '已优化'; tagTone = 'teal'
  } else if (item.status === 'completed') {
    tag = '已诊断'; tagTone = 'plum'
  } else if (item.status === 'pending' || item.status === 'processing') {
    tag = '处理中'; tagTone = 'wheat'
  }
  return {
    id: item.id,
    taskId: item.taskId,
    name,
    format: 'PDF',
    updated: relDate(item.updatedAt || item.createdAt),
    isDefault: index === 0,
    score: 0, // 列表端点不含诊断分，详情页展示
    tag,
    tagTone,
  }
}

Page({
  data: {
    statusBarHeight: 20,
    resumes: [],
    loginRequired: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    this._load()
  },

  async _load() {
    if (!auth.isLoggedIn()) {
      this.setData({ loginRequired: true, resumes: [] })
      return
    }
    this.setData({ loginRequired: false })
    wx.showLoading({ title: '加载中…', mask: true })
    try {
      const list = await api.getMyResumes({ pageSize: 50 })
      this.setData({ resumes: (list || []).map(mapResume) })
    } catch (e) {
      if (e.statusCode === 401) {
        this.setData({ loginRequired: true, resumes: [] })
      } else {
        wx.showToast({ title: e.message || '加载失败', icon: 'none', duration: 2000 })
      }
    } finally {
      wx.hideLoading()
    }
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  openResume(e) {
    const taskId = e.currentTarget.dataset.taskId
    if (taskId) wx.navigateTo({ url: `/pages/resume-diagnose/resume-diagnose?taskId=${encodeURIComponent(taskId)}` })
  },

  optimize(e) {
    const taskId = e.currentTarget.dataset.taskId
    if (taskId) wx.navigateTo({ url: `/pages/resume-optimize/resume-optimize?taskId=${encodeURIComponent(taskId)}` })
  },

  noop() {}, // 阻止事件冒泡用的空处理

  diagnose(e) {
    wx.navigateTo({ url: '/pages/resume-diagnose/resume-diagnose' })
  },

  upload() {
    wx.navigateTo({ url: '/pages/resume-upload/resume-upload' })
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },
})
