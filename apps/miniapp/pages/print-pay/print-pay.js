Page({
  data: {
    statusBarHeight: 20,
    q: {},
    files: [{ name: '未选择文件', desc: '', price: '—' }],
    fee: { total: '—' },
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
    if (q.pickupCode) {
      wx.navigateTo({
        url: `/pages/print-pickup/print-pickup?pickupCode=${encodeURIComponent(q.pickupCode)}&expiresAt=${encodeURIComponent(q.expiresAt || '')}&bundleId=${encodeURIComponent(q.bundleId || '')}&store=${encodeURIComponent(q.store || '')}&name=${encodeURIComponent(this.data.files[0].name)}&total=${encodeURIComponent(this.data.fee.total)}`,
      })
      return
    }
    wx.showModal({
      title: '预提交接口尚未开通',
      content: '当前已完成文件、价目和终端选择界面，但 Order-only 待到机订单、到机码及机端支付状态机尚未进入主项目。本版本不会生成假订单或假取件码。',
      showCancel: false,
    })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
