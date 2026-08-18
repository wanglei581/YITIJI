// pages/community/community.js
const app = getApp()
const api = require('../../utils/api')

const AV_COLORS = ['#7a5a86', '#1f9e86', '#c8622a', '#2563eb', '#be7c30']
function avColor(name) {
  return AV_COLORS[(name || '?').charCodeAt(0) % AV_COLORS.length]
}
function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}天前`
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
function process(item) {
  const name = item.authorName || (item.author && item.author.name) || '匿名'
  return { ...item, _authorName: name, _initials: name.slice(0, 1), _color: avColor(name), _timeAgo: timeAgo(item.createdAt || item.publishedAt) }
}

Page({
  data: {
    statusBarHeight: 20,
    feeds: [], loading: true, error: '', noMore: false, cursor: null, refreshing: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this._load(true)
  },

  onPullDownRefresh() {
    this._load(true).then(() => wx.stopPullDownRefresh())
  },

  _load(reset) {
    if (!reset && this.data.noMore) return Promise.resolve()
    const cursor = reset ? null : this.data.cursor
    this.setData({ loading: true, error: '', ...(reset ? { refreshing: true } : {}) })
    return api.getCommunityFeeds({ pageSize: 15, ...(cursor ? { cursor } : {}) })
      .then(list => {
        const items = (Array.isArray(list) ? list : []).map(process)
        const feeds = reset ? items : [...this.data.feeds, ...items]
        this.setData({
          feeds,
          loading:    false,
          refreshing: false,
          noMore:     items.length < 15,
          cursor:     list.nextCursor || null,
        })
      })
      .catch(err => {
        const msg = err && err.statusCode === 501 ? '职业圈需连接真实后端' : '加载失败，下拉可重试'
        this.setData({ loading: false, refreshing: false, error: msg })
      })
  },

  loadMore() { this._load(false) },

  tapLike(e) {
    const { id, liked } = e.currentTarget.dataset
    const fn = liked ? api.unlikeFeed.bind(api) : api.likeFeed.bind(api)
    fn(id).then(() => {
      const feeds = this.data.feeds.map(f => {
        if (f.id !== id) return f
        return { ...f, likedByMe: !liked, likeCount: (f.likeCount || 0) + (liked ? -1 : 1) }
      })
      this.setData({ feeds })
    }).catch(() => wx.showToast({ title: '请先登录', icon: 'none' }))
  },

  goBack() { wx.navigateBack() },

  onShareAppMessage() {
    return { title: '职易达职业圈', path: '/pages/community/community' }
  },
})
