const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

Page({
  data: {
    statusBarHeight: 20,
    wxLoading: false,
    phone: '',
    code: '',
    counting: false,
    countDown: 0,
    sending: false,
    submitting: false,
    agreed: true,
    codeHint: '',
    otp: ['', '', '', '', '', ''],
  },

  onLoad() {
    const fallback = () => (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).statusBarHeight
    this.setData({ statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || fallback() || 20 })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  /** 微信一键登录（getPhoneNumber 授权）。detail.code 由后端换手机号。 */
  onPhoneNumber(e) {
    if (this.data.wxLoading) return
    if (!this.data.agreed) {
      wx.showToast({ title: '请先同意服务协议和隐私政策', icon: 'none' })
      return
    }
    const phoneCode = e.detail && e.detail.code
    if (!phoneCode) {
      wx.showToast({ title: '微信授权未完成，可改用短信登录', icon: 'none' })
      return
    }
    this.setData({ wxLoading: true })
    wx.showLoading({ title: '登录中', mask: true })
    api.loginByPhone(phoneCode)
      .then((res) => {
        auth.saveSession(res)
        wx.hideLoading()
        this.setData({ wxLoading: false })
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 600)
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ wxLoading: false })
        wx.showToast({ title: (err && err.message) || '微信登录失败，请用短信登录', icon: 'none' })
      })
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
    const phone = this.data.phone.replace(/\s/g, '')
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    this.setData({ sending: true })
    wx.showLoading({ title: '发送中', mask: true })
    api.sendOtp(phone)
      .then((res) => {
        wx.hideLoading()
        const masked = phone.slice(0, 3) + '****' + phone.slice(7)
        const seconds = (res && res.cooldownSeconds) || 60
        this.setData({ sending: false, codeHint: `验证码已发送至 ${masked}` })
        wx.showToast({ title: '验证码已发送', icon: 'none' })
        this.startCountDown(seconds)
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ sending: false, codeHint: '' })
        wx.showToast({ title: (err && err.message) || '发送失败，请稍后重试', icon: 'none' })
      })
  },

  startCountDown(seconds) {
    this.clearCountDown()
    this.setData({ counting: true, countDown: seconds })
    this._timer = setInterval(() => {
      const n = this.data.countDown - 1
      if (n <= 0) {
        this.clearCountDown()
        this.setData({ counting: false, countDown: 0 })
      } else {
        this.setData({ countDown: n })
      }
    }, 1000)
  },

  clearCountDown() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  onUnload() { this.clearCountDown() },

  confirm() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先同意服务协议和隐私政策', icon: 'none' })
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
      .then((res) => {
        auth.saveSession(res)
        wx.hideLoading()
        this.setData({ submitting: false })
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 600)
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ submitting: false, code: '', otp: ['', '', '', '', '', ''] })
        wx.showToast({ title: (err && err.message) || '登录失败，请重试', icon: 'none' })
      })
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed })
  },

  tapTerms() {
    wx.navigateTo({ url: '/pages/terms/terms' })
  },

  tapPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' })
  },
})
