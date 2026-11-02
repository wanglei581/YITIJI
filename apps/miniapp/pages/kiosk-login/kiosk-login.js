// pages/kiosk-login/kiosk-login.js
// 小程序扫码登录一体机：扫终端屏幕上的 QR 码，凭已登录 JWT 确认这一次登录请求，无需短信验证码。
//
// 手机这一步只做「确认」。服务端 confirmByToken 只把票据标成 confirmed，手机拿不到任何登录态；
// 一体机要自己轮询到 confirmed 再 claim 才真正登录，而 claim 会失败（一体机会清掉二维码要求重扫）。
// 所以本页最多只能说「已确认，请回一体机查看登录结果」，不说「登录成功 / 已在该机完成登录」。
// 口径与状态拆分按 docs/design/kiosk-redesign-2026-08/51-phone-relay.html 的 qr-login 分屏。
//
// 进页三条路：首页「扫码连接一体机」（autoScan=1，进页就开扫码）；
// 微信「扫一扫」直接扫一体机的登录码（`https://<域名>/k/l/<ticketId>`，整条码在 options.q）；
// 传文件页把扫到的登录码转过来（同样带 q）。q 若是传文件码，转给 pages/kiosk-send。
// 扫码时还没登录也照样读票据；去登录再回来，票据还是这一张，接着确认（见 _resumeAfterLogin）。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
// 一体机屏幕上的码（登录码、传文件码，新旧两种格式）都由 utils/kiosk-qr.js 认。
const { parseKioskCode } = require('../../utils/kiosk-qr')

const NOT_KIOSK_COPY = '这不是一体机上的二维码，请确认扫的是终端屏幕上的登录码或上传码'

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
    capsuleInsetRight: 94,
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

  onLoad(options) {
    // 票据只留在内存：不进 data（手机可能被人凑过来看，也不该进截图 / 日志）。
    this._ticketId = ''
    // 每次扫码 / 重置都换一轮；晚到的响应对不上轮次就丢弃。
    this._flow = 0
    // 这一轮属于哪个会话。换号或退出之后，上一个人的票据与结果一律作废。
    this._gen = auth.sessionGeneration()
    // 这一轮开始时有没有登录。没登录时扫到的票据，登录回来还能接着用。
    this._genLoggedIn = auth.isLoggedIn()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      capsuleInsetRight: app.globalData.capsuleInsetRight || 94,
      isLoggedIn: this._genLoggedIn,
    })
    // 微信扫一体机屏幕上的普通链接码进来：整条码在 q 里（微信编码过一次）。
    if (options && options.q) {
      this._openLink(options.q)
      return
    }
    // 首页「扫码连接一体机」进来：直接开扫码。取消扫码就停在本页说明上，不算出错。
    if (options && options.autoScan === '1') this.scanCode()
  },

  onShow() {
    // 从登录页返回、或在别处换了账号
    if (!auth.isSameSession(this._gen)) {
      if (!this._resumeAfterLogin()) this._reset()
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
    // 扫码直达时本页在栈底，navigateBack 会失败：回首页，不留一个点了没反应的返回键。
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  /** q：解一次再认码型。登录码在本页读票据；传文件码转给 kiosk-send；别的码说清不是一体机的码。 */
  _openLink(q) {
    let raw = ''
    try {
      raw = decodeURIComponent(String(q))
    } catch (_) {
      raw = ''
    }
    const code = parseKioskCode(raw)
    if (code && code.kind === 'login') {
      this._ticketId = code.ticketId
      this._readStatus('scan')
      return
    }
    if (code) {
      wx.redirectTo({
        url: '/pages/kiosk-send/kiosk-send?q=' + encodeURIComponent(raw),
        fail: () => this.setData({ phase: 'scan-error', errorMsg: '没能打开传文件页，请重新扫码。' }),
      })
      return
    }
    this.setData({ phase: 'scan-error', errorMsg: NOT_KIOSK_COPY })
  },

  /**
   * 扫码时还没登录、这会儿登录上了：票据是本人刚扫的那一张，接着用。
   * 换成新代号、作废没登录时发出的在途读取，再读一次状态（过期就进 ticket-dead，没过期进 ready）。
   * 已登录换成另一个人、或退出登录，都不算 —— 照旧按换人清场。
   * @returns {boolean} 接上了返回 true；调用方拿到 false 就清场。
   */
  _resumeAfterLogin() {
    if (this._genLoggedIn || !auth.isLoggedIn()) return false
    // 登录前就读到这张票据已经不能再确认了：照旧停在「回一体机」那一屏，不退回扫码引导
    const dead = !this._ticketId && this.data.phase === 'ticket-dead'
    if (!this._ticketId && !dead) return false
    this._flow += 1
    this._gen = auth.sessionGeneration()
    this._genLoggedIn = true
    this.setData({ isLoggedIn: true })
    if (!dead) this._readStatus('scan')
    return true
  },

  /** 丢掉当前这一轮，回到当前账号的起点。 */
  _reset(phase) {
    this._flow += 1
    this._ticketId = ''
    this._gen = auth.sessionGeneration()
    this._genLoggedIn = auth.isLoggedIn()
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

  /**
   * 这一发响应还属于屏幕上这一轮、这个账号吗。换了账号就顺手清场；
   * 没登录时扫的票据、读的途中登录上了，则接着用这张票据重读（这一发照样丢掉）。
   */
  _owns(flow) {
    if (flow !== this._flow) return false
    if (auth.isSameSession(this._gen)) return true
    if (!this._resumeAfterLogin()) this._reset()
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
    const text = typeof raw === 'string' ? raw.trim() : ''
    // 一体机屏幕上有两类码：登录票据、手机上传会话。先按码型分流，
    // 不能一律当登录码处理 —— 那会让扫上传码的人看到「这不是一体机登录码」，
    // 而他扫的恰恰就是终端屏幕上的码。
    const code = parseKioskCode(text)
    if (code && code.kind === 'upload-scene') {
      // 新码：整条码带过去，由传文件页自己兑换
      this.setData({ phase: 'idle' })
      wx.navigateTo({ url: '/pages/kiosk-send/kiosk-send?q=' + encodeURIComponent(text) })
      return
    }
    if (code && code.kind === 'upload-session') {
      // 旧码：照旧直接带 sessionId / token
      this.setData({ phase: 'idle' })
      wx.navigateTo({
        url: '/pages/kiosk-send/kiosk-send'
          + '?sessionId=' + encodeURIComponent(code.sessionId)
          + '&token=' + encodeURIComponent(code.token),
      })
      return
    }
    if (!code) {
      this.setData({ phase: 'scan-error', errorMsg: NOT_KIOSK_COPY })
      return
    }
    this._ticketId = code.ticketId
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
    if (!auth.isSameSession(this._gen)) {
      if (!this._resumeAfterLogin()) this._reset()
      return
    }
    if (!auth.isLoggedIn()) {
      // 先登录再确认：票据留在内存里，页面落到「请先登录小程序」，登录回来接着用这一张
      this.setData({ isLoggedIn: false })
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
