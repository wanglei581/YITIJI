// 本人文档：只展示服务端返回的真实元数据，不在小程序保存文件内容或伪造样例。
const app = getApp()
const api = require('../../utils/api')
const fileUrls = require('../../utils/file-url')
const auth = require('../../utils/auth')
const uploadNames = require('../../utils/upload-name')
const conversion = require('./documents-helpers')

Page({
  data: {
    statusBarHeight: 20,
    activeFilter: 'all',
    filters: [
      { key: 'all', label: '全部' },
      { key: 'original', label: '原始文件' },
      { key: 'optimized', label: '优化成果' },
      { key: 'derived', label: '派生成果' },
    ],
    all: [],
    nextCursor: null,
    loadingMore: false,
    filtered: [],
    loading: true,
    loadError: '',
    uploading: false,
    previewing: false,
    wordConversionAvailable: false,
    wordConversionCopy: conversion.WORD_CONVERSION_UNAVAILABLE_COPY,
    convertingId: '',
    convertResult: null,
    convertCountdown: '',
    convertExpired: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    if (!auth.isLoggedIn()) {
      wx.redirectTo({
        url: `/pages/launch/launch?returnTo=${encodeURIComponent('/pages/documents/documents')}`,
        // redirectTo 失败（如 launch 已在栈顶）时不能静默留在本页，与 contract-review._toLogin 同款兜底。
        fail: () => wx.switchTab({ url: '/pages/home/home' }),
      })
      return
    }
    this._loadConversionCapabilities()
    this.loadDocuments()
  },

  onUnload() {
    this._stopConvertCountdown()
  },

  _loadConversionCapabilities() {
    api.getDocumentConversionCapabilities()
      .then((capabilities) => {
        const available = capabilities && capabilities.wordToPdf === true
        this.setData({
          wordConversionAvailable: available,
          wordConversionCopy: available
            ? conversion.WORD_CONVERSION_DISCLOSURE
            : `${conversion.WORD_CONVERSION_UNAVAILABLE_COPY}；${(capabilities && capabilities.reason) || '转换引擎未就绪'}`,
        })
      })
      .catch(() => {
        this.setData({
          wordConversionAvailable: false,
          wordConversionCopy: conversion.WORD_CONVERSION_UNAVAILABLE_COPY,
        })
      })
  },

  loadDocuments(append = false) {
    // 2026-09-03 修复「不显示文件」：此前只取第一页 50 条即止——unwrapList 早就把
    // nextCursor 挂在返回数组上（utils/api.js），这里拿到就丢。第 51 份文件起
    // 永远不出现，页面还写着「最近 · 50 个文件」让人以为只有这么多。
    // 打印场景（证件正反、简历多版本、证书、合同）极易超过 50 份。
    // 分页写法对照 orders.js 的 _load（同一套 cursor 约定）。
    if (append && (!this.data.nextCursor || this.data.loadingMore)) return
    const cursor = append ? this.data.nextCursor : null
    this.setData(append ? { loadingMore: true } : { loading: true, loadError: '' })
    api.getMyDocuments({ pageSize: 50, ...(cursor ? { cursor } : {}) })
      .then((items) => {
        const page = (items || []).map(conversion.toView)
        const all = append ? [...this.data.all, ...page] : page
        this.setData({ all, loading: false, loadingMore: false, nextCursor: (items && items.nextCursor) || null })
        this.applyFilter(this.data.activeFilter, all)
      })
      .catch((err) => this.setData({
        loading: false,
        loadingMore: false,
        loadError: (err && err.message) || '加载文档失败，请稍后重试',
      }))
  },

  applyFilter(key, source) {
    const all = source || this.data.all
    this.setData({ filtered: key === 'all' ? all : all.filter((item) => item.type === key) })
  },

  onReachBottom() {
    this.loadDocuments(true)
  },

  setFilter(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ activeFilter: key })
    this.applyFilter(key)
  },

  // 点击行 → 可打印文件进打印流程；高敏报告只预览，避免点进打印吃 400
  openDoc(e) {
    const item = this.data.all.find((entry) => entry.id === String(e.currentTarget.dataset.id || ''))
    if (!item) return
    if (!item.reprintable) {
      wx.showModal({
        title: '不可打印',
        content: conversion.DOCUMENT_NOT_REPRINTABLE_COPY,
        showCancel: false,
        confirmText: '查看文件',
        success: (modal) => { if (modal.confirm) this.previewDoc(item.id) },
      })
      return
    }
    wx.navigateTo({
      url: `/pages/print-upload/print-upload?fileId=${encodeURIComponent(item.id)}&name=${encodeURIComponent(item.name)}&pages=${item.pages}`,
    })
  },

  reprintDoc(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const item = this.data.all.find((entry) => entry.id === id) || this._convertedPdfItem(id)
    if (!item) return
    if (!item.reprintable) {
      wx.showModal({
        title: '不可打印',
        content: conversion.DOCUMENT_NOT_REPRINTABLE_COPY,
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    wx.navigateTo({
      url: `/pages/print-upload/print-upload?fileId=${encodeURIComponent(item.id)}&name=${encodeURIComponent(item.name)}&pages=${item.pages}`,
    })
  },

  convertDoc(e) {
    const item = this.data.all.find((entry) => entry.id === String(e.currentTarget.dataset.id || ''))
    if (!item || !item.isWord) return
    if (!this.data.wordConversionAvailable) {
      wx.showModal({
        title: '暂不能转 PDF',
        content: this.data.wordConversionCopy || conversion.WORD_CONVERSION_UNAVAILABLE_COPY,
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    if (this.data.convertingId) return
    this._stopConvertCountdown()
    this.setData({ convertingId: item.id, convertResult: null, convertCountdown: '', convertExpired: false })
    wx.showLoading({ title: '正在转换为 PDF…', mask: true })
    api.convertDocumentToPdf(item.id)
      .then((raw) => {
        wx.hideLoading()
        const result = conversion.formatConvertResult(raw, item)
        if (!result.fileId || !result.filename) {
          const incomplete = new Error('Word 转 PDF 未返回可预览文件')
          incomplete.code = 'CONVERSION_FAILED'
          throw incomplete
        }
        const countdown = conversion.remainingLabel(result.expiresMs, Date.now())
        this.setData({
          convertingId: '',
          convertResult: result,
          convertCountdown: countdown.text,
          convertExpired: countdown.expired,
        }, () => this._startConvertCountdown())
        this.loadDocuments()
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ convertingId: '' })
        wx.showModal({
          title: '未能转换为 PDF',
          content: conversion.conversionUserMessage(err),
          showCancel: false,
          confirmText: '知道了',
        })
      })
  },

  _startConvertCountdown() {
    this._stopConvertCountdown()
    const tick = () => {
      const result = this.data.convertResult
      if (!result) return
      const countdown = conversion.remainingLabel(result.expiresMs, Date.now())
      this.setData({ convertCountdown: countdown.text, convertExpired: countdown.expired })
      if (countdown.expired) this._stopConvertCountdown()
    }
    tick()
    this._convertCountdownTimer = setInterval(tick, 1000)
  },

  _stopConvertCountdown() {
    if (this._convertCountdownTimer) clearInterval(this._convertCountdownTimer)
    this._convertCountdownTimer = null
  },

  _convertedPdfItem(id) {
    const result = this.data.convertResult
    if (!result || result.fileId !== id) return null
    return {
      id: result.fileId,
      name: result.filename,
      pages: result.pageCount,
      reprintable: result.reprintable !== false,
      isImage: false,
    }
  },

  openConvertedPdf() {
    const result = this.data.convertResult
    if (!result || this.data.convertExpired || this.data.convertingId || this.data.previewing) return
    this.previewDoc(result.fileId)
  },

  reprintConvertedPdf() {
    const result = this.data.convertResult
    if (!result || this.data.convertExpired || this.data.convertingId || this.data.previewing) return
    if (!result.reprintable) return
    this.reprintDoc({ currentTarget: { dataset: { id: result.fileId } } })
  },

  // 预览文件内容
  previewDoc(id) {
    const item = this.data.all.find((entry) => entry.id === id) || this._convertedPdfItem(id)
    if (!item) return
    if (this.data.previewing) return
    this.setData({ previewing: true })
    wx.showLoading({ title: '加载预览…', mask: true })
    api.getFilePreviewUrl(item.id)
      .then((res) => {
        // 服务端返回的是相对路径，wx API 只接受绝对地址（见 utils/file-url.js）
        // 必须用 url 而非 printFileUrl。file.types.ts:122 明写：
        // printFileUrl 是「系统 HMAC content URL，仅供 /print/jobs 使用；
        // url 只用于预览/下载」。两者签名方案不同，拿 printFileUrl 去预览
        // 会被 verifyFileSignature 判为无效签名 → 401 → 图片加载失败。
        const url = fileUrls.absoluteUrl(res && (res.url || res.previewUrl))
        if (!url) throw new Error('服务端未返回预览链接')
        if (item.isImage) {
          wx.hideLoading()
          this.setData({ previewing: false })
          wx.previewImage({ urls: [url], current: url })
        } else {
          wx.downloadFile({
            url,
            success: (dl) => {
              wx.hideLoading()
              this.setData({ previewing: false })
              if (dl.statusCode === 200) {
                wx.openDocument({
                  filePath: dl.tempFilePath,
                  showMenu: true,
                  fail: () => wx.showToast({ title: '无法打开此文件', icon: 'none' }),
                })
              } else {
                wx.showToast({ title: '下载失败，请重试', icon: 'none' })
              }
            },
            fail: () => {
              wx.hideLoading()
              this.setData({ previewing: false })
              wx.showToast({ title: '下载失败，请重试', icon: 'none' })
            },
          })
        }
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ previewing: false })
        wx.showToast({ title: (err && err.message) || '预览失败', icon: 'none' })
      })
  },

  /**
   * 修改保存期限。可选项只用 item.allowedRetentionPolicies（服务端算的）。
   * months_6 / long_term 属延长保存，服务端要求 consentVersion——
   * 必须先把条款给用户看、由他明确确认，再带版本号。
   * 在代码里默认补版本号等于替用户签字。
   */
  chooseRetention(item) {
    const options = item.allowedRetentionPolicies || []
    if (options.length < 2) return
    const labels = options.map((k) => conversion.RETENTION_LABEL[k] || k)
    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        const next = options[res.tapIndex]
        if (!next || next === item.retentionPolicy) return
        if (conversion.RETENTION_NEEDS_CONSENT.indexOf(next) === -1) {
          this._applyRetention(item.id, next, '')
          return
        }
        wx.showModal({
          title: '延长保存需要你确认',
          content: `选择「${conversion.RETENTION_LABEL[next]}」后，这份文件会在服务器上保存更久。你可以随时改回更短的期限或直接删除文件。确认后才会生效。`,
          confirmText: '我已阅读并确认',
          cancelText: '再想想',
          success: (m) => {
            if (!m.confirm) return
            this._applyRetention(item.id, next, conversion.RETENTION_CONSENT_VERSION)
          },
        })
      },
    })
  },

  _applyRetention(fileId, policy, consentVersion) {
    wx.showLoading({ title: '正在保存…', mask: true })
    api.updateFileRetention(fileId, policy, consentVersion)
      .then(() => {
        wx.hideLoading()
        // 不在本地推算新的到期日期——天数规则在服务端(months_3=90 天等)，
        // 前端算一遍必然漂移。重新拉列表，显示服务端的真实结果。
        wx.showToast({ title: '已保存', icon: 'success' })
        this.loadDocuments()
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showModal({
          title: '未能修改保存期限',
          content: (err && err.message) || '请稍后重试',
          showCancel: false,
          confirmText: '知道了',
        })
      })
  },

  more(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const item = this.data.all.find((entry) => entry.id === id)
    if (!item) return
    // 只有服务端给了两个及以上可选项时才出「修改保存期限」——
    // 证件照/签名/合同被锁死在 system_short，摆一个点进去必被打回的入口
    // 等于假装这个文件的保存期限可改。
    const canChangeRetention = !item.retentionLocked
    const itemList = ['预览文件']
    if (item.isWord) itemList.push('转 PDF')
    itemList.push(item.reprintable ? '发起打印' : conversion.DOCUMENT_NOT_REPRINTABLE_COPY)
    if (canChangeRetention) itemList.push('修改保存期限')
    itemList.push('删除文件')
    const CONVERT_IDX = item.isWord ? 1 : -1
    const PRINT_IDX = item.isWord ? 2 : 1
    const RETENTION_IDX = canChangeRetention ? PRINT_IDX + 1 : -1
    const DELETE_IDX = canChangeRetention ? PRINT_IDX + 2 : PRINT_IDX + 1

    wx.showActionSheet({
      itemList,
      success: (res) => {
        if (res.tapIndex === 0) {
          this.previewDoc(id)
          return
        }
        if (res.tapIndex === CONVERT_IDX) {
          this.convertDoc({ currentTarget: { dataset: { id } } })
          return
        }
        if (res.tapIndex === PRINT_IDX) {
          this.reprintDoc({ currentTarget: { dataset: { id } } })
          return
        }
        if (res.tapIndex === RETENTION_IDX) {
          this.chooseRetention(item)
          return
        }
        if (res.tapIndex !== DELETE_IDX) return
        wx.showModal({
          title: '删除文件',
          content: `确认删除"${item.name}"？文件内容将被删除，系统仅保留必要的删除审计。`,
          confirmText: '删除',
          confirmColor: '#b5643c',
          success: (modal) => {
            if (!modal.confirm) return
            api.deleteMyDocument(id)
              .then(() => {
                wx.showToast({ title: '已删除', icon: 'success' })
                this.loadDocuments()
              })
              .catch((err) => wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' }))
          },
        })
      },
    })
  },

  // 原来只有 wx.chooseMessageFile 一条路径。该 API 只能从「微信聊天会话」里选文件，
  // 小程序没有直接调起手机文件管理器的能力——意味着手机里没有电子版文件的用户
  // （身份证、体检表、工牌这类只有纸质原件的材料）必须先退出小程序、
  // 把照片发给文件传输助手、再回来重选。这是打印链路上最靠前也最致命的流失点。
  // 补一条拍照/相册路径，后端 /files/kiosk-upload 对来源无假设，不需要改服务端。
  upload() {
    if (this.data.uploading) return
    wx.showActionSheet({
      itemList: ['拍照或从相册选择', '从微信聊天中选择文件'],
      success: (res) => {
        if (res.tapIndex === 0) this._pickFromCamera()
        else this._pickFromChat()
      },
    })
  },

  _pickFromCamera() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['original'], // 打印件不能压缩，压过的图打出来会糊
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file || !file.tempFilePath) return
        // 拍照/相册的临时文件本来就没有有意义的原名（tmp_8a3f… 这类），
        // 直传上去列表里就是一串字母数字。这里按来源和时间生成可读名——
        // 不是编造原名，而是如实描述这份文件是什么时候拍的。
        // 扩展名必须沿用临时文件的真实扩展名，改了会被后端魔数校验打回。
        const ext = uploadNames.extOf(file.tempFilePath) || 'jpg'
        this._doUpload(file.tempFilePath, uploadNames.cameraFileName(ext))
      },
    })
  },

  _pickFromChat() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf', 'jpg', 'jpeg', 'png'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file || !file.path) return
        // file.name 才是用户在聊天里看到的真实文件名；file.path 是 tmp_xxx 临时名。
        // 之前只把 path 传下去，真实文件名就是在这一行丢掉的。
        this._doUpload(file.path, uploadNames.pickedFileName(file.name, file.path))
      },
    })
  },

  _doUpload(filePath, displayName) {
    this.setData({ uploading: true })
    wx.showLoading({ title: '正在上传…', mask: true })
    api.uploadPrintFile(filePath, displayName)
      .then(() => {
        wx.hideLoading()
        this.setData({ uploading: false })
        wx.showToast({ title: '文件已上传', icon: 'success' })
        this.loadDocuments()
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ uploading: false })
        wx.showModal({
          title: '上传失败',
          content: (err && err.message) || '网络异常，请稍后重试',
          showCancel: false,
        })
      })
  },

  back() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
