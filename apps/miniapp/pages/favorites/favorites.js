// pages/favorites/favorites.js
// 读取本机真实收藏(utils/favorites,wx.storage)。岗位/招聘会/企业三个详情页均可收藏,
// 对应 tab 读各自本机收藏;无收藏时如实显示空态,不伪造样例数据。
// 接后端后改为 GET /api/v1/me/favorites,以服务端为准。
const app = getApp()
const favorites = require('../../utils/favorites')

Page({
  data: {
    statusBarHeight: 20,
    managing: false,
    activeTab: 'job',
    tabs: [
      { key: 'job',     label: '岗位' },
      { key: 'fair',    label: '招聘会' },
      { key: 'company', label: '企业' },
    ],
    list: [],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this.refresh()
  },

  onShow() {
    // 从详情页收藏/取消后返回,重新读取本机收藏
    this.refresh()
  },

  refresh() {
    this.setData({ list: favorites.list(this.data.activeTab) })
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  setTab(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ activeTab: key, list: favorites.list(key) })
  },

  toggleManage() {
    this.setData({ managing: !this.data.managing })
  },

  unfav(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    favorites.remove(this.data.activeTab, id)
    this.refresh()
    wx.showToast({ title: '已取消收藏', icon: 'none', duration: 1200 })
  },

  openItem(e) {
    if (this.data.managing) return // 管理模式下点卡片主体不跳转,只保留 ✕ 删除
    const id = e.currentTarget.dataset.id
    const routes = {
      job: '/pages/job-detail/job-detail',
      fair: '/pages/fair-detail/fair-detail',
      company: '/pages/company-detail/company-detail',
    }
    const url = routes[this.data.activeTab]
    if (url && id) {
      wx.navigateTo({ url: `${url}?id=${id}` })
      return
    }
    wx.showToast({ title: '无法打开该收藏', icon: 'none', duration: 1500 })
  },
})
