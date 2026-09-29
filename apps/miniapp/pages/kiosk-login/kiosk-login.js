// pages/kiosk-login/kiosk-login.js
// 小程序扫码登录一体机：扫终端屏幕上的 QR 码，凭已登录 JWT 确认这一次登录请求，无需短信验证码。
//
// 手机这一步只做「确认」。服务端 confirmByToken 只把票据标成 confirmed，手机拿不到任何登录态；
// 一体机要自己轮询到 confirmed 再 claim 才真正登录，而 claim 会失败（一体机会清掉二维码要求重扫）。
// 所以本页最多只能说「已确认，请回一体机查看登录结果」，不说「登录成功 / 已在该机完成登录」。
// 口径与状态拆分按 docs/design/kiosk-redesign-2026-08/51-phone-relay.html 的 qr-login 分屏。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

// 从扫码结果 URL 里提取 ticketId（容错：带或不带 domain 前缀）
const TICKET_RE = /[?&]ticketId=([A-Za-z0-9_%-]{20,200})/

/**
 * 一体机「手机扫码上传」的码：`<origin><path>#sessionId=xx&token=xx`。
 * 参数在 **fragment** 里而不是 query —— 一体机侧 buildPhoneUploadUrl 是这么拼的，
 * 用 `[?&]` 匹配不到，必须认 `#` 与 `&`。
 */
