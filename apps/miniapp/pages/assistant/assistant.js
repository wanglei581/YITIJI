const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const voice = require('../../utils/voice-recorder')

// 后端 route 字符串 → 小程序页面路径映射（后端返回 actions[].route 时使用）
const ROUTE_MAP = {
  '/resume/source':    '/pages/resume-upload/resume-upload',
  '/resume/report':    '/pages/resume-diagnose/resume-diagnose',
  '/resume/optimize':  '/pages/resume-optimize/resume-optimize',
  '/career-plan':      '/pages/career-plan/career-plan',
  '/job-fit':          '/pages/job-fit/job-fit',
  '/interview':        '/pages/interview-entry/interview-entry',
  '/print':            '/pages/print/print',
  '/print/upload':     '/pages/print-upload/print-upload',
  '/jobs':             '/pages/jobs/jobs',
  '/fairs':            '/pages/fairs/fairs',
  '/policies':         '/pages/policies/policies',
  '/ai-records':       '/pages/ai-records/ai-records',
}

function iconForRoute(route) {
  if (/resume|career|job-fit/.test(route)) return 'file-text'
  if (/print/.test(route))                  return 'printer'
  if (/interview/.test(route))              return 'comment'
  if (/job/.test(route))                    return 'briefcase'
  if (/fair/.test(route))                   return 'calendar'
  if (/polic/.test(route))                  return 'info'
  return 'right'
}

