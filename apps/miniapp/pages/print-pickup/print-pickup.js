const app = getApp()
const api = require('../../utils/api')
const { PICKUP_CODE_RE, createPickupQrMatrix, normalizePickupCode } = require('../../utils/pickup-qrcode')

const POLL_INTERVAL_MS = 3000
const TERMINAL_STATES = new Set(['completed', 'failed', 'expired', 'cancelled', 'abandoned'])

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
  return hours > 0 ? `${hours}小时${minutes}分钟后过期` : `${Math.max(1, minutes)}分钟后过期`
}

function resolveOrderState(order) {
  const pickupStatus = String(order.pickupStatus || '')
  const taskStatus = String(order.taskStatus || '')

  if (pickupStatus === 'expired' || taskStatus === 'expired') {
    return { key: 'expired', title: '取件码已过期', detail: '请返回打印订单重新发起打印。', showQr: false }
  }
  if (pickupStatus === 'cancelled' || taskStatus === 'cancelled') {
    return { key: 'cancelled', title: '订单已取消', detail: '本次取件码已经失效。', showQr: false }
  }
  if (taskStatus === 'failed') {
    return { key: 'failed', title: '打印失败', detail: '请查看终端提示，或联系现场工作人员处理。', showQr: false }
  }
  if (taskStatus === 'abandoned') {
    return { key: 'abandoned', title: '打印任务已终止', detail: '请返回订单页重新发起，或联系现场工作人员处理。', showQr: false }
  }
  if (taskStatus === 'completed') {
    return { key: 'completed', title: '打印已完成', detail: '请及时取走纸张并检查是否齐全。', showQr: false }
  }
  if (taskStatus === 'printing') {
    return { key: 'printing', title: '正在打印', detail: '终端已经开始出纸，请在设备旁等候。', showQr: false }
  }
  if (pickupStatus === 'used' || taskStatus === 'pending' || taskStatus === 'claimed') {
    return { key: 'queued', title: '已进入打印队列', detail: '终端已核销并创建打印任务，请等待出纸。', showQr: false }
  }
  if (pickupStatus === 'claimed' || taskStatus === 'awaiting_payment') {
    return { key: 'awaiting_payment', title: '已扫码，等待现场支付', detail: '请在一体机确认订单并完成现场支付。', showQr: false }
  }
  return { key: 'pending', title: '等待终端扫码', detail: '将二维码对准一体机扫码器，或手动输入取件码。', showQr: true }
}

