// pages/launch/launch.js
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

// 只允许回到已经明确需要登录的现有页面，禁止把任意 query 当成跳转地址。
// 「我的权益」「合同审查」两页已停放（首发按非招聘类目提审，compliance-boundary.md §1.1），
// 从这里摘掉；恢复页面时一并加回（合同审查 6 个端点全部要会员身份，未登录整条链 404）。
const LOGIN_RETURN_ROUTES = new Set([
  '/pages/documents/documents',
  '/pages/notifications/notifications',
])

function safeReturnTo(raw) {
  if (!raw) return ''
  let value = String(raw)
  try { value = decodeURIComponent(value) } catch (_) {}
  return LOGIN_RETURN_ROUTES.has(value) ? value : ''
}

Page({
  data: {
    statusBarHeight: 20,
    agreed: false,
    // 登录模式：false = 微信一键（默认），true = 短信验证码（内嵌表单）
    showSms: false,
    // 短信表单
    phone: '',
    code: '',
    otp: ['', '', '', '', '', ''],
    counting: false,
    countDown: 0,
    sending: false,
    submitting: false,
    codeHint: '',
    returnTo: '',
    // 正式版取不到已发布的协议（C4）：先说清楚，不让人交出手机号之后才失败。
    legalBlocked: false,
  },

  onLoad(options) {
    const fallback = () => (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).statusBarHeight
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || fallback() || 20,
      returnTo: safeReturnTo(options && options.returnTo),
    })
    this._checkLegal()
  },

  /**
   * 正式版协议没发布就拦住登录（C4）。只认 LEGAL_DOCS_NOT_PUBLISHED；网络失败不下结论，
   * 真去登录时会照实失败。开发版、体验版回落草稿版本号，这里不会拦（见 utils/api-legal-consent.js）。
   */
  _checkLegal() {
    api.getLegalVersions().then(
      () => this.setData({ legalBlocked: false }),
      (err) => { if (err && err.code === 'LEGAL_DOCS_NOT_PUBLISHED') this.setData({ legalBlocked: true }) },
    )
  },

  _explainLegalBlocked() {
    wx.showModal({
      title: '暂时不能登录',
      content: '服务协议还没有正式发布，发布前不能登录。不登录也可以看使用帮助和打印指引，也可以扫一体机屏幕上的码，把文件传到一体机打印。',
      showCancel: false,
      confirmText: '知道了',
    })
  },

  /** 服务端登录时才发现协议没发布（例如体验版连着生产）：同样拦住并说清楚。 */
  _handleLoginError(err) {
    if (!err || err.code !== 'LEGAL_DOCS_NOT_PUBLISHED') return false
    this.setData({ legalBlocked: true, showSms: false })
    this._explainLegalBlocked()
    return true
  },

  /**
   * 登录成功后对一次账：勾选行写着「并确认已年满 14 周岁」，登录即声明；
   * 本机未登录时同意过的录音同意补写到账号里，在别处撤回的以撤回为准。失败不影响登录。
   */
  _syncDeclarations() {
    api.syncAiDeclarationsAfterLogin()
  },

  onUnload() {
    this._clearCountDown()
  },

  // ── 微信一键登录 ──────────────────────────────────────────────────

  onGetPhoneNumber(e) {
    if (this.data.legalBlocked) { this._explainLegalBlocked(); return }
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意服务协议和隐私政策', icon: 'none' })
      return
    }
    const d = e.detail || {}
    if (!d.code) {
      wx.showToast({ title: '未获取到手机号，可用短信验证码登录', icon: 'none' })
      return
    }
    wx.showLoading({ title: '登录中', mask: true })
    api.loginByPhone(d.code)
      .then(res => {
        const saved = auth.saveSession(res)
        wx.hideLoading()
        // 存不下的会话等于没有会话:这时跳走,用户以为登录了,下一页当场 401。
        if (!saved) {
          wx.showToast({ title: '登录状态未能保存，请重试', icon: 'none' })
          return
        }
        this._syncDeclarations()
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => this._afterLogin(), 600)
      })
      .catch(err => {
        wx.hideLoading()
        if (this._handleLoginError(err)) return
        wx.showToast({ title: (err && err.message) || '微信登录失败，请用短信验证码', icon: 'none' })
        setTimeout(() => this.setData({ showSms: true }), 1200)
      })
  },

  // ── 短信验证码登录（内嵌，不跳页面）──────────────────────────────

  tapSmsLogin() {
    if (this.data.legalBlocked) { this._explainLegalBlocked(); return }
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意服务协议和隐私政策', icon: 'none' })
      return
    }
    this.setData({ showSms: true })
  },

  tapBackToWx() {
    this._clearCountDown()
    this.setData({ showSms: false, phone: '', code: '', otp: ['','','','','',''], codeHint: '', counting: false, countDown: 0 })
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value })
  },

  onCodeInput(e) {
    const raw = e.detail.value.replace(/\D/g, '').slice(0, 6)
    const otp = Array.from({ length: 6 }, (_, i) => raw[i] || '')
    this.setData({ code: raw, otp })
  },

  sendCode() {
    if (this.data.counting || this.data.sending) return
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意服务协议和隐私政策', icon: 'none' })
      return
    }
    const phone = this.data.phone.replace(/\s/g, '')
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    this.setData({ sending: true })
    wx.showLoading({ title: '发送中', mask: true })
    api.sendOtp(phone)
      .then(res => {
        wx.hideLoading()
        const masked = phone.slice(0, 3) + '****' + phone.slice(7)
        const seconds = (res && res.cooldownSeconds) || 60
        this.setData({ sending: false, codeHint: `验证码已发送至 ${masked}` })
        wx.showToast({ title: '验证码已发送', icon: 'none' })
        this._startCountDown(seconds)
      })
      .catch(err => {
        wx.hideLoading()
        const reason = (err && err.message) || '发送失败，请稍后重试'
        // 原因留在输入框下方：toast 一闪就没，被限流的人不知道要等多久（走查 9/29）。
        this.setData({ sending: false, codeHint: reason })
        wx.showToast({ title: reason, icon: 'none' })
      })
  },

  confirmSms() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意服务协议和隐私政策', icon: 'none' })
      return
    }
    if (this.data.code.length < 6) {
      wx.showToast({ title: '请输入完整的验证码', icon: 'none' })
      return
    }
    const phone = this.data.phone.replace(/\s/g, '')
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })
    wx.showLoading({ title: '登录中', mask: true })
    api.loginBySms(phone, this.data.code)
      .then(res => {
        const saved = auth.saveSession(res)
        wx.hideLoading()
        this.setData({ submitting: false })
        // 与微信入口同一条判据:没存下就留在本页,不提示成功、不跳转。
        if (!saved) {
          this.setData({ code: '', otp: ['','','','','',''] })
          wx.showToast({ title: '登录状态未能保存，请重试', icon: 'none' })
          return
        }
        this._syncDeclarations()
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => this._afterLogin(), 600)
      })
      .catch(err => {
        wx.hideLoading()
        this.setData({ submitting: false, code: '', otp: ['','','','','',''] })
        if (this._handleLoginError(err)) return
        wx.showToast({ title: (err && err.message) || '登录失败，请重试', icon: 'none' })
      })
  },

  // ── 公共 ──────────────────────────────────────────────────────────

  tapSkip() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
    } else {
      wx.switchTab({ url: '/pages/home/home' })
    }
  },

  _afterLogin() {
    if (this.data.returnTo) {
      wx.redirectTo({
        url: this.data.returnTo,
        fail() { wx.switchTab({ url: '/pages/home/home' }) },
      })
      return
    }
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
    } else {
      wx.switchTab({ url: '/pages/home/home' })
    }
  },

  _startCountDown(seconds) {
    this._clearCountDown()
    this.setData({ counting: true, countDown: seconds })
    this._timer = setInterval(() => {
      const n = this.data.countDown - 1
      if (n <= 0) {
        this._clearCountDown()
        this.setData({ counting: false, countDown: 0 })
      } else {
        this.setData({ countDown: n })
      }
    }, 1000)
  },

  _clearCountDown() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  },

  toggleAgree() { this.setData({ agreed: !this.data.agreed }) },
  tapTerms()   { wx.navigateTo({ url: '/pages/legal/legal?type=terms_of_service' }) },
  tapPrivacy() { wx.navigateTo({ url: '/pages/legal/legal?type=privacy_policy' }) },
})
