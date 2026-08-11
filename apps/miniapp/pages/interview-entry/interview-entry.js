const app = getApp()
const api = require('../../utils/api.js')
const storage = require('../../utils/storage.js')

// 题型 → backend interviewerType；'case' 对应管理面试官
const TYPE_MAP = { hr: 'hr', tech: 'tech', case: 'manager' }

Page({
  data: {
    statusBarHeight: 20,
    form: { position: '' },
    levels: [
      { val: 'fresh', label: '应届/校招' },
      { val: 'lt1',   label: '1年以内' },
      { val: 'y1_3',  label: '1-3年' },
      { val: 'y3_5',  label: '3-5年' },
      { val: 'gt5',   label: '5年以上' },
      { val: 'switch', label: '转岗' },
    ],
    // durationMin 对应后端 DURATION_TARGET: { 3:4, 5:6, 8:8 }
    durations: [
      { val: 3, label: '约4题' },
      { val: 5, label: '约6题' },
      { val: 8, label: '约8题' },
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
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    if (options.position) this.setData({ 'form.position': decodeURIComponent(options.position) })
  },
  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
  inputPosition(e) { this.setData({ 'form.position': e.detail.value }) },
  tapLevel(e)    { this.setData({ activeLevel:    e.currentTarget.dataset.val }) },
  tapDuration(e) { this.setData({ activeDuration: e.currentTarget.dataset.val }) },
  tapType(e)     { this.setData({ activeType:     e.currentTarget.dataset.val }) },

  async tapStart() {
    const position = (this.data.form.position || '').trim()
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
      wx.navigateTo({ url: `/pages/interview-qa/interview-qa?sessionId=${dto.sessionId}` })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '创建面试失败，请重试', icon: 'none' })
    } finally {
      this.setData({ creating: false })
    }
  },
})