Page({
  _countdownTimer: null,
  _pollTimer: null,
  _polling: false,
  _pageReady: false,
  _visible: true,

  data: {
    statusBarHeight: 20,
    state: 'loading', // loading | ready | error
    errorMsg: '',
    orderId: '',
    fromOrders: false,
    orderNo: '',
    taskStatus: '',
    pickupStatus: '',
    statusKey: 'pending',
    statusTitle: '等待终端扫码',
    statusDetail: '',
    showQr: false,
    code: '',
    codeRaw: '',
    expiresAt: 0,
    countdown: '',
    qrSizePx: 216,
    qrStatus: 'loading',
    refreshing: false,
  },

  onLoad(opts) {
    const q = opts || {}
    const orderId = q.orderId ? decodeURIComponent(q.orderId) : ''
    const pickupCode = normalizePickupCode(q.pickupCode ? decodeURIComponent(q.pickupCode) : '')
    const expiresAt = q.expiresAt ? new Date(decodeURIComponent(q.expiresAt)).getTime() : 0
    const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : { windowWidth: 375 }
    const qrSizePx = Math.round(Math.max(188, Math.min(232, windowInfo.windowWidth * 0.56)))
    const initial = resolveOrderState({
      pickupStatus: PICKUP_CODE_RE.test(pickupCode) ? 'pending' : '',
      taskStatus: q.taskStatus ? decodeURIComponent(q.taskStatus) : '',
    })

    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      orderId,
      fromOrders: q.source === 'orders',
      orderNo: q.orderNo ? decodeURIComponent(q.orderNo) : '',
      taskStatus: q.taskStatus ? decodeURIComponent(q.taskStatus) : '',
      pickupStatus: PICKUP_CODE_RE.test(pickupCode) ? 'pending' : '',
      code: formatCode(pickupCode),
      codeRaw: PICKUP_CODE_RE.test(pickupCode) ? pickupCode : '',
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
      qrSizePx,
      qrStatus: 'loading',
      state: orderId ? 'loading' : (PICKUP_CODE_RE.test(pickupCode) ? 'ready' : 'error'),
      errorMsg: orderId || PICKUP_CODE_RE.test(pickupCode) ? '' : '订单信息不完整，请返回订单列表刷新状态',
      statusKey: initial.key,
      statusTitle: initial.title,
      statusDetail: initial.detail,
      showQr: initial.showQr && PICKUP_CODE_RE.test(pickupCode),
    })

    if (orderId) this._refreshOrder(true)
    else this._resumeVisibleWork()
  },

  onReady() {
    this._pageReady = true
    this._drawPickupQr()
  },

  onShow() {
    this._visible = true
    if (this.data.orderId) this._refreshOrder(false)
    else this._resumeVisibleWork()
  },

  onHide() {
    this._visible = false
    this._stopTimers()
  },

  onUnload() {
    this._visible = false
    this._stopTimers()
  },

  _refreshOrder(initial) {
    if (!this.data.orderId || this._polling) return
    this._polling = true
    if (initial) this.setData({ state: 'loading', errorMsg: '' })
    else this.setData({ refreshing: true })

    api.getCloudPrintOrder(this.data.orderId)
      .then((order) => {
        this._polling = false
        if (!this._visible || !order) return
        const pickupCode = normalizePickupCode(order.pickupCode || this.data.codeRaw)
        const hasCode = PICKUP_CODE_RE.test(pickupCode)
        const status = resolveOrderState(order)
        const expiresAt = order.pickupCodeExpiresAt ? new Date(order.pickupCodeExpiresAt).getTime() : this.data.expiresAt
        const shouldRedraw = status.showQr && hasCode && pickupCode !== this.data.codeRaw

        this.setData({
          state: 'ready',
          errorMsg: '',
          refreshing: false,
          orderNo: order.orderNo || this.data.orderNo,
          taskStatus: order.taskStatus || '',
          pickupStatus: order.pickupStatus || '',
          statusKey: status.key,
          statusTitle: status.title,
          statusDetail: status.detail,
          showQr: status.showQr && hasCode,
          codeRaw: status.showQr && hasCode ? pickupCode : '',
          code: status.showQr && hasCode ? formatCode(pickupCode) : '',
          expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
          qrStatus: shouldRedraw ? 'loading' : this.data.qrStatus,
        }, () => {
          if (this.data.showQr) this._drawPickupQr()
          this._resumeVisibleWork()
        })
      })
      .catch((err) => {
        this._polling = false
        if (!this._visible) return
        if (err && err.statusCode === 401) {
          const fallbackAvailable = this.data.state === 'ready' || Boolean(this.data.showQr && this.data.codeRaw)
          this.setData({
            state: fallbackAvailable ? 'ready' : 'error',
            refreshing: false,
            errorMsg: '登录已失效，请返回订单页重新登录后查看实时状态',
          }, () => {
            // 已经显示在本机的真实到机码仍可在有效期内使用，但停止无意义的 401 轮询。
            this._stopPoll()
            if (this.data.showQr) {
              this._drawPickupQr()
              if (this.data.expiresAt > 0) this._startCountdown()
            }
          })
          return
        }
        // 首次请求失败时仍可使用 URL 中的真实取件码离线绘码；后续失败保留最近一次状态。
        const fallbackAvailable = this.data.state === 'ready' || Boolean(this.data.showQr && this.data.codeRaw)
        this.setData({
          state: fallbackAvailable ? 'ready' : 'error',
          refreshing: false,
          errorMsg: (err && err.message) || '订单状态加载失败，请稍后重试',
        }, () => {
          // onReady 可能早于首次请求失败；回退到 URL 里的真实取件码后必须主动补画。
          if (this.data.showQr) this._drawPickupQr()
          if (fallbackAvailable) this._resumeVisibleWork()
        })
      })
  },

  _resumeVisibleWork() {
    if (!this._visible || this.data.state !== 'ready') return
    if (this.data.showQr && this.data.expiresAt > 0) this._startCountdown()
    else this._stopCountdown()
    if (this.data.orderId && !TERMINAL_STATES.has(this.data.statusKey)) this._schedulePoll()
    else this._stopPoll()
  },

  _schedulePoll() {
    this._stopPoll()
    if (!this._visible || !this.data.orderId || TERMINAL_STATES.has(this.data.statusKey)) return
    this._pollTimer = setTimeout(() => this._refreshOrder(false), POLL_INTERVAL_MS)
  },

  _drawPickupQr() {
    if (!this._pageReady || this.data.state !== 'ready' || !this.data.showQr || !this.data.codeRaw) return

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
      if (ms <= 0) {
        this.setData({
          countdown: '已过期',
          showQr: false,
          codeRaw: '',
          code: '',
          statusKey: 'expired',
          statusTitle: '取件码已过期',
          statusDetail: '请返回打印订单重新发起打印。',
        })
        this._stopTimers()
        return
      }
      this.setData({ countdown: formatCountdown(ms) })
    }
    tick()
    if (this.data.showQr) this._countdownTimer = setInterval(tick, 60000)
  },

  _stopCountdown() {
    if (this._countdownTimer) clearInterval(this._countdownTimer)
    this._countdownTimer = null
  },

  _stopPoll() {
    if (this._pollTimer) clearTimeout(this._pollTimer)
    this._pollTimer = null
  },

  _stopTimers() {
    this._stopCountdown()
    this._stopPoll()
  },

  retry() {
    if (this.data.orderId) this._refreshOrder(true)
    else this.toOrders()
  },

  toOrders() {
    if (this.data.fromOrders) {
      wx.navigateBack({ fail() { wx.redirectTo({ url: '/pages/orders/orders' }) } })
      return
    }
    wx.redirectTo({ url: '/pages/orders/orders' })
  },

  home() {
    wx.switchTab({ url: '/pages/home/home' })
  },

  back() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },
})
