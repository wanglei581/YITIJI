// pages/print-preview/print-preview.js  P09 打印预览
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    docName: '文档.pdf',
    fileId: '',
    color: 'bw',
    colorLabel: '黑白',
    duplex: 'single',
    duplexLabel: '单面',
    copies: 1,
    total: '0.00',
    // 原样透传上游的服务端报价金额（单位：分）；缺失时保持空串，绝不本地补 0。
    amountCents: '',
    isFreeOrder: false,
    page: 1,
    pages: 1,
    pageDots: [],
  },

  onLoad(opts) {
    opts = opts || {}
    const color = opts.color || 'bw'
    const duplex = opts.duplex || 'single'
    const pages = Math.max(1, Number(opts.pages) || 1)
    // 金额只认上游服务端报价：解析不出有效值就当作「未知」，按付费文案兜底，
    // 不能默认成免费——宁可少宣称免费，也不能伪造出一个不存在的 0 元结论。
    const rawAmount = opts.amountCents === undefined ? '' : opts.amountCents
    const amountCents = Number(rawAmount)
    const hasAmount = rawAmount !== '' && Number.isSafeInteger(amountCents) && amountCents >= 0
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      docName: opts.name ? decodeURIComponent(opts.name) : '文档.pdf',
      fileId: opts.fileId || '',
      color,
      colorLabel: color === 'color' ? '彩色' : '黑白',
      duplex,
      duplexLabel: duplex === 'double' ? '双面·自动' : '单面',
      copies: Math.max(1, Number(opts.copies) || 1),
      total: opts.total || '0.00',
      amountCents: hasAmount ? amountCents : '',
      isFreeOrder: hasAmount && amountCents === 0,
      pages,
      pageDots: Array.from({ length: pages }),
    })
  },

  prevPage() {
    if (this.data.page > 1) this.setData({ page: this.data.page - 1 })
  },
  nextPage() {
    if (this.data.page < this.data.pages) this.setData({ page: this.data.page + 1 })
  },

  confirm() {
    // 预览仅确认参数；出纸在门店一体机完成，这里进入选门店流程（不伪造已打印）
    const { color, duplex, copies, total, amountCents, docName, fileId, pages } = this.data
    if (!fileId) {
      wx.showToast({ title: '缺少真实文件参数，请重新选择文档', icon: 'none' })
      return
    }
    // amountCents 必须继续透传：下游 print-store / print-pay 靠它区分免费试运营单和付费单，
    // 一旦在这里丢掉，0 元订单会被下游当成金额未知，重新显示成「机端支付 ¥x」。
    wx.navigateTo({
      url: `/pages/print-store/print-store?fileId=${encodeURIComponent(fileId)}&color=${color}&duplex=${duplex}&copies=${copies}&total=${encodeURIComponent(total)}&amountCents=${encodeURIComponent(amountCents)}&pages=${pages}&name=${encodeURIComponent(docName)}`,
    })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
