const app = getApp()
const api = require('../../utils/api')
const storage = require('../../utils/storage')
const model = require('../../utils/resume-build-model')
const voice = require('../../utils/voice-recorder')
const Q = require('./resume-voice-questions')

const PROBE_MAX_S = Math.floor(voice.PROBE_MAX_MS / 1000)
const QUESTION_MAX_S = Math.floor(voice.QUESTION_MAX_MS / 1000)

Page({
  data: {
    statusBarHeight: 20,
    /**
     * consent 录音同意（独立勾选，不和隐私政策打包）
     * probe   强制试音
     * ask     一问一录
     */
    phase: 'consent',
    textOnly: false,
    textOnlyReason: '',
    consentChecked: false,

    recStatus: 'idle', // idle | recording | transcribing | ready | error
    recSeconds: 0,
    recMax: PROBE_MAX_S,
    transcript: '',
    recError: '',
    editing: false,
    editText: '',
    typedText: '',

    probeTries: 0,
    qIndex: 0,
    qTotal: Q.QUESTIONS.length,
    qTitle: '',
    qPrompt: '',
    qHint: '',
    qExample: '',
    qSensitive: false,
    qSkippable: false,
    qRequired: false,
    qVoice: true,
    qKeyboard: 'text',
    qMaxLen: 50,
    confirmedCount: 0,
  },

  onLoad() {
    this.setData({ statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20 })
    this._form = Q.emptyForm()
    this._seq = 0
  },

  onUnload() {
    this._gone = true
    this._stopTick()
    voice.cancel()
  },

  goBack() {
    if (this.data.phase === 'consent' || this.data.confirmedCount === 0) {
      wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
      return
    }
    wx.showModal({
      title: '离开？',
      content: '已经确认的内容不会保存。想用手打可以从「从零建一份简历」继续。',
      confirmText: '离开',
      cancelText: '留下',
      success: (r) => {
        if (!r.confirm) return
        wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
      },
    })
  },

  goTypedForm() {
    wx.redirectTo({
      url: '/pages/resume-build/resume-build',
      fail() { wx.showToast({ title: '页面打开失败', icon: 'none' }) },
    })
  },

  toggleConsent() {
    this.setData({ consentChecked: !this.data.consentChecked })
  },

  refuseVoice() {
    this._enterTextOnly('你没有同意录音，后面请用手打。功能还在。')
  },

  agreeVoice() {
    if (!this.data.consentChecked) {
      wx.showToast({ title: '请先单独勾选录音同意', icon: 'none' })
      return
    }
    voice.ensureRecordAuth().then((ok) => {
      if (this._gone) return
      if (!ok) {
        this._enterTextOnly('麦克风权限未开启，后面请用手打。功能还在。')
        return
      }
      this.setData({
        phase: 'probe',
        recStatus: 'idle',
        recSeconds: 0,
        recMax: PROBE_MAX_S,
        transcript: '',
        recError: '',
        probeTries: 0,
      })
    })
  },

  _enterTextOnly(reason) {
    this._stopTick()
    voice.cancel()
    const first = Q.nextIndex(0, this._form)
    this.setData({
      textOnly: true,
      textOnlyReason: reason || '后面请用手打。已经确认的内容还在。',
      phase: 'ask',
      recStatus: 'idle',
      recError: '',
      transcript: '',
      editing: false,
    })
    this._showQuestion(first)
  },

  startRec() {
    if (this.data.recStatus === 'recording' || this.data.recStatus === 'transcribing') return
    const maxS = this.data.phase === 'probe' ? PROBE_MAX_S : QUESTION_MAX_S
    const seq = (this._seq += 1)
    this.setData({
      recStatus: 'recording',
      recSeconds: 0,
      recMax: maxS,
      recError: '',
      transcript: '',
      editing: false,
    })
    this._startTick()
    voice.start(maxS * 1000)
      .then((res) => {
        this._stopTick()
        if (this._gone || seq !== this._seq) return
        const path = res && res.tempFilePath
        if (!path) {
          this.setData({ recStatus: 'idle' })
          return
        }
        this._transcribe(path, seq)
      })
      .catch((err) => {
        this._stopTick()
        if (this._gone || seq !== this._seq) return
        const f = Q.transcribeFail(err)
        if (f.degrade) this._enterTextOnly(f.msg)
        else this.setData({ recStatus: 'error', recError: f.msg })
      })
  },

  stopRec() {
    if (this.data.recStatus !== 'recording') return
    voice.stop()
  },

  _transcribe(filePath, seq) {
    this.setData({ recStatus: 'transcribing', recError: '' })
    api.transcribeResumeVoice(filePath)
      .then((res) => {
        if (this._gone || seq !== this._seq) return
        const text = String((res && res.text) || '').trim()
        if (!text) {
          this.setData({
            recStatus: 'error',
            recError: '没有识别到有效文字，请重说或改用文字输入',
          })
          return
        }
        this.setData({ recStatus: 'ready', transcript: text, editText: text, editing: false })
      })
      .catch((err) => {
        if (this._gone || seq !== this._seq) return
        const f = Q.transcribeFail(err)
        if (f.degrade) this._enterTextOnly(f.msg)
        else this.setData({ recStatus: 'error', recError: f.msg })
      })
  },

  probeYes() {
    if (this.data.recStatus !== 'ready' || !String(this.data.transcript || '').trim()) return
    const first = Q.nextIndex(0, this._form)
    this.setData({ phase: 'ask', recStatus: 'idle', transcript: '', recError: '' })
    this._showQuestion(first)
  },

  probeNo() {
    const tries = this.data.probeTries + 1
    if (tries >= 2) {
      this._enterTextOnly('试音两次都对不上，后面请用手打，避免白说。已经确认的内容还在。')
      return
    }
    this.setData({
      probeTries: tries,
      recStatus: 'idle',
      transcript: '',
      recError: '请再试一次。还不对的话会改成手打。',
    })
  },

  confirmTranscript() {
    const q = Q.questionAt(this.data.qIndex)
    if (!q) return
    const text = String(this.data.editing ? this.data.editText : this.data.transcript).trim()
    if (!text) {
      wx.showToast({ title: '请先确认文字', icon: 'none' })
      return
    }
    this._commit(q, text)
  },

  retryRec() {
    this.setData({ recStatus: 'idle', transcript: '', recError: '', editing: false, editText: '' })
  },

  startEdit() {
    const text = this.data.transcript || this.data.editText || ''
    this.setData({ editing: true, editText: text })
  },

  onEditInput(e) {
    this.setData({ editText: e.detail.value })
  },

  onTypedInput(e) {
    this.setData({ typedText: e.detail.value })
  },

  confirmTyped() {
    const q = Q.questionAt(this.data.qIndex)
    if (!q) return
    const text = String(this.data.typedText || '').trim()
    if (!text) {
      if (q.required && !q.skippable) {
        wx.showToast({ title: '这一项需要填写', icon: 'none' })
        return
      }
      this._advance()
      return
    }
    this._commit(q, text)
  },

  skipQuestion() {
    const q = Q.questionAt(this.data.qIndex)
    if (!q || !q.skippable) return
    this._advance()
  },

  typeThisQuestion() {
    this.setData({
      qVoice: false,
      recStatus: 'idle',
      transcript: '',
      recError: '',
      editing: false,
      typedText: '',
    })
    this._stopTick()
    voice.cancel()
  },

  _commit(q, raw) {
    Q.applyAnswer(this._form, q.slot, raw, q.maxLen)
    this.setData({ confirmedCount: this.data.confirmedCount + 1 })
    this._advance()
  },

  _advance() {
    const next = Q.nextIndex(this.data.qIndex + 1, this._form)
    if (next < 0) {
      this._finish()
      return
    }
    this._showQuestion(next)
  },

  _showQuestion(index) {
    if (index < 0) {
      this._finish()
      return
    }
    const q = Q.questionAt(index)
    if (!q) {
      this._finish()
      return
    }
    const textOnly = this.data.textOnly
    const useVoice = !textOnly && q.input === 'voice'
    this._stopTick()
    voice.cancel()
    this.setData({
      qIndex: index,
      qTitle: q.title,
      qPrompt: q.prompt,
      qHint: q.hint || '',
      qExample: q.example || '',
      qSensitive: Boolean(q.sensitive),
      qSkippable: Boolean(q.skippable),
      qRequired: Boolean(q.required),
      qVoice: useVoice,
      qKeyboard: q.keyboard || 'text',
      qMaxLen: q.maxLen || 200,
      recStatus: 'idle',
      recSeconds: 0,
      recMax: QUESTION_MAX_S,
      transcript: '',
      recError: '',
      editing: false,
      editText: '',
      typedText: '',
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  _finish() {
    const errors = model.validate(this._form)
    if (errors.length) {
      wx.showModal({
        title: '还差几项',
        content: errors.slice(0, 4).join('\n'),
        showCancel: false,
        confirmText: '去补',
      })
      const jump = Q.nextIndex(0, this._form, true)
      if (jump >= 0) this._showQuestion(jump)
      return
    }
    storage.set(storage.KEYS.RESUME_VOICE_HANDOFF, {
      form: this._form,
      fromVoice: true,
      textOnly: this.data.textOnly,
      ts: Date.now(),
    })
    wx.redirectTo({
      url: '/pages/resume-build/resume-build?from=voice',
      fail: () => {
        storage.remove(storage.KEYS.RESUME_VOICE_HANDOFF)
        wx.showToast({ title: '没法打开预览页', icon: 'none' })
      },
    })
  },

  _startTick() {
    this._stopTick()
    this._t0 = Date.now()
    this._timer = setInterval(() => {
      if (this._gone) { this._stopTick(); return }
      const sec = Math.floor((Date.now() - this._t0) / 1000)
      const cap = this.data.recMax
      this.setData({ recSeconds: Math.min(sec, cap) })
      if (sec >= cap && this.data.recStatus === 'recording') voice.stop()
    }, 250)
  },

  _stopTick() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  },
})
