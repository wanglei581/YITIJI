// pages/kiosk-send/kiosk-send.js
// 把手机里的文件递进「面前这台一体机」的上传会话。
//
// 两条入口，落到同一段上传逻辑：
//   ① 小程序内扫码：在 pages/kiosk-login 扫到一体机的上传码后跳进来，
//      sessionId / uploadToken 由那次扫码直接带入。
//   ② 微信扫小程序码：一体机展示 getwxacodeunlimit 生成的小程序码，
//      用户用微信相机扫，落到本页并带 `scene`。scene 只是个 ≤32 字符的不透明
//      凭据，要先 POST /upload-sessions/scene/resolve 换回 sessionId + uploadToken。
//      （契约：docs/api/upload-scene-miniapp-contract.md）
//
// 两条入口都不自己造凭据，也不从别处猜。上传令牌只留在页面实例上，不进 data。
// 本页不读取、不附带会员登录态：这条链路只认 uploadToken，匿名和已登录都一样。
//
// 为什么不要求登录：服务端 POST /upload-sessions/:id/files 只认 body 里的 uploadToken
// （会话创建时随二维码下发），与一体机现有 H5 手机上传页口径一致。人已经站在机器前，
// 把文件递进去这件事不应该先逼他注册。想把文件留进「我的文档」是另一条路
// （api.uploadPrintFile），那条才需要登录。
//
// 请求兑现不等于已收到。utils/request.js 会把 2xx 的 {} 和 data:null 解包后兑现。
// 只有 status=uploaded、file.fileId，且 purpose 是会话真实支持的三种用途，
// 并且 sessionId 就是这一次，才算收到。空的、缺字段的、别的会话的，都是结果未知。
// 一张码只收一份；收到之后不再发送，避免后一次失败把已收到盖掉。
const app = getApp()
const api = require('../../utils/api')
const { userMessageOf } = require('../../utils/user-error')

const MAX_BYTES = 10 * 1024 * 1024
// 与一体机 phoneUploadModel.receiptOf 的 SESSION_PURPOSES 相同。
// signature_image 能出现在文件用途里，但创建上传会话的 DTO 不接受它。
const SESSION_PURPOSES = ['resume_upload', 'print_doc', 'contract_upload']
const DEAD_CODES = {
  UPLOAD_SESSION_EXPIRED: true,
  UPLOAD_SESSION_NOT_PENDING: true,
  UPLOAD_SESSION_NOT_FOUND: true,
  UPLOAD_TOKEN_INVALID: true,
}
const AUTH_CODES = {
  AUTH_REQUIRED: true,
  MEMBER_MISSING_TOKEN: true,
  MEMBER_SESSION_EXPIRED: true,
  MEMBER_TOKEN_INVALID: true,
}
const UNKNOWN_COPY = '这次上传的结果还不确定。请回到一体机屏幕核对，不要在这里重复发送。'
const BUSY_COPY = '这个二维码正在处理一次上传。请回到一体机屏幕查看，不要重复发送。'
const DEAD_COPY = '这个二维码已经不能再传。请回到一体机屏幕确认；如果上面没有这份文件，请重新生成二维码。'
const REJECT_FALLBACK = '系统没有收下这份文件，可以重新选择后再试'

function isSessionPurpose(value) {
  return typeof value === 'string' && SESSION_PURPOSES.indexOf(value) !== -1
}

function receiptAccepted(body, sessionId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  if (!sessionId || body.sessionId !== sessionId) return false
  if (body.status !== 'uploaded') return false
  const file = body.file
  if (!file || typeof file !== 'object' || Array.isArray(file)) return false
  if (typeof file.fileId !== 'string' || file.fileId.trim() === '') return false
  if (!isSessionPurpose(body.purpose)) return false
  return true
}

