const app = getApp()
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')
const normalize = require('../../utils/normalize.js')
const auth = require('../../utils/auth.js')
const buildModel = require('../../utils/resume-build-model.js')
const fileUrls = require('../../utils/file-url.js')
const draft = require('./draft')
const factCheck = require('./fact-check')

const FORMATS = [
  { key: 'pdf', label: 'PDF', mimeType: 'application/pdf' },
  { key: 'docx', label: 'DOCX', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { key: 'txt', label: 'TXT', mimeType: 'text/plain' },
  { key: 'md', label: 'Markdown', mimeType: 'text/markdown' },
]

/** 优化页接线：导出 / 草稿 / 事实核对。对照只读，编辑区才进草稿与导出。 */
Page({
  data: {
    statusBarHeight: 20,
    phase: 'no-task',
    taskId: '',
    needReupload: false,
    failMsg: '',
    opt: null,
    isMock: false,
    fromJobFit: false,
    targetPosition: '',
    formats: FORMATS,
    format: 'pdf',
    exporting: false,
    opening: false,
    exportResult: null,
    exportDisabledReason: '',
    pricingStatus: 'loading',
    pricing: { mode: 'unavailable', text: '正在确认导出价格…', disabledReason: '正在确认导出价格，请稍候。' },
    benefitGrantId: '',
    exportDisabled: true,
    exportCountdown: '',
    exportExpired: false,
    loggedIn: false,
    editor: draft.resumeToEditor(null),
    draftReady: false,
    draftKind: 'guest',
    draftStatus: '未登录不保存',
    versions: { latestLabel: '', items: [], empty: true },
    versionsHint: '',
    openingVersion: false,
    factPanel: factCheck.closedPanel(),
    factsBlockedReason: '',
    LEN: buildModel.LEN,
  },

  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20, loggedIn: auth.isLoggedIn() })
    this._loadPricing()
    const taskId = options.taskId || ''
    if (!taskId) {
      this.setData({ phase: 'no-task' })
      return
    }
    this.setData({
      taskId,
      phase: 'loading',
      fromJobFit: options.from === 'jobFit',
      targetPosition: options.position ? decodeURIComponent(options.position) : '',
    })
    this._fetch()
  },

  onUnload() {
    this._gone = true
    this._stopExportCountdown()
    if (this._saver) this._saver.flush()
  },

  async _fetch() {
    const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
    const accessToken = saved && saved.taskId === this.data.taskId ? (saved.accessToken || '') : ''
    try {
      const raw = await api.getResumeOptimize(this.data.taskId, accessToken)
      const opt = normalize.resumeOptimize(raw)
      if (!opt) {
        this._fail('优化结果格式异常', false)
        return
      }
      if (opt.isFailed) {
        const msg = opt.failReason || '优化生成失败'
        const needReupload = /简历原文|清理|重新上传/.test(msg)
        this._fail(msg, needReupload)
        return
      }
      if (!opt.isCompleted) {
        this._fail('优化任务未完成', false)
        return
      }
      this._serverResume = draft.clone(opt.optimizedResume || {})
      this._resume = draft.clone(this._serverResume)
      this._editor = draft.resumeToEditor(this._resume)
      this.setData({
        phase: 'done',
        opt,
        isMock: opt.isMockProvider,
        editor: this._editor,
      }, () => {
        this._syncExportAvailability()
        this._bootDraft()
        this._loadVersions()
      })
    } catch (err) {
      const code = (err && err.code) || ''
      if (code === 'AI_TASK_NOT_FOUND') {
        this._fail('优化记录不存在或无权访问', false)
      } else if (code === 'AI_PROVIDER_NOT_CONFIGURED') {
        this._fail('AI 优化模型尚未配置，请联系管理员', false)
      } else if (code === 'AI_OPTIMIZE_INVALID_OUTPUT' || code === 'AI_OPTIMIZE_UNAVAILABLE') {
        this._fail('AI 优化服务暂时不可用，请稍后重试', false)
      } else {
        this._fail((err && err.message) || '加载失败，请返回重试', false)
      }
    }
  },

  _fail(failMsg, needReupload) {
    this.setData({ phase: 'failed', failMsg, needReupload }, () => this._syncExportAvailability())
  },

  _bootDraft() {
    const loggedIn = auth.isLoggedIn()
    this._draftExtras = {}
    this._saver = draft.createAutosave({
      isLoggedIn: () => auth.isLoggedIn() && this._draftWritable,
      getTaskId: () => this.data.taskId,
      getPayload: () => draft.buildDraftPutBody(this._resume, this._draftExtras),
      put: (taskId, payload) => api.putResumeDraft(taskId, payload),
      onResponse: (res) => { this._draftExtras = draft.mergeDraftExtras(this._draftExtras, res) },
      onStatus: (kind, iso, err) => {
        if (this._gone) return
        const text = kind === 'failed' ? draft.explainSaveError(err) : draft.statusText(kind, iso)
        this.setData({ draftKind: kind, draftStatus: text })
      },
    })
    if (!loggedIn) {
      this._draftWritable = false
      this.setData({ loggedIn: false, draftReady: true, draftKind: 'guest', draftStatus: draft.statusText('guest') })
      return
    }
    this.setData({ loggedIn: true, draftKind: 'saving', draftStatus: '正在读取草稿…' })
    draft.restoreDraft(api, this.data.taskId).then((result) => {
      if (this._gone) return
      this._draftWritable = result.writable
      this._draftExtras = result.extras || {}
      if (result.resume) {
        this._resume = result.resume
        this._editor = draft.resumeToEditor(this._resume)
        this.setData({ editor: this._editor })
      }
      this.setData({ draftReady: true, draftKind: result.kind, draftStatus: result.text })
    })
  },

  _loadVersions() {
    if (!auth.isLoggedIn()) {
      this.setData({ versions: { latestLabel: '', items: [], empty: true }, versionsHint: '登录后可查看已确认的导出版本。' })
      return
    }
    api.getResumeVersions(this.data.taskId)
      .then((res) => {
        if (this._gone) return
        const versions = draft.formatVersions(res)
        this.setData({
          versions,
          versionsHint: versions.empty ? '还没有已确认的导出版本。成功导出后会出现在这里。' : '',
        })
      })
      .catch((err) => {
        if (this._gone) return
        this.setData({
          versions: { latestLabel: '', items: [], empty: true },
          versionsHint: (err && err.message) || '读取已确认版本失败',
        })
      })
  },

  onDraftInput(e) {
    const ds = e.currentTarget.dataset
    this._editor = draft.applyInput(this._editor, ds.section, ds.key, ds.index, e.detail.value)
    this._resume = draft.editorToResume(this._editor)
    this._factsConfirmedAt = ''
    this._factsNeedRecheck = true
    this.setData({ factsBlockedReason: '' }, () => this._syncExportAvailability())
    if (!auth.isLoggedIn()) {
      this.setData({ draftKind: 'guest', draftStatus: draft.statusText('guest') })
      return
    }
    if (!this._draftWritable) {
      this.setData({ draftKind: 'unbound', draftStatus: draft.statusText('unbound') })
      return
    }
    if (this._saver) this._saver.schedule()
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
        const pricing = normalize.resumeExportPricing(raw, loggedIn)
        let benefitGrantId = ''
        if (pricing.mode === 'charged' && loggedIn && pricing.available > 0) {
          const benefits = await api.getMyBenefits({ pageSize: 50 })
          benefitGrantId = normalize.resumeExportBenefitId(benefits)
          if (!benefitGrantId) pricing.disabledReason = '服务端显示有可用次数，但未找到可核销权益，请刷新后重试。'
        }
        if (this._gone || seq !== this._pricingSeq) return
        this.setData({ pricingStatus: 'ready', pricing, benefitGrantId }, () => this._syncExportAvailability())
      })
      .catch((err) => {
        if (this._gone || seq !== this._pricingSeq) return
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
    if (this.data.phase !== 'done') reason = '优化失败或尚未完成，暂时不能导出。'
    else if (!this.data.opt || !this.data.opt.hasOptimizedResume) reason = '服务端没有返回结构化优化稿，暂时不能生成文件。'
    else if (this.data.pricingStatus !== 'ready') reason = this.data.pricing.disabledReason || '正在确认导出价格，请稍候。'
    else if (this.data.pricing.disabledReason) reason = this.data.pricing.disabledReason
    else if (this.data.pricing.mode === 'charged' && !this.data.benefitGrantId) reason = '未取得可核销权益，当前不能导出。'
    else if (this.data.factsBlockedReason) reason = this.data.factsBlockedReason
    this.setData({ exportDisabled: Boolean(reason), exportDisabledReason: reason })
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  tapRetry() {
    if (this.data.phase !== 'failed' || this.data.needReupload) return
    this.setData({ phase: 'loading', failMsg: '' })
    this._fetch()
  },

  tapReupload() {
    wx.navigateTo({
      url: '/pages/resume-parse/resume-parse',
      fail: () => wx.showToast({ title: '页面跳转失败', icon: 'none' }),
    })
  },

  pickFormat(e) {
    if (this.data.exporting) return
    const format = String(e.currentTarget.dataset.format || '')
    if (!FORMATS.some((item) => item.key === format)) return
    this.setData({ format, exportResult: null })
  },

  exportResume() {
    if (this.data.exporting) return
    if (this.data.exportDisabled) {
      wx.showModal({ title: '暂时不能导出', content: this.data.exportDisabledReason, showCancel: false })
      return
    }
    const resume = this._resume || (this.data.opt && this.data.opt.optimizedResume)
    if (!resume) {
      wx.showModal({ title: '暂时无法导出', content: '服务端没有返回结构化优化稿。本页只展示现有对照，不会用空内容生成文件。', showCancel: false })
      return
    }
    if (!auth.isLoggedIn()) {
      wx.showModal({
        title: '需要登录',
        content: '导出文件需要归到本人账号，才能真实存入「我的文档」并进入打印流程。',
        confirmText: '去登录',
        cancelText: '取消',
        success: (res) => { if (res.confirm) wx.navigateTo({ url: '/pages/launch/launch' }) },
      })
      return
    }
    if (this._factsConfirmedAt && !this._factsNeedRecheck) {
      this._doExport(this._factsConfirmedAt)
      return
    }
    this._startFactCheck()
  },

  _startFactCheck() {
    this.setData({ factPanel: factCheck.loadingPanel() })
    const run = () => api.factCheckResume(this.data.taskId)
      .then((res) => {
        if (this._gone) return
        const panel = factCheck.openPanel(res)
        this._factsNeedRecheck = false
        this.setData({ factPanel: panel })
        if (!panel.canConfirm) {
          this.setData({ factsBlockedReason: panel.error }, () => this._syncExportAvailability())
        }
      })
      .catch((err) => {
        if (this._gone) return
        const panel = factCheck.errorPanel(err)
        this.setData({ factPanel: panel, factsBlockedReason: panel.error }, () => this._syncExportAvailability())
      })
    const pending = this._saver ? this._saver.flush() : Promise.resolve()
    Promise.resolve(pending).then(run, run)
  },

  toggleFact(e) {
    const key = e.currentTarget.dataset.factKey
    const items = factCheck.toggleItem(this.data.factPanel.items, key)
    this.setData({ 'factPanel.items': items, 'factPanel.pending': factCheck.pendingCount(items) })
  },

  removeFact(e) {
    factCheck.runRemove(this, { draft, auth }, e.currentTarget.dataset.factKey)
  },

  cancelFacts() {
    this.setData({ factPanel: factCheck.closedPanel() })
  },

  confirmFacts() {
    const panel = this.data.factPanel
    if (!panel.canConfirm || panel.loading) return
    if (!factCheck.allConfirmed(panel.items)) {
      wx.showToast({ title: '请先勾选原文未找到的项', icon: 'none' })
      return
    }
    const at = factCheck.nowIso()
    this._factsConfirmedAt = at
    this.setData({ factPanel: factCheck.closedPanel() })
    this._doExport(at)
  },

  _doExport(factsConfirmedAt) {
    const format = this.data.format
    const resume = this._resume || this.data.opt.optimizedResume
    const payload = buildModel.buildExportPayload(resume, { format, taskId: this.data.taskId })
    if (this.data.benefitGrantId) payload.benefitGrantId = this.data.benefitGrantId
    payload.factsConfirmedAt = factsConfirmedAt
    this._stopExportCountdown()
    this.setData({ exporting: true, exportResult: null })
    wx.showLoading({ title: '正在生成文件…', mask: true })
    const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
    const accessToken = saved.taskId === this.data.taskId ? (saved.accessToken || '') : ''
    api.exportGeneratedResume(payload, accessToken)
      .then((res) => {
        wx.hideLoading()
        if (!res || !res.fileId || !res.filename || !res.printFileUrl) {
          throw new Error('服务端未返回完整文件或打印用 PDF 副本')
        }
        const result = draft.toExportResult(res, format, FORMATS, fileUrls.absoluteUrl)
        result.printFileId = draft.fileIdFromPrintUrl(res.printFileUrl)
        result.pdfUrl = fileUrls.absoluteUrl(res.printFileUrl)
        if (!result.pdfUrl || !result.printFileId) throw new Error('打印用 PDF 副本地址无效')
        this.setData({ exporting: false, exportResult: result }, () => this._startExportCountdown())
        if (this.data.pricing.mode === 'charged') this._loadPricing()
        this._loadVersions()
        this._openPdf(result)
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ exporting: false })
        if ((err && err.code) === 'RESUME_FACTS_NOT_CONFIRMED') this._factsConfirmedAt = ''
        wx.showModal({ title: '未能生成文件', content: factCheck.explainExportError(err), showCancel: false })
      })
  },

  openPdf() {
    if (this.data.exportResult) this._openPdf(this.data.exportResult)
  },

  _openPdf(result) {
    if (this.data.opening || this.data.exportExpired || !result.pdfUrl) return
    this.setData({ opening: true })
    wx.showLoading({ title: '正在打开 PDF…', mask: true })
    const finish = () => {
      wx.hideLoading()
      this.setData({ opening: false })
    }
    wx.downloadFile({
      url: result.pdfUrl,
      success: (download) => {
        if (download.statusCode !== 200) {
          finish()
          wx.showModal({ title: 'PDF 打开失败', content: `服务端返回 ${download.statusCode}，文件链接可能已过期。`, showCancel: false })
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

  openVersion(e) {
    const fileId = String(e.currentTarget.dataset.fileId || '')
    const hint = String(e.currentTarget.dataset.openHint || '')
    if (!fileId) {
      wx.showModal({ title: '无法打开', content: hint || '服务端未返回 fileId，也没有其它 signedUrl 字段可打开。', showCancel: false })
      return
    }
    if (this.data.openingVersion) return
    this.setData({ openingVersion: true })
    wx.showLoading({ title: '加载预览…', mask: true })
    const finish = () => {
      wx.hideLoading()
      this.setData({ openingVersion: false })
    }
    api.getFilePreviewUrl(fileId)
      .then((res) => {
        const url = fileUrls.absoluteUrl(res && (res.url || res.previewUrl))
        if (!url) throw new Error('服务端未返回预览链接')
        wx.downloadFile({
          url,
          success: (dl) => {
            if (dl.statusCode !== 200) {
              finish()
              wx.showModal({ title: '打开失败', content: `服务端返回 ${dl.statusCode}，文件链接可能已过期。`, showCancel: false })
              return
            }
            wx.openDocument({
              filePath: dl.tempFilePath,
              showMenu: true,
              success: finish,
              fail: (err) => {
                finish()
                wx.showModal({ title: '无法打开此文件', content: fileUrls.readableDownloadError(err && err.errMsg), showCancel: false })
              },
            })
          },
          fail: (err) => {
            finish()
            wx.showModal({ title: '下载失败', content: fileUrls.readableDownloadError(err && err.errMsg), showCancel: false })
          },
        })
      })
      .catch((err) => {
        finish()
        wx.showModal({ title: '预览失败', content: (err && err.message) || '无法取得预览链接', showCancel: false })
      })
  },

  printExport() {
    const result = this.data.exportResult
    if (!result || this.data.exportExpired || !result.printFileId) return
    const printName = result.filename.replace(/\.[^.]+$/, '') + '_打印副本.pdf'
    wx.navigateTo({
      url: `/pages/print-upload/print-upload?fileId=${encodeURIComponent(result.printFileId)}&name=${encodeURIComponent(printName)}&printFileUrl=${encodeURIComponent(result.printFileUrl)}`,
    })
  },

  _startExportCountdown() {
    this._stopExportCountdown()
    const initial = normalize.resumeExportCountdown(this.data.exportResult && this.data.exportResult.expiresMs)
    this.setData({ exportCountdown: initial.text, exportExpired: initial.expired })
    if (initial.expired) return
    const tick = () => {
      const result = this.data.exportResult
      if (!result) return
      const countdown = normalize.resumeExportCountdown(result.expiresMs)
      this.setData({ exportCountdown: countdown.text, exportExpired: countdown.expired })
      if (countdown.expired) this._stopExportCountdown()
    }
    this._exportCountdownTimer = setInterval(tick, 1000)
  },

  _stopExportCountdown() {
    if (this._exportCountdownTimer) clearInterval(this._exportCountdownTimer)
    this._exportCountdownTimer = null
  },

  viewDocuments() { wx.navigateTo({ url: '/pages/documents/documents' }) },
})
