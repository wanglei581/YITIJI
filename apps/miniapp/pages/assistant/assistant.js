const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const voice = require('../../utils/voice-recorder')
const aiAccess = require('../../utils/ai-access')
const { userMessageOf, plainAiMessageOf } = require('../../utils/user-error')
const aiEntries = require('../../utils/ai-entries')

// 后端 route 字符串 → 小程序页面路径映射（后端返回 actions[].route 时使用）。
// 没有映射的 route 会被丢掉（见 _send 里的 .filter）：服务端给一体机的岗位、招聘会、
// 人社专区三类卡片在小程序里不出现——对应页面已停放，
// 小程序首发按非招聘类目提审（compliance-boundary.md §1.1）。
const ROUTE_MAP = {
  '/resume/source':    aiEntries.resumeUploadUrl,
  '/resume/report':    aiEntries.resumeDiagnoseUrl,
  '/resume/optimize':  aiEntries.resumeOptimizeUrl,
  '/career-plan':      aiEntries.careerPlanUrl,
  '/job-fit':          aiEntries.jobFitUrl,
  '/interview':        aiEntries.interviewEntryUrl,
  '/print':            '/pages/print/print',
  '/print/upload':     '/pages/print-upload/print-upload',
  '/ai-records':       aiEntries.aiRecordsUrl,
}

// 请求带 channel=miniapp 之后（C12），服务端回的 route 已经是小程序页面路径，而且只会是 app.json
// 里注册过的页面（services/api/src/ai/llm/assistant-channel.ts）。上面这张表留给还没升级的服务端。
const MINIAPP_PAGE_RE = /^\/pages\/[a-z0-9-]+\/[a-z0-9-]+$/

function cardUrlOf(route) {
  const raw = String(route || '')
  if (ROUTE_MAP[raw]) return ROUTE_MAP[raw]
  return MINIAPP_PAGE_RE.test(raw.split('?')[0]) ? raw : ''
}

// Tab 页只能 switchTab 进，navigateTo 会直接失败（「打印」成为 Tab 后，
// 开场卡片「怎么打印文件」和服务端 /print 卡片都会落到这里）。
const TAB_PAGES = ['/pages/home/home', '/pages/print/print', '/pages/me/me']
if (aiEntries.aiTab) TAB_PAGES.push(aiEntries.aiTab)

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
        text: '你好，我是小青。简历怎么改、面试怎么准备、文件怎么打印，都可以问我。想从哪里开始？',
        cards: [
          { id: 'resume', icon: 'file-text', tone: 'plum', title: '诊断我的简历', sub: 'AI 分析并给出优化建议', url: aiEntries.resumeUploadUrl },
          { id: 'print',  icon: 'printer',   tone: 'teal', title: '怎么打印文件', sub: '上传、扫码或在一体机上打印',  url: '/pages/print/print' },
        ],
      },
    ],
    quickChips: ['简历怎么写更好', '面试前要准备什么', '怎么在手机上下单打印', '练习模拟面试'],
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
    // 小程序渠道不提政策（C12：本渠道没有政策页），这里也不再写「政策、补贴以官方渠道为准」。
    disclaimer: 'AI 生成，仅供参考：小青的回答由 AI 生成，可能有错，请核对后再用。',
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
    wx.navigateBack({ fail() { if (aiEntries.aiTab) wx.switchTab({ url: aiEntries.aiTab }) } })
  },

  tapCard(e) {
    const { url } = e.currentTarget.dataset
    if (!url) return
    if (TAB_PAGES.includes(String(url).split('?')[0])) wx.switchTab({ url: String(url).split('?')[0] })
    else wx.navigateTo({ url, fail() { wx.showToast({ title: '这个页面当前版本暂未开放', icon: 'none' }) } })
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

      // 将 backend actions 转成引导卡（只保留认得出的小程序页面）
      const cards = (res.actions || []).map(a => ({
        id:   a.route,
        icon: iconForRoute(a.route),
        tone: 'teal',
        title: a.label,
        sub:  '',
        url:  cardUrlOf(a.route),
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
    } catch (err) {
      // 说得出原因的就照实说：没登录、AI 暂停、年龄没确认、内容处理不了；其余才是「暂时无法回复」。
      const aiMsg = { id: loadingMsg.id, role: 'ai', text: plainAiMessageOf(err, '小青暂时无法回复，请稍后再试。') }
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
    if (!aiAccess.isDeclared(aiAccess.AGE_SCOPE) || !aiAccess.isDeclared(aiAccess.VOICE_SCOPE)) {
      // 第一次：先问年满 14 周岁与录音单独同意（与语音说简历、模拟面试共用一次，C6）。
      // 提示框会打断按住的手指，这一次只问不录，同意后提示再按住说话；不同意照样能打字。
      this._wantRecord = false
      api.ensureVoiceConsent().then(
        () => wx.showToast({ title: '已同意录音，请再按住说话', icon: 'none' }),
        (err) => wx.showToast({ title: userMessageOf(err, '这一步请改用文字输入'), icon: 'none', duration: 2500 }),
      )
      return
    }
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
      itemList: ['清空对话记录', '查看 AI 服务记录', 'AI 服务说明', '投诉 AI 回答'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.setData({ messages: [this.data.messages[0]], sessionId: '' })
        } else if (res.tapIndex === 1) {
          if (aiEntries.aiRecordsUrl) wx.navigateTo({ url: aiEntries.aiRecordsUrl })
        } else if (res.tapIndex === 2) {
          this.openAiDisclaimer()
        } else if (res.tapIndex === 3) {
          this.openAiComplaint()
        }
      },
    })
  },

  // C1 所用模型与备案号、C3 投诉入口：声明条里与右上角菜单里各一处。
  openAiDisclaimer() {
    wx.navigateTo({ url: '/pages/legal/legal?type=ai_disclaimer' })
  },

  openAiComplaint() {
    wx.navigateTo({ url: '/pages/feedback/feedback?category=ai_content' })
  },

  onShareAppMessage() {
    return { title: 'AI 顾问小青', path: aiEntries.assistantUrl }
  },
})
