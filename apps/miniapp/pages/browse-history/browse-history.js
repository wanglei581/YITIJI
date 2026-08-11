// pages/browse-history/browse-history.js
const app = getApp()
const history = require('../../utils/history')

// 按 day 分组;list() 已按时间倒序,故按出现顺序分组即天然是「今天→昨天→更早」
function group(list) {
  const groups = []
  const idx = Object.create(null) // 无原型对象:防 day 恰为 'toString' 等原型键时索引误判(当前 day 不会出现,纯防御)
  list.forEach((r) => {
    if (idx[r.day] === undefined) { idx[r.day] = groups.length; groups.push({ day: r.day, items: [] }) }
    groups[idx[r.day]].items.push(r)
  })
  return groups
}

Page({
  data: {
    statusBarHeight: 20,
    activeFilter: 'all',
    filters: [
      { key: 'all',     label: '全部' },
      { key: 'job',     label: '岗位' },
      { key: 'fair',    label: '招聘会' },
      { key: 'company', label: '企业' },
      { key: 'policy',  label: '政策' },
    ],
    groups: [],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    this.setData({ groups: group(history.list(this.data.activeFilter)) })
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  setFilter(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ activeFilter: key, groups: group(history.list(key)) })
  },

  clear() {
    wx.showModal({
      title: '清空浏览记录',
      content: '将清空本人的浏览与跳转记录,不影响来源平台的任何数据。',
      confirmText: '清空',
      success: (res) => {
        if (!res.confirm) return
        history.clear()
        this.refresh()
        wx.showToast({ title: '已清空', icon: 'none', duration: 1200 })
      },
    })
  },

  openItem(e) {
    const { id, type } = e.currentTarget.dataset
    const routes = {
      job: '/pages/job-detail/job-detail',
      fair: '/pages/fair-detail/fair-detail',
      company: '/pages/company-detail/company-detail',
      policy: '/pages/policy-detail/policy-detail',
    }
    const url = routes[type]
    if (url && id != null && id !== '') { wx.navigateTo({ url: `${url}?id=${id}` }); return }
    wx.showToast({ title: '无法打开该记录', icon: 'none', duration: 1500 })
  },
})
