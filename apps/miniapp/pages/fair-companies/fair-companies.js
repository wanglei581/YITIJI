// pages/fair-companies/fair-companies.js · 招聘会现场助手 · 参会企业列表
const app = getApp()
const api = require('../../utils/api')

// 后端 pageSize 上限 100（jobs.controller.ts:safeInt(sizeStr, 20, 1, 100)），一次尽量多拿。
const PAGE_SIZE = 100
// 翻页上限。真实招聘会规模远小于 500 家；设这个数只是不让脏数据把页面拖死。
const MAX_PAGES = 5
// 关键词输入到重算列表的等待。纯本地过滤不发请求，200ms 只为避免逐字符 setData 抖动。
const SEARCH_DEBOUNCE = 200

// 规模标签口径收在 utils/normalize.js:列表页和详情页曾各写一份且值不一样,
// 同一家企业在相邻两页显示「中型」和「中型企业」。
const N = require('../../utils/normalize')

function text(v) {
  return v == null ? '' : String(v).trim()
}

function scaleLabel(scale) {
  return N.scaleLabel(scale)
}

/**
 * 后端这个端点回的是 FairCompany（name / jobFairId / zoneId），不是 packages/shared
 * 的 FairCompanyDTO（companyName / fairId / zoneName）。两种命名都兜一遍，
 * 将来后端换成 DTO 形态时这一页不用跟着改。
 * zoneName 企业记录里根本没有，只能靠 /zones 的 id→名字映射补出来。
 */
function normalize(row, zoneNameById) {
  const r = row || {}
  const name = text(r.companyName) || text(r.name) || '未命名企业'
  const industry = text(r.industry)
  const scale = scaleLabel(r.scale)
  const booth = text(r.boothNumber)
  const zoneName = text(zoneNameById[text(r.zoneId)]) || text(r.zoneName)

  // 岗位数优先用真实回传的 positions 明细；明细为空时才退回库里的声明值 jobsCount，
  // 两者都没有就如实说「暂无岗位」，不填 0 也不猜。
  const posCount = Array.isArray(r.positions) ? r.positions.length : 0
  const declared = Number(r.jobsCount)
  const shown = posCount > 0 ? posCount : (Number.isFinite(declared) && declared > 0 ? declared : 0)

  // 去重：honorTags 是后端按逗号切出来的自由文本，同一个标签重复录入过。
  // 留着会让 wx:key="*this" 撞键，微信会整段停止复用节点。
  const honorTags = []
  ;(Array.isArray(r.honorTags) ? r.honorTags : []).forEach((t) => {
    const tag = text(t)
    if (tag && honorTags.indexOf(tag) < 0) honorTags.push(tag)
  })

  return {
    id: text(r.id),
    name,
    initial: name.slice(0, 1),
    zoneName,
    metaText: [industry, scale].filter(Boolean).join(' · '),
    placeText: [booth ? `展位 ${booth}` : '', zoneName].filter(Boolean).join(' · '),
    jobText: shown > 0 ? `${shown} 个岗位` : '暂无岗位',
    // 卡片最多挂 3 个荣誉标签，多了会把两行卡片撑成四行；完整列表在详情页。
    honorTags: honorTags.slice(0, 3),
    // filter(Boolean) 不能省：空字段会 join 出连续空格，用户打一个空格就命中全部。
    searchKey: [name, industry, scale, zoneName, booth].filter(Boolean).join(' ').toLowerCase(),
  }
}

