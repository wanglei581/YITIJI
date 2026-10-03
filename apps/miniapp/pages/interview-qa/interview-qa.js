const app = getApp()
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')
const voice = require('../../utils/voice-recorder')
const { userMessageOf } = require('../../utils/user-error')

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
    // 先亮出「语音作答」；点了才问录音同意和麦克风权限（进页就弹系统授权框会打断读题）。
    voiceAvailable: true,
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
      const code = (err && err.code) || ''
      if (code === 'INTERVIEW_SESSION_NOT_FOUND') {
        this._fail('面试会话不存在或无权访问')
      } else {
        this._fail((err && err.message) || '面试初始化失败。AI 不可用时可打印通用题目单。')
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
      // 原话在 err.message（utils/request.js）。用弹窗不用 toast：toast 只有两行，长一点的原话会被截断
      wx.showModal({
        title: '这一题没有提交成功',
        content: (err && err.message) || '提交失败，请重试。已输入的回答还在。',
        showCancel: false,
        confirmText: '知道了',
      })
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
    // 录音之前先问：年满 14 周岁 + 录音单独同意（与语音说简历、小青共用一次，C6）；再问麦克风权限。
    api.ensureVoiceConsent()
      .then(() => voice.ensureRecordAuth())
      .then((ok) => {
        if (!ok) {
          this.setData({ voiceAvailable: false, recError: '没有麦克风权限，已改用文字输入' })
          return
        }
        if (this.data.phase === 'running') this._record()
      }, (err) => {
        this.setData({ recError: userMessageOf(err, '这一题请用文字作答') })
      })
  },
  _record() {
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
