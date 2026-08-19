// pages/package-create/package-create.js
const app = getApp()
const { guardPackageChain } = require('../../utils/package-feature')

Page({
  data: {
    statusBarHeight: 20,
    step: 1,
    files: [],
    colorMode: 'bw',
    duplex: 'single',
    copies: 1,
    totalPages: 0,
    totalPrice: '--',
  },

  onLoad() {
    if (guardPackageChain()) return
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    // 恢复上次未提交的文件列表（如有）
    const saved = wx.getStorageSync('temp_package_data')
    if (saved && Array.isArray(saved.files) && saved.files.length > 0) {
      this.setData({
        files:     saved.files,
        colorMode: saved.colorMode || 'bw',
        duplex:    saved.duplex    || 'single',
        copies:    saved.copies    || 1,
      }, () => { this._recalculateSummary() })
    }
  },

  _recalculateSummary() {
    const { files } = this.data
    let totalPages = 0
    files.forEach(f => { totalPages += f.pages || 0 })

    // 这里原本按「黑白 0.5 元/页、彩色 2 元/页」在本地算总价。那两个单价是写死的，
    // 既不读 GET /print/price-config，也对不上仓库里的价目（黑白 20 分 / 彩色 50 分），
    // 等于把一个编出来的金额显示给用户看。真实打印链的做法是让服务端报价
    // （print-upload.js 调 POST /orders/quote 拿 amountCents），材料包要显示金额也必须走同一条路。
    // 在服务端下单/报价接口上线前，此处不给数字。
    this.setData({ totalPages, totalPrice: '--' })
  },

  goBack() {
    wx.navigateBack()
  },

  addFile() {
    wx.chooseMessageFile({
      count: 9,
      type: 'file',
      extension: ['pdf', 'doc', 'docx'],
      success: (res) => {
        const existing = this.data.files
        const newFiles = res.tempFiles
          .filter(f => !existing.some(e => e.name === f.name))
          .map(f => ({
            id:    'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name:  f.name,
            size:  this._formatFileSize(f.size),
            path:  f.path,
            pages: 1,  // 实际页数由打印机读取
          }))
        if (newFiles.length === 0) {
          wx.showToast({ title: '文件已添加过', icon: 'none' })
          return
        }
        this.setData({ files: existing.concat(newFiles) }, () => {
          this._recalculateSummary()
        })
      },
      fail(err) {
        if (err.errCode !== -2) {  // -2 = 用户取消
          wx.showToast({ title: '文件选择失败', icon: 'none' })
        }
      }
    })
  },

  _formatFileSize(bytes) {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + 'B'
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB'
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
  },

  removeFile(e) {
    const { id } = e.currentTarget.dataset
    const files = this.data.files.filter(f => f.id !== id)
    this.setData({ files }, () => {
      this._recalculateSummary()
    })
  },

  setColorMode(e) {
    const { mode } = e.currentTarget.dataset
    this.setData({ colorMode: mode }, () => {
      this._recalculateSummary()
    })
  },

  setDuplex(e) {
    const { mode } = e.currentTarget.dataset
    this.setData({ duplex: mode })
  },

  decreaseCopies() {
    const copies = Math.max(1, this.data.copies - 1)
    this.setData({ copies }, () => {
      this._recalculateSummary()
    })
  },

  increaseCopies() {
    const copies = Math.min(10, this.data.copies + 1)
    this.setData({ copies }, () => {
      this._recalculateSummary()
    })
  },

  createPackage() {
    const { files, colorMode, duplex, copies, totalPrice } = this.data
    if (files.length === 0) {
      wx.showToast({ title: '请先添加文件', icon: 'none' })
      return
    }
    
    // 保存材料包数据到临时存储
    const packageData = {
      files,
      colorMode,
      duplex,
      copies,
      totalPrice
    }
    wx.setStorageSync('temp_package_data', packageData)
    
    console.log('创建材料包，跳转选择服务点:', packageData)

    // 跳转到服务点选择页面
    wx.navigateTo({
      url: '/pages/store-select/store-select?from=package-create'
    })
  },

  // 不提供 onShareAppMessage：功能未开放前不把这条链继续扩散出去。
})
