// pages/store-select/store-select.js
//
// 材料包第二步：选一台真实的一体机。数据来自 GET /terminals/public（公开、无需登录）。
//
// 这页只做**预筛**，权威判定仍在服务端：下单时 PackageOrderService 会重新核
// 「最近 5 分钟有心跳 + 本地任务库可用 + 终端 enabled/active + 已登记 document_print
// 能力」，任何一条不满足就 PRINT_TERMINAL_OFFLINE / PRINT_TERMINAL_NOT_ACTIVE /
// CAPABILITY_* 拒单。所以离线终端这里不让选，不是因为前端说了算，而是为了不让用户
// 走进一条已知会被拒的路；页面同时写明服务端还会再校验一次。
//
// 本页刻意不提供的东西（都曾经在这里假装存在过）：
//   - 服务点电话：后端不下发。曾写死 '010-00000000'，用户真拨过去只会打空号。
//   - 地图坐标与距离：后端不下发坐标，也没有接地图距离服务。曾塞一个北大附近的固定
//     坐标当「用户位置」，任何人打开都被当成在北大。
//   - 营业时间与「打印/扫描/复印」设施标签：能力是逐台登记在管理员后台的，
//     统一贴三个标签等于替所有机器宣称它们都能扫描复印。
const api = require('../../utils/api')
const pkg = require('../../utils/package-order')

Page({
  data: {
    statusBarHeight: 44,
    selectedStore: null,
    stores: [],
    onlineCount: 0,
    state: 'loading',   // loading | ready | error
    errorTitle: '',
    errorText: '',
    hasPackageData: true,
    onsiteNotice: pkg.PACKAGE_ONSITE_NOTICE,
  },

  onLoad() {
    const app = getApp()
    // 深链直接打开本页时 storage 里没有材料包草稿，选完服务点也无从下单。
    // 不能假装流程正常：直接给一个说得清、能恢复的状态。
    const draft = wx.getStorageSync('temp_package_data')
    const files = draft && Array.isArray(draft.files) ? draft.files.filter((f) => f && f.fileId) : []
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 44,
      hasPackageData: files.length > 0,
    })
    this._loadStores()
  },

  _loadStores() {
    this.setData({ state: 'loading', errorTitle: '', errorText: '' })
    api.getPublicTerminals()
      .then((list) => {
        const rows = (Array.isArray(list) ? list : []).map((terminal) => ({
          id: terminal.id,
          name: terminal.displayName || '服务点',
          address: terminal.locationLabel || '位置待补充',
          isOnline: terminal.isOnline === true,
          // 心跳时间是服务端给的事实，直接展示比「营业中/已打烊」这种推断更诚实。
          lastSeenText: pkg.formatExpireAt(terminal.lastSeenAt),
        }))
        this.setData({
          stores: rows,
          onlineCount: rows.filter((r) => r.isOnline).length,
          state: 'ready',
        })
      })
      .catch((err) => {
        const shown = pkg.describePackageError(err, '服务点列表加载失败，请稍后重试。')
        this.setData({ state: 'error', errorTitle: shown.title, errorText: shown.text })
      })
  },

  retryStores() {
    this._loadStores()
  },

  selectStore(e) {
    const { id } = e.currentTarget.dataset
    const store = this.data.stores.find((s) => s.id === id)
    if (!store) return
    if (!store.isOnline) {
      wx.showModal({
        title: '该服务点当前离线',
        content: '这台一体机最近 5 分钟没有上报心跳，服务端会拒绝向它下单。请选一台在线的服务点，或稍后重试。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    this.setData({ selectedStore: id })
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  /**
   * 回到第一步。优先退回**原来那个** package-create 实例（它还拿着用户勾好的文件）；
   * redirectTo 会换一个全新实例、选择全部丢失，只在没有上一页时才用它兜底。
   */
  backToFiles() {
    wx.navigateBack({
      delta: 1,
      fail() { wx.redirectTo({ url: '/pages/package-create/package-create' }) },
    })
  },

  confirmAndContinue() {
    const { selectedStore, stores, hasPackageData } = this.data
    if (!hasPackageData) {
      this.backToFiles()
      return
    }
    if (!selectedStore) {
      wx.showToast({ title: '请先选择服务点', icon: 'none' })
      return
    }
    const store = stores.find((s) => s.id === selectedStore)
    if (!store) return
    // 先落存储再跳转：跳转 success 里再写会在慢设备上出现下一页读到空值的窗口。
    wx.setStorageSync('temp_selected_store', { id: store.id, name: store.name, address: store.address })
    wx.navigateTo({ url: '/pages/package-confirm/package-confirm' })
  },
})