const UPLOAD_SESSION_RE = /[#&]sessionId=([A-Za-z0-9_%-]{8,200})/
const UPLOAD_TOKEN_RE = /[#&]token=([A-Za-z0-9_.%-]{8,400})/

/** 票据总寿命（member-qr-login.service.ts 的 QR_TICKET_TTL）。status 回的是**剩余**秒数，不是它。 */
const QR_TICKET_TTL_SECONDS = 180

/** 服务端已经断定这张票据不能再确认：再试只会再失败一次，只能回一体机。 */
const DEAD_TICKET_CODES = [
  'QR_LOGIN_NOT_FOUND',
  'QR_LOGIN_ALREADY_CLAIMED',
  'QR_LOGIN_ALREADY_CONFIRMED',
  'QR_LOGIN_TICKET_INVALID',
]

function isDeadTicket(err) {
  return !!err && DEAD_TICKET_CODES.indexOf(err.code) >= 0
}

/**
 * request.js 会把 2xx 的 `{}`、`{ data: null }` 解包成兑现 —— 兑现本身不是确认。
 * 只有回执就是 { status: 'confirmed' } 才算；其余一律按结果未知处理。
 */
function isConfirmedReceipt(res) {
  return !!res && typeof res === 'object' && res.status === 'confirmed'
}

/** 4xx = 服务端处理过并拒绝了这一次；断网（-1）、超时、5xx 都没有结论。 */
function isServerRejection(err) {
  const code = err && err.statusCode
  return typeof code === 'number' && code >= 400 && code < 500
}

function readDeviceLabel(status) {
  const raw = status && typeof status.deviceLabel === 'string' ? status.deviceLabel.trim() : ''
  return raw.slice(0, 40)
}

function readRemainSeconds(status) {
  const n = status && status.expiresInSeconds
  return Number.isInteger(n) && n > 0 && n <= QR_TICKET_TTL_SECONDS ? n : 0
}

/**
 * 机器卡文案。deviceLabel 是可选字段：没拿到就如实说没有名称，让用户核对面前那台机器，
 * 绝不编一个名字填上去。
 */
function devCard(phase, label) {
  const known = !!label
  if (phase === 'checking') {
    return { name: '正在识别一体机', unknown: true, compact: false, desc: '正在核对这个二维码是否还有效，请稍候。', note: '' }
  }
  if (phase === 'status-error') {
    return { name: '尚未识别一体机', unknown: true, compact: false, desc: '二维码状态这次没读到，本页还不知道它是否有效。', note: '' }
  }
  if (phase === 'ticket-dead') {
    return { name: known ? label : '这台一体机', unknown: !known, compact: false, desc: '这台机器上的这张二维码，已经不能再用来确认登录了。', note: '' }
  }
  if (phase === 'confirmed') {
    return { name: known ? label : '刚才那台一体机', unknown: !known, compact: false, desc: '你的确认已经提交，手机这边到此为止，接下来看这台机器的屏幕。', note: '' }
  }
  if (phase === 'ready') {
    return {
      name: known ? label : '一体机名称未提供',
      unknown: !known,
      compact: false,
      desc: known ? '这台一体机正在请求登录你的账号。' : '这次登录请求里没有机器名称，本页无法显示是哪一台。',
      note: known
        ? '请核对：这个名称和你面前这台机器一致，二维码也是你刚才亲手扫的那一张。'
        : '请核对面前一体机屏幕上的二维码，确认就是你刚才亲手扫的那一张，再往下确认。',
    }
  }
  // confirming / unknown / rejected：收成一行，把状态说明留在首屏
  return {
    name: known ? label : '一体机名称未提供',
    unknown: !known,
    compact: true,
    desc: known ? '正在为这台机器确认登录。' : '这次登录请求没带机器名称。',
    note: '',
  }
}

Page({
  data: {
    statusBarHeight: 20,
    isLoggedIn: false,
    // idle 引导扫码 · scanning 扫码中 · scan-error 没扫到 / 不是一体机的码
    // checking 读票据 · status-error 没读到（可重读） · ticket-dead 票据已不能再确认（回一体机）
    // ready 待本人确认 · confirming 确认中 · confirmed 已确认（回一体机看结果）
    // unknown 确认结果未知（不再确认，只能重读状态） · rejected 服务端拒绝了这一次
    phase: 'idle',
    deviceLabel: '',
    dev: null,
    remainSeconds: 0,
    ttlSeconds: QR_TICKET_TTL_SECONDS,
    errorMsg: '',
    note: '',
  },

  onLoad() {
    // 票据只留在内存：不进 data（手机可能被人凑过来看，也不该进截图 / 日志）。
    this._ticketId = ''
    // 每次扫码 / 重置都换一轮；晚到的响应对不上轮次就丢弃。
    this._flow = 0
    // 这一轮属于哪个会话。换号或退出之后，上一个人的票据与结果一律作废。
    this._gen = auth.sessionGeneration()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      isLoggedIn: auth.isLoggedIn(),
    })
  },

  onShow() {
    // 从登录页返回、或在别处换了账号
    if (!auth.isSameSession(this._gen)) {
      this._reset()
      return
    }
    const loggedIn = auth.isLoggedIn()
    if (loggedIn !== this.data.isLoggedIn) this.setData({ isLoggedIn: loggedIn })
  },

  onUnload() {
    this._flow += 1
    this._ticketId = ''
  },

  goLogin() {
    // 统一进入包含「微信一键登录 + 短信兜底」的登录页。
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  goBack() {
    wx.navigateBack()
  },

  /** 丢掉当前这一轮，回到当前账号的起点。 */
  _reset(phase) {
    this._flow += 1
    this._ticketId = ''
    this._gen = auth.sessionGeneration()
    this.setData({
      phase: phase || 'idle',
      isLoggedIn: auth.isLoggedIn(),
      deviceLabel: '',
      dev: null,
      remainSeconds: 0,
      errorMsg: '',
      note: '',
    })
  },

  /** 这一发响应还属于屏幕上这一轮、这个账号吗。换了账号就顺手清场。 */
  _owns(flow) {
    if (flow !== this._flow) return false
    if (auth.isSameSession(this._gen)) return true
    this._reset()
    return false
  },

  _show(phase, patch) {
    const label = patch && patch.deviceLabel !== undefined ? patch.deviceLabel : this.data.deviceLabel
    this.setData(Object.assign({ phase, dev: devCard(phase, label), errorMsg: '', note: '' }, patch))
  },

  scanCode() {
    this._reset('scanning')
    const flow = this._flow
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: (res) => {
        if (flow === this._flow) this._handleScanResult(res && res.result)
      },
      fail: (err) => {
        if (flow !== this._flow) return
        if (err && err.errMsg && err.errMsg.includes('cancel')) {
          this.setData({ phase: 'idle' })
        } else {
          this.setData({ phase: 'scan-error', errorMsg: '扫码失败，请重试' })
        }
      },
    })
  },

  _handleScanResult(raw) {
    const text = typeof raw === 'string' ? raw : ''
    // 一体机屏幕上有两类码：登录票据、手机上传会话。先按码型分流，
    // 不能一律当登录码处理 —— 那会让扫上传码的人看到「这不是一体机登录码」，
    // 而他扫的恰恰就是终端屏幕上的码。
    const session = text.match(UPLOAD_SESSION_RE)
    const token = text.match(UPLOAD_TOKEN_RE)
    if (session && token) {
      try {
        const url = '/pages/kiosk-send/kiosk-send'
          + '?sessionId=' + encodeURIComponent(decodeURIComponent(session[1]))
          + '&token=' + encodeURIComponent(decodeURIComponent(token[1]))
        this.setData({ phase: 'idle' })
        wx.navigateTo({ url })
      } catch (_) {
        this.setData({ phase: 'scan-error', errorMsg: '这张上传码读不出来，请回一体机重新生成后再扫' })
      }
      return
    }

    const match = text.match(TICKET_RE)
    let ticketId = ''
    try {
      ticketId = match ? decodeURIComponent(match[1]) : ''
    } catch (_) {
      ticketId = ''
    }
    if (!ticketId) {
      this.setData({
        phase: 'scan-error',
        errorMsg: '这不是一体机上的二维码，请确认扫的是终端屏幕上的登录码或上传码',
      })
      return
    }
    this._ticketId = ticketId
    this._readStatus('scan')
  },

  /**
   * 读这张票据的状态（无需登录、不改变任何东西）。
   * mode：scan 刚扫到 · recheck 重新检查 · after-unknown 确认结果未知后的自查
   */
  _readStatus(mode) {
    const ticketId = this._ticketId
    if (!ticketId) return
    const flow = this._flow
    this._show('checking')
    api.getQrLoginStatus(ticketId).then(
      (status) => {
        if (!this._owns(flow)) return
        const known = status && typeof status === 'object'
          && (status.status === 'pending' || status.status === 'confirmed')
        if (!known) {
          // 看不懂的回执不是结论
          this._statusUnreadable(mode)
          return
        }
        const deviceLabel = readDeviceLabel(status)
        if (status.status === 'confirmed') {
          this._ticketDead(deviceLabel)
          return
        }
        this._show('ready', {
          deviceLabel,
          remainSeconds: readRemainSeconds(status),
          note: mode === 'after-unknown'
            ? '这张二维码还在等待确认，说明刚才那次确认没有生效。核对面前的一体机后，可以再确认一次。'
            : '',
        })
      },
      (err) => {
        if (!this._owns(flow)) return
        if (isDeadTicket(err)) this._ticketDead(this.data.deviceLabel)
        else this._statusUnreadable(mode)
      },
    )
  },

  _statusUnreadable(mode) {
    if (mode === 'after-unknown') {
      // 仍然没有结论：留在结果未知这一屏，不退回可以确认的屏。
      this._show('unknown', { note: '这次检查也没有拿到结果。请先回一体机看屏幕，稍后可以再检查一次。' })
    } else {
      this._show('status-error', { remainSeconds: 0 })
    }
  },

  _ticketDead(deviceLabel) {
    this._ticketId = ''
    this._show('ticket-dead', { deviceLabel, remainSeconds: 0 })
  },

  /** 本人在页面上核对过机器之后确认。只在 ready 屏可用，一张票据一次只发一发。 */
  confirmLogin() {
    if (this.data.phase !== 'ready' || !this._ticketId) return
    if (!auth.isLoggedIn() || !auth.isSameSession(this._gen)) {
      this._reset()
      return
    }
    const flow = this._flow
    this._show('confirming')
    api.confirmQrLoginByToken(this._ticketId).then(
      (res) => {
        if (!this._owns(flow)) return
        if (isConfirmedReceipt(res)) {
          this._ticketId = ''
          this._show('confirmed', { remainSeconds: 0 })
        } else {
          this._show('unknown')
        }
      },
      (err) => {
        if (!this._owns(flow)) return
        if (isDeadTicket(err)) {
          this._ticketDead(this.data.deviceLabel)
        } else if (isServerRejection(err)) {
          this._show('rejected', {
            isLoggedIn: auth.isLoggedIn(),
            errorMsg: (err && err.message) || '系统没有接受这次确认。可以重新检查这张二维码，或回一体机刷新后再扫。',
          })
        } else {
          // 请求发出去了、结果没回来：那次确认可能早就生效了，不能盲发第二次。
          this._show('unknown')
        }
      },
    )
  },

  /** 重读状态。结果未知时这是唯一负责任的动作：它只读，不会替用户再确认一次。 */
  recheck() {
    const from = this.data.phase
    if (['status-error', 'unknown', 'rejected'].indexOf(from) < 0 || !this._ticketId) return
    this._readStatus(from === 'unknown' ? 'after-unknown' : 'recheck')
  },

  /** 不是面前这台机器：什么都没发，直接放弃这张票据。 */
  cancelConfirm() {
    if (this.data.phase !== 'ready') return
    this._reset()
  },
})
