// pages/resumes/resumes.js
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const aiEntries = require('../../utils/ai-entries')

function relDate(iso) {
  try {
    const d = new Date(iso)
    // Invalid Date 不会 throw，try/catch 拦不住——不早退的话会落进 M/D 拼接分支
    // 渲染出「NaN/NaN」。iOS JSC 对 'YYYY-MM-DD HH:mm:ss' 空格格式解析失败而
    // Android 能解析，同一串双端表现不同，这不是理论输入。
    if (Number.isNaN(d.getTime())) return ''
    const now = new Date()
    // clamp 到 ≥0：手机系统时间比服务端慢（手动校时/时区错设）时 diff 为负，
    // 否则显示「-1 天前」。
    const diffDays = Math.max(0, Math.floor((now - d) / 86400000))
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
 * 当前列表端点只返回 AI 记录元数据，不返回关联文件或 MIME。
 * 若未来 additive 返回 mimeType 才显示真实格式；没有就明确写成记录，不能默认 PDF。
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
    mimeType: typeof item.mimeType === 'string' ? item.mimeType : '',
    fileLabel: typeof item.mimeType === 'string' && item.mimeType
      ? item.mimeType
      : '仅记录，未导出文件',
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
    nextCursor: null,
    loadingMore: false,
    loadMoreError: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    this._load()
  },

  onReachBottom() {
    this._load(true)
  },

  retryLoadMore() {
    this._load(true)
  },

  // 未登录 / 401：屏幕上的简历属于上一个会话，连同游标一起清掉。
  // 序号作废还在飞的那一页，避免退出或换号之后迟到的响应把旧列表写回来。
  _clearForLoggedOut() {
    this._seq = (this._seq || 0) + 1
    const refreshing = this._refreshing
    this._refreshing = false
    if (refreshing) wx.hideLoading()
    this.setData({
      loginRequired: true,
      resumes: [],
      nextCursor: null,
      loadingMore: false,
      loadMoreError: '',
    })
  },

  async _load(append = false) {
    if (!auth.isLoggedIn()) {
      this._clearForLoggedOut()
      return
    }
    // 没有下一页、正在翻页、或整页刷新还没回来：触底不再发请求。
    if (append && (!this.data.nextCursor || this.data.loadingMore || this._refreshing)) return
    const seq = (this._seq = (this._seq || 0) + 1)
    const cursor = append ? this.data.nextCursor : null
    if (append) {
      this.setData({ loadingMore: true, loadMoreError: '' })
    } else {
      this._refreshing = true
      this.setData({ loginRequired: false, loadingMore: false, loadMoreError: '' })
      wx.showLoading({ title: '加载中…', mask: true })
    }
    try {
      // nextCursor 挂在返回数组上（utils/api.js unwrapList）。第 51 份起靠它再请求。
      const list = await api.getMyResumes({ pageSize: 50, ...(cursor ? { cursor } : {}) })
      if (seq !== this._seq) return
      if (!auth.isLoggedIn()) {
        this._clearForLoggedOut()
        return
      }
      const start = append ? this.data.resumes.length : 0
      const page = (list || []).map((item, index) => mapResume(item, start + index))
      this.setData({
        loginRequired: false,
        resumes: append ? this.data.resumes.concat(page) : page,
        nextCursor: (list && list.nextCursor) || null,
        loadingMore: false,
        loadMoreError: '',
      })
    } catch (e) {
      if (seq !== this._seq) return
      if (!auth.isLoggedIn() || (e && e.statusCode === 401)) {
        this._clearForLoggedOut()
        return
      }
      // 翻页失败只在底部说明：已显示的简历留在屏幕上，游标留着以便重试。
      if (append) {
        this.setData({
          loadingMore: false,
          loadMoreError: (e && e.message) || '加载更多失败，点此重试',
        })
        return
      }
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none', duration: 2000 })
    } finally {
      if (!append && seq === this._seq) {
        this._refreshing = false
        wx.hideLoading()
      }
    }
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  openResume(e) {
    const taskId = e.currentTarget.dataset.taskId
    if (taskId) wx.navigateTo({ url: aiEntries.href(aiEntries.resumeDiagnoseUrl, 'taskId=' + encodeURIComponent(taskId)) })
  },

  optimize(e) {
    const taskId = e.currentTarget.dataset.taskId
    if (taskId) wx.navigateTo({ url: aiEntries.href(aiEntries.resumeOptimizeUrl, 'taskId=' + encodeURIComponent(taskId)) })
  },

  noop() {}, // 阻止事件冒泡用的空处理

  diagnose(e) {
    wx.navigateTo({ url: aiEntries.resumeDiagnoseUrl })
  },

  upload() {
    wx.navigateTo({ url: aiEntries.resumeUploadUrl })
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },
})
