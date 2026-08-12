const app = getApp()
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')

const LEVEL_MAP = {
  needs_work: { label: '需要加强', color: '#e67e22' },
  pass:        { label: '基本合格', color: '#3498db' },
  good:        { label: '表现良好', color: '#1f9e86' },
  excellent:   { label: '表现出色', color: '#16a085' },
}
const SECTION_TITLES = {
  expression:   '表达能力',
  positionFit:  '岗位匹配',
  credibility:  '可信度',
  professional: '专业能力',
  adaptability: '应变能力',
  risks:        '待提升点',
}

Page({
  data: {
    statusBarHeight:  20,
    phase:            'loading', // loading | done | failed
    sessionId:        '',
    accessToken:      '',
    failMsg:          '',
    // done 态
    position:         '',
    interviewerLabel: '',
    overallLabel:     '',
    overallColor:     '#1f9e86',
    overallSummary:   '',
    sections:         [],
    predictedQuestions: [],
    starAdvice:       null,
    checklist:        [],
    printing:         false,
  },
  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    const saved = storage.get(storage.KEYS.INTERVIEW_SESSION) || {}
    const sessionId   = options.sessionId || saved.sessionId   || ''
    const accessToken = saved.accessToken || ''
    if (!sessionId) {
      this.setData({ phase: 'failed', failMsg: '会话不存在，请重新开始面试' })
      return
    }
    this.setData({ sessionId, accessToken })
    this._load()
  },
  async _load() {
    const { sessionId, accessToken } = this.data
    // 先尝试读已生成的报告（回访场景，秒回，避免重复调用 end）
    try {
      const dto = await api.getInterviewReport(sessionId, accessToken)
      if (dto && dto.endedAt && dto.report) { this._render(dto); return }
    } catch (_) { /* 未结束或 404，继续调用 end 生成 */ }
    // 首次结束：生成报告（约 27 秒）
    try {
      const dto = await api.endInterview(sessionId, accessToken)
      this._render(dto)
    } catch (err) {
      const code = err.error?.code || ''
      if (code === 'INTERVIEW_SESSION_NOT_FOUND') this._fail('面试会话不存在或无权访问')
      else this._fail(err.error?.message || 'AI 报告生成失败，请稍后重试')
    }
  },
  _render(dto) {
    const r  = dto.report || {}
    const lv = LEVEL_MAP[r.overall?.level] || LEVEL_MAP.pass
    const sections = ['expression', 'positionFit', 'credibility', 'professional', 'adaptability', 'risks']
      .map(k => ({ key: k, title: SECTION_TITLES[k], items: r[k] || [] }))
      .filter(s => s.items.length > 0)
    this.setData({
      phase:              'done',
      position:           dto.position           || '',
      interviewerLabel:   dto.interviewerLabel   || '',
      overallLabel:       lv.label,
      overallColor:       lv.color,
      overallSummary:     r.overall?.summary     || '',
      sections,
      predictedQuestions: r.predictedQuestions   || [],
      starAdvice:         r.starAdvice           || null,
      checklist:          r.checklist            || [],
    })
  },
  _fail(failMsg) { this.setData({ phase: 'failed', failMsg }) },
  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
  async tapPrint() {
    if (this.data.printing) return
    this.setData({ printing: true })
    try {
      const file = await api.printInterviewReport(this.data.sessionId, this.data.accessToken)
      const name = encodeURIComponent(file.filename || `${this.data.position || '面试'}_复盘报告.pdf`)
      const pages = Number(file.pageCount) > 0 ? Number(file.pageCount) : ''
      wx.navigateTo({ url: `/pages/print-upload/print-upload?fileId=${file.fileId}&name=${name}&pages=${pages}` })
    } catch (err) {
      wx.showToast({ title: err.error?.message || '打印请求失败，请重试', icon: 'none' })
    } finally {
      this.setData({ printing: false })
    }
  },
  tapRetry() { wx.navigateTo({ url: '/pages/interview-entry/interview-entry' }) },
})
