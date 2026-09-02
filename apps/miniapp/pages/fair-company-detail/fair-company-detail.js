// pages/fair-company-detail/fair-company-detail.js · 招聘会现场助手 · 参会企业详情
const app = getApp()
const api = require('../../utils/api')

// 规模标签口径收在 utils/normalize.js。这里原本自己写了一份,注释还写着
// 「与列表页同一份口径」,值却是带「企业」的长形 —— 正是这种复制导致的漂移。
const N = require('../../utils/normalize')
const history = require('../../utils/history')
const POSITION_TYPE_LABEL = {
  full_time: '全职',
  part_time: '兼职',
  intern: '实习',
}

function text(v) {
  return v == null ? '' : String(v).trim()
}

function scaleLabel(scale) {
  return N.scaleLabel(scale)
}

function normalizePosition(p) {
  const r = p || {}
  const type = text(r.positionType)
  const head = Number(r.headcount)
  return {
    id: text(r.id),
    title: text(r.title) || '未命名岗位',
    // headcount 没填时后端给 null/0。按 CLAUDE.md「null 统计字段显示暂无数据，不显示 0」，
    // 这里如实写「人数未标注」，不能渲染成「招 0 人」。
    headText: Number.isFinite(head) && head > 0 ? `招 ${head} 人` : '人数未标注',
    salary: text(r.salary),
    requirements: text(r.requirements),
    // 学历 / 经验 / 城市 / 类型是四个独立可空字段，拼一行展示，全空就整行不渲染。
    metaText: [
      text(r.department),
      text(r.location),
      text(r.education),
      text(r.experience),
      type ? (POSITION_TYPE_LABEL[type] || type) : '',
    ].filter(Boolean).join(' · '),
  }
}

/**
 * 后端这个端点回的是 FairCompany（name / jobFairId / zoneId），不是 packages/shared
 * 的 FairCompanyDTO（companyName / fairId / zoneName / applyNote / aiMatchScore）。
 * 两种命名都兜一遍；DTO 独有的字段拿不到就不渲染，绝不本地编一个顶上去。
 */
function normalize(row, zoneName) {
  const r = row || {}
  const name = text(r.companyName) || text(r.name)
  if (!name) return { id: '' }

  const industry = text(r.industry)
  const scale = scaleLabel(r.scale)
  const positions = (Array.isArray(r.positions) ? r.positions : []).map(normalizePosition)
  const declared = Number(r.jobsCount)
  const hasDeclared = Number.isFinite(declared) && declared > 0

  // 企业档案是一组可空字段，逐条判空拼成 rows，比在 wxml 里写五个 wx:if 好维护。
  const infoRows = [
    { k: '所属行业', v: industry },
    { k: '企业规模', v: scale },
    { k: '成立年份', v: text(r.founded) },
    { k: '总部所在', v: text(r.headquarters) },
    { k: '注册资本', v: text(r.registeredCapital) },
  ].filter((row0) => !!row0.v)

  // 只认真正的数字。不能走 Number()：后端把字段留成空串时 Number('') === 0，
  // 页面就会把「没录」渲染成一个白纸黑字的 0。
  const rawScore = r.aiMatchScore
  const score = typeof rawScore === 'number' && Number.isFinite(rawScore) && rawScore >= 0
    ? rawScore
    : null

  const honorTags = []
  ;(Array.isArray(r.honorTags) ? r.honorTags : []).forEach((t) => {
    const tag = text(t)
    if (tag && honorTags.indexOf(tag) < 0) honorTags.push(tag)
  })

  return {
    id: text(r.id),
    name,
    initial: name.slice(0, 1),
    industry,
    scale,
    subText: [industry, scale].filter(Boolean).join(' · '),
    description: text(r.description),
    boothNumber: text(r.boothNumber),
    zoneName: text(zoneName) || text(r.zoneName),
    honorTags,
    infoRows,
    positions,
    posCount: positions.length,
    // 明细为空但库里声明了岗位数：如实说明「明细待录入」，不假装这家企业没有岗位。
    posNote: positions.length === 0 && hasDeclared
      ? `该企业申报 ${declared} 个岗位，主办方尚未录入岗位明细。`
      : '',
    sourceUrl: text(r.sourceUrl),
    // applyNote 是合规提示原文，后端给了就原样展示，一个字都不改写。
    applyNote: text(r.applyNote),
    // 机构录入的展示指标，0–100。后端当前不返回，返回了才渲染。
    matchScore: score,
  }
}

