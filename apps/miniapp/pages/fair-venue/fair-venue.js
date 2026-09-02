const app = getApp()
const api = require('../../utils/api')

// 设施 type 是后端枚举，中文名与图标只能由前端映射。
// 未知 type 不丢弃：Admin 后台可能先于小程序上线新点位类型，
// 丢弃等于让站在会场里的人少一个真实存在的点位。
const FACILITY_META = {
  entrance: { label: '入口', icon: 'i-navigation', tone: '' },
  serviceDesk: { label: '服务台', icon: 'i-info', tone: '' },
  // 打印点是本终端自己的设备，现场最需要被一眼找到，单独给强调底色。
  printPoint: { label: '打印点', icon: 'i-printer', tone: 'print' },
  consulting: { label: '咨询台', icon: 'i-message-circle', tone: '' },
}
const FACILITY_FALLBACK = { label: '场馆点位', icon: 'i-map-pin', tone: '' }

const BOOTH_STATUS = {
  occupied: { label: '已入驻', tone: 'occ' },
  reserved: { label: '已预留', tone: 'res' },
  available: { label: '空位', tone: '' },
}

// 只放行 #RGB / #RRGGBB。zone.color 是主办方后台自由填写的字符串，
// 直接拼进行内 style 等于把外部输入注入样式；不合法就退回页面默认令牌色。
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// 展区 category 的中文名。后端 FairZone 没有 industry 列，category 是唯一的分类线索。
const ZONE_CATEGORY = {
  innovation: '创新展区',
  service: '现场服务',
  campus_corp_topic: '校企主题',
}

/**
 * 统计字段 null/undefined 时必须说「暂无数据」。
 * 兜成 0 会被现场用户读成「真的一家都没有」，那是伪造结论。
 */
function statText(value, suffix, fallback) {
  return typeof value === 'number' && isFinite(value) ? value + suffix : fallback
}

/**
 * 展区统计。boothCount / checkedInCount 目前后端根本不返回（见 zoneName 处的说明），
 * 两个都缺时并排两句「暂无数据」纯属噪音，合成一句；只缺一个时仍分别如实标注。
 */
function zoneMetrics(zone) {
  const hasBooth = typeof zone.boothCount === 'number' && isFinite(zone.boothCount)
  const hasChecked = typeof zone.checkedInCount === 'number' && isFinite(zone.checkedInCount)
  if (!hasBooth && !hasChecked) return ['展位与签到统计暂无数据']
  return [
    statText(zone.boothCount, ' 个展位', '展位数暂无数据'),
    statText(zone.checkedInCount, ' 家已签到', '签到数暂无数据'),
  ]
}

function errText(err) {
  if (err && err.statusCode === 404) return '未找到该招聘会，可能已下线'
  return (err && err.message) || '加载失败'
}

// 三个数据源相互独立：任何一个挂掉都不该把另外两个的内容一起吞掉，
// 所以先把 reject 收成结果对象，再由 _apply 分区判定。
function settle(promise) {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  )
}

