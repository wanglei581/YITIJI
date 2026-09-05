// pages/feedback/feedback.js
// 会员意见反馈：提交表单 + 本人工单。状态只展示服务端返回值，不本地伪造。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

const CAT_LABEL = { device: '设备使用', print: '打印服务', file_process: '文件处理', general: '一般建议' }
const CATEGORIES = Object.keys(CAT_LABEL).map((value) => ({ value, label: CAT_LABEL[value] }))
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
  const st = STATUS_LABEL[item.status] ? item.status : item.status
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
    categories: CATEGORIES,
    category: 'general',
    title: '',
    content: '',
    contentLen: 0,
    contactPhone: '',
    submitting: false,
    canSubmit: false,
    list: [],
    listState: 'idle',
    loadError: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    const loggedIn = auth.isLoggedIn()
    this.setData({ loggedIn })
    if (loggedIn) this.loadList()
    else this.setData({ list: [], listState: 'idle', loadError: '' })
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/me/me' }) } })
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  setCategory(e) {
    const value = e.currentTarget.dataset.value
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
        this.setData({ submitting: false })
        wx.showToast({ title: (err && err.message) || '提交失败，反馈未送出', icon: 'none', duration: 2000 })
      })
  },

  loadList() {
    this.setData({ listState: 'loading', loadError: '' })
    api.getMyFeedback({ pageSize: 50 })
      .then((items) => this.setData({ list: (items || []).map(toView), listState: 'ready' }))
      .catch((err) => {
        const login = err && err.statusCode === 401
        this.setData({
          loggedIn: login ? false : this.data.loggedIn,
          list: [],
          listState: login ? 'idle' : 'error',
          loadError: login ? '' : ((err && err.message) || '加载失败，请稍后重试'),
        })
      })
  },

  retryLoad() { this.loadList() },

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
        wx.showToast({ title: (err && err.message) || '详情加载失败', icon: 'none' })
      })
  },

  _patch(id, patch) {
    this.setData({ list: this.data.list.map((item) => (item.id === id ? Object.assign({}, item, patch) : item)) })
  },
})
