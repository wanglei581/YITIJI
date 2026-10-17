const api = require('../../utils/api')
const auth = require('../../utils/auth')
const fileUrls = require('../../utils/file-url')
const pricing = require('../../utils/print-pricing')
const printParams = require('../../utils/print-params')
const storage = require('../../utils/storage')
const uploadNames = require('../../utils/upload-name')

// 后端 print_doc 只收 PDF/JPG/PNG，扩展名足以判型，不必为一个徽章多打一次网络请求。
function extLabelOf(name) {
  const clean = String(name || '').split('?')[0].trim()
  const dot = clean.lastIndexOf('.')
  if (dot < 0 || dot === clean.length - 1) return 'FILE'
  return clean.slice(dot + 1).toUpperCase().slice(0, 5)
}

const IMAGE_EXTS = ['JPG', 'JPEG', 'PNG']
const DEFAULT_DRAFT = { copies: 1, colorMode: 'black_white', duplex: 'simplex', terminalId: '' }

// 草稿归属用的会员 id：只读存储，不调 getToken / isLoggedIn / getUser——令牌过期或两格对不上时
// 它们会顺手清掉会话，影响别的页面。真正的「换没换人」由会话代际（auth.sessionGeneration）判定。
function storedOwner() {
  const user = storage.get(storage.KEYS.USER, null)
  return user && user.id != null && user.id !== '' ? String(user.id) : null
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
    // 文件卡标题只放主名，扩展名在 fileExt 标签里（「.pdf」不再被拆到下一行，FLOW1a）。
    fileBase: '未选择文件',
    fileExt: 'FILE',
    fileId: '',
    hasFile: false,
    hasPageCount: false,
    // 第 1 步只按 1 份黑白单面向服务端核定页数（门禁基线）；份数、颜色、单双面都在第 2 步按终端能力设置。
    copies: 1,
    // idle | loading | ready | unavailable；ready 仅代表 /orders/quote 已返回。
    priceStatus: 'idle',
    priceError: '',
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
      this.setData({ 'file.name': name, fileBase: uploadNames.displayNameParts(name).base, fileExt: extLabelOf(name) })
    }

    // 上游页数只作瞬时参考，不作为计价依据；服务端报价会覆盖为真实计费页数。
    const upstreamPages = parseInt(o.pages, 10)
    if (upstreamPages > 0) this.setData({ 'file.pages': upstreamPages })

    if (o.fileId) {
      // printFileUrl：上游（招聘会活动资料 / 参会企业资料）拿到的服务端签名 URL。
      // 那两类是共享派生文件，endUserId 为 null，用 fileId 去换 preview-url 必吃 403；
      // 服务端在生成响应里已经把 URL 给过一次，这里直接用，不再换第二次。
      // 普通本人文件不带这个参数，走原路径，行为完全不变。
      this._printFileUrl = o.printFileUrl ? decodeURIComponent(o.printFileUrl) : ''
      this.setData({ fileId: o.fileId, hasFile: true })
      this._runPrivacyScan(o.fileId)
      this._refreshQuote()
    }
  },

  onUnload() {
    this._unloaded = true
    if (this._quoteTimer) clearTimeout(this._quoteTimer)
    this._quoteTimer = null
    this._quoteSeq += 1
    // 正在打开原文时返回：全局遮罩当场收起，不等网络，免得挡住上一页。
    if (this._opening) { this._opening = false; wx.hideLoading() }
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
      api.quoteMyPrintOrder(fileId, verifiedPrintParams(copies), this._printFileUrl)
        .then((quote) => {
          if (seq !== this._quoteSeq) return
          const amountCents = Number(quote && quote.amountCents)
          const billablePages = Number(quote && quote.billablePages)
          if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !Number.isSafeInteger(billablePages) || billablePages < 1) {
            throw new Error('服务端核定结果不完整，请重试')
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
            priceError: (err && err.message) || '服务端暂时无法核定页数',
            total: '—',
            amountCents: null,
            hasPageCount: false,
          })
        })
    }

    if (delay > 0) this._quoteTimer = setTimeout(run, delay)
    else run()
  },

  // 「查看原文」直接用微信阅读器打开本人原文件：PDF/Office 走 openSignedDocument（与「我的文档」同一实现，
  // 手机上已验过），图片走 previewImage。此前先进打印预览中间页、还要再点一次「打开原文查看」，
  // 那页还把第 1 步默认的黑白单面写成「本次打印参数」（FLOW1a 实图 08）。
  openOriginal() {
    const { fileId, file, fileExt } = this.data
    if (!fileId) { this.chooseSource(); return }
    if (this._opening) return
    this._opening = true
    wx.showLoading({ title: '正在打开原文…', mask: true })
    const done = () => {
      if (!this._opening) return
      this._opening = false
      wx.hideLoading()
    }
    if (IMAGE_EXTS.indexOf(fileExt) === -1) {
      fileUrls.openSignedDocument({ wx, fetchUrl: () => api.getFilePreviewUrl(fileId), name: file.name })
        .then((result) => {
          done()
          if (!this._unloaded && !result.ok) wx.showModal({ title: '无法打开原文', content: result.text, showCancel: false })
        })
      return
    }
    api.getFilePreviewUrl(fileId)
      .then((res) => {
        const url = fileUrls.absoluteUrl(res && (res.url || res.previewUrl))
        if (!url) throw new Error('没有拿到原文链接，请稍后重试')
        done()
        if (!this._unloaded) wx.previewImage({ urls: [url], current: url })
      })
      .catch((err) => {
        done()
        if (!this._unloaded) wx.showToast({ title: (err && err.message) || '原文打开失败，请重试', icon: 'none' })
      })
  },

  // 第 2 步（终端和参数）每次改动都经 EventChannel 报回来。草稿只存在本页实例里（不写 storage / globalData）。
  // 归属绑定在**发起跳转那一刻**（gen、owner 由 toStore 传进来），不是事件到达时现取：
  // 晚到的事件若已跨了账号，代际或会员对不上就不收；未登录（owner 为 null）不收；别的文件、校验不过的也不收。
  _keepDraft(d, gen, owner) {
    if (!owner || !auth.isSameSession(gen) || storedOwner() !== owner) return
    if (!d || typeof d !== 'object' || d.fileId !== this.data.fileId) return
    let normalized
    try { normalized = printParams.normalize({ copies: d.copies, colorMode: d.colorMode, duplex: d.duplex }) } catch (e) { return }
    const terminalId = typeof d.terminalId === 'string' && d.terminalId.length <= 64 ? d.terminalId : ''
    this._draft = {
      fileId: d.fileId,
      gen,
      owner,
      copies: normalized.copies,
      colorMode: normalized.colorMode,
      duplex: normalized.duplex,
      terminalId,
    }
  },

  // 带回第 2 步的只有本文件、同一会话代际、同一会员的草稿；中途登出、换号就作废，回到默认值。
  _usableDraft() {
    const d = this._draft
    if (d && d.fileId === this.data.fileId && auth.isSameSession(d.gen) && storedOwner() === d.owner) return d
    return DEFAULT_DRAFT
  },

  // 「预览排版」和「去选门店」是同一条打印链路上的两个入口，必须走同一道闸门：
  // 真实文件 → 服务端报价 → PII 隐私确认。此前 preview() 自带一套只查文件和报价的
  // 弱校验，导致从预览页可以完全绕过隐私确认继续下单。闸门只允许存在这一处实现，
  // 任何入口都不得再内联重复校验，否则两条路径会再次分叉。
  _passPrintGate() {
    if (!this.data.fileId) {
      wx.showModal({
        title: '尚未选择文件',
        content: '本版本只允许从本人已上传文档或真实 AI 成果进入打印，不能用占位文件建单。',
        confirmText: '选择文档',
        success: (res) => { if (res.confirm) this.chooseSource() },
      })
      return false
    }
    if (this.data.priceStatus !== 'ready' || !this.data.hasPageCount) {
      wx.showToast({
        title: this.data.priceStatus === 'loading' ? '服务端正在核定页数' : '页数暂时无法核定，请稍后重试',
        icon: 'none',
      })
      return false
    }
    if (this.data.privacyStatus !== 'ready') {
      wx.showModal({
        title: '请先完成隐私检查',
        content: this.data.privacyStatus === 'scanning' ? '文件仍在检查中，请稍候。' : '确认隐私检查结果后才能提交打印订单。',
        showCancel: false,
      })
      return false
    }
    return true
  },

  // 看原文不是流程节点：openOriginal() 只打开文件本身，没有通往选终端的出口，
  // #610 要堵的「预览 → 建单绕过隐私确认」那条旁路结构上不存在。下单闸门仍然只有
  // _passPrintGate() 这一处实现，且只有 toStore() 这一个入口会用到它——任何入口都不得再内联重复校验。
  tapFile() {
    if (this.data.hasFile) this.openOriginal()
    else this.chooseSource()
  },

  chooseSource() {
    wx.navigateTo({ url: '/pages/documents/documents' })
  },

  // 颜色、单双面、份数、终端都在第 2 步按终端实时能力设置；这里把上次在第 2 步选好的
  // 带回去（FLOW1a P1：此前只带份数，返回再进时彩色、双面被重置成黑白单面）。
  // 带回去的只是用户意图：第 2 步照样按终端能力重算、重新核价，quoteKey 对得上才放行。
  toStore() {
    if (!this._passPrintGate()) return
    const { file, fileId } = this.data
    const d = this._usableDraft()
    const enc = encodeURIComponent
    let url = '/pages/print-store/print-store?fileId=' + enc(fileId)
      + '&copies=' + d.copies
      + '&colorMode=' + d.colorMode
      + '&duplex=' + d.duplex
      + '&name=' + enc(file.name)
    if (d.terminalId) url += '&terminalId=' + enc(d.terminalId)
    const gen = auth.sessionGeneration()
    const owner = storedOwner()
    wx.navigateTo({
      url,
      events: { printDraft: (draft) => this._keepDraft(draft, gen, owner) },
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
