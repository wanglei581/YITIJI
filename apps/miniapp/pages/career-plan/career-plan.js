const app = getApp()
const api = require('../../utils/api')
const N = require('../../utils/normalize')
const storage = require('../../utils/storage')

/**
 * 职业规划参考。
 *
 * 删掉的三类伪造(不得恢复):
 *   1. setTimeout 2.5s 后写死的假规划(summary / directions / actions 全是前端编的)
 *   2. 学历/工作年限/意向城市/期望方向四个输入框 —— 后端 POST /resume/career-plan/:taskId
 *      **不接受任何 body**,只吃简历 taskId。留着输入框等于向用户承诺"填了会影响结果",
 *      而实际上填什么都被丢掉。这种伪造比假数据更隐蔽,因为界面看起来完全正常。
 *   3. directions[].fitLevel / fitLabel(「高匹配」「中匹配」)—— CareerPlanResponse 的
 *      directions 只有 { title, why, firstStep },后端从来没有"方向匹配度"这个字段。
 *
 * 数据来源:全部来自简历原文。currentSnapshot 每条 evidence 都经服务端逐字校验
 * (必须出自简历原文),校验不过的**条目会被丢掉而不是整体失败**,所以一个
 * status:'completed' 的规划里 currentSnapshot 为空是合法的 —— 页面必须能空着,
 * 不能因为"看起来不完整"就补内容。
 */
Page({
  data: {
    statusBarHeight: 20,
    // no-task 无已解析简历 | ready 可生成 | running 生成中 | done 真实结果 | failed 失败
    phase: 'no-task',
    taskId: '',
    resumeName: '',
    elapsed: 0,
    failMsg: '',
    // 简历原文被清理这类"重试也没用,得重新上传"的失败,要给不同出口
    needReupload: false,
    plan: null,
    printing: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    const saved = storage.get(storage.KEYS.RESUME_TASK)
    if (!saved || !saved.taskId) {
      this.setData({ phase: 'no-task' })
      return
    }
    this._token = saved.accessToken || ''
    this.setData({ taskId: saved.taskId, resumeName: saved.fileName || '' })
    this._loadExisting()
  },

  onUnload() {
    this._stopped = true
    this._stopElapsed()
  },

  /**
   * 先读已有结果,避免重复触发真实模型调用(每次生成都真花钱,且限流 6 次/分钟)。
   * 404 CAREER_PLAN_NOT_FOUND 是正常空态,落到 ready 让用户自己决定是否生成。
   */
  _loadExisting() {
    api.getCareerPlan(this.data.taskId, this._token)
      .then((res) => {
        if (this._stopped) return
        const plan = N.careerPlan(res)
        if (plan && plan.isCompleted && plan.summary) {
          this.setData({ phase: 'done', plan })
        } else {
          this.setData({ phase: 'ready' })
        }
      })
      .catch(() => {
        if (this._stopped) return
        this.setData({ phase: 'ready' })
      })
  },

  tapGenerate() {
    if (this.data.phase === 'running') return
    this.setData({ phase: 'running', elapsed: 0, failMsg: '', needReupload: false })
    this._startElapsed()
    api.generateCareerPlan(this.data.taskId, this._token)
      .then((res) => {
        this._stopElapsed()
        if (this._stopped) return
        const plan = N.careerPlan(res)
        if (!plan) return this._fail('返回内容无法解析,请重试')
        // 200 但 status:'failed' —— 简历原文已按隐私策略清理,重试无用,只能重新上传
        if (plan.isFailed) {
          return this._fail(plan.failReason || '生成失败,请重新上传简历后再试', true)
        }
        if (!plan.isCompleted || !plan.summary) return this._fail('生成未完成,请重试')
        this.setData({ phase: 'done', plan })
      })
      .catch((err) => {
        this._stopElapsed()
        if (this._stopped) return
        this._fail((err && err.message) || '生成失败,请稍后重试')
      })
  },

  _fail(msg, needReupload) {
    this.setData({ phase: 'failed', failMsg: msg, needReupload: !!needReupload })
  },

  // 已用时长是真实计时;后端不给进度,所以不显示任何进度百分比
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

  /** 列表里的长文本会被截断,点开看全文 */
  tapText(e) {
    const { title, text } = e.currentTarget.dataset
    if (!text) return
    wx.showModal({ title: title || '详情', content: text, showCancel: false, confirmText: '知道了' })
  },

  /** 重新生成会再花一次模型调用,先确认 */
  tapRegenerate() {
    wx.showModal({
      title: '重新生成规划',
      content: '将重新调用 AI 生成一份新的规划,覆盖当前结果。',
      confirmText: '重新生成',
      cancelText: '取消',
      success: (r) => { if (r.confirm) this.tapGenerate() },
    })
  },

  tapUpload() {
    wx.navigateTo({ url: '/pages/resume-upload/resume-upload' })
  },

  /**
   * 生成建议单 PDF 交给打印流程。
   * 服务端这一步已把文件落到「我的文档」(purpose:'print_doc'),所以不再需要单独的
   * "保存到我的文档"按钮;但只说「已生成建议单」,不声称已下单或已打印。
   */
  tapPrint() {
    if (this.data.printing) return
    this.setData({ printing: true })
    wx.showLoading({ title: '正在生成建议单…', mask: true })
    api.printCareerPlan(this.data.taskId, this._token)
      .then((res) => {
        wx.hideLoading()
        this.setData({ printing: false })
        if (this._stopped) return
        const name = encodeURIComponent((res && res.filename) || '职业规划建议单.pdf')
        const fid = encodeURIComponent((res && res.fileId) || '')
        const pages = (res && res.pageCount) || ''
        wx.navigateTo({ url: `/pages/print-upload/print-upload?name=${name}&fileId=${fid}&pages=${pages}` })
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ printing: false })
        wx.showModal({
          title: '生成建议单失败',
          content: (err && err.message) || '请稍后重试',
          showCancel: false,
          confirmText: '知道了',
        })
      })
  },

  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  onShareAppMessage() {
    return {
      title: 'AI 职业规划参考',
      path: '/pages/career-plan/career-plan',
    }
  },
})
