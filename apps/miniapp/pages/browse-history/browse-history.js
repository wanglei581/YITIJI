// pages/browse-history/browse-history.js
// 浏览与跳转记录。登录后读服务端 /me/browse-logs + /me/external-jump-logs ——
// 手机与一体机是同一个账号的同一份足迹;未登录读本机(功能不消失,只是不跨设备)。
// 加载失败必须显示「加载失败」,绝不能伪装成「暂无浏览记录」。
const app = getApp()
const auth = require('../../utils/auth')
const history = require('../../utils/history')

// 按 day 分组;记录已按时间倒序,故按出现顺序分组即天然是「今天→昨天→更早」
function group(list) {
  const groups = []
  const idx = Object.create(null) // 无原型对象:防 day 恰为 'toString' 等原型键时索引误判
  list.forEach((r) => {
    if (idx[r.day] === undefined) { idx[r.day] = groups.length; groups.push({ day: r.day, items: [] }) }
    groups[idx[r.day]].items.push(r)
  })
  return groups
}

const ROUTES = {
  job: '/pages/job-detail/job-detail',
  fair: '/pages/fair-detail/fair-detail',
  company: '/pages/company-detail/company-detail',
  policy: '/pages/policy-detail/policy-detail',
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
    // loading / ready / error —— 失败与空态严格分开
    state: 'loading',
    loadError: '',
    source: 'local',
    loggedIn: false,
    managing: false,
    hasLocal: false,
    note: '',
  },

  _all: [],

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const loggedIn = auth.isLoggedIn()
    this.setData({ loggedIn, hasLocal: history.hasLocal(), state: 'loading', loadError: '' })
    if (!loggedIn) {
      this._apply(history.listLocal('all'), 'local')
      return
    }
    history.listServer('all')
      .then((rows) => this._apply(rows, 'server'))
      .catch((err) => {
        const msg = err && err.statusCode === 401
          ? '登录已失效，请重新登录后查看账号记录'
          : (err && err.message) || '记录加载失败，请稍后重试'
        this.setData({ state: 'error', loadError: msg, groups: [] })
        this._all = []
      })
  },

  _apply(rows, source) {
    this._all = rows || []
    this.setData({
      source,
      state: 'ready',
      note: this._noteOf(source),
    })
    this._filter(this.data.activeFilter)
  },

  _noteOf(source) {
    if (source === 'server') return '已同步到账号，与一体机共用同一份记录；服务端记录默认保留 30 天。'
    if (this.data.loggedIn) return '服务端记录暂时读取不到，当前显示本机缓存，可能不完整。'
    return '当前为本机记录，登录后新的浏览与跳转会记录到账号并可在一体机上回看。'
  },

  _filter(key) {
    const list = key === 'all' ? this._all : this._all.filter((r) => r.type === key)
    this.setData({ groups: group(list) })
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  setFilter(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ activeFilter: key })
    this._filter(key)
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

  // 服务端读不到时的降级视图。明确标注是本机缓存，不冒充账号记录。
  showLocalCache() {
    this.setData({ state: 'ready' })
    this._apply(history.listLocal('all'), 'local')
  },

  // 后端没有批量清空端点，这里只逐条删除；服务端记录调对应删除端点并留审计。
  removeItem(e) {
    const rid = e.currentTarget.dataset.rid
    const record = this._all.find((r) => r && r.rid === rid)
    if (!record) return
    history.removeRecord(record)
      .then(() => {
        wx.showToast({ title: '已删除', icon: 'none', duration: 1200 })
        this.refresh()
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '删除失败，请稍后重试', icon: 'none', duration: 1800 })
      })
  },

  // 只清本机缓存。账号记录没有批量清空接口，不做假的「一键清空」。
  clearLocal() {
    wx.showModal({
      title: '清空本机记录',
      content: '将清空这台手机上缓存的浏览与跳转记录。账号里的记录需要逐条删除，来源平台的任何数据都不受影响。',
      confirmText: '清空',
      success: (res) => {
        if (!res.confirm) return
        history.clearLocal()
        wx.showToast({ title: '已清空本机记录', icon: 'none', duration: 1400 })
        this.refresh()
      },
    })
  },

  openItem(e) {
    if (this.data.managing) return
    const { id, type } = e.currentTarget.dataset
    const url = ROUTES[type]
    if (url && id != null && id !== '') { wx.navigateTo({ url: `${url}?id=${id}` }); return }
    wx.showToast({ title: '无法打开该记录', icon: 'none', duration: 1500 })
  },
})
