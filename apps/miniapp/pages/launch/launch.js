// pages/launch/launch.js
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

// 只允许回到已经明确需要登录的现有页面，禁止把任意 query 当成跳转地址。
const LOGIN_RETURN_ROUTES = new Set([
  '/pages/documents/documents',
  '/pages/membership/membership',
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
  },

  onLoad(options) {
    const fallback = () => (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).statusBarHeight
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || fallback() || 20,
      returnTo: safeReturnTo(options && options.returnTo),
    })
  },

  onUnload() {
    this._clearCountDown()
  },

  // ── 微信一键登录 ──────────────────────────────────────────────────

  onGetPhoneNumber(e) {
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
        auth.saveSession(res)
        wx.hideLoading()
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => this._afterLogin(), 600)
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: (err && err.message) || '微信登录失败，请用短信验证码', icon: 'none' })
        setTimeout(() => this.setData({ showSms: true }), 1200)
      })
  },

  // ── 短信验证码登录（内嵌，不跳页面）──────────────────────────────

  tapSmsLogin() {
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
        this.setData({ sending: false, codeHint: '' })
        wx.showToast({ title: (err && err.message) || '发送失败，请稍后重试', icon: 'none' })
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
        auth.saveSession(res)
        wx.hideLoading()
        this.setData({ submitting: false })
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => this._afterLogin(), 600)
      })
      .catch(err => {
        wx.hideLoading()
        this.setData({ submitting: false, code: '', otp: ['','','','','',''] })
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
