const app = getApp()
const { PICKUP_CODE_RE, createPickupQrMatrix, normalizePickupCode } = require('../../utils/pickup-qrcode')

function formatCode(raw) {
  if (!raw) return ''
  const value = String(raw).replace(/\s/g, '').toUpperCase()
  const groups = value.match(/.{1,2}/g)
  return groups ? groups.join('-') : ''
}

function formatCountdown(ms) {
  if (ms <= 0) return '已过期'
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  return hours > 0 ? `${hours}小时${minutes}分钟后过期` : `${minutes}分钟后过期`
}

Page({
  _countdownTimer: null,
  _pageReady: false,

  data: {
    statusBarHeight: 20,
    state: 'error',
    errorMsg: '',
    code: '',
    codeRaw: '',
    orderNo: '',
    taskStatus: '',
    expiresAt: 0,
    countdown: '',
    qrSizePx: 216,
    qrStatus: 'loading',
  },

  onLoad(opts) {
    const q = opts || {}
    const pickupCode = normalizePickupCode(q.pickupCode ? decodeURIComponent(q.pickupCode) : '')
    const expiresAt = q.expiresAt ? new Date(decodeURIComponent(q.expiresAt)).getTime() : 0
    const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : { windowWidth: 375 }
    const qrSizePx = Math.round(Math.max(188, Math.min(232, windowInfo.windowWidth * 0.56)))
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20, qrSizePx })

    if (!PICKUP_CODE_RE.test(pickupCode)) {
      this.setData({ errorMsg: '订单暂未返回取件码，请返回订单列表刷新状态' })
      return
    }

    this.setData({
      state: 'ready',
      code: formatCode(pickupCode),
      codeRaw: pickupCode,
      orderNo: q.orderNo ? decodeURIComponent(q.orderNo) : '',
      taskStatus: q.taskStatus ? decodeURIComponent(q.taskStatus) : '',
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
      qrStatus: 'loading',
    }, () => this._drawPickupQr())
    if (Number.isFinite(expiresAt) && expiresAt > 0) this._startCountdown()
  },

  onReady() {
    this._pageReady = true
    this._drawPickupQr()
  },

  onHide() { this._stopCountdown() },
  onUnload() { this._stopCountdown() },

  _drawPickupQr() {
    if (!this._pageReady || this.data.state !== 'ready' || !this.data.codeRaw) return

    let matrix
    try {
      matrix = createPickupQrMatrix(this.data.codeRaw)
    } catch (_) {
      this.setData({ qrStatus: 'error' })
      return
    }

    wx.createSelectorQuery().in(this).select('#pickup-qr').fields({ node: true, size: true }).exec((result) => {
      const target = result && result[0]
      if (!target || !target.node) {
        this.setData({ qrStatus: 'error' })
        return
      }

      const canvas = target.node
      const context = canvas.getContext('2d')
      const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : { pixelRatio: 1 }
      const pixelRatio = Math.max(1, windowInfo.pixelRatio || 1)
      const size = this.data.qrSizePx
      canvas.width = Math.round(size * pixelRatio)
      canvas.height = Math.round(size * pixelRatio)
      context.scale(pixelRatio, pixelRatio)
      context.fillStyle = '#FFFFFF'
      context.fillRect(0, 0, size, size)

      const quietZone = 4
      const cellSize = Math.floor(size / (matrix.length + quietZone * 2))
      const drawSize = cellSize * (matrix.length + quietZone * 2)
      const offset = Math.floor((size - drawSize) / 2)
      context.fillStyle = '#15100C'
      matrix.forEach((row, y) => row.forEach((dark, x) => {
        if (dark) context.fillRect(
          offset + (x + quietZone) * cellSize,
          offset + (y + quietZone) * cellSize,
          cellSize,
          cellSize,
        )
      }))
      this.setData({ qrStatus: 'ready' })
    })
  },

  _startCountdown() {
    this._stopCountdown()
    const tick = () => {
      const ms = this.data.expiresAt - Date.now()
      this.setData({ countdown: formatCountdown(ms) })
      if (ms <= 0) this._stopCountdown()
    }
    tick()
    this._countdownTimer = setInterval(tick, 60000)
  },

  _stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
  },

  toOrders() { wx.navigateBack({ fail() { wx.navigateTo({ url: '/pages/orders/orders' }) } }) },
  home() { wx.switchTab({ url: '/pages/home/home' }) },
  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
