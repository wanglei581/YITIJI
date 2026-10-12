// pages/feedback/feedback.js
// 会员意见反馈：提交表单 + 本人工单。状态只展示服务端返回值，不本地伪造。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { AI_ENABLED } = require('../../utils/build-variant')

// ai_content（C3）：AI 内容投诉，服务端 member-feedback.dto.ts 的 FEEDBACK_CATEGORIES 里有这一类。
// 个人信息请求不在这里开类别：在「隐私与数据」自助办，办不了的按那里写的方式联系（9/28 C3 口径）。
const CAT_LABEL = { device: '设备使用', print: '打印服务', file_process: '文件处理', general: '一般建议', ai_content: 'AI 内容投诉' }
// 答复时限（D5，律师再核）。写在页面上，也是对用户的承诺，改之前先改法务文档。
const AI_COMPLAINT_REPLY_DAYS = 5
const CATEGORIES = Object.keys(CAT_LABEL)
  .filter((value) => AI_ENABLED || value !== 'ai_content')
  .map((value) => ({ value, label: CAT_LABEL[value] }))
const STATUS_LABEL = { pending: '待处理', processing: '处理中', replied: '已回复', closed: '已关闭' }
const STATUS_TONE = { pending: 'wheat', processing: 'teal', replied: 'ok', closed: '' }
const PHONE_RE = /^1[3-9]\d{9}$/

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function snippet(text, n) {
  const s = String(text || '').trim()
  return !s ? '' : (s.length > n ? `${s.slice(0, n)}…` : s)
}

function statusFields(st) {
  return {
    status: st,
    statusLabel: STATUS_LABEL[st] || st || '状态未知',
    statusTone: STATUS_TONE[st] || '',
    canClose: st === 'replied',
  }
}

function mapReplies(replies) {
  return (replies || []).map((r) => ({
    id: String(r.id || ''),
    who: r.senderType === 'user' ? '我的补充' : (r.senderType === 'admin' ? '服务回复' : '系统说明'),
    content: r.content || '',
    time: formatTime(r.createdAt),
  }))
}

function toView(item) {
  const st = item.status
  return Object.assign({
    id: String(item.id || ''),
    categoryLabel: CAT_LABEL[item.category] || item.category || '',
    title: item.title || '',
    content: item.content || '',
    preview: snippet(item.title || item.content, 48),
    time: formatTime(item.updatedAt || item.createdAt),
    expanded: false,
    replies: null,
    replyPreview: '',
    loadingDetail: false,
    closing: false,
  }, statusFields(st))
}

