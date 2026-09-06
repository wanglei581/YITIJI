const app = getApp()
const api = require('../../utils/api')

// 作答**只放在页面实例上**，不进 Storage、不进路由参数。
// 户籍/参保/失业登记这类信息一旦落本地缓存或 URL，就脱离了「服务端零落库」的口径。
// 页面卸载即消失，这是有意的。

Page({
  data: {
    statusBarHeight: 20,
    // ask 填写中 | checking 核对中 | result 有结果 | error 出错
    phase: 'ask',
    loading: true,
    loadError: '',
    questions: [],
    privacyNotice: '',
    disclaimer: '',
    answers: {},          // key -> value，仅用于渲染选中态
    answeredCount: 0,
    result: null,
    submitting: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20 })
    this.loadQuestions()
  },

  loadQuestions() {
    this.setData({ loading: true, loadError: '' })
    api.getPolicyEligibilityQuestions()
      .then((d) => {
        const questions = (d && Array.isArray(d.questions)) ? d.questions : []
        if (!questions.length) {
          this.setData({ loading: false, loadError: '暂时取不到自测问项，请稍后重试' })
          return
        }
        this.setData({
          loading: false,
          questions,
          privacyNotice: (d && d.privacyNotice) || '',
          disclaimer: (d && d.disclaimer) || '',
        })
      })
      .catch((err) => {
        this.setData({ loading: false, loadError: (err && err.message) || '加载失败，请稍后重试' })
      })
  },

  reload() { this.loadQuestions() },

  // 再点一次同一项即取消选择——敏感项标了「可以不填」，就必须真的能不填
  tapOption(e) {
    const { key, value } = e.currentTarget.dataset
    if (!key) return
    const next = Object.assign({}, this.data.answers)
    if (next[key] === value) delete next[key]
    else next[key] = value
    this.setData({ answers: next, answeredCount: Object.keys(next).length })
  },

  submit() {
    if (this.data.submitting) return
    // 一项都没填时不提交：空作答换回来的结果对用户没有信息量，
    // 只会让人以为「系统判我不符合」。
    if (this.data.answeredCount === 0) {
      wx.showToast({ title: '至少选一项再核对', icon: 'none', duration: 2000 })
      return
    }
    this.setData({ submitting: true, phase: 'checking' })
    api.checkPolicyEligibility(this.data.answers)
      .then((res) => {
        if (this._gone) return
        this.setData({ submitting: false, phase: 'result', result: this._toResultView(res) })
        wx.pageScrollTo({ scrollTop: 0, duration: 200 })
      })
      .catch((err) => {
        if (this._gone) return
        this.setData({ submitting: false, phase: 'ask' })
        wx.showModal({
          title: '未能完成核对',
          content: (err && err.message) || '请稍后重试',
          showCancel: false,
          confirmText: '知道了',
        })
      })
  },

  /**
   * 结果视图。两条硬约束：
   *   1. overallLabel 原样用服务端的，不自己造措辞——服务端给的是
   *      「已录入条件的比对结果」，写成「你符合申领资格」就把机械比对说成了资格认定。
   *   2. items 为空只说「没有可比对的政策」，**不说「你不符合任何政策」**——
   *      库里没录入条件和「不符合」是两回事。
   */
  _toResultView(res) {
    const items = (res && Array.isArray(res.items)) ? res.items : []
    return {
      checkedAt: (res && res.checkedAt) || '',
      answeredCount: (res && res.answeredCount) || 0,
      disclaimer: (res && res.disclaimer) || this.data.disclaimer,
      ignoredCount: (res && Array.isArray(res.ignoredQuestionKeys)) ? res.ignoredQuestionKeys.length : 0,
      items: items.map((it) => ({
        policyId: it.policyId,
        title: it.title,
        overallLabel: it.overallLabel || '',
        conditionsRecorded: it.conditionsRecorded === true,
        manualReviewRequired: it.manualReviewRequired === true,
        summary: it.summary || { matched: 0, conflict: 0, unknown: 0, total: 0 },
        sourceName: (it.source && it.source.sourceName) || '',
      })),
      isEmpty: items.length === 0,
    }
  },

  restart() {
    this.setData({ phase: 'ask', result: null, answers: {}, answeredCount: 0 })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  tapPolicy(e) {
    const { id } = e.currentTarget.dataset
    if (!id) return
    wx.navigateTo({ url: `/pages/policy-detail/policy-detail?id=${encodeURIComponent(id)}` })
  },

  onUnload() { this._gone = true },

  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