Page({
  // 非响应式实例状态：请求序号用于作废过期响应，索引只在搜索时读，都不进 data
  _seq: 0,
  _index: [],

  data: {
    statusBarHeight: 20,
    fairId: '',
    // phase: loading 首次加载中 / error 三个数据源全部失败（多半断网）/ ready 至少一个数据源有结果
    phase: 'loading',
    loadError: '',

    venueName: '',
    // 主办方没配导览时 venue-guide 正常返回 null，这不是错误，页面要降级展示展区/展位
    guideMissing: false,
    guideError: '',
    zonesError: '',
    boothsError: '',

    // 主办方上传的真实平面图。没上传时为空串，整块不渲染——
    // 占位图只是噪音，下面的厅/区/展位列表本来就是它的替代表达。
    mapImageUrl: '',
    mapImageFailed: false,

    facilities: [],
    halls: [],
    zones: [],
    boothGroups: [],
    boothTotal: 0,

    expandedHallId: '',
    canSearch: false,
    keyword: '',
    matches: [],
    matchTotal: 0,
  },

  onLoad(opts) {
    const { statusBarHeight } = app.globalData
    this.setData({
      statusBarHeight: statusBarHeight || 20,
      fairId: (opts && opts.fairId) || '',
    })
    this.load()
  },

  load() {
    const id = this.data.fairId
    if (!id) {
      this.setData({ phase: 'error', loadError: '缺少招聘会参数，请从招聘会详情页进入' })
      return
    }
    const seq = ++this._seq
    this.setData({ phase: 'loading', loadError: '' })
    Promise.all([
      settle(api.getFairVenueGuide(id)),
      settle(api.getFairZones(id)),
      settle(api.getFairMap(id)),
    ]).then((res) => {
      if (seq !== this._seq) return
      this._apply(res[0], res[1], res[2])
    }).catch((err) => {
      // settle 之后 Promise.all 不会 reject，走到这里只可能是 _apply 自己抛了
      // （字段形状与预期不符）。不兜住的话页面会永远停在「加载中…」。
      if (seq !== this._seq) return
      this.setData({ phase: 'error', loadError: errText(err) })
    })
  },

  reload() {
    this.load()
  },

  _apply(guideRes, zoneRes, mapRes) {
    // 只有三个都失败才整页报错。挂一个就整页空白，等于让另外两份真实数据白拿。
    if (!guideRes.ok && !zoneRes.ok && !mapRes.ok) {
      this.setData({ phase: 'error', loadError: errText(guideRes.error) })
      return
    }

    const guide = guideRes.ok ? guideRes.value : null
    const mapData = (mapRes.ok && mapRes.value) || {}
    const listedZones = (zoneRes.ok && zoneRes.value) || []
    // /zones 与 /map 的 zones 是同一份展区数据的两个出口。前者为空或抖动时用后者兜，
    // 免得展区区块因为单个接口失败就整块消失。
    const zoneSource = listedZones.length ? listedZones : (mapData.zones || [])
    const booths = mapData.booths || []

    const halls = (guide && guide.halls ? guide.halls : []).map((hall) => ({
      hallId: hall.hallId,
      hallCode: hall.hallCode || '',
      hallName: hall.hallName || '未命名展厅',
      industryCategory: hall.industryCategory || '',
      description: hall.description || '',
      boothRange: hall.boothRange || '',
      companyText: statText(hall.companyCount, ' 家企业', '企业数暂无数据'),
      companies: (hall.companies || []).map((co) => ({
        companyId: co.companyId || '',
        companyName: co.companyName || '未标注企业名',
        boothNo: co.boothNo || '',
        industry: co.industry || '',
        jobText: statText(co.jobCount, ' 个在册岗位', '岗位数暂无数据'),
        titlesText: (co.jobTitles || []).slice(0, 3).join(' · '),
      })),
    }))

    const facilities = (guide && guide.facilities ? guide.facilities : []).map((item) => {
      const meta = FACILITY_META[item.type] || FACILITY_FALLBACK
      return {
        id: item.id,
        name: item.name || meta.label,
        typeLabel: meta.label,
        icon: meta.icon,
        tone: meta.tone,
        locationLabel: item.locationLabel || '',
        relatedHallCode: item.relatedHallCode || '',
      }
    })

    const zones = zoneSource.map((zone) => {
      const raw = typeof zone.color === 'string' ? zone.color.trim() : ''
      const sub = []
      if (zone.industry) sub.push(zone.industry)
      if (ZONE_CATEGORY[zone.category]) sub.push(ZONE_CATEGORY[zone.category])
      if (zone.city) sub.push(zone.city)
      return {
        id: zone.id,
        // 后端 /zones 与 /map 吐的是 Prisma FairZone 原样（字段名 name），
        // 不是 packages/shared 的 FairZoneDTO（zoneName）。utils/api.js 的
        // N.fairZoneLike 已经补上这层映射，所以 zone.name 这条分支正常情况下走不到；
        // 留着是因为漏掉它的代价（每个展区都显示「未命名展区」）远大于一个 || 的成本。
        zoneName: zone.zoneName || zone.name || '未命名展区',
        subText: sub.join(' · '),
        description: zone.description || '',
        metrics: zoneMetrics(zone),
        colorStyle: HEX_COLOR.test(raw) ? 'background:' + raw : '',
      }
    })

    this.setData({
      phase: 'ready',
      venueName: (guide && guide.venueName) || '',
      guideMissing: guideRes.ok && !guide,
      guideError: guideRes.ok ? '' : errText(guideRes.error),
      zonesError: zoneRes.ok ? '' : errText(zoneRes.error),
      boothsError: mapRes.ok ? '' : errText(mapRes.error),
      mapImageUrl: (mapRes.ok && mapData.mapImageUrl) || '',
      mapImageFailed: false,
      halls,
      facilities,
      zones,
      boothGroups: this._groupBooths(booths),
      boothTotal: booths.length,
      // 只有一个厅时折叠没有意义，直接展开
      expandedHallId: halls.length === 1 ? halls[0].hallId : '',
      canSearch: this._buildIndex(halls, booths) > 0,
      keyword: '',
      matches: [],
      matchTotal: 0,
    })
  },

  // 没有真实平面图可用，空间关系只能靠「展区 → 展位」的分组层级表达。
  _groupBooths(booths) {
    const groups = []
    booths.forEach((booth) => {
      const zoneName = booth.zoneName || '未标注展区'
      let group = groups.find((g) => g.zoneName === zoneName)
      if (!group) {
        group = { zoneName, list: [] }
        groups.push(group)
      }
      const status = BOOTH_STATUS[booth.status] || { label: '', tone: '' }
      group.list.push({
        id: booth.id,
        boothNumber: booth.boothNumber || '—',
        companyName: booth.companyName || '',
        companyId: booth.companyId || '',
        statusLabel: status.label,
        statusTone: status.tone,
      })
    })
    return groups.map((g) => ({
      zoneName: g.zoneName,
      list: g.list,
      countText: g.list.length + ' 个展位',
    }))
  },

  /**
   * 现场最高频的动作是「我要找的这家在哪个展位」，靠一屏屏翻列表不现实。
   * 索引同时吃展厅企业与展位企业：前者带岗位数，后者覆盖没进展厅配置的企业。
   * 同一家同时出现在两处时保留先入的展厅条目（信息更全）。
   */
  _buildIndex(halls, booths) {
    const seen = {}
    const index = []
    halls.forEach((hall) => {
      const where = hall.hallCode ? hall.hallCode + ' · ' + hall.hallName : hall.hallName
      hall.companies.forEach((co) => {
        const key = co.companyId || co.companyName + '#' + co.boothNo
        if (seen[key]) return
        seen[key] = true
        index.push({
          key,
          companyId: co.companyId,
          name: co.companyName,
          boothNo: co.boothNo,
          where,
          extra: co.jobText,
        })
      })
    })
    booths.forEach((booth) => {
      if (!booth.companyName) return
      const key = booth.companyId || booth.companyName + '#' + (booth.boothNumber || '')
      if (seen[key]) return
      seen[key] = true
      index.push({
        key,
        companyId: booth.companyId || '',
        name: booth.companyName,
        boothNo: booth.boothNumber || '',
        where: booth.zoneName || '',
        extra: '',
      })
    })
    this._index = index
    return index.length
  },

  onSearch(e) {
    this._search(((e.detail && e.detail.value) || '').trim())
  },

  clearSearch() {
    this._search('')
  },

  _search(keyword) {
    if (!keyword) {
      this.setData({ keyword: '', matches: [], matchTotal: 0 })
      return
    }
    const needle = keyword.toLowerCase()
    const hits = this._index.filter((item) => (
      item.name.toLowerCase().indexOf(needle) >= 0 ||
      (!!item.boothNo && item.boothNo.toLowerCase().indexOf(needle) >= 0)
    ))
    // 现场是站着单手看，长结果翻不动；截断并如实说明一共命中多少条。
    this.setData({ keyword, matches: hits.slice(0, 20), matchTotal: hits.length })
  },

  // 手机上一张整场平面图缩到 375pt 宽，展位号必然糊掉，放大看是这张图唯一的用法。
  previewMap() {
    const url = this.data.mapImageUrl
    if (!url) return
    wx.previewImage({ current: url, urls: [url] })
  },

  // 图挂了只说明这一张取不到（签名过期 / 存储抖动），
  // 厅、区、展位三块与它无关，照常可用；这里只换成一行可重试的提示，不留空白。
  onMapError() {
    this.setData({ mapImageFailed: true })
  },

  // 置回 false 会让 <image> 重新挂载，从而真的重发一次请求
  retryMap() {
    this.setData({ mapImageFailed: false })
  },

  toggleHall(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ expandedHallId: this.data.expandedHallId === id ? '' : id })
  },

  tapCompany(e) {
    const cid = e.currentTarget.dataset.cid
    if (!cid) {
      wx.showToast({ title: '该展位暂未关联企业档案', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/fair-company-detail/fair-company-detail?fairId=${encodeURIComponent(this.data.fairId)}&companyId=${encodeURIComponent(cid)}`,
    })
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },
})
