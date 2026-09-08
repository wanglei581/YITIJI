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
// 两条入口都不自己造凭据，也不从别处猜。
//
// 为什么不要求登录：服务端 POST /upload-sessions/:id/files 只认 body 里的 uploadToken
// （会话创建时随二维码下发），与一体机现有 H5 手机上传页口径一致。人已经站在机器前，
// 把文件递进去这件事不应该先逼他注册。想把文件留进「我的文档」是另一条路
// （api.uploadPrintFile），那条才需要登录。
//
// 传完不用管一体机：会话在服务端本来就带 terminalId，一体机侧一直在轮询
// GET /upload-sessions/:sessionId，传上去它自己就看见了。
const app = getApp()
const api = require('../../utils/api')

const MAX_BYTES = 10 * 1024 * 1024

Page({
  data: {
    statusBarHeight: 20,
    sessionId: '',
    // 'idle' | 'resolving' | 'uploading' | 'done' | 'error'
    phase: 'idle',
    // scene 兑换失败：码已被消费，不提供重试
    sceneFailed: false,
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
      errorMsg: sessionId && token ? '' : '扫码信息不完整，请回到一体机重新扫码',
    })
  },

  /**
   * 用 scene 换回会话。
   *
   * **只在 onLoad 调一次**：服务端用 Redis GETDEL 原子消费，码是一次性的，
   * 第二次兑换必失败。所以既不放在 onShow，失败时也不提供「重试兑换」——
   * 重试只会让用户看到同一条失效提示，误以为是网络问题。
   */
  _resolveScene(scene) {
    this.setData({ phase: 'resolving', errorMsg: '' })
    api.resolveUploadScene(scene)
      .then((res) => {
        this._uploadToken = res.uploadToken
        this.setData({
          sessionId: res.sessionId || '',
          phase: res.sessionId && res.uploadToken ? 'idle' : 'error',
          errorMsg: res.sessionId && res.uploadToken ? '' : '二维码已失效，请回到一体机重新生成',
        })
      })
      .catch((err) => {
        // 服务端把「格式错 / 查无此码 / 已过期 / 已用掉」统一成 UPLOAD_SCENE_UNUSABLE，
        // 是刻意的：区分原因对用户没价值（补救动作都是回一体机重新生成），
        // 对探测者却是一台预言机。这里同样**不按原因分支**。
        this.setData({
          phase: 'error',
          // 该码的服务端文案本身就是面向用户的；拿不到就用与本页操作相关的兜底句。
          errorMsg: (err && err.message) || '二维码已失效，请回到一体机重新生成',
          sceneFailed: true,
        })
      })
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  chooseAndSend() {
    if (this.data.phase === 'uploading') return
    if (!this.data.sessionId || !this._uploadToken) return
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file) return
        if (file.size > MAX_BYTES) {
          this.setData({ phase: 'error', errorMsg: '单个文件不能超过 10MB，请压缩后重试' })
          return
        }
        this._send(file)
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return
        this.setData({ phase: 'error', errorMsg: '选择文件失败，请重试' })
      },
    })
  },

  _send(file) {
    this.setData({ phase: 'uploading', errorMsg: '' })
    wx.showLoading({ title: '正在传给终端', mask: true })
    api.uploadToKioskSession(this.data.sessionId, this._uploadToken, file.path, file.name)
      .then(() => {
        wx.hideLoading()
        this.setData({
          phase: 'done',
          sent: this.data.sent.concat([{ name: file.name }]),
        })
      })
      .catch((err) => {
        wx.hideLoading()
        // 不把服务端错误体当文案（判据见 utils/user-error.js），给与当前操作相关的中文兜底。
        this.setData({
          phase: 'error',
          errorMsg: (err && err.message) || '传给终端失败，请确认二维码没有过期后重试',
        })
      })
  },

  retry() {
    // scene 兑换失败不给重试：码是一次性的，重试必然再失败一次，
    // 只会让用户以为是网络抖动。这时唯一有效的动作是回一体机重新生成。
    if (this.data.sceneFailed) return
    this.setData({ phase: this.data.sessionId && this._uploadToken ? 'idle' : 'error', errorMsg: '' })
  },
})
