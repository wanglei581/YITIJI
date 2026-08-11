const app = getApp()
const api = require('../../utils/api')
const storage = require('../../utils/storage')
const N = require('../../utils/normalize')

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
  },

  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })

    const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
    // 兼容旧入口:早期以 resumeId 进入,但后端诊断是按解析任务(taskId)读取的,
    // 没有"按简历 id 出诊断"的端点,所以只认 taskId,其余一律走空态引导。
    const taskId = options.taskId || ''

    if (taskId) {
      this.setData({ taskId })
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
          })
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
          this.setData({ status: 'done', report })
          return
        }

        // pending / processing:继续等
        if (round >= POLL_MAX) {
          this.setData({
            status: 'failed',
            failMsg: '诊断结果生成超时,请稍后重试',
          })
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
        })
      })
  },

  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  /** 查看本机存的上一次任务 */
  viewSaved() {
    const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
    if (!saved.taskId) return
    this.setData({ status: 'loading', taskId: saved.taskId, failMsg: '' })
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
})
