const app = getApp()
const api = require('../../utils/api')

// 求职材料模板。**全程无 LLM**：服务端按模板 + 你填的字段直接渲染 PDF
// (job-materials.service.ts 无任何模型调用)。所以这一页不挂 AI 标识、
// 不写"AI 生成"——写了就是伪造。

// resume_template 类型服务端会拒(JOB_MATERIAL_TEMPLATE_UNSUPPORTED,
// 提示走简历诊断/优化链路)。与其让用户填完才被打回,不如在列表上就说清楚。
const RESUME_TEMPLATE_TYPE = 'resume_template'

const TYPE_LABEL = {
  cover_letter: '求职信',
  thank_you: '感谢信',
  portfolio_cover: '作品集封面',
  materials_checklist: '材料清单',
  resume_template: '简历模板',
}

Page({
  data: {
    statusBarHeight: 20,
    // list 选模板 | form 填写中 | generating 生成中 | error 出错
    phase: 'list',
    loading: true,
    loadError: '',
    templates: [],
    picked: null,      // 当前模板视图
    values: {},        // key -> 已填内容
    canSubmit: false,
    generating: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20 })
    this.load()
  },

  onUnload() { this._gone = true },

  load() {
    this.setData({ loading: true, loadError: '' })
    api.getJobMaterialTemplates()
      .then((list) => {
        if (this._gone) return
        const rows = (Array.isArray(list) ? list : []).map((t) => ({
          id: t.id,
          title: t.title || '未命名模板',
          description: t.description || '',
          typeLabel: TYPE_LABEL[t.type] || '材料',
          tags: Array.isArray(t.tags) ? t.tags : [],
          recommendedFor: t.recommendedFor || '',
          fields: Array.isArray(t.fields) ? t.fields : [],
          // 服务端会拒的类型在列表上就标出来并说明去哪儿办，不做成填完才报错的死路
          unsupported: t.type === RESUME_TEMPLATE_TYPE,
          unsupportedWhy: t.type === RESUME_TEMPLATE_TYPE ? '简历请走简历诊断或优化，那条链会带上你的真实简历内容' : '',
        }))
        this.setData({ templates: rows, loading: false })
      })
      .catch((err) => {
        if (this._gone) return
        this.setData({ loading: false, loadError: (err && err.message) || '模板加载失败，请稍后重试' })
      })
  },

  reload() { this.load() },

  tapTemplate(e) {
    const { id } = e.currentTarget.dataset
    const t = this.data.templates.find((x) => x.id === id)
    if (!t) return
    if (t.unsupported) {
      wx.showModal({
        title: t.title,
        content: t.unsupportedWhy + '。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    this.setData({ picked: t, values: {}, canSubmit: false, phase: 'form' })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  onInput(e) {
    const { key } = e.currentTarget.dataset
    if (!key) return
    const values = Object.assign({}, this.data.values, { [key]: e.detail.value })
    this.setData({ values, canSubmit: this._checkRequired(values) })
  },

  // 必填由模板自己声明（field.required），前端不自作主张增删
  _checkRequired(values) {
    const fields = (this.data.picked && this.data.picked.fields) || []
    return fields.every((f) => !f.required || String(values[f.key] || '').trim().length > 0)
  },

  backToList() {
    this.setData({ phase: 'list', picked: null, values: {}, canSubmit: false })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  submit() {
    if (this.data.generating || !this.data.canSubmit || !this.data.picked) return
    this.setData({ generating: true, phase: 'generating' })
    wx.showLoading({ title: '正在生成…', mask: true })
    api.generateJobMaterial(this.data.picked.id, this.data.values)
      .then((res) => {
        wx.hideLoading()
        if (this._gone) return
        this.setData({ generating: false, phase: 'form' })
        const fid = encodeURIComponent((res && res.fileId) || '')
        if (!fid) {
          this._failed('服务端未返回可打印文件，请稍后重试。')
          return
        }
        // 产出文件带 endUserId（归属本人），走普通 fileId 路径即可，
        // 不传 printFileUrl——那条旁路只给招聘会的共享派生文件用。
        const name = encodeURIComponent((res && res.filename) || `${this.data.picked.title}.pdf`)
        const pages = (res && res.pageCount) || ''
        wx.navigateTo({ url: `/pages/print-upload/print-upload?name=${name}&fileId=${fid}&pages=${pages}` })
      })
      .catch((err) => {
        wx.hideLoading()
        if (this._gone) return
        this.setData({ generating: false, phase: 'form' })
        if (err && err.statusCode === 401) {
          wx.showModal({
            title: '需要登录',
            content: '生成的材料会存进你本人的「我的文档」，需要先登录。',
            confirmText: '去登录',
            success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/launch/launch' }) },
          })
          return
        }
        this._failed((err && err.message) || '请稍后重试')
      })
  },

  _failed(msg) {
    wx.showModal({ title: '未能生成材料', content: msg, showCancel: false, confirmText: '知道了' })
  },

  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
