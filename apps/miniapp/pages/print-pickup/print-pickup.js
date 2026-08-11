const app = getApp()

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

  data: {
    statusBarHeight: 20,
    state: 'error',
    errorMsg: '',
    code: '',
    orderNo: '',
    taskStatus: '',
    expiresAt: 0,
    countdown: '',
  },

  onLoad(opts) {
    const q = opts || {}
    const pickupCode = q.pickupCode ? decodeURIComponent(q.pickupCode) : ''
    const expiresAt = q.expiresAt ? new Date(decodeURIComponent(q.expiresAt)).getTime() : 0
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })

    if (!pickupCode) {
      this.setData({ errorMsg: '订单暂未返回取件码，请返回订单列表刷新状态' })
      return
    }

    this.setData({
      state: 'ready',
      code: formatCode(pickupCode),
      orderNo: q.orderNo ? decodeURIComponent(q.orderNo) : '',
      taskStatus: q.taskStatus ? decodeURIComponent(q.taskStatus) : '',
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    })
    if (Number.isFinite(expiresAt) && expiresAt > 0) this._startCountdown()
  },

  onHide() { this._stopCountdown() },
  onUnload() { this._stopCountdown() },

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