Page({
  _seq: 0,
  _gone: false,

  data: {
    statusBarHeight: 20,
    fairId: '',
    companyId: '',
    loading: true,
    loadError: '',
    // company.id 为空表示「查得到接口但查不到这家企业」，走空态而不是错误态。
    company: { id: '' },
    // '' | 'profile' | 'positions'：同一时刻只允许一个打印文件在生成。
    printing: '',
  },

  onLoad(opts) {
    const { statusBarHeight } = app.globalData
    const o = opts || {}
    this.setData({
      statusBarHeight: statusBarHeight || 20,
      fairId: o.fairId || '',
      companyId: o.companyId || '',
    })
    this.load()
  },

  onUnload() {
    this._seq += 1
    this._gone = true
  },

  load() {
    const fairId = this.data.fairId
    const companyId = this.data.companyId
    if (!fairId || !companyId) {
      this.setData({ loading: false, loadError: '缺少招聘会或企业参数' })
      return Promise.resolve()
    }
    const seq = ++this._seq
    this.setData({ loading: true, loadError: '' })
    return Promise.all([
      api.getFairCompanyDetail(fairId, companyId),
      // 展区名不在企业记录里（后端 FairCompany 只有 zoneId），要靠 /zones 补。
      // 取不到只是少一行展区信息，不该让整页进错误态。
      api.getFairZones(fairId).catch(() => []),
    ]).then((res) => {
      if (seq !== this._seq) return
      const row = res[0]
      const zoneRows = Array.isArray(res[1]) ? res[1] : []
      const zoneId = text(row && row.zoneId)
      let zoneName = ''
      zoneRows.forEach((z) => {
        if (z && text(z.id) === zoneId) zoneName = text(z.zoneName || z.name)
      })
      // 招聘会未发布或企业不存在时后端返回 data:null（不是 404），
      // 解包后就是 null——落空态，不能当成加载失败。
      this.setData({ company: normalize(row, zoneName), loading: false })
    }).catch((err) => {
      if (seq !== this._seq) return
      const msg = err && err.statusCode === 404
        ? '未找到该内容，可能已下线'
        : (err && err.message) || '加载失败'
      this.setData({ loading: false, loadError: msg })
    })
  },

  reload() {
    this.load()
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  tapPrintProfile() {
    this._runPrint('profile', '企业资料.pdf')
  },

  tapPrintPositions() {
    if (!this.data.company.posCount) {
      wx.showToast({ title: '该企业暂无岗位明细，无法生成岗位清单', icon: 'none', duration: 2000 })
      return
    }
    this._runPrint('positions', '岗位清单.pdf')
  },

  /**
   * 生成打印文件后交给既有打印流程（print-upload 负责参数、报价和下单）。
   * 拿到响应只代表**文件已生成**，不代表已打印，所以这里没有任何「已打印」文案；
   * 没拿到 fileId 就不跳——跳进打印页却没有文件，只会显示「未选择文件」。
   */
  _runPrint(variant, fallbackName) {
    if (this.data.printing) return
    this.setData({ printing: variant })
    wx.showLoading({ title: '正在生成打印文件…', mask: true })
    api.prepareFairCompanyPrint(this.data.fairId, this.data.companyId, variant)
      .then((res) => {
        wx.hideLoading()
        // 生成要 1~3 秒。用户等不及返回上一页时不能再 navigateTo——
        // 那会把人从他自己翻到的页面强行拖进打印下单流程。
        if (this._gone) return
        this.setData({ printing: '' })
        const fid = encodeURIComponent((res && res.fileId) || '')
        if (!fid) {
          this._printFailed('服务端未返回可打印文件，请稍后重试')
          return
        }
        const name = encodeURIComponent((res && res.filename) || fallbackName)
        const pages = (res && res.pageCount) || ''
        // 企业资料是服务端实时渲染的共享派生文件(endUserId 为 null)，print-upload
        // 用 fileId 去换 preview-url 会吃 403。响应里已经带了 printFileUrl，透传过去。
        const purl = encodeURIComponent((res && res.printFileUrl) || '')
        wx.navigateTo({ url: `/pages/print-upload/print-upload?name=${name}&fileId=${fid}&pages=${pages}&printFileUrl=${purl}` })
      })
      .catch((err) => {
        wx.hideLoading()
        // 失败路径同样要判:退出后弹「需要登录」或错误 modal,
        // 一样是在用户已经离开的页面上打断他。
        if (this._gone) return
        this.setData({ printing: '' })
        if (err && err.statusCode === 401) {
          wx.showModal({
            title: '需要登录',
            content: '生成打印文件会存进你本人的「我的文档」，需要先登录。',
            confirmText: '去登录',
            success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/launch/launch' }) },
          })
          return
        }
        this._printFailed((err && err.message) || '请稍后重试')
      })
  },

  _printFailed(content) {
    wx.showModal({ title: '生成打印文件失败', content, showCancel: false, confirmText: '知道了' })
  },

  /**
   * 小程序打不开任意外部网页（业务域名白名单只覆盖自家接口），所以这里只能复制链接，
   * 按钮文案也就必须是「复制来源链接」而不是「去来源平台投递」——写后者是承诺一个
   * 这一端做不到的动作。
   * 不调 utils/history 记录跳转：history 的类型表只有 job/fair/company/policy，
   * 把参会企业按 company 上报会以 company_profile 的身份带着 FairCompany 的 id 落库，
   * 记出来的是一条错记录。缺 fair_company 类型，等 utils 补齐再接。
   */
  tapCopySource() {
    const url = this.data.company.sourceUrl
    if (!url) {
      wx.showToast({ title: '该企业未提供来源平台链接', icon: 'none', duration: 2000 })
      return
    }
    // 上报「打开过来源投递入口」。服务端自己按 companyId 补 targetTitle 和
    // externalId(父级 JobFair.id),这里只送三个字段。
    // 只在真正复制成功后记——复制失败却记了一笔,就是记了一件没发生的事。
    // 合规:只记录「打开过入口」,不记录也无法知道用户是否真的投了。
    wx.setClipboardData({
      data: url,
      success: () => history.recordJump('fair_company', {
        id: this.data.companyId,
        title: this.data.company.name,
      }),
    })
  },

  onShareAppMessage() {
    const fairId = encodeURIComponent(this.data.fairId)
    const companyId = encodeURIComponent(this.data.companyId)
    return {
      title: this.data.company.name || '参会企业详情',
      path: `/pages/fair-company-detail/fair-company-detail?fairId=${fairId}&companyId=${companyId}`,
    }
  },
})
