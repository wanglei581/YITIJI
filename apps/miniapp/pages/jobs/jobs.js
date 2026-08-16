// pages/jobs/jobs.js
const app = getApp()
const api = require('../../utils/api')

const PAGE_SIZE = 20

Page({
  _searchTimer: null,
  _seq: 0,

  data: {
    statusBarHeight: 20,
    filters: ['全部', '岗位', '招聘会', '找企业', '政策'],
    activeFilter: 0,
    jobs: [],
    query: '',
    loading: true,
    loadingMore: false,
    hasMore: false,
    page: 1,
    loadError: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this.loadJobs()
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = null
    this._seq += 1
  },

  /**
   * 岗位检索与翻页都交给服务端：/jobs 支持 keyword / page / pageSize。
   * 之前只拉第一页再本地过滤，等于告诉用户「没有匹配的岗位」——实际只是没搜到第一页而已。
   * append=true 为触底追加，其余情况都从第 1 页重新拉取。
   */
  loadJobs({ append = false } = {}) {
    const page = append ? this.data.page + 1 : 1
    const keyword = (this.data.query || '').trim()
    // 每次请求都作废前一笔：快速改关键词时旧结果不得回写覆盖新结果。
    const seq = ++this._seq
    this.setData(append ? { loadingMore: true } : { loading: true, loadError: '' })
    return api.getJobs({ page, pageSize: PAGE_SIZE, ...(keyword ? { keyword } : {}) })
      .then((list) => {
        if (seq !== this._seq) return
        const items = Array.isArray(list) ? list : []
        const totalPages = Number(list && list.pagination && list.pagination.totalPages)
        this.setData({
          jobs: append ? this.data.jobs.concat(items) : items,
          page,
          // 后端给了 totalPages 就按它判断；没给就退化为「这一页是否装满」。
          hasMore: Number.isFinite(totalPages) && totalPages > 0 ? page < totalPages : items.length >= PAGE_SIZE,
          loading: false,
          loadingMore: false,
        })
      })
      .catch((err) => {
        if (seq !== this._seq) return
        this.setData({ loading: false, loadingMore: false, loadError: (err && err.message) || '加载失败' })
      })
  },

  onSearchInput(e) {
    const query = e.detail.value || ''
    this.setData({ query })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null
      this.loadJobs()
    }, 300)
  },

  reload() {
    this.loadJobs()
  },

  onPullDownRefresh() {
    const stop = () => wx.stopPullDownRefresh()
    this.loadJobs().then(stop, stop)
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) {
      this.loadJobs({ append: true })
    }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
  },

  tapFilter(e) {
    const idx = e.currentTarget.dataset.index
    // 校园招聘 / 招聘会 / 找企业 / 政策 为独立信息入口页，跳转；岗位在本页内筛选
    const routes = {
      2: '/pages/fairs/fairs',
      3: '/pages/companies/companies',
      4: '/pages/policies/policies',
    }
    if (routes[idx]) {
      wx.navigateTo({ url: routes[idx] })
      return
    }
    this.setData({ activeFilter: idx })
  },

  tapJob(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${id}` })
  },

  // Web 域名未统一配置前只复制后端返回的真实来源链接，不伪装成已跳转。
  tapSource(e) {
    const url = e.currentTarget.dataset.url || ''
    if (!url) {
      wx.showToast({ title: '来源链接暂不可用', icon: 'none' })
      return
    }
    wx.setClipboardData({ data: url })
  },

  onShareAppMessage() {
    return { title: '智引答 · 发现求职机会', path: '/pages/jobs/jobs' }
  },
})
