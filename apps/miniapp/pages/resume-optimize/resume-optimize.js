const app = getApp()
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')
const normalize = require('../../utils/normalize.js')

/**
 * resume-optimize 真实化 — Phase S0C Task#3
 *
 * 删掉的三类伪造(不得恢复):
 *   1. setTimeout 2.5s 后写死 status:'done'
 *   2. 硬编码的 diffs 数组(含虚构工作经历和技能数据)
 *   3. 硬编码的 mergedText 字符串
 *
 * 修复的参数读取错误:
 *   - options.resumeId → options.taskId (导航传参统一为 ?taskId=)
 *
 * 三类后端失败模式:
 *   200 + status:'failed' + failReason    ─ LLM 两次 paraphrase 被防编造校验拒绝;
 *                                           或简历原文已按隐私策略清理
 *   503 AI_OPTIMIZE_INVALID_OUTPUT        ─ 同上(兜底 503)
 *   503 AI_PROVIDER_NOT_CONFIGURED        ─ 模型未配置
 *   404 AI_TASK_NOT_FOUND                 ─ taskId 不存在或无权访问
 *
 * 模型输出未通过真实性校验时进入 failed,页面不自动重试,也不预测重试成功率。
 *
 * 后端没有导出与 PDF 生成端点，因此本页只展示真实优化对照。
 */
Page({
  data: {
    statusBarHeight: 20,
    // phase: no-task | loading | done | failed
    phase: 'no-task',
    taskId: '',
    // failed 时区分原因:true=简历原文已清理,需重新上传; false=LLM 校验失败,可手动重试
    needReupload: false,
    failMsg: '',
    opt: null,         // normalize.resumeOptimize 返回值
    isMock: false,
    fromJobFit: false,
    targetPosition: '',
  },

  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
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
        // failReason 含「简历原文/清理/重新上传」→ 原文已清理,重试无用
        const msg = opt.failReason || '优化生成失败'
        const needReupload = /简历原文|清理|重新上传/.test(msg)
        this._fail(msg, needReupload)
        return
      }
      if (!opt.isCompleted) {
        this._fail('优化任务未完成', false)
        return
      }
      this.setData({ phase: 'done', opt, isMock: opt.isMockProvider })
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
    this.setData({ phase: 'failed', failMsg, needReupload })
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  tapRetry() {
    // 仅 failed + !needReupload 时允许用户主动重试。
    if (this.data.phase !== 'failed' || this.data.needReupload) return
    this.setData({ phase: 'loading', failMsg: '' })
    this._fetch()
  },

  tapReupload() {
    // failed + needReupload → 引导重新上传简历
    wx.navigateTo({
      url: '/pages/resume-parse/resume-parse',
      fail: () => wx.showToast({ title: '页面跳转失败', icon: 'none' }),
    })
  },
})
