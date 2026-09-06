const app = getApp()
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')
const voice = require('../../utils/voice-recorder')

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
    voiceAvailable: false,
    recStatus:      'idle',
    recError:       '',
    omitPrintAnswers: false,
    practiceBusy:   false,
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
    voice.ensureRecordAuth().then((ok) => {
      this.setData({ voiceAvailable: !!ok })
    })
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
      const code = err.error?.code || err.code || ''
      if (code === 'INTERVIEW_SESSION_NOT_FOUND') {
        this._fail('面试会话不存在或无权访问')
      } else {
        this._fail(err.error?.message || err.message || '面试初始化失败。AI 不可用时可打印通用题目单。')
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
        this._goResult()
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
  toggleOmit(e) {
    const v = e.detail && e.detail.value
    this.setData({ omitPrintAnswers: Array.isArray(v) ? v.length > 0 : !!v })
  },
  _goResult() {
    const saved = storage.get(storage.KEYS.INTERVIEW_SESSION) || {}
    storage.set(storage.KEYS.INTERVIEW_SESSION, {
      ...saved,
      sessionId: this.data.sessionId,
      accessToken: this.data.accessToken,
      omitPrintAnswers: this.data.omitPrintAnswers,
    })
    wx.redirectTo({
      url: `/pages/interview-result/interview-result?sessionId=${this.data.sessionId}`,
    })
  },
  tapVoice() {
    if (!this.data.voiceAvailable) {
      wx.showToast({ title: '没有麦克风权限，请用文字作答', icon: 'none' })
      return
    }
    if (this.data.recStatus === 'recording' || this.data.recStatus === 'transcribing') return
    if (this.data.phase !== 'running') return
    this.setData({ recStatus: 'recording', recError: '' })
    voice.start(voice.QUESTION_MAX_MS)
      .then((res) => {
        const path = res && res.tempFilePath
        if (!path) {
          this.setData({ recStatus: 'idle' })
          return
        }
        this._transcribe(path)
      })
      .catch((err) => {
        const denied = err && (err.code === 'permission-denied' || err.code === 'unsupported')
        this.setData({
          recStatus: 'idle',
          voiceAvailable: denied ? false : this.data.voiceAvailable,
          recError: denied ? '没有麦克风权限，已改用文字输入' : ((err && err.message) || '录音失败，请改用文字'),
        })
      })
  },
  tapStopVoice() {
    if (this.data.recStatus !== 'recording') return
    voice.stop()
  },
  _transcribe(filePath) {
    this.setData({ recStatus: 'transcribing' })
    api.transcribeInterviewAnswer(this.data.sessionId, filePath, this.data.accessToken)
      .then((res) => {
        const text = String((res && res.text) || '').trim()
        if (!text) {
          this.setData({ recStatus: 'idle', recError: '没有识别到有效文字，请重说或改用文字输入' })
          return
        }
        this.setData({ recStatus: 'idle', myAnswer: text, recError: '' })
      })
      .catch((err) => {
        this.setData({
          recStatus: 'idle',
          recError: (err && err.message) || '转写失败，请改用文字输入',
        })
      })
  },
  tapPracticeSheet() {
    if (this.data.practiceBusy) return
    this.setData({ practiceBusy: true })
    api.printInterviewPracticeSheet(this.data.sessionId, this.data.accessToken)
      .then((file) => {
        const name = encodeURIComponent((file && file.filename) || '模拟面试通用题目单.pdf')
        const pages = Number(file && file.pageCount) > 0 ? Number(file.pageCount) : ''
        wx.navigateTo({ url: `/pages/print-upload/print-upload?fileId=${file.fileId}&name=${name}&pages=${pages}` })
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '题目单生成失败', icon: 'none' })
      })
      .finally(() => this.setData({ practiceBusy: false }))
  },
})
