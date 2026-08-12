const api = require('../../utils/api')

Page({
  data: {
    statusBarHeight: 20,
    q: {},
    files: [{ name: '未选择文件', desc: '', price: '—' }],
    fee: { total: '—' },
    submitting: false,
  },

  onLoad(opts) {
    const q = opts || {}
    const total = q.total || '—'
    const copies = Number(q.copies) > 0 ? Number(q.copies) : 1
    const pages = Number(q.pages) > 0 ? Number(q.pages) : 0
    const color = q.color === 'color' ? '彩色' : '黑白'
    const duplex = q.duplex === 'double' ? '双面' : '单面'
    this.setData({
      statusBarHeight: getApp().globalData.statusBarHeight || 20,
      q,
      'fee.total': total,
      'files[0].price': total,
      'files[0].name': q.name ? decodeURIComponent(q.name) : '未选择文件',
      'files[0].desc': `${color} · ${duplex} · ${pages || '未知'} 页 · ×${copies}`,
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
      wx.redirectTo({
        url: `/pages/print-pickup/print-pickup?orderId=${encodeURIComponent(order.id)}&orderNo=${encodeURIComponent(order.orderNo || '')}&pickupCode=${encodeURIComponent(order.pickupCode)}&expiresAt=${encodeURIComponent(order.pickupCodeExpiresAt || '')}&taskStatus=${encodeURIComponent(order.taskStatus || 'pending_release')}&store=${encodeURIComponent(q.store || '')}&name=${encodeURIComponent(this.data.files[0].name)}&amountCents=${encodeURIComponent(order.amountCents || 0)}`,
      })
    }).catch(err => {
      wx.hideLoading()
      this.setData({ submitting: false })
      wx.showModal({ title: '提交失败', content: (err && err.message) || '请稍后重试', showCancel: false })
    })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
