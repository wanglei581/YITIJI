const app = getApp()
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')
const { plainAiMessageOf } = require('../../utils/user-error')

// 题型 → backend interviewerType；'case' 对应管理面试官
const TYPE_MAP = { hr: 'hr', tech: 'tech', case: 'manager' }

const HOT_POSITIONS = [
  '前端开发',
  '产品经理',
  '新媒体运营',
  '行政人事',
  '财会审计',
  '国企综合',
]

function normalizeDurationVal(raw) {
  const num = Number(raw)
  return num === 3 || num === 5 || num === 8 ? num : 5
}

Page({
  data: {
    statusBarHeight: 20,
    form: { position: '' },
    hotPositions: HOT_POSITIONS,
    levels: [
      { val: 'fresh', label: '应届生' },
      { val: 'lt1',   label: '1年以内' },
      { val: 'y1_3',  label: '1-3年' },
      { val: 'y3_5',  label: '3-5年' },
      { val: 'gt5',   label: '5年以上' },
      { val: 'switch', label: '转岗' },
    ],
    // durationMin 对应后端 DURATION_TARGET: { 3:4, 5:6, 8:8 }（严格整数 3 / 5 / 8）
    durations: [
      { val: 3, title: '3 分钟快练', sub: '4 题速测 · 通勤可用', badge: '最快', featured: true },
      { val: 5, title: '标准模拟',   sub: '约 6 题 · 常见节奏', badge: '',     featured: false },
      { val: 8, title: '深度演练',   sub: '约 8 题 · 全面复盘', badge: '',     featured: false },
    ],
    qtypes: [
      { val: 'hr',   label: '行为面试' },
      { val: 'tech', label: '技术考察' },
      { val: 'case', label: '案例分析' },
    ],
    activeLevel:    'fresh',
    activeDuration: 5,
    activeType:     'hr',
    creating:       false,
  },
  onLoad(options) {
    const opts = options || {}
    const patch = { statusBarHeight: (app && app.globalData && app.globalData.statusBarHeight) || 20 }
    if (opts.position) {
      let decoded = ''
      try { decoded = decodeURIComponent(opts.position) } catch (_) { decoded = String(opts.position) }
      patch['form.position'] = decoded.trim().slice(0, 50)
    }
    if (opts.quick === '1' || opts.quick === 'true') {
      patch.activeDuration = 3
    } else if (opts.durationMin !== undefined) {
      patch.activeDuration = normalizeDurationVal(opts.durationMin)
    }
    this.setData(patch)
  },
  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
  inputPosition(e) { this.setData({ 'form.position': ((e && e.detail && e.detail.value) || '').slice(0, 50) }) },
  tapHotPosition(e) {
    const pos = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.pos) || '').trim().slice(0, 50)
    if (!pos) return
    this.setData({ 'form.position': pos })
  },
  tapLevel(e)    { this.setData({ activeLevel:    e.currentTarget.dataset.val }) },
  tapDuration(e) { this.setData({ activeDuration: normalizeDurationVal(e.currentTarget.dataset.val) }) },
  tapType(e)     { this.setData({ activeType:     e.currentTarget.dataset.val }) },

  async tapStart() {
    const position = (this.data.form.position || '').trim().slice(0, 50)
    if (!position) { wx.showToast({ title: '请填写目标岗位', icon: 'none' }); return }
    if (this.data.creating) return
    this.setData({ creating: true })
    try {
      const dto = await api.createInterview({
        interviewerType: TYPE_MAP[this.data.activeType] || 'hr',
        industry:        '通用',
        position,
        experience:  this.data.activeLevel,
        difficulty:  'standard',
        durationMin: this.data.activeDuration,
      })
      // accessToken 只在创建时下发一次，必须立即落地
      storage.set(storage.KEYS.INTERVIEW_SESSION, {
        sessionId:      dto.sessionId,
        accessToken:    dto.accessToken || '',
        position,
        questionTarget: dto.questionTarget || 0,
        ts: Date.now(),
      })
      const url = `/pages/interview-qa/interview-qa?sessionId=${dto.sessionId}`
      // 页面栈满 10 层时 navigateTo 会静默失败：面试已在服务端建好，用户却停在本页，
      // 再点一次又建一场（走查 9/29）。失败就用本页换过去，会话已落地，作答页读得到。
      wx.navigateTo({ url, fail: () => wx.redirectTo({ url }) })
    } catch (err) {
      wx.showToast({ title: plainAiMessageOf(err, '创建面试失败，请重试'), icon: 'none', duration: 2500 })
    } finally {
      this.setData({ creating: false })
    }
  },
})
