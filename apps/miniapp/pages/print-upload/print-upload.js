const api = require('../../utils/api')
const pricing = require('../../utils/print-pricing')

// 后端 print_doc 只收 PDF/JPG/PNG，扩展名足以判型，不必为一个徽章多打一次网络请求。
function extLabelOf(name) {
  const clean = String(name || '').split('?')[0].trim()
  const dot = clean.lastIndexOf('.')
  if (dot < 0 || dot === clean.length - 1) return 'FILE'
  return clean.slice(dot + 1).toUpperCase().slice(0, 5)
}

function verifiedPrintParams(copies) {
  return {
    copies,
    colorMode: 'black_white',
    duplex: 'simplex',
    paperSize: 'A4',
    orientation: 'auto',
    quality: 'standard',
    scale: 'fit',
    pagesPerSheet: 1,
  }
}

Page({
  _quoteTimer: null,
  _quoteSeq: 0,

  data: {
    statusBarHeight: 20,
    // 文件内容始终留在服务端；页面只持有本人文件 id 和安全元数据。
    file: { name: '未选择文件', pages: 0, size: '—' },
    fileExt: 'FILE',
    fileId: '',
    hasFile: false,
    hasPageCount: false,
    color: 'bw',
    duplex: 'single',
    copies: 1,
    // idle | loading | ready | unavailable；ready 仅代表 /orders/quote 已返回。
    priceStatus: 'idle',
    priceError: '',
    priceLabels: { bw: '读取中…', color: '读取中…' },
    total: '—',
    amountCents: null,
    billingPageSource: '',
    privacyStatus: 'idle', // idle | scanning | review | ready | error
    privacyError: '',
    privacyTaskId: '',
    privacyFindings: [],
    privacySubmitting: false,
  },

  onLoad(opts) {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight || 20 })
    const o = opts || {}
    if (o.name) {
      const name = decodeURIComponent(o.name)
      this.setData({ 'file.name': name, fileExt: extLabelOf(name) })
    }

    // 上游页数只作瞬时参考，不作为计价依据；服务端报价会覆盖为真实计费页数。
    const upstreamPages = parseInt(o.pages, 10)
    if (upstreamPages > 0) this.setData({ 'file.pages': upstreamPages })

    if (o.fileId) {
      this.setData({ fileId: o.fileId, hasFile: true })
      this._runPrivacyScan(o.fileId)
      this._refreshQuote()
    }
    this._loadPriceLabels()
  },

  onUnload() {
    if (this._quoteTimer) clearTimeout(this._quoteTimer)
    this._quoteTimer = null
    this._quoteSeq += 1
  },

  _loadPriceLabels() {
    api.getPrintPriceConfig()
      .then((raw) => {
        const view = pricing.normalizePriceConfig(raw)
        this.setData({ priceLabels: view.labels })
      })
      .catch(() => {
        // 单价展示失败不冒充正式价格；精确报价仍独立走 /orders/quote。
        this.setData({ priceLabels: { bw: '以服务端报价为准', color: '暂未开放' } })
      })
  },

  _refreshQuote(delay = 0) {
    if (this._quoteTimer) clearTimeout(this._quoteTimer)
    this._quoteTimer = null
    // 每次参数变化都要立刻让前一笔请求失效，并撤下旧报价。
    // 不能等 500ms 防抖结束后才递增序号，否则旧请求可能在等待期间回写为 ready。
    const seq = ++this._quoteSeq
    if (!this.data.fileId) {
      this.setData({ priceStatus: 'idle', total: '—', amountCents: null, hasPageCount: false })
      return
    }

    const fileId = this.data.fileId
    const copies = this.data.copies
    this.setData({
      priceStatus: 'loading',
      priceError: '',
      total: '—',
      amountCents: null,
      hasPageCount: false,
    })

    const run = () => {
      this._quoteTimer = null
      api.quoteMyPrintOrder(fileId, verifiedPrintParams(copies))
        .then((quote) => {
          if (seq !== this._quoteSeq) return
          const amountCents = Number(quote && quote.amountCents)
          const billablePages = Number(quote && quote.billablePages)
          if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !Number.isSafeInteger(billablePages) || billablePages < 1) {
            throw new Error('服务端报价缺少有效页数或金额')
          }
          this.setData({
            priceStatus: 'ready',
            priceError: '',
            total: pricing.formatCents(amountCents),
            amountCents,
            'file.pages': billablePages,
            hasPageCount: true,
            billingPageSource: quote.billingPageSource || '',
          })
        })
        .catch((err) => {
          if (seq !== this._quoteSeq) return
          this.setData({
            priceStatus: 'unavailable',
            priceError: (err && err.message) || '服务端暂时无法核定页数和金额',
            total: '—',
            amountCents: null,
            hasPageCount: false,
          })
        })
    }

    if (delay > 0) this._quoteTimer = setTimeout(run, delay)
    else run()
  },

  pickColor(e) {
    // 不可选项要说清楚「为什么」。一个没有解释的 toast 会让用户以为是自己点错了、
    // 反复去点；讲明原因之后，暂不开放才是一条能被接受的产品结论。
    // 注意：本函数必须紧跟 _refreshQuote 之后（verify-miniapp-static 的报价竞态门禁按此定位）。
    if (e.currentTarget.dataset.v !== 'bw') {
      wx.showModal({
        title: '彩色打印暂不可选',
        content: '门店一体机硬件支持彩色，但驱动侧的彩色参数尚未完成 Windows 真机出纸验收。在验收通过前放开，可能出现按彩色计价、实际却出黑白的情况，所以本期只开放黑白。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    this.setData({ color: 'bw' })
  },

  pickDuplex(e) {
    if (e.currentTarget.dataset.v !== 'single') {
      wx.showModal({
        title: '双面打印暂不可选',
        content: '一体机支持自动双面，但双面参数要经打印驱动 DEVMODE 下发，尚未完成真机验收。在验收通过前放开，可能出现按双面计费却打成单面的情况，所以本期只开放单面。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    this.setData({ duplex: 'single' })
  },

  minus() {
    if (this.data.copies <= 1) return
    this.setData({ copies: this.data.copies - 1 })
    this._refreshQuote(500)
  },

  plus() {
    if (this.data.copies >= 99) return
    this.setData({ copies: this.data.copies + 1 })
    this._refreshQuote(500)
  },

  // 预览只是「看自己的文件」，不该被报价卡住：报价未就绪时预览页显示「待服务端核定」，
  // 而不是编一个金额。下单闸门（报价 + 隐私确认）只保留在 toStore() 一处，
  // 预览页也不再自行跳选门店——否则从预览页就能绕过隐私确认。
  preview() {
    const { color, duplex, copies, total, amountCents, file, fileId, hasPageCount } = this.data
    if (!fileId) {
      wx.showToast({ title: '请先从“我的文档”选择真实文件', icon: 'none' })
      return
    }
    const quoted = this.data.priceStatus === 'ready' && hasPageCount
    wx.navigateTo({
      url: `/pages/print-preview/print-preview?fileId=${encodeURIComponent(fileId)}&color=${color}&duplex=${duplex}&copies=${copies}&total=${encodeURIComponent(quoted ? total : '')}&amountCents=${encodeURIComponent(quoted ? amountCents : '')}&pages=${quoted ? file.pages : 0}&name=${encodeURIComponent(file.name)}`,
    })
  },

  tapFile() {
    if (this.data.hasFile) this.preview()
    else this.chooseSource()
  },

  chooseSource() {
    wx.navigateTo({ url: '/pages/documents/documents' })
  },

  toStore() {
    if (!this.data.fileId) {
      wx.showModal({
        title: '尚未选择文件',
        content: '本版本只允许从本人已上传文档或真实 AI 成果进入打印，不能用占位文件建单。',
        confirmText: '选择文档',
        success: (res) => { if (res.confirm) this.chooseSource() },
      })
      return
    }
    if (this.data.priceStatus !== 'ready') {
      wx.showToast({
        title: this.data.priceStatus === 'loading' ? '服务端正在核定页数和金额' : '报价暂不可用，请稍后重试',
        icon: 'none',
      })
      return
    }
    if (this.data.privacyStatus !== 'ready') {
      wx.showModal({
        title: '请先完成隐私检查',
        content: this.data.privacyStatus === 'scanning' ? '文件仍在检查中，请稍候。' : '确认隐私检查结果后才能提交打印订单。',
        showCancel: false,
      })
      return
    }
    const { color, duplex, copies, total, amountCents, file, fileId } = this.data
    wx.navigateTo({
      url: `/pages/print-store/print-store?fileId=${encodeURIComponent(fileId)}&color=${color}&duplex=${duplex}&copies=${copies}&total=${total}&amountCents=${encodeURIComponent(amountCents)}&pages=${file.pages}&name=${encodeURIComponent(file.name)}`,
    })
  },

  retryQuote() {
    this._refreshQuote()
  },

  _runPrivacyScan(fileId) {
    this.setData({ privacyStatus: 'scanning', privacyError: '', privacyFindings: [], privacyTaskId: '' })
    api.createPrintPiiScan(fileId)
      .then((task) => {
        const findings = Array.isArray(task.piiFindings) ? task.piiFindings.filter((item) => item.action === 'pending') : []
        this.setData({
          privacyTaskId: task.id || '',
          privacyFindings: findings,
          privacyStatus: findings.length ? 'review' : 'ready',
        })
      })
      .catch((err) => this.setData({ privacyStatus: 'error', privacyError: (err && err.message) || '隐私检查失败' }))
  },

  confirmPrivacy() {
    if (this.data.privacySubmitting || !this.data.privacyTaskId) return
    const decisions = this.data.privacyFindings.map((item) => ({ findingId: item.id, action: 'keep' }))
    this.setData({ privacySubmitting: true })
    api.decidePrintPiiFindings(this.data.privacyTaskId, decisions)
      .then(() => {
        this.setData({ privacySubmitting: false, privacyStatus: 'ready' })
        wx.showToast({ title: '已确认', icon: 'success' })
      })
      .catch((err) => {
        this.setData({ privacySubmitting: false })
        wx.showModal({ title: '确认失败', content: (err && err.message) || '请稍后重试', showCancel: false })
      })
  },

  retryPrivacy() {
    if (this.data.fileId) this._runPrivacyScan(this.data.fileId)
  },

  back() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },
})
