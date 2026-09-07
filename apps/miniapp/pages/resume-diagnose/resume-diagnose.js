const app = getApp()
const api = require('../../utils/api')
const storage = require('../../utils/storage')
const N = require('../../utils/normalize')
const auth = require('../../utils/auth')
const fileUrls = require('../../utils/file-url')

// 结果未就绪时的轮询节奏(与解析页一致口径)
const POLL_INTERVAL = 3000
const POLL_MAX = 40

Page({
  data: {
    statusBarHeight: 20,
    // loading:正在取报告 | done:已拿到真实报告 | failed:后端明确失败 | empty:没有可展示的任务
    status: 'loading',
    taskId: '',
    failMsg: '',
    // 报告为 null 时页面不渲染任何结论;真实数据由 normalize.resumeReport 整形
    report: null,
    // 本机是否存有上一次解析任务,用于 empty 态给一个真实可用的入口
    hasSavedTask: false,
    savedFileName: '',
    sourceFileId: '',
    pricingStatus: 'loading',
    pricing: { mode: 'unavailable', text: '正在确认导出价格…', disabledReason: '正在确认导出价格，请稍候。' },
    benefitGrantId: '',
    exportDisabled: true,
    exportDisabledReason: '诊断结果尚未完成，暂时不能导出。',
    exportingKind: '',
    openingPdf: false,
    exportResult: null,
    exportCountdown: '',
    exportExpired: false,
  },

  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this._loadPricing()

    const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
    // 兼容旧入口:早期以 resumeId 进入,但后端诊断是按解析任务(taskId)读取的,
    // 没有"按简历 id 出诊断"的端点,所以只认 taskId,其余一律走空态引导。
    const taskId = options.taskId || ''

    if (taskId) {
      this.setData({
        taskId,
        savedFileName: saved.taskId === taskId ? (saved.fileName || '') : '',
        sourceFileId: saved.taskId === taskId ? (saved.fileId || '') : '',
      })
      this._load(taskId, 0)
      return
    }

    if (saved.taskId) {
      this.setData({ hasSavedTask: true, savedFileName: saved.fileName || '' })
    }
    this.setData({ status: 'empty' })
  },

  onUnload() {
    this._stopped = true
    if (this._pollTimer) clearTimeout(this._pollTimer)
    this._stopExportCountdown()
  },

  /** 读取真实报告。匿名场景必须带 accessToken,否则后端一律 404。 */
  _load(taskId, round) {
    const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
    const token = saved.taskId === taskId ? saved.accessToken : ''

    api.getResumeRecord(taskId, token)
      .then((res) => {
        if (this._stopped) return
        const status = res && res.status

        if (status === 'failed') {
          this.setData({
            status: 'failed',
            failMsg: (res && res.failReason) || 'AI 未能完成本次诊断',
            sourceFileId: (res && res.fileId) || this.data.sourceFileId,
          }, () => this._syncExportAvailability())
          return
        }

        if (status === 'completed') {
          const report = N.resumeReport(res)
          if (!report || !report.hasReport) {
            // 状态是完成但没有维度得分:不编造内容,按失败提示用户重试
            this.setData({
              status: 'failed',
              failMsg: '后端返回的报告缺少评分内容,请重新解析',
            })
            return
          }
          this.setData({ status: 'done', report, sourceFileId: report.fileId || this.data.sourceFileId }, () => this._syncExportAvailability())
          return
        }

        // pending / processing:继续等
        if (round >= POLL_MAX) {
          this.setData({
            status: 'failed',
            failMsg: '诊断结果生成超时,请稍后重试',
          }, () => this._syncExportAvailability())
          return
        }
        this._pollTimer = setTimeout(() => {
          if (this._stopped) return
          this._load(taskId, round + 1)
        }, POLL_INTERVAL)
      })
      .catch((err) => {
        if (this._stopped) return
        // 404 AI_TASK_NOT_FOUND 的真实含义包含"凭证丢失/不属于本人",
        // 这种情况下必须让用户重新上传,而不是让页面停在转圈。
        const notFound = err && (err.statusCode === 404 || err.code === 'AI_TASK_NOT_FOUND')
        this.setData({
          status: 'failed',
          failMsg: notFound
            ? '找不到这份诊断报告(可能凭证已失效),请重新上传简历生成'
            : (err && err.message) || '读取诊断报告失败,请稍后重试',
        }, () => this._syncExportAvailability())
      })
  },

  _loadPricing() {
    const seq = (this._pricingSeq || 0) + 1
    this._pricingSeq = seq
    this.setData({
      pricingStatus: 'loading',
      pricing: { mode: 'unavailable', text: '正在确认导出价格…', disabledReason: '正在确认导出价格，请稍候。' },
      benefitGrantId: '',
    }, () => this._syncExportAvailability())

    const loggedIn = auth.isLoggedIn()
    api.getResumeExportPricing()
      .then(async (raw) => {
        const pricing = N.resumeExportPricing(raw, loggedIn)
        let benefitGrantId = ''
        if (pricing.mode === 'charged' && loggedIn && pricing.available > 0) {
          const benefits = await api.getMyBenefits({ pageSize: 50 })
          benefitGrantId = N.resumeExportBenefitId(benefits)
          if (!benefitGrantId) pricing.disabledReason = '服务端显示有可用次数，但未找到可核销权益，请刷新后重试。'
        }
        if (this._stopped || seq !== this._pricingSeq) return
        this.setData({ pricingStatus: 'ready', pricing, benefitGrantId }, () => this._syncExportAvailability())
      })
      .catch((err) => {
        if (this._stopped || seq !== this._pricingSeq) return
        const reason = (err && err.message) || '暂时无法确认导出价格'
        this.setData({
          pricingStatus: 'failed',
          pricing: { mode: 'unavailable', text: reason, disabledReason: `${reason}，为避免误扣权益，当前不能导出。` },
          benefitGrantId: '',
        }, () => this._syncExportAvailability())
      })
  },

  _syncExportAvailability() {
    let reason = ''
    if (this.data.status !== 'done') reason = '诊断失败或尚未完成，暂时不能导出。'
    else if (this.data.pricingStatus !== 'ready') reason = this.data.pricing.disabledReason || '正在确认导出价格，请稍候。'
    else if (this.data.pricing.disabledReason) reason = this.data.pricing.disabledReason
    else if (this.data.pricing.mode === 'charged' && !this.data.benefitGrantId) reason = '未取得可核销权益，当前不能导出。'
    this.setData({ exportDisabled: Boolean(reason), exportDisabledReason: reason })
  },

  exportReport(e) {
    const kind = String(e.currentTarget.dataset.kind || '')
    if (!['diagnosis_report', 'change_list'].includes(kind) || this.data.exportingKind) return
    if (this.data.exportDisabled) {
      wx.showModal({ title: '暂时不能导出', content: this.data.exportDisabledReason, showCancel: false })
      return
    }
    const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
    const accessToken = saved.taskId === this.data.taskId ? (saved.accessToken || '') : ''
    const label = kind === 'diagnosis_report' ? '诊断报告 PDF' : '修改清单 PDF'
    this._stopExportCountdown()
    this.setData({ exportingKind: kind, exportResult: null, exportCountdown: '', exportExpired: false })
    wx.showLoading({ title: '正在生成 PDF…', mask: true })
    api.exportResumeReport(this.data.taskId, kind, accessToken, this.data.benefitGrantId)
      .then((raw) => {
        wx.hideLoading()
        if (this._stopped) return
        const result = N.resumeExportResult(raw, label)
        if (!result.fileId || !result.filename || result.mimeType !== 'application/pdf' || !result.signedUrl || !result.printFileUrl) {
          throw new Error('服务端未返回完整的 PDF 文件信息')
        }
        this.setData({ exportingKind: '', exportResult: result }, () => this._startExportCountdown())
        if (this.data.pricing.mode === 'charged') this._loadPricing()
      })
      .catch((err) => {
        wx.hideLoading()
        if (this._stopped) return
        this.setData({ exportingKind: '' })
        wx.showModal({ title: '导出失败', content: (err && err.message) || '请稍后重试', showCancel: false })
      })
  },

  _startExportCountdown() {
    this._stopExportCountdown()
    const initial = N.resumeExportCountdown(this.data.exportResult && this.data.exportResult.expiresMs)
    this.setData({ exportCountdown: initial.text, exportExpired: initial.expired })
    if (initial.expired) return
    const tick = () => {
      const result = this.data.exportResult
      if (!result) return
      const countdown = N.resumeExportCountdown(result.expiresMs)
      this.setData({ exportCountdown: countdown.text, exportExpired: countdown.expired })
      if (countdown.expired) this._stopExportCountdown()
    }
    this._exportCountdownTimer = setInterval(tick, 1000)
  },

  _stopExportCountdown() {
    if (this._exportCountdownTimer) clearInterval(this._exportCountdownTimer)
    this._exportCountdownTimer = null
  },

  openExportPdf() {
    const result = this.data.exportResult
    if (!result || this.data.exportExpired || this.data.openingPdf) return
    const url = fileUrls.absoluteUrl(result.signedUrl)
    if (!url) return
    this.setData({ openingPdf: true })
    wx.showLoading({ title: '正在打开 PDF…', mask: true })
    const finish = () => {
      wx.hideLoading()
      this.setData({ openingPdf: false })
    }
    wx.downloadFile({
      url,
      success: (download) => {
        if (download.statusCode !== 200) {
          finish()
          wx.showToast({ title: 'PDF 下载失败', icon: 'none' })
          return
        }
        wx.openDocument({
          filePath: download.tempFilePath,
          fileType: 'pdf',
          showMenu: true,
          success: finish,
          fail: (err) => {
            finish()
            wx.showModal({ title: 'PDF 打开失败', content: fileUrls.readableDownloadError(err && err.errMsg), showCancel: false })
          },
        })
      },
      fail: (err) => {
        finish()
        wx.showModal({ title: 'PDF 下载失败', content: fileUrls.readableDownloadError(err && err.errMsg), showCancel: false })
      },
    })
  },

  printExportPdf() {
    const result = this.data.exportResult
    if (!result || this.data.exportExpired) return
    wx.navigateTo({
      url: `/pages/print-upload/print-upload?fileId=${encodeURIComponent(result.fileId)}&name=${encodeURIComponent(result.filename)}&pages=${encodeURIComponent(result.pageCount || '')}&printFileUrl=${encodeURIComponent(result.printFileUrl)}`,
    })
  },

  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  /** 查看本机存的上一次任务 */
  viewSaved() {
    const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
    if (!saved.taskId) return
    this.setData({
      status: 'loading',
      taskId: saved.taskId,
      failMsg: '',
      savedFileName: saved.fileName || '',
      sourceFileId: saved.fileId || '',
    })
    this._stopped = false
    this._load(saved.taskId, 0)
  },

  toUpload() {
    wx.navigateTo({ url: '/pages/resume-upload/resume-upload' })
  },

  retry() {
    if (!this.data.taskId) {
      this.toUpload()
      return
    }
    this.setData({ status: 'loading', failMsg: '' })
    this._stopped = false
    this._load(this.data.taskId, 0)
  },

  retryDiagnosis() {
    if (!this.data.sourceFileId) {
      this.toUpload()
      return
    }
    const extension = (this.data.savedFileName.split('.').pop() || 'pdf').toLowerCase()
    const query = [
      `fileId=${encodeURIComponent(this.data.sourceFileId)}`,
      `fileName=${encodeURIComponent(this.data.savedFileName || '简历原件.pdf')}`,
      `fileFormat=${encodeURIComponent(extension)}`,
      'source=upload',
    ].join('&')
    wx.redirectTo({ url: `/pages/resume-parse/resume-parse?${query}` })
  },

  /** 展开某条建议/风险的完整内容(长文本在列表里会被截断) */
  tapText(e) {
    const { text, title } = e.currentTarget.dataset
    if (!text) return
    wx.showModal({
      title: title || '详情',
      content: text,
      showCancel: false,
      confirmText: '知道了',
    })
  },

  tapOptimize() {
    // 优化端点由用户点击后触发真实模型调用，taskId 用于归属校验和结果持久化。
    wx.navigateTo({ url: `/pages/resume-optimize/resume-optimize?taskId=${this.data.taskId}` })
  },

  printOriginal() {
    const fileId = this.data.sourceFileId
    if (!fileId) {
      wx.showModal({ title: '原件暂不可打印', content: '本次记录没有可用的原件文件，请重新上传后再打印。', showCancel: false })
      return
    }
    wx.navigateTo({
      url: `/pages/print-upload/print-upload?fileId=${encodeURIComponent(fileId)}&name=${encodeURIComponent(this.data.savedFileName || '简历原件')}`,
    })
  },

  goPrint() { wx.navigateTo({ url: '/pages/print/print' }) },
  viewJobs() { wx.switchTab({ url: '/pages/jobs/jobs' }) },
})
