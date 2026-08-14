const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

const META = {
  print: { icon: 'printer', tone: 'teal', link: '查看打印订单' },
  ai: { icon: 'robot', tone: 'plum', link: '查看 AI 记录' },
  feedback: { icon: 'comment', tone: 'wheat', link: '' },
  system: { icon: 'bell', tone: 'slate', link: '' },
}

function toView(item) {
  const type = ['print', 'ai', 'feedback'].includes(item.category) ? item.category : 'system'
  const meta = META[type]
  const d = new Date(item.createdAt)
  const time = Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return {
    id: item.id,
    kind: item.kind,
    type,
    t: item.title,
    body: item.content,
    unread: !item.isRead,
    time,
    icon: meta.icon,
    tone: meta.tone,
    link: meta.link,
    relatedType: item.relatedType,
    relatedId: item.relatedId,
  }
}

Page({
  data: {
    statusBarHeight: 20,
    activeFilter: 'all',
    filters: [
      { id: 'all', label: '全部' },
      { id: 'print', label: '打印' },
      { id: 'ai', label: 'AI' },
      { id: 'system', label: '系统' },
    ],
    all: [],
    list: [],
    loading: true,
    loadError: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    if (!auth.isLoggedIn()) {
      wx.redirectTo({
        url: `/pages/launch/launch?returnTo=${encodeURIComponent('/pages/notifications/notifications')}`,
      })
      return
    }
    this.loadNotifications()
  },

  loadNotifications() {
    this.setData({ loading: true, loadError: '' })
    api.getMyNotifications({ pageSize: 50 })
      .then((page) => {
        const all = ((page && page.items) || []).map(toView)
        this.setData({ all, loading: false })
        this.applyFilter(this.data.activeFilter, all)
      })
      .catch((err) => this.setData({
        loading: false,
        loadError: (err && err.message) || '加载通知失败，请稍后重试',
      }))
  },

  applyFilter(filter, source) {
    const all = source || this.data.all
    this.setData({ list: filter === 'all' ? all : all.filter((item) => item.type === filter) })
  },

  setFilter(e) {
    const filter = e.currentTarget.dataset.id
    this.setData({ activeFilter: filter })
    this.applyFilter(filter)
  },

  markAllRead() {
    if (!this.data.all.some((item) => item.unread)) {
      wx.showToast({ title: '没有未读通知', icon: 'none' })
      return
    }
    api.markAllNotificationsRead()
      .then(() => {
        const all = this.data.all.map((item) => ({ ...item, unread: false }))
        this.setData({ all })
        this.applyFilter(this.data.activeFilter, all)
        wx.showToast({ title: '已全部标记为已读', icon: 'success' })
      })
      .catch((err) => wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }))
  },

  tapItem(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const item = this.data.all.find((entry) => entry.id === id)
    if (!item) return
    if (item.unread) {
      api.markNotificationRead(item.kind, item.id)
        .then(() => {
          const all = this.data.all.map((entry) => entry.id === id ? { ...entry, unread: false } : entry)
          this.setData({ all })
          this.applyFilter(this.data.activeFilter, all)
        })
        .catch(() => {})
    }
  },

  tapLink(e) {
    const item = this.data.all.find((entry) => entry.id === String(e.currentTarget.dataset.id || ''))
    if (!item) return
    this.tapItem(e)
    if (item.type === 'print') wx.navigateTo({ url: '/pages/orders/orders' })
    if (item.type === 'ai') wx.navigateTo({ url: '/pages/ai-records/ai-records' })
  },

  back() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
