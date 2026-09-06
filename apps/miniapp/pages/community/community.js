// pages/community/community.js
// 官方动态流：政策 / 权益 / 通知。未登录可读；无点赞、无评论。
const app = getApp()
const api = require('../../utils/api')

const PAGE_LIMIT = 20
const KIND_LABEL = { policy: '政策', benefit: '权益', broadcast: '通知' }
const KIND_TONE = { policy: 'teal', benefit: 'wheat', broadcast: 'plum' }
const TAB_PATHS = {
  '/pages/home/home': true,
  '/pages/ai/ai': true,
  '/pages/jobs/jobs': true,
  '/pages/me/me': true,
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  if (Number.isNaN(diff)) return ''
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}天前`
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function toView(item) {
  const action = item && item.action ? item.action : {}
  const kind = item && item.kind
  return {
    id: item && item.id,
    kindLabel: KIND_LABEL[kind] || '',
    kindTone: KIND_TONE[kind] || '',
    title: (item && item.title) || '',
    summary: (item && item.summary) || '',
    sourceName: (item && item.sourceName) || '',
    timeAgo: timeAgo(item && item.publishedAt),
    actionLabel: action.label || '',
    actionRoute: action.route || '',
  }
}

function openMiniappRoute(route) {
  if (!route) return
  const path = String(route).split('?')[0]
  if (TAB_PATHS[path]) {
    wx.switchTab({ url: path })
    return
  }
  wx.navigateTo({ url: route })
}

Page({
  data: {
    statusBarHeight: 20,
    feeds: [],
    loading: true,
    error: '',
    noMore: false,
    nextCursor: '',
    refreshing: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this._load(true)
  },

  onPullDownRefresh() {
    this._load(true).then(() => wx.stopPullDownRefresh())
  },

  _load(reset) {
    if (!reset && (this.data.noMore || this.data.loading)) return Promise.resolve()
    const cursor = reset ? '' : this.data.nextCursor
    this.setData({ loading: true, error: '', ...(reset ? { refreshing: true } : {}) })
    return api.getCommunityFeeds({ limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) })
      .then((res) => {
        const list = (res && Array.isArray(res.items) ? res.items : []).map(toView)
        const nextCursor = (res && res.nextCursor) || ''
        this.setData({
          feeds: reset ? list : this.data.feeds.concat(list),
          loading: false,
          refreshing: false,
          nextCursor,
          noMore: !nextCursor,
        })
      })
      .catch((err) => {
        this.setData({
          loading: false,
          refreshing: false,
          error: (err && err.message) || '加载失败，下拉可重试',
        })
      })
  },

  loadMore() { this._load(false) },

  openRoute(e) {
    openMiniappRoute(e.currentTarget.dataset.route)
  },

  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/ai/ai' }) } }) },

  onShareAppMessage() {
    return { title: '最新动态', path: '/pages/community/community' }
  },
})
