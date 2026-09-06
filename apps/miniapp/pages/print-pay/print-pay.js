const api = require('../../utils/api')

// MP-07 改法 (a)：标签只显示即将建单的真实参数，不从 query 猜彩色/双面。
// 与 print-upload.verifiedPrintParams 锁死同一组（verify-miniapp-static 抽取字面量）。
// 彩色/双面尚未通过真机验收，不能做 (b) 把 query 透传到报价/建单——那会按彩色收费或 400。
const ORDER_COLOR_MODE = 'black_white'
const ORDER_DUPLEX = 'simplex'

function colorLabelOf(colorMode) {
  return colorMode === 'color' ? '彩色' : '黑白'
}

function duplexLabelOf(duplex) {
  return duplex === 'simplex' ? '单面' : '双面'
}

Page({
  data: {
    statusBarHeight: 20,
    q: {},
    files: [{ name: '未选择文件', desc: '', price: '—' }],
    fee: { total: '—' },
    isFreeOrder: false,
    submitting: false,
    colorMode: ORDER_COLOR_MODE,
    duplex: ORDER_DUPLEX,
    colorLabel: '黑白',
    duplexLabel: '单面',
    pageCountLabel: '未知 页',
    copiesLabel: 1,
  },

  onLoad(opts) {
    const q = opts || {}
    const total = q.total || '—'
    const copies = Number(q.copies) > 0 ? Number(q.copies) : 1
    const pages = Number(q.pages) > 0 ? Number(q.pages) : 0
    const colorMode = ORDER_COLOR_MODE
    const duplex = ORDER_DUPLEX
    const color = colorLabelOf(colorMode)
    const duplexText = duplexLabelOf(duplex)
    const pageCountLabel = `${pages || '未知'} 页`
    const amountCents = Number(q.amountCents)
    const hasAmount = q.amountCents !== undefined && q.amountCents !== '' && Number.isSafeInteger(amountCents) && amountCents >= 0
    const isFreeOrder = hasAmount && amountCents === 0
    this.setData({
      statusBarHeight: getApp().globalData.statusBarHeight || 20,
      q,
      isFreeOrder,
      colorMode,
      duplex,
      colorLabel: color,
      duplexLabel: duplexText,
      pageCountLabel,
      copiesLabel: copies,
      'fee.total': total,
      'files[0].price': isFreeOrder ? '免费' : total,
      'files[0].name': q.name ? decodeURIComponent(q.name) : '未选择文件',
      'files[0].desc': `${color} · ${duplexText} · ${pageCountLabel} · ×${copies}`,
    })
  },

  continueFlow() {
    const q = this.data.q
    if (this.data.submitting) return
    if (!q.fileId || !q.storeId) {
      wx.showModal({ title: '参数不完整', content: '请返回重新选择文件和终端。', showCancel: false })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '正在提交…', mask: true })
    api.createCloudPrintOrder({
      fileId: q.fileId,
      terminalId: q.storeId,
      copies: Math.max(1, Number(q.copies) || 1),
      colorMode: 'black_white',
      duplex: 'simplex',
    }).then(order => {
      wx.hideLoading()
      this.setData({ submitting: false })
      if (!order || !order.pickupCode) throw new Error('服务端未返回到机码')
      const amountCents = Number.isSafeInteger(Number(order.amountCents)) ? Number(order.amountCents) : ''
      wx.redirectTo({
        url: `/pages/print-pickup/print-pickup?orderId=${encodeURIComponent(order.id)}&orderNo=${encodeURIComponent(order.orderNo || '')}&pickupCode=${encodeURIComponent(order.pickupCode)}&expiresAt=${encodeURIComponent(order.pickupCodeExpiresAt || '')}&taskStatus=${encodeURIComponent(order.taskStatus || 'pending_release')}&store=${encodeURIComponent(q.store || '')}&name=${encodeURIComponent(this.data.files[0].name)}&amountCents=${encodeURIComponent(amountCents)}`,
      })
    }).catch(err => {
      wx.hideLoading()
      this.setData({ submitting: false })
      wx.showModal({ title: '提交失败', content: (err && err.message) || '请稍后重试', showCancel: false })
    })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