Page({
  data: {
    statusBarHeight: 20,
    // 胶囊右让（px）。实测本页 .as-more 落在胶囊 [296,383] 内的 [346,376]，点不到。
    // 由 app.js 运行时算，不写死 rpx——胶囊位置随机型变。
    capsuleInsetRight: 94,
    sessionId: '',
    messages: [
      {
        id: 1,
        role: 'ai',
        text: '你好，我是小青。简历优化、打印帮助、求职政策都可以问我。想从哪里开始？',
        cards: [
          { id: 'resume', icon: 'file-text', tone: 'plum', title: '诊断我的简历', sub: 'AI 分析并给出优化建议', url: '/pages/resume-upload/resume-upload' },
          { id: 'print',  icon: 'printer',   tone: 'teal', title: '怎么打印文件', sub: '上传、扫码或到店打印',  url: '/pages/print/print' },
        ],
      },
    ],
    quickChips: ['简历怎么写更好', '求职补贴怎么领', '附近招聘会', '练习模拟面试'],
    inputText: '',
    sending: false,
    holding: false,
    transcribing: false,
    sendVoiceDirect: false,
    asrEnabled: false,
    voiceBlockedReason: '',
    savingSummary: false,
    summaryHint: '',
    summaryHighlights: [],
    summaryTodos: [],
    // 滚动到底部：两值交替使 scroll-top 绑定每次触发
    _stFlip: false,
    scrollTop: 0,
    disclaimer: 'AI 助手小青的回答由 AI 生成，可能存在错误。政策、补贴等信息请以官方渠道为准。',
  },

  onLoad() {
    const fallback = () => (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).statusBarHeight
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || fallback() || 20,
      // 见 data.capsuleInsetRight 的说明：本页右上角的「更多」按钮实测整个落在胶囊里
      capsuleInsetRight: (app.globalData && app.globalData.capsuleInsetRight) || 94,
    })
    api.getAssistantVoiceCapability().then((cap) => {
      const ok = !!(cap && cap.asrEnabled)
      this.setData({
        asrEnabled: ok,
        voiceBlockedReason: ok ? '' : '语音转写未启用，请使用文字输入。恢复条件：管理员配置 ASR 后重新进入本页。',
      })
    }).catch(() => {
      this.setData({
        asrEnabled: false,
        voiceBlockedReason: '语音转写未启用，请使用文字输入。恢复条件：管理员配置 ASR 后重新进入本页。',
      })
    })
  },

  onUnload() {
    voice.cancel()
  },

  back() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/ai/ai' }) } })
  },

  tapCard(e) {
    const { url } = e.currentTarget.dataset
    if (url) wx.navigateTo({ url })
  },

  /** 滚动到底部（两值交替保证 scroll-top binding 每次都触发渲染） */
  _scrollBottom() {
    const flip = !this.data._stFlip
    this.setData({ _stFlip: flip, scrollTop: flip ? 999998 : 999999 })
  },

  async _send(text) {
    if (!text || this.data.sending) return
    const now = Date.now()
    const userMsg   = { id: now,     role: 'user', text }
    const loadingMsg = { id: now + 1, role: 'ai',  text: '…', loading: true }
    this.setData({
      messages: [...this.data.messages, userMsg, loadingMsg],
      inputText: '',
      sending: true,
    })
    this._scrollBottom()

    try {
      const res = await api.assistantChat(text, this.data.sessionId)

      // 将 backend actions 转成引导卡（只保留有已知映射的路由）
      const cards = (res.actions || []).map(a => ({
        id:   a.route,
        icon: iconForRoute(a.route),
        tone: 'teal',
        title: a.label,
        sub:  '',
        url:  ROUTE_MAP[a.route] || '',
      })).filter(c => c.url)

      // 服务端专门透出 aiGenerated / providerLabel，就是为了让前端分辨
      // 「真实模型」与「mock/stub 预置话术」(ai.service.ts S0-1 / 风险 R1：
      // 「绝不因为 reply 看起来像 AI 回答就当成 AI 回答」)。
      // 此前这里只取 res.reply，把降级话术原样当成小青的回答展示——
      // 那是在用户看不见的地方伪造能力。
      const aiGenerated = res.aiGenerated === true
      const aiMsg = {
        id: loadingMsg.id,
        role: 'ai',
        text: res.reply || '',
        cards,
        aiGenerated,
        // 只在**没走真实模型**时出标记。走了就什么都不显示——
        // 给每条真实回答都挂个「AI 生成」徽章是噪音，不是诚实。
        fallbackNote: aiGenerated ? '' : '本条不是模型生成的回答，是系统预置话术（AI 服务当前不可用）。',
      }
      const msgs  = this.data.messages.slice(0, -1).concat(aiMsg)
      this.setData({
        messages:  msgs,
        sessionId: res.sessionId || this.data.sessionId,
        sending:   false,
      })
    } catch (_) {
      const aiMsg = { id: loadingMsg.id, role: 'ai', text: '小青暂时无法回复，请稍后再试。' }
      const msgs  = this.data.messages.slice(0, -1).concat(aiMsg)
      this.setData({ messages: msgs, sending: false })
    }
    this._scrollBottom()
  },

  sendMsg() {
    this._send(this.data.inputText.trim())
  },

  onInputChange(e) {
    this.setData({ inputText: e.detail.value })
  },

  tapChip(e) {
    this._send(e.currentTarget.dataset.text)
  },

  toggleSendDirect() {
    this.setData({ sendVoiceDirect: !this.data.sendVoiceDirect })
  },

  onHoldStart() {
    if (this.data.sending || this.data.holding || this.data.transcribing) return
    if (!this.data.asrEnabled) return
    this._wantRecord = true
    voice.ensureRecordAuth().then((ok) => {
      if (!this._wantRecord) return null
      if (!ok) {
        this.setData({
          asrEnabled: false,
          voiceBlockedReason: '录音授权失败，已退回文字输入。可在微信设置里允许麦克风后重进本页。',
        })
        return null
      }
      this.setData({ holding: true })
      return voice.start(58000)
    }).then((res) => {
      if (!res) {
        this.setData({ holding: false })
        return null
      }
      this.setData({ holding: false, transcribing: true })
      return api.transcribeAssistantVoice(res.tempFilePath)
    }).then((out) => {
      if (!out) return
      const text = String((out && out.text) || '').trim()
      this.setData({ transcribing: false })
      if (!text) {
        wx.showToast({ title: '没听清，请重说或手打', icon: 'none' })
        return
      }
      if (this.data.sendVoiceDirect) this._send(text)
      else this.setData({ inputText: text })
    }).catch((err) => {
      this._wantRecord = false
      voice.cancel()
      const code = (err && err.code) || ''
      if (code === 'ASR_NOT_CONFIGURED' || code === 'permission-denied' || code === 'unsupported') {
        this.setData({
          holding: false,
          transcribing: false,
          asrEnabled: false,
          voiceBlockedReason: (err && err.message) || '语音不可用，请使用文字输入',
        })
        return
      }
      this.setData({ holding: false, transcribing: false })
      wx.showToast({ title: (err && err.message) || '转写失败，请手打', icon: 'none' })
    })
  },

  onHoldEnd() {
    this._wantRecord = false
    voice.stop()
  },

  onHoldCancel() {
    this._wantRecord = false
    voice.cancel()
    this.setData({ holding: false, transcribing: false })
  },

  saveSummary() {
    if (this.data.savingSummary) return
    if (!auth.isLoggedIn()) {
      this.setData({ summaryHint: '登录后可将本次要点保存到我的文档并打印。' })
      return
    }
    if (!this.data.sessionId) {
      this.setData({ summaryHint: '先问小青至少一轮，才能保存本次要点。' })
      return
    }
    this.setData({ savingSummary: true, summaryHint: '' })
    api.summarizeAssistantSession(this.data.sessionId).then((res) => {
      const highlights = (res && res.highlights) || []
      const todos = (res && res.todos) || []
      const saved = res && res.document
        ? '本次要点已保存到我的文档，可打印。'
        : ((res && res.printUnavailableReason) || '本次要点已保存，打印稿尚未生成。')
      this.setData({
        savingSummary: false,
        summaryHint: saved,
        summaryHighlights: highlights,
        summaryTodos: todos,
      })
    }).catch((err) => {
      this.setData({
        savingSummary: false,
        summaryHint: (err && err.message) || '本次要点暂时保存不了，请稍后重试',
      })
    })
  },

  tapMore() {
    wx.showActionSheet({
      itemList: ['清空对话记录', '查看 AI 服务记录'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.setData({ messages: [this.data.messages[0]], sessionId: '' })
        } else {
          wx.navigateTo({ url: '/pages/ai-records/ai-records' })
        }
      },
    })
  },

  onShareAppMessage() {
    return { title: 'AI 顾问小青', path: '/pages/assistant/assistant' }
  },
})
