// pages/print-pay/print-pay.js
//
// 单件云打印的最后一步：确认参数 → 建 Order-only 订单 → 去到机码页。
//
// 本页收到的 URL **只有 fileId / storeId / store（终端公开显示名）/ copies** 四项。
// 文件名与金额此前是从上一页拼在 URL 里传过来的，现在一律向服务端取：
//   - 金额与页数走 `POST /orders/quote`（与 print-upload 同一条报价链，服务端识别真实
//     页数并按 PriceConfig 计价）。前端不做任何单价乘法，也不把调用方给的数字当事实。
//   - 文件名走 `GET /me/documents`（本人文件元数据，带登录态）。
// 为什么非改不可：求职材料的文件名里常常就写着本人姓名（「张三的简历.pdf」），
// 而金额是本人订单状态。它们进了 URL，一条构造出来或转发出去的链接就能在别人手机上
// 把这些渲染出来。与 package-confirm → package-code、orders → print-pickup 同一口径。
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { memberIdentityKey, isMemberIdentity } = require('../../utils/page-guard')

// MP-07 改法 (a)：标签只显示即将建单的真实参数，不从 query 猜彩色/双面。
// 与 print-upload.verifiedPrintParams 锁死同一组（verify-miniapp-static 抽取字面量）。
// 彩色/双面尚未通过真机验收，不能做 (b) 把 query 透传到报价/建单——那会按彩色收费或 400。
const ORDER_COLOR_MODE = 'black_white'
const ORDER_DUPLEX = 'simplex'

/**
 * 报价参数。**与下面 createCloudPrintOrder 用的是同两个常量**，
 * 两条链共用一个出口，就不可能出现「按一种参数报价、按另一种参数计价」。
 * 其余固定值与 print-upload 的 verifiedPrintParams 逐字一致。
 */
function quoteParams(copies) {
  return {
    copies,
    colorMode: ORDER_COLOR_MODE,
    duplex: ORDER_DUPLEX,
    paperSize: 'A4',
    orientation: 'auto',
    quality: 'standard',
    scale: 'fit',
    pagesPerSheet: 1,
  }
}

function colorLabelOf(colorMode) {
  return colorMode === 'color' ? '彩色' : '黑白'
}

function duplexLabelOf(duplex) {
  return duplex === 'simplex' ? '单面' : '双面'
}

/** 分 → 元字符串。0 分是真的免费（试运营价目），不是「未知」，两者必须分开。 */
function formatYuan(amountCents) {
  return (amountCents / 100).toFixed(2)
}