Page({
  data: {
    statusBarHeight: 20,
    loggedIn: false,
    aiEnabled: AI_ENABLED,
    categories: CATEGORIES,
    category: 'general',
    title: '',
    content: '',
    contentLen: 0,
    contactPhone: '',
    aiReplyDays: AI_COMPLAINT_REPLY_DAYS,
    submitting: false,
    canSubmit: false,
    list: [],
    listState: 'idle',
    loadError: '',
    nextCursor: null,
    loadingMore: false,
    loadMoreError: '',
  },

  onLoad(options) {
    let preset = options && CAT_LABEL[options.category] ? options.category : ''
    if (!AI_ENABLED && preset === 'ai_content') preset = ''
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      aiReplyDays: AI_COMPLAINT_REPLY_DAYS,
      category: preset || this.data.category,
    })
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      this._abandonList()
      return
    }
    this.setData({ loggedIn: true })
    this.loadList()
  },

  onReachBottom() {
    this.loadList(true)
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/me/me' }) } })
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  // 没登录也要有投诉的去处：经营者信息里有联系电话。
  goOperatorInfo() {
    wx.navigateTo({ url: '/pages/legal/legal?type=operator_info' })
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' })
  },

  setCategory(e) {
    const value = e.currentTarget.dataset.value
    if (!AI_ENABLED && value === 'ai_content') return
    if (CAT_LABEL[value]) this.setData({ category: value })
  },

  onTitle(e) { this.setData({ title: String(e.detail.value || '').slice(0, 80) }) },

  onContent(e) {
    const content = String(e.detail.value || '').slice(0, 500)
    this.setData({ content, contentLen: content.length, canSubmit: content.trim().length >= 10 })
  },

  onPhone(e) { this.setData({ contactPhone: e.detail.value || '' }) },

  submit() {
    if (this.data.submitting) return
    const content = this.data.content.trim()
    if (content.length < 10 || content.length > 500) {
      wx.showToast({ title: content.length < 10 ? '请至少填写 10 个字' : '内容不能超过 500 字', icon: 'none' })
      return
    }
    const phone = this.data.contactPhone.trim()
    if (phone && !PHONE_RE.test(phone)) {
      wx.showToast({ title: '请填写 11 位手机号', icon: 'none' })
      return
    }
    const title = this.data.title.trim()
    const body = { category: this.data.category, content }
    if (title) body.title = title.slice(0, 80)
    if (phone) body.contactPhone = phone
    this.setData({ submitting: true })
    api.createFeedback(body)
      .then(() => {
        this.setData({ submitting: false, title: '', content: '', contentLen: 0, contactPhone: '', canSubmit: false })
        wx.showToast({ title: '反馈已送出', icon: 'success' })
        this.loadList()
      })
      .catch((err) => {
        if (this._handleAuthError(err)) return
        this.setData({ submitting: false })
        wx.showToast({ title: (err && err.message) || '提交失败，反馈未送出', icon: 'none', duration: 2000 })
      })
  },

  /**
   * 令牌过期（401）时统一回到「请先登录」态：只弹 toast 会把用户留在一个再点也没用的
   * 表单前面。返回 true 表示已按登录态处理，调用方不要再弹自己的失败 toast。
   * （Hermes 第 17 轮建议 2）
   */
  _handleAuthError(err) {
    if (!err || err.statusCode !== 401) return false
    this._abandonList()
    wx.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
    return true
  },

  // 未登录 / 401：本人工单不能留在屏幕上。序号作废在途请求，换号后迟到的一页写不回来。
  _abandonList() {
    this._seq = (this._seq || 0) + 1
    this.setData({
      loggedIn: false,
      list: [],
      listState: 'idle',
      loadError: '',
      submitting: false,
      closingId: '',
      nextCursor: null,
      loadingMore: false,
      loadMoreError: '',
    })
  },

  loadList(append = false) {
    if (!auth.isLoggedIn()) {
      this._abandonList()
      return
    }
    // 没有下一页、正在翻页、或整页还在加载：触底不再发请求。
    if (append && (!this.data.nextCursor || this.data.loadingMore || this.data.listState === 'loading')) return
    const seq = (this._seq = (this._seq || 0) + 1)
    const cursor = append ? this.data.nextCursor : null
    if (append) {
      this.setData({ loadingMore: true, loadMoreError: '' })
    } else {
      this.setData({
        loggedIn: true,
        listState: 'loading',
        loadError: '',
        loadingMore: false,
        loadMoreError: '',
      })
    }
    // nextCursor 挂在返回数组上（utils/api.js unwrapList）。第 51 条起靠它再请求。
    api.getMyFeedback({ pageSize: 50, ...(cursor ? { cursor } : {}) })
      .then((items) => {
        if (seq !== this._seq) return
        if (!auth.isLoggedIn()) {
          this._abandonList()
          return
        }
        const page = (items || []).map(toView)
        this.setData({
          loggedIn: true,
          list: append ? this.data.list.concat(page) : page,
          listState: 'ready',
          loadError: '',
          loadingMore: false,
          loadMoreError: '',
          nextCursor: (items && items.nextCursor) || null,
        })
      })
      .catch((err) => {
        if (seq !== this._seq) return
        if (!auth.isLoggedIn() || (err && err.statusCode === 401)) {
          this._abandonList()
          return
        }
        // 翻页失败不把 listState 打成 error：那一支模板会换成错误卡片，已看到的反馈会消失。
        if (append) {
          this.setData({
            loadingMore: false,
            loadMoreError: (err && err.message) || '加载更多失败，点此重试',
          })
          return
        }
        this.setData({
          list: [],
          listState: 'error',
          loadError: (err && err.message) || '加载失败，请稍后重试',
          loadingMore: false,
          nextCursor: null,
          loadMoreError: '',
        })
      })
  },

  retryLoad() { this.loadList() },

  retryLoadMore() { this.loadList(true) },

  toggleItem(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const list = this.data.list.map((item) => (
      item.id === id
        ? Object.assign({}, item, { expanded: !item.expanded })
        : (item.expanded ? Object.assign({}, item, { expanded: false }) : item)
    ))
    this.setData({ list })
    const target = list.find((item) => item.id === id)
    if (target && target.expanded && target.replies === null) this._loadDetail(id)
  },

  closeItem(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.list.find((x) => x.id === id)
    if (!item || !item.canClose || item.closing) return
    this._patch(id, { closing: true })
    api.closeFeedback(id)
      .then((detail) => this._patch(id, Object.assign({ closing: false }, statusFields(detail && detail.status))))
      .catch((err) => {
        this._patch(id, { closing: false })
        if (this._handleAuthError(err)) return
        wx.showToast({ title: (err && err.message) || '关闭失败', icon: 'none' })
      })
  },

  _loadDetail(id) {
    this._patch(id, { loadingDetail: true })
    api.getFeedbackDetail(id)
      .then((detail) => {
        const replies = mapReplies(detail && detail.replies)
        const last = replies.length ? replies[replies.length - 1] : null
        this._patch(id, Object.assign({
          loadingDetail: false,
          replies,
          replyPreview: last ? snippet(`${last.who}：${last.content}`, 48) : '暂无回复',
          content: (detail && detail.content) || '',
        }, statusFields(detail && detail.status)))
      })
      .catch((err) => {
        this._patch(id, { loadingDetail: false })
        if (this._handleAuthError(err)) return
        wx.showToast({ title: (err && err.message) || '详情加载失败', icon: 'none' })
      })
  },

  _patch(id, patch) {
    this.setData({ list: this.data.list.map((item) => (item.id === id ? Object.assign({}, item, patch) : item)) })
  },
})
