// pages/kiosk-send/kiosk-send.js
// 把文件递进「面前这台一体机」的这一单（上传会话）。
//
// 三条入口，落到同一段上传逻辑：
//   ① 微信「扫一扫」扫一体机屏幕上的普通链接码（`https://<域名>/k/u/<scene>`）：
//      按「扫普通链接二维码打开小程序」规则直达本页，整条码在 options.q（微信编码过一次）。
//      扫到的若是一体机的登录码（/k/l/），转给 pages/kiosk-login。码型见 utils/kiosk-qr.js。
//   ② 微信扫小程序码（旧）：带 `scene`。
//      ①② 的 scene 都只是不透明凭据，要 POST /upload-sessions/scene/resolve 换回
//      sessionId + uploadToken。会话有效期内可重复兑换（同一张码换回同一把令牌），
//      所以没回应、超时、5xx 可以点「重试」再兑换；码失效（UPLOAD_SCENE_UNUSABLE）不给重试。
//   ③ 小程序内扫码：pages/kiosk-login 扫到上传码后跳进来，新码带 q，旧码直接带 sessionId / token。
//
// 文件有两个来源，都是「一张码只收一份」：
//   a. 从「我的文档」选：要登录，POST /upload-sessions/:id/member-file（服务端只读本人的文件）。
//   b. 从微信聊天选：不要求登录，POST /upload-sessions/:id/files，只认 body 里的 uploadToken，
//      与一体机现有 H5 手机上传页口径一致 —— 人已经站在机器前，递一份文件不该先逼他注册。
//
// 上传令牌只留在页面实例上：不进 data、不进存储。去登录再回来，页面实例还在，令牌也还在；
// 换了账号只清「我的文档」列表（那是上一个账号的数据），令牌属于一体机这一单，不跟账号走。
//
// 请求兑现不等于已收到（判定见 kiosk-send-helpers.js 的 receiptAccepted）：空的、缺字段的、
// 别的会话的，都是结果未知。收到之后不再发送，避免后一次失败把已收到盖掉。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { parseKioskCode } = require('../../utils/kiosk-qr')
const { userMessageOf } = require('../../utils/user-error')

const {
  MAX_BYTES,
  isSessionPurpose,
  signatureFileIssue,
  receiptAccepted,
  statusOf,
  isAuthError,
  classifySendError,
  resolveRetryable,
  safeDecode,
  docRowsOf,
} = require('./kiosk-send-helpers')

const DOC_PAGE_SIZE = 50
const UNKNOWN_COPY = '这次上传的结果还不确定。请回到一体机屏幕核对，不要在这里重复发送。'
const BUSY_COPY = '这个二维码正在处理一次上传。请回到一体机屏幕查看，不要重复发送。'
// 码失效 / 已用 / 过期：与一体机 uploadSessionUserMessage 同一句（一体机句子为准）
const DEAD_COPY = '二维码已失效或已使用，请回到一体机刷新二维码。'
// 这一单已经不收文件了（收到了一份、一体机已确认或已取消）。可能是旁人拍到屏上的码先传了：
// 叫本人去一体机上看，不是自己的就取消再扫（无人值守，只能靠本人认）。
const OCCUPIED_COPY = '这一单已经不能再收文件了。如果一体机屏上有不是你传的文件，请在一体机上点「取消」，再重新扫码。'
const REJECT_FALLBACK = '系统没有收下这份文件，可以重新选择后再试'
const OFFLINE_COPY = '没连上终端，可以重试。'
const NOT_KIOSK_COPY = '这不是一体机上的二维码，请扫一体机屏幕上显示的二维码。'
const INCOMPLETE_COPY = '扫码信息不完整，请回到一体机重新扫码'
const LOGIN_PAGE_FAILED_COPY = '没能打开扫码登录页，请返回后重新扫码。'
// 从「我的文档」选
const DOC_NOT_FOUND_COPY = '这份文件现在用不了，可能已删除或已过期，请换一份。'
const DOC_TOO_LARGE_COPY = '这份文件超过 10MB，这台一体机这一单收不了，请换一份。'
const MEMBER_MISMATCH_COPY = '这台一体机现在登录的是另一个账号。请先在一体机上退出登录，再重新扫码。'
const LOGIN_EXPIRED_COPY = '登录已失效，请重新登录后再选。'
const DOCS_LOAD_FALLBACK = '我的文档这次没读到，可以重新读取。'

