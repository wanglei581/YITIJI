// pages/company-detail/company-detail.js · P22 企业详情
const app = getApp()
const api = require('../../utils/api')
const favorites = require('../../utils/favorites')
const history = require('../../utils/history')

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    loadError: '',
    faved: false,
    pageId: '',
    company: {
      name: '', legalName: '', logoUrl: '', coverImageUrl: '', descriptionLines: [],
      icon: 'bank', meta: '', tags: [], metrics: {}, address: '', sourceOrg: '',
      externalId: '', syncTime: '', externalUrl: '', dataSourceNote: '',
    },
    jobs: [],
    jobsLoading: true,
    jobsError: '',
  },

  onLoad(opts) {
    const id = (opts && opts.id) || ''
    // 企业收藏后端没有对应模型（FavoriteTargetType 只有 job/job_fair/policy），
    // 因此始终只有本机一份；同步读取即为权威值。
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20, pageId: id, faved: favorites.isFaved('company', id) })
    this.loadDetail(id)
  },

  onShow() {
    // navigateBack 只触发 onShow 不触发 onLoad;从收藏页取消后返回需重新同步 faved
    if (this.data.pageId) {
      this.setData({ faved: favorites.isFaved('company', this.data.pageId) })
    }
  },

  loadDetail(id) {
    this.setData({ loading: true, loadError: '', jobsLoading: true, jobsError: '', jobs: [] })
    api.getCompanyDetail(id).then((company) => {
      this.setData({ company, loading: false, faved: favorites.isFaved('company', id) })
      history.recordView('company', { id, title: company.name, source: company.sourceOrg })
      this.loadJobs(id)
    }).catch((err) => {
      const msg = err && err.statusCode === 404 ? '未找到该内容，可能已下线' : (err && err.message) || '加载失败'
      this.setData({ loading: false, loadError: msg, jobsLoading: false })
    })
  },

  loadJobs(id) {
    this.setData({ jobsLoading: true, jobsError: '' })
    return api.getCompanyJobs(id, { pageSize: 20 })
      .then((jobs) => this.setData({ jobs: jobs || [], jobsLoading: false }))
      .catch((err) => this.setData({
        jobsLoading: false,
        jobsError: (err && err.message) || '岗位加载失败',
      }))
  },

  retryJobs() {
    this.loadJobs(this.data.pageId)
  },

  reload() {
    this.loadDetail(this.data.pageId)
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  tapFav() {
    const id = this.data.pageId
    const c = this.data.company || {}
    // 加载中/加载失败时禁止收藏，避免把空对象写入本地收藏。
    if (!id || this.data.loading || this.data.loadError) {
      wx.showToast({ title: '内容加载后可收藏', icon: 'none' })
      return
    }
    if (this._favBusy) return
    // 收藏项存展示字段,供「我的收藏」列表直接渲染(与 favorites 页卡片结构一致)
    const item = {
      id,
      initial: (c.name || '企').slice(0, 1),
      title: c.name || '企业',
      sub: c.meta || c.sourceOrg || '',
      salary: '',
      tag: '',
      tagTone: '',
      tone: 'plum',
    }
    this._favBusy = true
    favorites.toggle('company', item).then((res) => {
      this._favBusy = false
      this.setData({ faved: res.faved })
      // 本地存储真实写入成功,故 toast 为如实结论;hint 会说明企业收藏不跨设备
      const title = res.hint || (res.faved ? '已收藏' : '已取消收藏')
      wx.showToast({ title, icon: 'none', duration: res.hint ? 1800 : 1400 })
    }).catch((err) => {
      this._favBusy = false
      wx.showToast({ title: (err && err.message) || '收藏失败，请稍后重试', icon: 'none', duration: 1800 })
    })
  },

  tapJob(e) {
    wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${e.currentTarget.dataset.id}` })
  },

  // 合规：仅跳转来源平台，不做平台内投递 / 收简历
  tapExternal() {
    const c = this.data.company || {}
    if (this.data.loading || this.data.loadError || !c.externalUrl) {
      wx.showToast({ title: '来源链接暂不可用', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: c.externalUrl,
      success: () => history.recordJump('company', { id: this.data.pageId, title: c.name, source: c.sourceOrg }),
    })
  },

  onShareAppMessage() {
    return {
      title: (this.data.company && this.data.company.name) || '企业详情',
      path: '/pages/company-detail/company-detail?id=' + this.data.pageId,
    }
  },
})
