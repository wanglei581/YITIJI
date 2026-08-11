// pages/kiosk-login/kiosk-login.js
// 小程序扫码登录一体机：扫终端屏幕上的 QR 码，凭已登录 JWT 直接确认，无需短信验证码。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

// 从扫码结果 URL 里提取 ticketId（容错：带或不带 domain 前缀）
const TICKET_RE = /[?&]ticketId=([A-Za-z0-9_%-]{20,200})/

Page({
  data: {
    statusBarHeight: 20,
    isLoggedIn: false,
    // 'idle' | 'scanning' | 'confirming' | 'success' | 'error'
    phase: 'idle',
    deviceLabel: '',
    errorMsg: '',
  },

  onLoad() {
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      isLoggedIn: auth.isLoggedIn(),
    })
  },

  onShow() {
    // 从登录页返回后刷新登录态
    const loggedIn = auth.isLoggedIn()
    if (loggedIn !== this.data.isLoggedIn) {
      this.setData({ isLoggedIn: loggedIn })
    }
  },

  goLogin() {
    // 统一进入包含「微信一键登录 + 短信兜底」的登录页。
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  goBack() {
    wx.navigateBack()
  },

  scanCode() {
    this.setData({ phase: 'scanning', errorMsg: '' })
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: (res) => this._handleScanResult(res.result),
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('cancel')) {
          this.setData({ phase: 'idle' })
        } else {
          this.setData({ phase: 'error', errorMsg: '扫码失败，请重试' })
        }
      },
    })
  },

  async _handleScanResult(raw) {
    const match = raw.match(TICKET_RE)
    if (!match) {
      this.setData({
        phase: 'error',
        errorMsg: '这不是一体机登录码，请确认扫的是终端屏幕上的二维码',
      })
      return
    }
    const ticketId = decodeURIComponent(match[1])
    this.setData({ phase: 'confirming' })

    try {
      // 先拉票据状态，获取设备名称并检查票据是否仍有效
      const status = await api.getQrLoginStatus(ticketId)
      if (status.status === 'confirmed') {
        this.setData({ phase: 'error', errorMsg: '该二维码已被使用，请在终端刷新后重新扫码' })
        return
      }

      const deviceLabel = status.deviceLabel || '就业服务终端'
      this.setData({ deviceLabel })

      // 弹确认框
      const confirmed = await new Promise(resolve => {
        wx.showModal({
          title: '确认登录',
          content: `即将在「${deviceLabel}」上登录您的账号，确认吗？`,
          confirmText: '确认登录',
          cancelText: '取消',
          success: res => resolve(res.confirm),
          fail: () => resolve(false),
        })
      })

      if (!confirmed) {
        this.setData({ phase: 'idle' })
        return
      }

      // 凭 JWT 直接确认
      await api.confirmQrLoginByToken(ticketId)
      this.setData({ phase: 'success', deviceLabel })

    } catch (err) {
      const msg = err && err.message ? err.message : '确认失败，请重试'
      this.setData({ phase: 'error', errorMsg: msg })
    }
  },

  retry() {
    this.setData({ phase: 'idle', errorMsg: '', deviceLabel: '' })
  },
})
