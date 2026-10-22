const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { ensureMember } = require('../../utils/page-guard')

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
    nextCursor: null,
    loadingMore: false,
    list: [],
    loading: true,
    loadError: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    // 登录闸门（FLOW1b）：过期但可恢复时先等恢复结果；只有确定需要登录才去登录页。
    // 网络、限流、服务端故障时留在本页给重试，不把人送去重收短信。
    ensureMember(auth, api).then((r) => {
      if (this._unloaded) return
      if (r.state === 'need_login') {
        wx.redirectTo({
          url: `/pages/launch/launch?returnTo=${encodeURIComponent('/pages/notifications/notifications')}`,
          // redirectTo 失败（如 launch 已在栈顶）时不能静默留在本页，与 contract-review._toLogin 同款兜底。
          fail: () => wx.switchTab({ url: '/pages/home/home' }),
        })
        return
      }
      if (r.state === 'recoverable') {
        this.setData({ loading: false, loadError: '暂时没能恢复登录，请稍后重试' })
        return
      }
      this.loadNotifications()
    })
  },

  onUnload() {
    this._unloaded = true
  },

  // 「加载失败，点此重试」走这里。模板曾直接 bindtap="loadNotifications"：点击事件对象被当成 append，
  // 没有下一页时直接返回、有下一页时把下一页追加进来——与我的文档同一个缺陷（FLOW1a）。
  reloadNotifications() {
    this.loadNotifications(false)
  },

  loadNotifications(append) {
    // 2026-09-03：同 documents 的「50 条静默截断」修复——nextCursor 一直被丢弃，
    // 第 51 条起永远不显示。分页写法对照 orders.js / documents.js。
    // 只有 append === true 才翻页：别的真值（例如误绑进来的事件对象）一律按刷新处理。
    const paging = append === true
    if (paging && (!this.data.nextCursor || this.data.loadingMore)) return
    const cursor = paging ? this.data.nextCursor : null
    this.setData(paging ? { loadingMore: true } : { loading: true, loadError: '' })
    api.getMyNotifications({ pageSize: 50, ...(cursor ? { cursor } : {}) })
      .then((page) => {
        const items = ((page && page.items) || []).map(toView)
        const all = paging ? [...this.data.all, ...items] : items
        this.setData({ all, loading: false, loadingMore: false,
          nextCursor: (page && page.nextCursor) || null })
        this.applyFilter(this.data.activeFilter, all)
      })
      .catch((err) => this.setData({
        loading: false,
        loadingMore: false,
    loadError: (err && err.message) || '加载通知失败，请稍后重试',
      }))
  },

  onReachBottom() {
    this.loadNotifications(true)
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