function classifySendError(err) {
  const status = err && typeof err.statusCode === 'number' ? err.statusCode : -1
  const code = err && typeof err.code === 'string' ? err.code : ''
  if (DEAD_CODES[code]) return 'dead'
  if (code === 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS' || code === 'UPLOAD_SESSION_ACTION_IN_PROGRESS') return 'busy'
  if (status === 401 || AUTH_CODES[code]) return 'unknown'
  if (status >= 400 && status < 500 && status !== 408) return 'rejected'
  return 'unknown'
}

Page({
  data: {
    statusBarHeight: 20,
    sessionId: '',
    // 'idle' | 'resolving' | 'uploading' | 'done' | 'unknown' | 'error'
    phase: 'idle',
    // scene 兑换失败：码已被消费，不提供重试
    sceneFailed: false,
    // 只有服务端明确拒收、会话仍可能再收一份时为 true。结果未知和死码都不重传。
    canRetry: false,
    errorMsg: '',
    sent: [],
  },

  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })

    // 入口②：微信扫小程序码进来。scene 是微信 URL 编码过的，必须先解码。
    const scene = options.scene ? decodeURIComponent(options.scene) : ''
    if (scene) {
      this._resolveScene(scene)
      return
    }

    // 入口①：小程序内扫码带进来的现成凭据。
    const sessionId = options.sessionId ? decodeURIComponent(options.sessionId) : ''
    const token = options.token ? decodeURIComponent(options.token) : ''
    // 令牌只留在内存，不进 data —— data 会随页面栈快照走，没必要让它多待一层。
    this._uploadToken = token
    this.setData({
      sessionId,
      phase: sessionId && token ? 'idle' : 'error',
      canRetry: false,
      errorMsg: sessionId && token ? '' : '扫码信息不完整，请回到一体机重新扫码',
    })
  },

  /**
   * 用 scene 换回会话。
   *
   * **只在 onLoad 调一次**：服务端用 Redis GETDEL 原子消费，码是一次性的，
   * 第二次兑换必失败。所以既不放在 onShow，失败时也不提供「重试兑换」——
   * 重试只会让用户看到同一条失效提示，误以为是网络问题。
   * 兑换本身返回空对象或缺字段时也不再兑换：码可能已经被消费。
   */
  _resolveScene(scene) {
    this.setData({ phase: 'resolving', errorMsg: '', canRetry: false })
    api.resolveUploadScene(scene)
      .then((res) => {
        const sessionId = res && typeof res.sessionId === 'string' ? res.sessionId : ''
        const uploadToken = res && typeof res.uploadToken === 'string' ? res.uploadToken : ''
        if (!sessionId || !uploadToken) {
          this._uploadToken = ''
          this.setData({
            sessionId: '',
            phase: 'error',
            sceneFailed: true,
            canRetry: false,
            errorMsg: '二维码已失效，请回到一体机重新生成',
          })
          return
        }
        this._uploadToken = uploadToken
        this.setData({
          sessionId,
          phase: 'idle',
          sceneFailed: false,
          canRetry: false,
          errorMsg: '',
        })
      })
      .catch((err) => {
        // 服务端把「格式错 / 查无此码 / 已过期 / 已用掉」统一成 UPLOAD_SCENE_UNUSABLE，
        // 是刻意的：区分原因对用户没价值（补救动作都是回一体机重新生成），
        // 对探测者却是一台预言机。这里同样**不按原因分支**。
        this._uploadToken = ''
        this.setData({
          phase: 'error',
          canRetry: false,
          // 未登记的错误码不展示原文；这句和兑换失败的补救动作相同。
          errorMsg: userMessageOf(err, '二维码已失效，请回到一体机重新生成'),
          sceneFailed: true,
        })
      })
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  chooseAndSend() {
    if (this._sendBlocked()) return
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
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
    const phase = this.data.phase
    if (phase === 'uploading' || phase === 'done' || phase === 'unknown' || phase === 'resolving') return true
    if (phase === 'error' && !this.data.canRetry) return true
    if (this.data.sceneFailed) return true
    return !this.data.sessionId || !this._uploadToken
  },

  _send(file) {
    if (this._sendBlocked()) return
    const attempt = (this._sendAttempt || 0) + 1
    this._sendAttempt = attempt
    const sessionId = this.data.sessionId
    this.setData({ phase: 'uploading', errorMsg: '', canRetry: false })
    wx.showLoading({ title: '正在传给终端', mask: true })
    api.uploadToKioskSession(sessionId, this._uploadToken, file.path, file.name)
      .then((body) => {
        if (attempt !== this._sendAttempt) return
        wx.hideLoading()
        if (!receiptAccepted(body, sessionId)) {
          this.setData({ phase: 'unknown', canRetry: false, errorMsg: UNKNOWN_COPY })
          return
        }
        this.setData({
          phase: 'done',
          canRetry: false,
          errorMsg: '',
          sent: this.data.sent.concat([{ name: file.name }]),
        })
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
          this.setData({ phase: 'error', canRetry: false, errorMsg: DEAD_COPY })
          return
        }
        this.setData({
          phase: 'unknown',
          canRetry: false,
          errorMsg: kind === 'busy' ? BUSY_COPY : UNKNOWN_COPY,
        })
      })
  },

  retry() {
    // scene 兑换失败不给重试：码是一次性的，重试必然再失败一次，
    // 只会让用户以为是网络抖动。结果未知和死码同样不能再传。
    if (this.data.sceneFailed || !this.data.canRetry) return
    if (!this.data.sessionId || !this._uploadToken) return
    this.setData({ phase: 'idle', errorMsg: '', canRetry: false })
  },
})
