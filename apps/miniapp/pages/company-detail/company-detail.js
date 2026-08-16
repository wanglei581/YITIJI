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
      emoji: '', name: '', metaParts: [], tags: [], desc: [], sourceOrg: '',
      firstSeen: '', externalUrl: '', jobs: [],
    },
  },

  onLoad(opts) {
    const id = (opts && opts.id) || ''
    // 提前用本机收藏初始化 faved,避免加载期间图标先显未收藏再闪成已收藏
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20, pageId: id, faved: favorites.isFaved('company', id) })
    this.loadDetail(id)
  },

  onShow() {
    // navigateBack 只触发 onShow 不触发 onLoad;从收藏页取消后返回需重新同步 faved
    if (this.data.pageId && !this.data.loading && !this.data.loadError) {
      this.setData({ faved: favorites.isFaved('company', this.data.pageId) })
    }
  },

  loadDetail(id) {
    this.setData({ loading: true, loadError: '' })
    api.getCompanyDetail(id).then((company) => {
      this.setData({ company, loading: false, faved: favorites.isFaved('company', id) })
      history.recordView('company', { id, title: company.name, source: company.sourceOrg })
    }).catch((err) => {
      const msg = err && err.statusCode === 404 ? '未找到该内容，可能已下线' : (err && err.message) || '加载失败'
      this.setData({ loading: false, loadError: msg })
    })
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
    // 收藏项存展示字段,供「我的收藏」列表直接渲染(与 favorites 页卡片结构一致)
    const item = {
      id,
      initial: (c.name || '企').slice(0, 1),
      title: c.name || '企业',
      sub: (c.metaParts || []).filter((s) => s && s !== '·').join(' · '),
      salary: '',
      tag: '',
      tagTone: '',
      tone: 'plum',
    }
    const faved = favorites.toggle('company', item)
    this.setData({ faved })
    // 本地存储真实写入成功,故 toast 为如实结论(非伪造能力)
    wx.showToast({ title: faved ? '已收藏' : '已取消收藏', icon: 'none', duration: 1400 })
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