Page({
  data: {
    statusBarHeight: 20,
    q: {},
    files: [{ name: '本人文件', price: '—' }],
    fee: { total: '—' },
    isFreeOrder: false,
    submitting: false,
    colorMode: ORDER_COLOR_MODE,
    duplex: ORDER_DUPLEX,
    colorLabel: '黑白',
    duplexLabel: '单面',
    pageCountLabel: '待服务端核定',
    copiesLabel: 1,
    // 报价状态：idle | loading | ready | error。金额与页数只有 ready 时才是真的。
    quoteState: 'idle',
    quoteError: '',
    // 订单已建成后的锁。再 POST 一次就是第二张订单（/me/print-orders 没有幂等键）。
    createdLocked: false,
  },

  onLoad(opts) {
    const q = opts || {}
    const copies = Number(q.copies) > 0 ? Number(q.copies) : 1
    this.setData({
      statusBarHeight: getApp().globalData.statusBarHeight || 20,
      q,
      colorMode: ORDER_COLOR_MODE,
      duplex: ORDER_DUPLEX,
      colorLabel: colorLabelOf(ORDER_COLOR_MODE),
      duplexLabel: duplexLabelOf(ORDER_DUPLEX),
      copiesLabel: copies,
    })
    this._loadQuote()
    this._loadFileName()
  },

  /** 当前身份的稳定快照。三态；见 page-guard.memberIdentityKey。 */
  _identityKey() {
    return memberIdentityKey(auth)
  },

  /** 这条异步链的结果还能不能落到当前这位头上。换人了一律停手。 */
  _sameIdentity(identity) {
    return this._identityKey() === identity
  },

  /**
   * 服务端报价。金额与页数的**唯一来源**。
   *
   * 报价失败不挡下单：建单时服务端会自己计价，挡住等于用一次展示失败取消一次真实能力。
   * 但页面绝不本地补一个数字顶上 —— 只如实写「待服务端核定」（CLAUDE.md §9 不伪造能力）。
   */
  _loadQuote() {
    const { fileId } = this.data.q
    if (!fileId) {
      this.setData({ quoteState: 'error', quoteError: '这条链接没有带文件，请返回重新选择。' })
      return
    }
    const identity = this._identityKey()
    this.setData({ quoteState: 'loading', quoteError: '' })
    api.quoteMyPrintOrder(fileId, quoteParams(this.data.copiesLabel))
      .then((quote) => {
        if (!this._sameIdentity(identity)) return
        const amountCents = Number(quote && quote.amountCents)
        const billablePages = Number(quote && quote.billablePages)
        if (!Number.isSafeInteger(amountCents) || amountCents < 0
          || !Number.isSafeInteger(billablePages) || billablePages < 1) {
          throw new Error('服务端报价缺少有效页数或金额')
        }
        const isFreeOrder = amountCents === 0
        const total = isFreeOrder ? '免费' : formatYuan(amountCents)
        this.setData({
          quoteState: 'ready',
          quoteError: '',
          isFreeOrder,
          pageCountLabel: `${billablePages} 页`,
          'fee.total': total,
          'files[0].price': total,
        })
      })
      .catch((err) => {
        if (!this._sameIdentity(identity)) return
        this.setData({
          quoteState: 'error',
          quoteError: (err && err.message) || '暂时取不到服务端报价，金额将在到机时以服务端核定为准。',
        })
      })
  },

  retryQuote() {
    if (this.data.quoteState !== 'loading') this._loadQuote()
  },

  /**
   * 文件名只从**本人文件库**取，不从 URL 取。
   *
   * 取不到（翻页范围外、接口失败）就保留中性的「本人文件」，不猜、不回显 URL 里的值。
   * 这一步失败完全不影响下单：它只是一个让用户确认"我选的是哪一份"的标签。
   */
  _loadFileName() {
    const { fileId } = this.data.q
    if (!fileId) return
    const identity = this._identityKey()
    if (!isMemberIdentity(identity)) return
    api.getMyDocuments({ pageSize: 20 })
      .then((page) => {
        if (!this._sameIdentity(identity)) return
        const items = Array.isArray(page && page.items) ? page.items : (Array.isArray(page) ? page : [])
        const hit = items.find((doc) => doc && doc.id === fileId)
        if (hit && hit.filename) this.setData({ 'files[0].name': hit.filename })
      })
      .catch(() => {
        // 静默：标签取不到不该在确认页弹一个与下单无关的错误。
      })
  },

  /**
   * 订单已经建出来之后的统一出口。
   *
   * 存在的唯一理由：**再 POST 一次就是第二张订单**（`POST /me/print-orders` 没有幂等键）。
   * 所以一旦拿到 orderId，本页就不再是一个可以下单的页面 —— 按钮变灰，
   * 并把恢复动作指向「我的 · 打印订单」，那里能找回这张订单、点进去就是到机码页。
   */
  _lockAfterCreated(orderId) {
    this._createdOrderId = orderId
    this.setData({ submitting: false, createdLocked: true })
  },

  toOrders() {
    wx.navigateTo({ url: '/pages/orders/orders', fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  continueFlow() {
    const q = this.data.q
    if (this.data.submitting) return
    // 已经建过单：不再发第二次 POST，直接把人送去找那张订单。
    if (this._createdOrderId) { this._lockAfterCreated(this._createdOrderId); return }
    if (!q.fileId || !q.storeId) {
      wx.showModal({ title: '参数不完整', content: '请返回重新选择文件和终端。', showCancel: false })
      return
    }
    const identity = this._identityKey()
    this.setData({ submitting: true })
    wx.showLoading({ title: '正在提交…', mask: true })
    api.createCloudPrintOrder({
      fileId: q.fileId,
      terminalId: q.storeId,
      copies: Math.max(1, Number(q.copies) || 1),
      // 与上面 quoteParams 逐字同源（同两个常量）：报价与计价不会分叉。
      colorMode: 'black_white',
      duplex: 'simplex',
    }).then(order => {
      wx.hideLoading()
      const orderId = (order && order.id) || ''
      if (!orderId) throw new Error('服务端未返回订单号')
      // 换了人：这张订单属于上一位，不锁当前这位的页面、也不把他带去别人的到机码。
      // 上一位的订单不会丢，它已落库，本人可从「我的 · 打印订单」找回。
      if (!this._sameIdentity(identity)) { this.setData({ submitting: false }); return }
      // 从这一行起，这张订单在服务端已经存在：本页永远不许再 POST 第二次。
      // 锁必须在 redirectTo **之前**设 —— 跳转失败（或同步抛）时页面还留在这里，
      // 不设锁的话用户只会以为没下成，然后再点一次，于是多出一张订单和一笔钱。
      this._createdOrderId = orderId
      // 只把 orderId 交给下一页。到机码 / 金额 / 有效期 / 订单号 / 任务状态一律由
      // print-pickup 自己带登录态向 GET /me/print-orders/:orderId 取（requireOwned 归属校验）。
      wx.redirectTo({
        url: '/pages/print-pickup/print-pickup?orderId=' + encodeURIComponent(orderId),
        fail: () => this._lockAfterCreated(orderId),
      })
    }).catch(err => {
      wx.hideLoading()
      if (!this._sameIdentity(identity)) { this.setData({ submitting: false }); return }
      // 订单已经建成、只是后续动作抛错（例如 redirectTo 同步抛）：
      // 不能当成"下单失败"让用户重来 —— 重来就是第二张订单。
      if (this._createdOrderId) { this._lockAfterCreated(this._createdOrderId); return }
      this.setData({ submitting: false })
      wx.showModal({ title: '提交失败', content: (err && err.message) || '请稍后重试', showCancel: false })
    })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
