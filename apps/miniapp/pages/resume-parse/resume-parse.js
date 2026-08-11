const app = getApp()
const api = require('../../utils/api')
const storage = require('../../utils/storage')

/**
 * 本次解析包含的环节。
 * 合规:后端只返回 pending/processing/completed/failed 一个总状态,
 * **不返回分阶段进度**。所以这里只作为"AI 会检查什么"的说明列出,
 * 绝不逐项标"已完成"——那是伪造进度。
 */
const STAGE_DEFS = [
  { id: 'ocr', label: '文字识别', desc: '从 PDF / 图片中抽取文本' },
  { id: 'struct', label: '结构解析', desc: '识别基本信息、经历、技能等分区' },
  { id: 'understand', label: '内容理解', desc: '理解经历表述与成果描述' },
  { id: 'assess', label: '维度评估', desc: '按 6 个维度给出得分与建议' },
]

// 轮询节奏:后端实测常同步返回 completed;异步时按 3s 一次,最多约 2 分钟
const POLL_INTERVAL = 3000
const POLL_MAX = 40

Page({
  data: {
    statusBarHeight: 20,
    phase: 'parsing', // parsing | failed | missing
    elapsed: 0,
    atext: '正在提交解析…',
    stages: STAGE_DEFS,
    done: false,
    failMsg: '',
    // 解析参数,重试用
    fileId: '',
    fileName: '',
    fileFormat: '',
    source: 'upload',
  },

  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })

    const fileId = options.fileId || ''
    const fileName = options.fileName ? decodeURIComponent(options.fileName) : ''
    const fileFormat = options.fileFormat ? decodeURIComponent(options.fileFormat) : ''
    const source = options.source || 'upload'

    // 没有 fileId 说明不是从上传流程进来的。后端解析必须有真实文件,
    // 不允许在这里凭空开始一段"解析"动画。
    if (!fileId) {
      this.setData({
        phase: 'missing',
        atext: '缺少待解析的简历文件',
      })
      return
    }

    this.setData({ fileId, fileName, fileFormat, source })
    this._startElapsed()
    this._submit()
  },

  onUnload() {
    this._stopped = true
    if (this._elapsedTimer) clearInterval(this._elapsedTimer)
    if (this._pollTimer) clearTimeout(this._pollTimer)
  },

  /** 已用时长是真实计时,可以显示;百分比不是,不显示。 */
  _startElapsed() {
    this._elapsedTimer = setInterval(() => {
      if (this._stopped) return
      this.setData({ elapsed: this.data.elapsed + 1 })
    }, 1000)
  },

  _submit() {
    this.setData({ atext: '正在解析简历,请勿离开…' })
    api.parseResume({
      fileId: this.data.fileId,
      fileName: this.data.fileName || `resume.${this.data.fileFormat || 'pdf'}`,
      fileFormat: this.data.fileFormat || 'pdf',
      source: this.data.source === 'scan' ? 'scan' : 'upload',
    })
      .then((res) => this._handle(res, 0))
      .catch((err) => this._fail(err))
  },

  /**
   * 处理解析响应(裸响应:顶层直接是 taskId/status/report)。
   * accessToken 只在提交时下发一次,必须先落地再做任何跳转,
   * 否则页面被切走就永久丢失读取权限。
   */
  _handle(res, round) {
    if (this._stopped || !res) return

    if (res.accessToken && res.taskId) {
      storage.set(storage.KEYS.RESUME_TASK, {
        taskId: res.taskId,
        accessToken: res.accessToken,
        fileName: this.data.fileName,
        ts: Date.now(),
      })
    }

    const status = res.status

    if (status === 'completed') {
      this.setData({ done: true, atext: '解析完成' })
      setTimeout(() => {
        if (this._stopped) return
        wx.redirectTo({
          url: `/pages/resume-diagnose/resume-diagnose?taskId=${encodeURIComponent(res.taskId || '')}`,
        })
      }, 500)
      return
    }

    if (status === 'failed') {
      this._fail(new Error(res.failReason || 'AI 解析未能完成'))
      return
    }

    // pending / processing:继续轮询
    if (round >= POLL_MAX) {
      this._fail(new Error('解析耗时超出预期,请稍后在「我的 - AI 服务记录」查看结果或重试'))
      return
    }

    const taskId = res.taskId
    if (!taskId) {
      this._fail(new Error('解析已提交但未返回任务标识,请重试'))
      return
    }

    this.setData({ atext: '正在解析简历,请勿离开…' })
    this._pollTimer = setTimeout(() => {
      if (this._stopped) return
      const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
      const token = saved.taskId === taskId ? saved.accessToken : ''
      api.getResumeRecord(taskId, token)
        .then((r) => this._handle(r, round + 1))
        .catch((err) => this._fail(err))
    }, POLL_INTERVAL)
  },

  _fail(err) {
    if (this._stopped) return
    if (this._elapsedTimer) clearInterval(this._elapsedTimer)
    this.setData({
      phase: 'failed',
      failMsg: (err && err.message) || '解析失败,请稍后重试',
    })
  },

  retry() {
    if (this.data.phase === 'missing') {
      wx.redirectTo({ url: '/pages/resume-upload/resume-upload' })
      return
    }
    // 同一个 fileId 仍在有效期内(后端约 30 分钟)可直接重提;过期会由后端报错
    this.setData({ phase: 'parsing', failMsg: '', elapsed: 0 })
    this._stopped = false
    this._startElapsed()
    this._submit()
  },

  toUpload() {
    wx.redirectTo({ url: '/pages/resume-upload/resume-upload' })
  },

  back() {
    this._stopped = true
    if (this._elapsedTimer) clearInterval(this._elapsedTimer)
    if (this._pollTimer) clearTimeout(this._pollTimer)
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },
})
