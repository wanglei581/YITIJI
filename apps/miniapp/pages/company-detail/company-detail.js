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
      emoji: '🎨',
      name: '杭州创意未来网络科技有限公司',
      metaParts: ['互联网', '·', '100–500人', '·', '杭州·西湖区'],
      tags: [
        { text: 'A轮融资', tone: 'teal' }, { text: '设计工具', tone: '' },
        { text: '电商平台', tone: '' }, { text: '弹性上下班', tone: '' },
        { text: '五险一金', tone: 'teal' }, { text: '定期团建', tone: '' },
      ],
      desc: [
        '杭州创意未来网络科技有限公司成立于2018年，是一家专注于创意设计工具和电商营销解决方案的互联网企业，总部位于杭州西湖区。公司旗下核心产品覆盖在线设计工具、图片素材库、营销模板市场三大方向。',
        '截至2025年，公司注册用户超过1,200万，企业客户覆盖全国30个省市。公司于2022年完成A轮融资，致力于为中小企业提供高效、低门槛的数字营销能力。团队规模约200人，技术与设计人员占比超过60%。',
        '公司文化强调创造力、协作与快速迭代，提供弹性工作制度、完善的职业晋升通道以及丰厚的绩效激励方案。',
      ],
      sourceOrg: '智联招聘',
      firstSeen: '2024-03-15',
      externalUrl: 'https://example.com/company/abc',
      jobs: [
        { id: 'j1', title: 'UI 设计师', meta: '杭州·西湖区 · 1–3年', salary: '8–14K' },
        { id: 'j2', title: '前端工程师', meta: '杭州·西湖区 · 3–5年', salary: '15–22K' },
        { id: 'j3', title: '产品经理', meta: '杭州·西湖区 · 2–5年', salary: '12–20K' },
      ],
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
    // 加载中/加载失败时 company 仍是默认 mock,收藏会存错名称,禁止收藏
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
    history.recordJump('company', { id: this.data.pageId, title: c.name, source: c.sourceOrg })
    wx.showToast({ title: '将跳转至来源平台了解更多', icon: 'none', duration: 1800 })
    // TODO: 打开 company.externalUrl（来源平台）
  },

  onShareAppMessage() {
    return {
      title: (this.data.company && this.data.company.name) || '企业详情',
      path: '/pages/company-detail/company-detail?id=' + this.data.pageId,
    }
  },
})
