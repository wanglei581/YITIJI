const app = getApp()
const api = require('../../utils/api')
const N = require('../../utils/normalize')
const storage = require('../../utils/storage')
const auth = require('../../utils/auth')

/**
 * 岗位匹配参考。
 *
 * 合规红线:后端只输出 fitLevel 三档参考等级(reference_high / medium / low),
 * **没有百分比、匹配率或录用概率字段**,服务端还有双层拦截。
 * 页面此前显示的「76% 参考匹配度」是前端自造的伪造数据,已删除;
 * 不得以任何形式恢复,包括把等级折算成百分比、按优势条数算比例。
 *
 * 流程:需要一份已解析的简历(taskId)→ 用户明确授权 → 才能分析。
 * 授权闸门是后端强制的:未授权直接调分析会 403 JOB_FIT_ANONYMOUS_CONSENT_REQUIRED。
 */
Page({
  data: {
    statusBarHeight: 20,
    // no-task 无已解析简历 | consent 待授权 | target 待确认目标岗位
    // running 分析中 | done 真实结果 | failed 失败
    phase: 'no-task',
    taskId: '',
    resumeName: '',
    jobId: '',
    jobTitleHint: '',
    // 手填目标岗位(没带 jobId 进来时使用)
    manualTitle: '',
    manualReq: '',
    elapsed: 0,
    failMsg: '',
    fit: null,
    printing: false,
    historyMode: false,
  },

  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    const opts = options || {}
    const jobId = opts.jobId || ''
    const hint = opts.jobTitle ? decodeURIComponent(opts.jobTitle) : ''
    const historyTaskId = opts.taskId || ''
    this.setData({
      jobId,
      jobTitleHint: hint,
      taskId: historyTaskId,
      historyMode: !!historyTaskId,
    })

    // 「我的 AI 记录」只包含会员本人结果；按 taskId 直接只读回看，不要求本机还保存最近任务。
    if (historyTaskId) {
      if (!auth.isLoggedIn()) {
        this._fail('登录已失效，请重新登录后查看历史结果')
        return
      }
      this._token = ''
      this._isAnonymousTask = false
      this.setData({ phase: 'history-loading', elapsed: 0 })
      this._loadHistory()
      return
    }

    const saved = storage.get(storage.KEYS.RESUME_TASK)
    if (!saved || !saved.taskId) {
      this.setData({ phase: 'no-task' })
      return
    }
    this._token = saved.accessToken || ''
    this._isAnonymousTask = !!this._token
    this.setData({ taskId: saved.taskId, resumeName: saved.fileName || '' })
    this._checkConsent()
  },

  onUnload() {
    this._stopped = true
    this._stopElapsed()
  },

  onShow() {
    if (!this.data.historyMode || !this._waitingForHistoryLogin || !auth.isLoggedIn()) return
    this._waitingForHistoryLogin = false
    this._stopped = false
    this.setData({ phase: 'history-loading', failMsg: '' })
    this._loadHistory()
  },

  _openHistoryLogin() {
    this._waitingForHistoryLogin = true
    wx.navigateTo({
      url: '/pages/launch/launch',
      fail: () => {
        this._waitingForHistoryLogin = false
        wx.showToast({ title: '登录页面打开失败', icon: 'none' })
      },
    })
  },

  _checkConsent() {
    if (!this._isAnonymousTask && !auth.isLoggedIn()) {
      this._fail('登录已失效，请重新登录后使用岗位匹配参考')
      return
    }
    const request = this._isAnonymousTask
      ? api.getJobFitConsent(this.data.taskId, this._token)
      : api.getMemberJobFitConsent()
    request
      .then((c) => {
        if (this._stopped) return
        if (c && c.active) return this._loadExisting()
        this.setData({ phase: 'consent' })
      })
      .catch(() => {
        if (this._stopped) return
        // 查不到授权状态时按未授权处理,由用户重新授权,不擅自当已授权
        this.setData({ phase: 'consent' })
      })
  },

  /** 已有结果就直接展示,避免重复触发耗时约 37s 的分析 */
  _loadExisting() {
    api.getJobFit(this.data.taskId, this._token)
      .then((res) => {
        if (this._stopped) return
        const fit = N.jobFit(res)
        if (fit && fit.isCompleted && (fit.summary || fit.matchPoints.length)) {
          this.setData({ phase: 'done', fit })
        } else {
          this.setData({ phase: 'target' })
        }
      })
      .catch(() => {
        if (this._stopped) return
        this.setData({ phase: 'target' })
      })
  },

  _loadHistory() {
    api.getJobFit(this.data.taskId, '')
      .then((res) => {
        if (this._stopped) return
        const fit = N.jobFit(res)
        if (fit && fit.isCompleted && (fit.summary || fit.matchPoints.length || fit.gapPoints.length)) {
          this.setData({ phase: 'done', fit })
          return
        }
        this._fail('这条岗位匹配记录没有可展示的结果')
      })
      .catch((err) => {
        if (this._stopped) return
        if ((err && err.statusCode === 401) || !auth.isLoggedIn()) {
          this._fail('登录已失效，请重新登录后查看历史结果')
          return
        }
        this._fail((err && err.message) || '历史岗位匹配结果读取失败')
      })
  },

  tapGrant() {
    wx.showLoading({ title: '提交授权…', mask: true })
    const request = this._isAnonymousTask
      ? api.grantJobFitConsent(this.data.taskId, this._token)
      : api.grantMemberJobFitConsent()
    request
      .then((c) => {
        wx.hideLoading()
        if (this._stopped) return
        if (!c || !c.active) {
          wx.showModal({ title: '授权未生效', content: '请稍后重试', showCancel: false, confirmText: '知道了' })
          return
        }
        this.setData({ phase: 'target' })
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showModal({
          title: '授权失败',
          content: (err && err.message) || '请稍后重试',
          showCancel: false,
          confirmText: '知道了',
        })
      })
  },

  inputTitle(e) { this.setData({ manualTitle: e.detail.value }) },
  inputReq(e) { this.setData({ manualReq: e.detail.value }) },

  tapAnalyze() {
    const { jobId, manualTitle, manualReq } = this.data
    const payload = { taskId: this.data.taskId }
    if (jobId) {
      payload.jobId = jobId
    } else {
      const title = (manualTitle || '').trim()
      if (!title) {
        wx.showToast({ title: '请填写目标岗位名称', icon: 'none' })
        return
      }
      payload.manualJob = { title }
      const req = (manualReq || '').trim()
      if (req) payload.manualJob.requirements = req
    }

    this.setData({ phase: 'running', elapsed: 0, failMsg: '' })
    this._startElapsed()
    api.analyzeJobFit(payload, this._token)
      .then((res) => {
        this._stopElapsed()
        if (this._stopped) return
        const fit = N.jobFit(res)
        if (!fit) return this._fail('返回内容无法解析,请重试')
        if (fit.isFailed) return this._fail(fit.failReason || '分析失败,请重试')
        if (!fit.isCompleted) return this._fail('分析未完成,请重试')
        this.setData({ phase: 'done', fit })
      })
      .catch((err) => {
        this._stopElapsed()
        if (this._stopped) return
        if (err && (err.code === 'JOB_FIT_ANONYMOUS_CONSENT_REQUIRED' || err.code === 'USER_AI_CONSENT_REQUIRED')) {
          this.setData({ phase: 'consent' })
          wx.showToast({ title: '请先完成授权', icon: 'none' })
          return
        }
        this._fail((err && err.message) || '分析失败,请稍后重试')
      })
  },

  _fail(msg) { this.setData({ phase: 'failed', failMsg: msg }) },

  // 已用时长是真实计时,可以显示;进度百分比后端不给,不显示
  _startElapsed() {
    this._stopElapsed()
    this._t0 = Date.now()
    this._timer = setInterval(() => {
      if (this._stopped) return
      this.setData({ elapsed: Math.floor((Date.now() - this._t0) / 1000) })
    }, 1000)
  },
  _stopElapsed() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  },

  /** 列表里的 evidence / suggestion 会被截断,点开看全文 */
  tapText(e) {
    const { title, text } = e.currentTarget.dataset
    if (!text) return
    wx.showModal({ title: title || '详情', content: text, showCancel: false, confirmText: '知道了' })
  },

  /** 生成匹配报告 PDF 交给打印流程。只说「已生成报告」,不声称已下单或已打印。 */
  tapPrint() {
    if (this.data.printing) return
    this.setData({ printing: true })
    wx.showLoading({ title: '正在生成报告…', mask: true })
    api.printJobFitReport(this.data.taskId, this._token)
      .then((res) => {
        wx.hideLoading()
        this.setData({ printing: false })
        if (this._stopped) return
        const name = encodeURIComponent((res && res.filename) || '岗位匹配决策报告.pdf')
        const fid = encodeURIComponent((res && res.fileId) || '')
        const pages = (res && res.pageCount) || ''
        wx.navigateTo({ url: `/pages/print-upload/print-upload?name=${name}&fileId=${fid}&pages=${pages}` })
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ printing: false })
        wx.showModal({
          title: '生成报告失败',
          content: (err && err.message) || '请稍后重试',
          showCancel: false,
          confirmText: '知道了',
        })
      })
  },

  /** 只有系统内岗位(jobId 模式)有详情页,手填岗位没有 */
  tapViewJob() {
    const id = this.data.jobId || (this.data.fit && this.data.fit.job.id)
    if (!id) {
      wx.showToast({ title: '手填岗位没有详情页', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${id}` })
  },

  tapOptimizeResume() {
    if (this.data.historyMode) {
      wx.showToast({ title: '历史结果只读，请从当前简历重新发起优化', icon: 'none' })
      return
    }
    const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
    if (!saved.taskId || saved.taskId !== this.data.taskId) {
      wx.showToast({ title: '简历任务已失效，请重新上传', icon: 'none' })
      return
    }
    const position = encodeURIComponent((this.data.fit && this.data.fit.job.title) || this.data.jobTitleHint || '')
    wx.navigateTo({
      url: `/pages/resume-optimize/resume-optimize?taskId=${encodeURIComponent(this.data.taskId)}&from=jobFit&position=${position}`,
    })
  },

  tapPracticeInterview() {
    const position = encodeURIComponent((this.data.fit && this.data.fit.job.title) || this.data.jobTitleHint || this.data.manualTitle || '')
    wx.navigateTo({ url: `/pages/interview-entry/interview-entry?position=${position}&from=jobFit` })
  },

  tapRevokeConsent() {
    wx.showModal({
      title: '撤销岗位分析授权',
      content: this._isAnonymousTask
        ? '撤销后，这份匿名简历不能再次用于岗位分析，重新授权后可继续。'
        : '撤销后，账号内简历不能再次用于岗位 AI 分析，重新授权后可继续。',
      confirmText: '确认撤销',
      confirmColor: '#b5643c',
      success: (modal) => {
        if (!modal.confirm) return
        wx.showLoading({ title: '正在撤销…', mask: true })
        const request = this._isAnonymousTask
          ? api.revokeJobFitConsent(this.data.taskId, this._token)
          : api.revokeMemberJobFitConsent()
        request.then(() => {
          wx.hideLoading()
          if (this._stopped) return
          this.setData({ phase: 'consent' })
          wx.showToast({ title: '授权已撤销', icon: 'none' })
        }).catch((err) => {
          wx.hideLoading()
          wx.showToast({ title: (err && err.message) || '撤销失败，请重试', icon: 'none' })
        })
      },
    })
  },

  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
  toUpload() { wx.navigateTo({ url: '/pages/resume-upload/resume-upload' }) },
  retry() {
    if (this.data.historyMode) {
      if (!auth.isLoggedIn()) {
        this._openHistoryLogin()
        return
      }
      this.setData({ phase: 'history-loading', failMsg: '' })
      this._loadHistory()
      return
    }
    if (!this._isAnonymousTask && !auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/launch/launch' })
      return
    }
    this.setData({ failMsg: '' })
    this._checkConsent()
  },

  onShareAppMessage() {
    return { title: '岗位匹配参考', path: '/pages/job-fit/job-fit' }
  },
})
