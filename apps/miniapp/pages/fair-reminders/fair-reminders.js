// pages/fair-reminders/fair-reminders.js
// 我的招聘会提醒列表：读取本机 reminders.js 数据，支持取消提醒与跳转详情
const app = getApp()
const reminders = require('../../utils/reminders')

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const mo = d.getMonth() + 1
  const da = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${mo}月${da}日 ${hh}:${mm}`
}

function isExpired(iso) {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return !isNaN(t) && t < Date.now()
}

Page({
  data: {
    statusBarHeight: 20,
    list: [],
    hasExpired: false,
    managing: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const all = reminders.getAll()
    const list = Object.values(all).map((item) => ({
      id: item.id,
      title: item.title,
      timeStr: formatTime(item.startTime),
      startTime: item.startTime || '',
      venue: item.venue || '',
      expired: isExpired(item.startTime),
      createdAt: item.createdAt,
    }))
    // 未过期在前，已过期在后，同类按 startTime 正序
    list.sort((a, b) => {
      if (a.expired !== b.expired) return a.expired ? 1 : -1
      return new Date(a.startTime || 0) - new Date(b.startTime || 0)
    })
    const hasExpired = list.some(function(i) { return i.expired })
    this.setData({ list, hasExpired })
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/me/me' }) } })
  },

  toggleManage() {
    this.setData({ managing: !this.data.managing })
  },

  removeReminder(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    reminders.remove(id)
    this.refresh()
    wx.showToast({ title: '提醒已取消', icon: 'none', duration: 1200 })
  },

  openFair(e) {
    if (this.data.managing) return
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/fair-detail/fair-detail?id=${id}` })
  },

  clearExpired() {
    const all = reminders.getAll()
    Object.keys(all).forEach((id) => {
      if (isExpired(all[id].startTime)) reminders.remove(id)
    })
    this.refresh()
    wx.showToast({ title: '已清除已过期提醒', icon: 'none', duration: 1400 })
  },
})
