// pages/print-preview/print-preview.js  打印预览
//
// 本页只做一件事：让用户在下单前看到「自己这份文件到底是什么」，并复核已核定的参数。
//
// 设计约束（CLAUDE.md §9 不伪造能力）：
//   - 服务端没有分页渲染能力（files 只有 /content 整文件出口，print-conversion 只做
//     images→PDF），因此本页不做逐页预览，也不再画任何假的「文档版式」占位线条。
//     旧版用 9 条灰色横线冒充正文、用 prev/next 假装可以翻页，用户看到的既不是自己的
//     文件，也翻不出第二页内容。
//   - 图片：<image> 直接渲染真实文件（image 组件不受合法域名限制），点击进系统级放大。
//   - PDF/Office：小程序无法内嵌排版，只能 wx.downloadFile + wx.openDocument 交给微信
//     自带阅读器。失败时必须说明失败原因，不能留一个空白框让用户以为文件是空的。
//
// 本页不再充当流程节点：报价与隐私检查两道闸门归 print-upload 单独持有，
// 预览只能返回，避免出现「从预览页绕过隐私确认直接进选门店」的旁路。
const app = getApp()
const api = require('../../utils/api')
const config = require('../../utils/config')

const IMAGE_EXT = ['jpg', 'jpeg', 'png']
// wx.openDocument 官方支持的类型；超出这个集合就别声明 fileType，交给微信自行判断。
const OPENABLE_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']

function extOf(name) {
  const clean = String(name || '').split('?')[0].trim()
  const dot = clean.lastIndexOf('.')
  if (dot < 0 || dot === clean.length - 1) return ''
  return clean.slice(dot + 1).toLowerCase().slice(0, 8)
}

// 服务端 signFileUrl() 返回的是 /api/v1/files/:id/content?... 相对路径，
// 而 wx.downloadFile / <image> 都只接受绝对地址，必须补回源站，否则必然失败。
function absoluteUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  return `${config.baseUrl}${raw.charAt(0) === '/' ? '' : '/'}${raw}`
}

function readableDownloadError(errMsg) {
  const text = String(errMsg || '')
  if (/domain list|合法域名|not in domain/i.test(text)) {
    return '微信后台尚未把文件域名加入 downloadFile 合法域名，小程序暂时无法打开原文。可先在「我的文档」核对文件，或到门店终端查看。'
  }
  if (/timeout/i.test(text)) return '下载原文超时，请检查网络后重试。'
  return text || '打开原文失败'
}

Page({
  data: {
    statusBarHeight: 20,

    // ── 文件 ──
    fileId: '',
    docName: '',
    ext: '',
    extLabel: 'FILE',
    isImage: false,

    // ── 预览状态：loading | image | doc | error（没有第五种「看起来正常但其实是空的」）──
    state: 'loading',
    fileUrl: '',
    errorText: '',
    opening: false,

    // ── 参数复核（全部来自上游，页面自身不推算任何页数或金额）──
    colorLabel: '黑白',
    duplexLabel: '单面',
    copies: 1,
    pages: 0,
    hasQuote: false,
    isFree: false,
    total: '',
  },

  onLoad(opts) {
    const o = opts || {}
    const docName = o.name ? decodeURIComponent(o.name) : ''
    const ext = extOf(docName)
    const pages = Number(o.pages)
    const amountCents = Number(o.amountCents)
    // 报价是否可用由「金额与页数同时有效」决定；缺一不可，否则宁可显示待核定。
    const hasQuote = o.amountCents !== undefined && o.amountCents !== '' &&
      Number.isSafeInteger(amountCents) && amountCents >= 0 &&
      Number.isSafeInteger(pages) && pages > 0

    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      fileId: o.fileId || '',
      docName: docName || '未命名文件',
      ext,
      extLabel: ext ? ext.toUpperCase() : 'FILE',
      isImage: IMAGE_EXT.indexOf(ext) >= 0,
      colorLabel: o.color === 'color' ? '彩色' : '黑白',
      duplexLabel: o.duplex === 'double' ? '双面' : '单面',
      copies: Math.max(1, Number(o.copies) || 1),
      pages: hasQuote ? pages : 0,
      hasQuote,
      isFree: hasQuote && amountCents === 0,
      total: o.total ? decodeURIComponent(o.total) : '',
    })

    this._loadPreview()
  },

  _loadPreview() {
    if (!this.data.fileId) {
      this.setData({ state: 'error', errorText: '缺少文件参数，请返回重新选择文档' })
      return
    }
    this.setData({ state: 'loading', errorText: '' })
    api.getFilePreviewUrl(this.data.fileId)
      .then((res) => {
        const url = absoluteUrl(res && (res.printFileUrl || res.url))
        if (!url) throw new Error('服务端未返回可用的预览链接')
        this.setData({ fileUrl: url, state: this.data.isImage ? 'image' : 'doc' })
      })
      .catch((err) => {
        this.setData({
          state: 'error',
          errorText: (err && err.message) || '预览链接获取失败，请稍后重试',
        })
      })
  },

  retryPreview() {
    this._loadPreview()
  },

  // <image> 拿到链接却渲染不出来（签名过期 / 文件损坏）时，必须说清楚，
  // 不能停在一个空白的 A4 框上让用户以为自己的文件是空白页。
  imageError() {
    this.setData({
      state: 'error',
      errorText: '图片内容加载失败，可能是预览链接已过期，请重试',
    })
  },

  zoomImage() {
    if (this.data.state !== 'image' || !this.data.fileUrl) return
    wx.previewImage({ urls: [this.data.fileUrl], current: this.data.fileUrl })
  },

  openDoc() {
    if (this.data.opening || !this.data.fileUrl) return
    this.setData({ opening: true })
    wx.showLoading({ title: '正在打开原文…', mask: true })

    const finish = () => {
      wx.hideLoading()
      this.setData({ opening: false })
    }
    const failWith = (errMsg) => {
      finish()
      wx.showModal({
        title: '无法打开原文',
        content: readableDownloadError(errMsg),
        showCancel: false,
      })
    }

    wx.downloadFile({
      url: this.data.fileUrl,
      success: (dl) => {
        if (dl.statusCode !== 200) {
          failWith(`服务端返回 ${dl.statusCode}，预览链接可能已过期`)
          return
        }
        const params = {
          filePath: dl.tempFilePath,
          showMenu: true,
          success: finish,
          fail: (e) => failWith((e && e.errMsg) || '微信自带阅读器无法打开该文件'),
        }
        if (OPENABLE_EXT.indexOf(this.data.ext) >= 0) params.fileType = this.data.ext
        wx.openDocument(params)
      },
      fail: (e) => failWith(e && e.errMsg),
    })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