/** 码已不能再传时说哪一句：这一单不再收文件（NOT_PENDING）单说，其余照一体机那句。 */
function deadCopyOf(err) {
  return err && err.code === 'UPLOAD_SESSION_NOT_PENDING' ? OCCUPIED_COPY : DEAD_COPY
}

Page({
  data: {
    statusBarHeight: 20,
    sessionId: '',
    purpose: '',
    // 'idle' | 'resolving' | 'uploading' | 'done' | 'unknown' | 'error'
    phase: 'idle',
    // 码失效（兑换说 UNUSABLE）：不提供重试
    sceneFailed: false,
    // 兑换没回应：码可能还好好的，可以再兑换一次
    resolveRetry: false,
    // 只有服务端明确拒收、会话仍可能再收一份时为 true。结果未知和死码都不重传。
    canRetry: false,
    errorMsg: '',
    sent: [],
    // 从「我的文档」选：login 要先登录 · loading · error 没读到（可重读）· empty · list · blocked 一体机登的是另一个账号
    docState: 'login',
    docs: [],
    docNote: '',
    docTruncated: false,
  },

  onLoad(options) {
    this._disposed = false
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    const opts = options || {}
    // 令牌和 scene 只留在内存，不进 data —— data 会随页面栈快照走，没必要让它们多待一层。
    this._uploadToken = ''
    this._scene = ''
    this._gen = auth.sessionGeneration()
    this._docsLoggedIn = auth.isLoggedIn()

    // 入口①：普通链接码，整条码在 q 里。
    if (opts.q) {
      this._openLink(opts.q)
      return
    }

    // 入口②：微信扫小程序码进来。scene 是微信 URL 编码过的，必须先解码。
    const scene = opts.scene ? safeDecode(opts.scene) : ''
    if (scene) {
      this._resolveScene(scene)
      return
    }

    // 入口③：小程序内扫码带进来的现成凭据。
    const sessionId = opts.sessionId ? safeDecode(opts.sessionId) : ''
    const token = opts.token ? safeDecode(opts.token) : ''
    if (sessionId && token) {
      this._connect(sessionId, token)
      return
    }
    this.setData({ sessionId: '', phase: 'error', canRetry: false, errorMsg: INCOMPLETE_COPY })
  },

  onShow() {
    // 去登录回来、退出、或在别处换了账号：列表属于上一个账号，清掉、按现在的账号重拉。
    // 上传令牌属于一体机这一单，不跟账号走。还没连上的，连上时（_connect）自己会列。
    if (auth.isSameSession(this._gen) && auth.isLoggedIn() === this._docsLoggedIn) return
    if (this.data.sessionId && this._uploadToken) {
      this._loadDocs()
      return
    }
    this._gen = auth.sessionGeneration()
    this._docsLoggedIn = auth.isLoggedIn()
  },

  onUnload() {
    // 退出后作废兑换、列表和上传回调；已发送请求的服务端结果仍由一体机核对。
    this._disposed = true
    this._sendAttempt = (this._sendAttempt || 0) + 1
    this._uploadToken = ''
    if (this.data.phase === 'uploading') wx.hideLoading()
    this._resolveAttempt = (this._resolveAttempt || 0) + 1
    this._docsFlow = (this._docsFlow || 0) + 1
    this._scene = ''
  },

  /** q：微信把整条码编码过一次，这里解一次再认码型。 */
  _openLink(q) {
    const raw = safeDecode(q)
    const code = parseKioskCode(raw)
    if (code && code.kind === 'login') {
      // 扫到的是一体机的登录码：交给扫码登录页，整条码原样带过去
      this.setData({ phase: 'resolving', errorMsg: '' })
      wx.redirectTo({
        url: '/pages/kiosk-login/kiosk-login?q=' + encodeURIComponent(raw),
        fail: () => this.setData({ phase: 'error', canRetry: false, errorMsg: LOGIN_PAGE_FAILED_COPY }),
      })
      return
    }
    if (code && code.kind === 'upload-scene') {
      this._resolveScene(code.scene)
      return
    }
    if (code && code.kind === 'upload-session') {
      this._connect(code.sessionId, code.token)
      return
    }
    this.setData({ sessionId: '', phase: 'error', canRetry: false, errorMsg: NOT_KIOSK_COPY })
  },

  /** 连上这一单：令牌进内存，列「我的文档」。 */
  _connect(sessionId, uploadToken, purpose) {
    this._uploadToken = uploadToken
    this.setData({
      sessionId,
      purpose: isSessionPurpose(purpose) ? purpose : '',
      phase: 'idle',
      sceneFailed: false,
      resolveRetry: false,
      canRetry: false,
      errorMsg: '',
    })
    this._loadDocs()
  },

  /**
   * 用 scene 换回会话。只在进页和用户点「重试」时调用，不放在 onShow 里自动兑换。
   * 服务端把「格式错 / 查无此码 / 已过期 / 已收到文件」统一成 UPLOAD_SCENE_UNUSABLE，
   * 是刻意的：区分原因对用户没价值，对探测者却是一台预言机。这里同样**不按原因分支**。
   */
  _resolveScene(scene) {
    this._scene = scene
    const attempt = (this._resolveAttempt || 0) + 1
    this._resolveAttempt = attempt
    this.setData({ phase: 'resolving', errorMsg: '', canRetry: false, resolveRetry: false, sceneFailed: false })
    api.resolveUploadScene(scene).then(
      (res) => {
        if (attempt !== this._resolveAttempt) return
        const sessionId = res && typeof res.sessionId === 'string' ? res.sessionId : ''
        const uploadToken = res && typeof res.uploadToken === 'string' ? res.uploadToken : ''
        // 回执不完整：码可能还好好的（同一张码可以再兑换），给重试
        if (!sessionId || !uploadToken) this._resolveFailed(true, null)
        else this._connect(sessionId, uploadToken, res.purpose)
      },
      (err) => {
        if (attempt !== this._resolveAttempt) return
        this._resolveFailed(resolveRetryable(err), err)
      },
    )
  },

  _resolveFailed(retryable, err) {
    this._uploadToken = ''
    if (retryable) {
      this.setData({
        sessionId: '',
        phase: 'error',
        sceneFailed: false,
        resolveRetry: true,
        canRetry: false,
        errorMsg: statusOf(err) === 429 ? userMessageOf(err, OFFLINE_COPY) : OFFLINE_COPY,
      })
      return
    }
    this._scene = ''
    this.setData({ sessionId: '', phase: 'error', sceneFailed: true, resolveRetry: false, canRetry: false, errorMsg: DEAD_COPY })
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  /** 去登录。不带 returnTo：登录页登完 navigateBack 回到本页实例，令牌还在内存里。 */
  goLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  reloadDocs() {
    if (this.data.docState !== 'error') return
    this._loadDocs()
  },

  /** 按现在的账号列「我的文档」。note 是列表上方的一句提示（比如上一份没传成的原因）。 */
  _loadDocs(note) {
    const flow = (this._docsFlow || 0) + 1
    this._docsFlow = flow
    const gen = auth.sessionGeneration()
    this._gen = gen
    this._docsLoggedIn = auth.isLoggedIn()
    const base = { docs: [], docTruncated: false, docNote: note || '' }
    if (this.data.purpose === 'signature_image') {
      this.setData(Object.assign(base, { docState: 'empty' }))
      return
    }
    if (this._memberBlocked) {
      this.setData(Object.assign(base, { docState: 'blocked', docNote: MEMBER_MISMATCH_COPY }))
      return
    }
    if (!this._docsLoggedIn) {
      this.setData(Object.assign(base, { docState: 'login' }))
      return
    }
    this.setData(Object.assign(base, { docState: 'loading' }))
    api.getMyDocuments({ pageSize: DOC_PAGE_SIZE }).then(
      (items) => {
        if (flow !== this._docsFlow) return
        // 读的途中换了账号：这份列表属于上一个账号，按现在的账号重来
        if (!auth.isSameSession(gen)) { this._loadDocs(); return }
        const docs = docRowsOf(items, Date.now())
        this.setData({
          docState: docs.length ? 'list' : 'empty',
          docs,
          docTruncated: !!(items && items.nextCursor),
        })
      },
      (err) => {
        if (flow !== this._docsFlow) return
        if (isAuthError(err)) {
          this._gen = auth.sessionGeneration()
          this._docsLoggedIn = auth.isLoggedIn()
          this.setData({ docState: 'login', docs: [], docTruncated: false, docNote: LOGIN_EXPIRED_COPY })
          return
        }
        if (!auth.isSameSession(gen)) { this._loadDocs(); return }
        this.setData({ docState: 'error', docs: [], docTruncated: false, docNote: userMessageOf(err, DOCS_LOAD_FALLBACK) })
      },
    )
  },

  /** 点「我的文档」里的一行：先确认，再递过去。 */
  pickDoc(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const doc = this.data.docs.find((item) => item.id === id)
    if (!doc || doc.tooLarge || this._memberSendBlocked()) return
    wx.showModal({
      title: '确认传文件',
      content: `把《${doc.name}》传给这台一体机？`,
      confirmText: '传过去',
      success: (res) => {
        if (res && res.confirm) this._sendMemberFile(doc)
      },
    })
  },

  chooseAndSend() {
    if (this._sendBlocked()) return
    wx.chooseMessageFile({
      count: 1,
      type: this.data.purpose === 'signature_image' ? 'image' : 'file',
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file) return
        if (this._sendBlocked()) return
        if (file.size > MAX_BYTES) {
          this.setData({
            phase: 'error',
            canRetry: true,
            errorMsg: '单个文件不能超过 10MB，请压缩后重试',
          })
          return
        }
        this._send(file)
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return
        if (this._sendBlocked()) return
        this.setData({ phase: 'error', canRetry: true, errorMsg: '选择文件失败，请重试' })
      },
    })
  },

  _sendBlocked() {
    if (this._disposed) return true
    const phase = this.data.phase
    if (phase === 'uploading' || phase === 'done' || phase === 'unknown' || phase === 'resolving') return true
    if (phase === 'error' && !this.data.canRetry) return true
    if (this.data.sceneFailed) return true
    return !this.data.sessionId || !this._uploadToken
  },

  /** 从「我的文档」递：只在连上、空闲、列表可选、账号没变时可以。 */
  _memberSendBlocked() {
    if (this._sendBlocked() || this.data.phase !== 'idle' || this.data.purpose === 'signature_image') return true
    if (this._memberBlocked || this.data.docState !== 'list') return true
    return !auth.isLoggedIn() || !auth.isSameSession(this._gen)
  },

  _delivered(name) {
    this.setData({
      phase: 'done',
      canRetry: false,
      errorMsg: '',
      sent: this.data.sent.concat([{ name }]),
    })
  },

  _send(file) {
    if (this._sendBlocked()) return
    const issue = this.data.purpose === 'signature_image' ? signatureFileIssue(file) : ''
    if (issue) {
      this.setData({ phase: 'error', canRetry: true, errorMsg: issue })
      return
    }
    const attempt = (this._sendAttempt || 0) + 1
    this._sendAttempt = attempt
    const sessionId = this.data.sessionId
    this.setData({ phase: 'uploading', errorMsg: '', canRetry: false })
    wx.showLoading({ title: '正在传给终端', mask: true })
    api.uploadToKioskSession(sessionId, this._uploadToken, file.path, file.name)
      .then((body) => {
        if (attempt !== this._sendAttempt) return
        wx.hideLoading()
        if (!receiptAccepted(body, sessionId, this.data.purpose)) {
          this.setData({ phase: 'unknown', canRetry: false, errorMsg: UNKNOWN_COPY })
          return
        }
        this._delivered(file.name)
      })
      .catch((err) => {
        if (attempt !== this._sendAttempt) return
        wx.hideLoading()
        const kind = classifySendError(err)
        if (kind === 'rejected') {
          this.setData({
            phase: 'error',
            canRetry: true,
            sceneFailed: false,
            errorMsg: userMessageOf(err, REJECT_FALLBACK),
          })
          return
        }
        if (kind === 'dead') {
          this.setData({ phase: 'error', canRetry: false, errorMsg: deadCopyOf(err) })
          return
        }
        this.setData({
          phase: 'unknown',
          canRetry: false,
          errorMsg: kind === 'busy' ? BUSY_COPY : UNKNOWN_COPY,
        })
      })
  },

  _sendMemberFile(doc) {
    if (this._memberSendBlocked()) return
    const attempt = (this._sendAttempt || 0) + 1
    this._sendAttempt = attempt
    const sessionId = this.data.sessionId
    this.setData({ phase: 'uploading', errorMsg: '', canRetry: false, docNote: '' })
    wx.showLoading({ title: '正在传给终端', mask: true })
    api.sendMemberFileToKioskSession(sessionId, this._uploadToken, doc.id).then(
      (body) => {
        if (attempt !== this._sendAttempt) return
        wx.hideLoading()
        if ((body && body.purpose === 'signature_image') || !receiptAccepted(body, sessionId, this.data.purpose)) {
          this.setData({ phase: 'unknown', canRetry: false, errorMsg: UNKNOWN_COPY })
          return
        }
        this._delivered(doc.name)
      },
      (err) => {
        if (attempt !== this._sendAttempt) return
        wx.hideLoading()
        this._memberSendFailed(err, doc)
      },
    )
  },

  /**
   * 「我的文档」那一份没递成。服务端在落成之前出错会把这一单退回待收，
   * 所以能说清原因的 4xx 都回到空闲、换一份再选；码不能再传、结果说不清的，照聊天那条路处理。
   */
  _memberSendFailed(err, doc) {
    const code = err && typeof err.code === 'string' ? err.code : ''
    const kind = classifySendError(err)
    if (kind === 'dead') {
      this.setData({ phase: 'error', canRetry: false, errorMsg: deadCopyOf(err) })
      return
    }
    if (kind === 'busy') {
      this.setData({ phase: 'unknown', canRetry: false, errorMsg: BUSY_COPY })
      return
    }
    if (isAuthError(err)) {
      // 请求在登录这一关就被拦下，这一份没有传过去；聊天文件那条路照常可用。
      this._gen = auth.sessionGeneration()
      this._docsLoggedIn = auth.isLoggedIn()
      this.setData({ phase: 'idle', docState: 'login', docs: [], docTruncated: false, docNote: LOGIN_EXPIRED_COPY })
      return
    }
    if (code === 'UPLOAD_SESSION_MEMBER_MISMATCH') {
      // 这张码不能再从「我的文档」传；聊天文件入口照旧
      this._memberBlocked = true
      this.setData({ phase: 'idle' })
      this._loadDocs()
      return
    }
    if (code === 'FILE_NOT_FOUND') {
      this.setData({ phase: 'idle' })
      this._loadDocs(DOC_NOT_FOUND_COPY)
      return
    }
    if (code === 'FILE_TOO_LARGE') {
      this.setData({
        phase: 'idle',
        docNote: DOC_TOO_LARGE_COPY,
        docs: this.data.docs.map((item) => (item.id === doc.id ? Object.assign({}, item, { tooLarge: true }) : item)),
      })
      return
    }
    if (kind === 'rejected') {
      this.setData({ phase: 'idle', docNote: userMessageOf(err, REJECT_FALLBACK) })
      return
    }
    this.setData({ phase: 'unknown', canRetry: false, errorMsg: UNKNOWN_COPY })
  },

  retry() {
    // 兑换没回应：码本身可能还好好的，再兑换一次是安全的（同一张码换回同一把令牌）。
    if (this.data.resolveRetry) {
      if (this.data.phase === 'error' && this._scene) this._resolveScene(this._scene)
      return
    }
    // 码失效、结果未知和死码都不能再传。
    if (this.data.sceneFailed || !this.data.canRetry) return
    if (!this.data.sessionId || !this._uploadToken) return
    this.setData({ phase: 'idle', errorMsg: '', canRetry: false })
  },
})
