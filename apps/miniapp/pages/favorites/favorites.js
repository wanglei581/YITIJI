// pages/favorites/favorites.js
// 我的收藏。登录后读服务端 /api/v1/me/favorites —— 手机与一体机是同一个账号、
// 同一份收藏;未登录读本机(功能不消失,只是不跨设备)。
// 加载失败必须显示「加载失败 + 重新加载」,绝不能伪装成「还没有收藏」。
const app = getApp()
const auth = require('../../utils/auth')
const favorites = require('../../utils/favorites')

const ROUTES = {
  job: '/pages/job-detail/job-detail',
  fair: '/pages/fair-detail/fair-detail',
  company: '/pages/company-detail/company-detail',
  policy: '/pages/policy-detail/policy-detail',
}

Page({
  data: {
    statusBarHeight: 20,
    managing: false,
    activeTab: 'job',
    tabs: [
      { key: 'job',     label: '岗位' },
      { key: 'fair',    label: '招聘会' },
      { key: 'policy',  label: '政策' },
      { key: 'company', label: '企业' },
    ],
    list: [],
    // loading / ready / error —— 三态分开,失败与空态不得混为一谈
    state: 'loading',
    loadError: '',
    source: 'local',
    loggedIn: false,
    tabNote: '',
    mergeCount: 0,
    merging: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    // 从详情页收藏/取消后返回需重新读取
    this.refresh()
  },

  refresh() {
    const type = this.data.activeTab
    const loggedIn = auth.isLoggedIn()
    this.setData({
      loggedIn,
      state: 'loading',
      loadError: '',
      mergeCount: loggedIn ? favorites.localPending().length : 0,
    })
    favorites.listPage(type)
      .then((res) => {
        // 快速切 Tab 时旧请求可能后到,丢弃非当前 Tab 的结果
        if (this.data.activeTab !== type) return
        this.setData({
          list: res.items || [],
          source: res.source,
          state: 'ready',
          tabNote: this._noteOf(type, res.source, loggedIn),
        })
      })
      .catch((err) => {
        if (this.data.activeTab !== type) return
        const msg = err && err.statusCode === 401
          ? '登录已失效，请重新登录后查看账号收藏'
          : (err && err.message) || '收藏加载失败，请稍后重试'
        this.setData({ state: 'error', loadError: msg, list: [] })
      })
  },

  // 每个 Tab 的数据归属如实说明,不让用户误以为企业收藏也跨设备。
  _noteOf(type, source, loggedIn) {
    if (type === 'company') return '企业收藏仅保存在本机，服务端暂无企业收藏能力，换设备不会同步。'
    if (source === 'server') return '已同步到账号，与一体机共用同一份收藏。'
    if (!loggedIn) return '当前为本机收藏，登录后可同步到账号并在一体机上看到。'
    return '当前显示本机收藏。'
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  setTab(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.activeTab) return
    this.setData({ activeTab: key, list: [] })
    this.refresh()
  },

  toggleManage() {
    this.setData({ managing: !this.data.managing })
  },

  retryLoad() {
    this.refresh()
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  // 显式合并:本机收藏逐条上传到账号。失败的保留在本机,不静默丢弃。
  doMerge() {
    if (this.data.merging) return
    this.setData({ merging: true })
    wx.showLoading({ title: '正在同步…', mask: true })
    favorites.mergeLocalToAccount()
      .then((res) => {
        wx.hideLoading()
        this.setData({ merging: false })
        const failedNote = res.failed
          ? `\n${res.failed} 条未能同步（来源内容可能已下线），仍保留在本机。`
          : ''
        wx.showModal({
          title: '同步完成',
          content: `已同步 ${res.merged} 条收藏到账号。${failedNote}`,
          showCancel: false,
          confirmText: '知道了',
          complete: () => this.refresh(),
        })
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ merging: false })
        wx.showToast({ title: (err && err.message) || '同步失败，请稍后重试', icon: 'none', duration: 1800 })
      })
  },

  unfav(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const type = this.data.activeTab
    favorites.remove(type, id)
      .then(() => {
        wx.showToast({ title: '已取消收藏', icon: 'none', duration: 1200 })
        this.refresh()
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '取消收藏失败，请稍后重试', icon: 'none', duration: 1800 })
      })
  },

  openItem(e) {
    if (this.data.managing) return // 管理模式下点卡片主体不跳转，只保留删除按钮
    const id = e.currentTarget.dataset.id
    const url = ROUTES[this.data.activeTab]
    if (url && id) {
      wx.navigateTo({ url: `${url}?id=${id}` })
      return
    }
    wx.showToast({ title: '无法打开该收藏', icon: 'none', duration: 1500 })
  },
})
