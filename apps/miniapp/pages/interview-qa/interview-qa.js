const app = getApp()
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')

Page({
  data: {
    statusBarHeight: 20,
    // loading: startInterview 进行中
    // running: 显示当前题目，等待用户输入
    // submitting: answerInterview 进行中
    // failed: 不可恢复错误
    phase:          'loading',
    sessionId:      '',
    accessToken:    '',
    position:       '',
    questionTarget: 0,
    current:        0,
    question:       '',
    qType:          '',
    myAnswer:       '',
    failMsg:        '',
  },
  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    const saved = storage.get(storage.KEYS.INTERVIEW_SESSION) || {}
    const sessionId   = options.sessionId || saved.sessionId   || ''
    const accessToken = saved.accessToken || ''
    const position    = saved.position    || ''
    const questionTarget = saved.questionTarget || 0
    if (!sessionId) {
      this.setData({ phase: 'failed', failMsg: '面试会话不存在，请返回重新开始' })
      return
    }
    this.setData({ sessionId, accessToken, position, questionTarget })
    this._start()
  },
  async _start() {
    try {
      const res = await api.startInterview(this.data.sessionId, this.data.accessToken)
      this.setData({
        phase:          'running',
        current:        res.questionIndex || 1,
        questionTarget: res.questionTarget || this.data.questionTarget,
        question:       res.question || '',
        qType:          res.qType   || '',
        myAnswer:       '',
      })
    } catch (err) {
      const code = err.error?.code || ''
      if (code === 'INTERVIEW_SESSION_NOT_FOUND') {
        this._fail('面试会话不存在或无权访问')
      } else {
        this._fail(err.error?.message || '面试初始化失败，请返回重试')
      }
    }
  },
  tapQuit() {
    wx.showModal({
      title:   '确认退出',
      content: '退出后本次答题进度将不保存',
      success: (res) => {
        if (res.confirm) wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
      },
    })
  },
  inputAnswer(e) { this.setData({ myAnswer: e.detail.value }) },
  async tapSubmit() {
    const answer = (this.data.myAnswer || '').trim()
    if (!answer) { wx.showToast({ title: '请先输入你的回答', icon: 'none' }); return }
    if (this.data.phase !== 'running') return
    this.setData({ phase: 'submitting' })
    try {
      const res = await api.answerInterview(
        this.data.sessionId,
        { answer, inputMode: 'text' },
        this.data.accessToken,
      )
      if (res.done) {
        // 全部题目完成，跳到报告页（replace，不允许返回答题页）
        wx.redirectTo({
          url: `/pages/interview-result/interview-result?sessionId=${this.data.sessionId}`,
        })
      } else {
        this.setData({
          phase:   'running',
          current: res.questionIndex || (this.data.current + 1),
          question: res.question || '',
          qType:    res.qType   || '',
          myAnswer: '',
        })
      }
    } catch (err) {
      // 提交失败：恢复答题状态，保留已输入内容
      this.setData({ phase: 'running' })
      wx.showToast({ title: err.error?.message || '提交失败，请重试', icon: 'none' })
    }
  },
  _fail(failMsg) { this.setData({ phase: 'failed', failMsg }) },
})