Page({
  _seq: 0,
  _searchTimer: null,

  data: {
    statusBarHeight: 20,
    fairId: '',
    loading: true,
    loadError: '',
    // all = 已载入的全部企业；list = 当前筛选结果。两份都要留：清空关键词时要能
    // 从 all 直接复原，而不是再发一轮请求。
    all: [],
    list: [],
    zones: ['全部'],
    zoneIndex: 0,
    query: '',
    // 命中 MAX_PAGES 上限：筛选范围只覆盖已载入部分，必须如实告诉用户。
    truncated: false,
  },

  onLoad(opts) {
    const { statusBarHeight } = app.globalData
    this.setData({
      statusBarHeight: statusBarHeight || 20,
      fairId: (opts && opts.fairId) || '',
    })
    this.load()
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = null
    this._seq += 1
  },

  /**
   * 一次把分页取完，再在本地做搜索和展区筛选。
   * 不是偷懒：/job-fairs/:id/companies 只收 page / pageSize，既没有 keyword 也没有
   * zoneId（jobs.controller.ts:178）。只拉第一页就本地过滤，用户搜第 3 页上的企业时
   * 会看到「没有匹配的企业」——那是撒谎，不是空态。
   * _seq 作废的是这条多页链路：重试或快速重进时，旧链路的后续页不得再 append 进新结果。
   */
  load() {
    const fairId = this.data.fairId
    if (!fairId) {
      this.setData({ loading: false, loadError: '缺少招聘会参数' })
      return Promise.resolve()
    }
    const seq = ++this._seq
    this.setData({ loading: true, loadError: '' })
    return Promise.all([
      // 展区取不到只是少一个筛选维度，不该让整页进错误态，所以单独兜成空数组。
      api.getFairZones(fairId).catch(() => []),
      this._fetchPages(fairId, seq, 1, []),
    ]).then((res) => {
      if (seq !== this._seq) return
      const zoneRows = Array.isArray(res[0]) ? res[0] : []
      const zoneNameById = {}
      zoneRows.forEach((z) => {
        const id = text(z && z.id)
        const zn = text(z && (z.zoneName || z.name))
        if (id && zn) zoneNameById[id] = zn
      })
      const all = (res[1].rows || []).map((row) => normalize(row, zoneNameById))
      // all 和 list 必须在同一次 setData 里落地：分两次写会先渲染出
      // 「共 N 家 / 当前筛选出 0 家」这一帧，看起来像筛空了。
      this.setData({
        all,
        list: this._filtered(all, '', ''),
        zones: this._zoneOptions(zoneRows, all),
        zoneIndex: 0,
        query: '',
        truncated: !!res[1].truncated,
        loading: false,
      })
    }).catch((err) => {
      if (seq !== this._seq) return
      const msg = err && err.statusCode === 404
        ? '未找到该招聘会，可能已下线'
        : (err && err.message) || '加载失败'
      this.setData({ loading: false, loadError: msg })
    })
  },

  /**
   * 逐页取到取完为止。后端这个端点回的是 { data, total, page, pageSize }，
   * 而 request.js 的信封解包只保留 body.pagination，total 在那一步就被丢掉了，
   * 所以「还有没有下一页」只能看这一页是否装满。
   */
  _fetchPages(fairId, seq, page, acc) {
    return api.getFairCompanies(fairId, { page, pageSize: PAGE_SIZE }).then((rows) => {
      if (seq !== this._seq) return { rows: acc, truncated: false }
      const got = Array.isArray(rows) ? rows : []
      const next = acc.concat(got)
      if (got.length < PAGE_SIZE) return { rows: next, truncated: false }
      if (page >= MAX_PAGES) return { rows: next, truncated: true }
      return this._fetchPages(fairId, seq, page + 1, next)
    })
  },

  // 展区筛选项只列真的有企业落在里面的展区：列一个空展区等于给用户一个必然落空的筛选键。
  _zoneOptions(zoneRows, items) {
    const opts = []
    zoneRows.forEach((z) => {
      const zn = text(z && (z.zoneName || z.name))
      if (!zn || opts.indexOf(zn) >= 0) return
      if (items.some((c) => c.zoneName === zn)) opts.push(zn)
    })
    return ['全部'].concat(opts)
  },

  _filtered(all, zone, query) {
    const q = text(query).toLowerCase()
    return all.filter((c) => {
      if (zone && c.zoneName !== zone) return false
      if (q && c.searchKey.indexOf(q) < 0) return false
      return true
    })
  },

  _applyFilter() {
    const zone = this.data.zoneIndex > 0 ? this.data.zones[this.data.zoneIndex] : ''
    this.setData({ list: this._filtered(this.data.all, zone, this.data.query) })
  },

  onSearchInput(e) {
    this.setData({ query: (e.detail && e.detail.value) || '' })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null
      this._applyFilter()
    }, SEARCH_DEBOUNCE)
  },

  clearSearch() {
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = null
    this.setData({ query: '' })
    this._applyFilter()
  },

  tapZone(e) {
    const index = Number(e.currentTarget.dataset.index) || 0
    if (index === this.data.zoneIndex) return
    this.setData({ zoneIndex: index })
    this._applyFilter()
  },

  reload() {
    this.load()
  },

  onPullDownRefresh() {
    const stop = () => wx.stopPullDownRefresh()
    this.load().then(stop, stop)
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  tapItem(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const fairId = encodeURIComponent(this.data.fairId)
    const companyId = encodeURIComponent(id)
    wx.navigateTo({
      url: `/pages/fair-company-detail/fair-company-detail?fairId=${fairId}&companyId=${companyId}`,
    })
  },

  onShareAppMessage() {
    return {
      title: '招聘会参会企业',
      path: `/pages/fair-companies/fair-companies?fairId=${encodeURIComponent(this.data.fairId)}`,
    }
  },
})
