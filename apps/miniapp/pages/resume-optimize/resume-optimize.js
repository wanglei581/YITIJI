const app = getApp()
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')
const normalize = require('../../utils/normalize.js')
const auth = require('../../utils/auth.js')
const buildModel = require('../../utils/resume-build-model.js')
const fileUrls = require('../../utils/file-url.js')

const FORMATS = [
  { key: 'pdf', label: 'PDF', mimeType: 'application/pdf' },
  { key: 'docx', label: 'DOCX', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { key: 'txt', label: 'TXT', mimeType: 'text/plain' },
  { key: 'md', label: 'Markdown', mimeType: 'text/markdown' },
]

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatExpiry(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return '以服务端签名链接为准'
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${min}`
}

function fileIdFromPrintUrl(url) {
  const match = /\/files\/([^/?]+)\/content(?:\?|$)/.exec(String(url || ''))
  return match ? decodeURIComponent(match[1]) : ''
}

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
 * 导出复用现有 POST /resume/generate/export。四种下载格式都由同一份
 * optimizedResume 生成；打印/预览统一使用响应里的同内容 PDF 副本。
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
    formats: FORMATS,
    format: 'pdf',
    exporting: false,
    opening: false,
    exportResult: null,
    exportDisabledReason: '',
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
      this.setData({
        phase: 'done',
        opt,
        isMock: opt.isMockProvider,
        exportDisabledReason: opt.hasOptimizedResume ? '' : '服务端没有返回结构化优化稿，暂时不能生成文件。',
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

  pickFormat(e) {
    if (this.data.exporting) return
    const format = String(e.currentTarget.dataset.format || '')
    if (!FORMATS.some((item) => item.key === format)) return
    this.setData({ format, exportResult: null })
  },

  exportResume() {
    if (this.data.exporting) return
    const opt = this.data.opt
    if (!opt || !opt.optimizedResume) {
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

    const format = this.data.format
    const payload = buildModel.buildExportPayload(opt.optimizedResume, { format, taskId: this.data.taskId })
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
        const definition = FORMATS.find((item) => item.key === format) || {}
        const result = {
          fileId: res.fileId,
          printFileId: fileIdFromPrintUrl(res.printFileUrl),
          filename: res.filename,
          mimeType: definition.mimeType || '',
          formatLabel: definition.label || format.toUpperCase(),
          sizeLabel: formatBytes(res.sizeBytes),
          pageLabel: Number(res.pageCount) > 0 ? `${res.pageCount} 页` : '非分页格式',
          expiresLabel: formatExpiry(res.expiresAt),
          pdfUrl: fileUrls.absoluteUrl(res.printFileUrl),
          printFileUrl: res.printFileUrl,
          savedToDocuments: true,
        }
        if (!result.pdfUrl || !result.printFileId) throw new Error('打印用 PDF 副本地址无效')
        this.setData({ exporting: false, exportResult: result })
        this._openPdf(result)
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ exporting: false })
        wx.showModal({ title: '未能生成文件', content: (err && err.message) || '请稍后重试', showCancel: false })
      })
  },

  openPdf() {
    if (this.data.exportResult) this._openPdf(this.data.exportResult)
  },

  _openPdf(result) {
    if (this.data.opening || !result.pdfUrl) return
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

  printExport() {
    const result = this.data.exportResult
    if (!result || !result.printFileId) return
    const printName = result.filename.replace(/\.[^.]+$/, '') + '_打印副本.pdf'
    wx.navigateTo({
      url: `/pages/print-upload/print-upload?fileId=${encodeURIComponent(result.printFileId)}&name=${encodeURIComponent(printName)}&printFileUrl=${encodeURIComponent(result.printFileUrl)}`,
    })
  },

  viewDocuments() { wx.navigateTo({ url: '/pages/documents/documents' }) },
})
