// pages/privacy/privacy.js
// 隐私与数据：把「数据导出」「撤回岗位 AI 授权」「账号注销」接到真实后端。
//
// 契约来源（每个字段都对着源码核过，未按字段名猜）：
//   services/api/src/member-auth/member-auth.controller.ts        step-up 两个端点
//   services/api/src/member-auth/member-step-up.types.ts          action 白名单
//   services/api/src/member-privacy/member-privacy.controller.ts  /me/data-requests 三个端点
//   services/api/src/member-privacy/member-data-request.service.ts  状态机与错误码
//   services/api/src/member-privacy/member-data-export.service.ts   23h 有效期、10MB、500 行/分区
//   packages/shared/src/types/memberPrivacy.ts                    UI 诚实文案 SSOT
//
// ⚠️ 账号注销：后端 create() 对 requestType='delete' 在任何副作用之前固定抛
//   ACCOUNT_CLOSURE_NOT_AVAILABLE，且 list() 的 capabilities.accountClosureAvailable
//   是写死的 false。本页因此不编造任何注销进度，只做两件真事：
//   把服务端的能力位如实显示出来，以及在用户确认后真的把请求发给服务端、
//   把服务端的原话（错误码 + 文案）原样回显。后端哪天放开，本页无需改动即可工作。

const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const exportFile = require('./export-file')
const dr = require('./data-rights')

Page({
  data: {
    statusBarHeight: 20,
    isLoggedIn: false,

    loading: false,
    loadError: '',

    // 服务端能力位。未拉到之前不下任何结论。
    capabilityLoaded: false,
    accountClosureAvailable: false,

    requests: [],
    latestExport: null,
    hasActiveRequest: false,

    savedFiles: [],

    busy: '',

    // 短信二次验证浮层
    su: {
      open: false,
      purpose: '',
      title: '',
      desc: '',
      challengeId: '',
      phoneMasked: '',
      code: '',
      cooldown: 0,
      expiresIn: 0,
      sending: false,
      verifying: false,
      error: '',
    },
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    const isLoggedIn = auth.isLoggedIn()
    this._pollCount = 0
    this.setData({ isLoggedIn, savedFiles: exportFile.listSavedExports() })
    if (isLoggedIn) this.loadRequests()
    else this.setData({ requests: [], latestExport: null, capabilityLoaded: false, hasActiveRequest: false })
  },

  onHide() { this.stopTimers() },
  onUnload() { this.stopTimers() },
  onPullDownRefresh() {
    if (this.data.isLoggedIn) this.loadRequests(() => wx.stopPullDownRefresh())
    else wx.stopPullDownRefresh()
  },

  stopTimers() {
    if (this._poll) { clearTimeout(this._poll); this._poll = null }
    if (this._tick) { clearInterval(this._tick); this._tick = null }
  },

  // ---------- 列表 ----------

  loadRequests(done) {
    this.setData({ loading: !this.data.requests.length, loadError: '' })
    api.listMemberDataRequests()
      .then((page) => {
        const view = dr.toListView(page)
        this.setData({
          requests: view.requests,
          latestExport: view.latestExport,
          hasActiveRequest: view.hasActiveRequest,
          accountClosureAvailable: view.accountClosureAvailable,
          capabilityLoaded: true,
          loading: false,
          loadError: '',
        })
        this.schedulePoll()
      })
      .catch((err) => {
        this.setData({ loading: false, loadError: dr.errText(err) })
        if (err && err.statusCode === 401) this.setData({ isLoggedIn: auth.isLoggedIn() })
      })
      .then(() => { if (typeof done === 'function') done() })
  },

  // 导出是异步队列任务，pending/handling 期间轮询。只在本页可见时继续。
  schedulePoll() {
    if (this._poll) { clearTimeout(this._poll); this._poll = null }
    if (!this.data.hasActiveRequest) { this._pollCount = 0; return }
    this._pollCount = (this._pollCount || 0) + 1
    if (this._pollCount > 24) return // 约 2 分钟后停手，交给下拉刷新，不无限空转
    this._poll = setTimeout(() => this.loadRequests(), 5000)
  },

  reload() { this.loadRequests() },

  // ---------- 二次验证浮层 ----------

  /**
   * @param {'export_data_request'|'export_data_download'} purpose step-up action，白名单见 member-step-up.types.ts
   */
  openStepUp(purpose, title, desc) {
    this._code = ''
    this.setData({
      su: {
        open: true, purpose, title, desc,
        challengeId: '', phoneMasked: '', code: '',
        cooldown: 0, expiresIn: 0, sending: true, verifying: false, error: '',
      },
    })
    this.sendCode()
  },

  sendCode() {
    this.setData({ 'su.sending': true, 'su.error': '' })
    api.sendMemberStepUpCode(this.data.su.purpose)
      .then((res) => {
        this.setData({
          'su.sending': false,
          'su.challengeId': res.challengeId || '',
          'su.phoneMasked': res.phoneMasked || '',
          'su.cooldown': Number(res.cooldownSeconds) || 0,
          'su.expiresIn': Number(res.expiresInSeconds) || 0,
        })
        this.startTick()
      })
      .catch((err) => {
        this.setData({ 'su.sending': false, 'su.error': dr.errText(err) })
      })
  },

  startTick() {
    if (this._tick) clearInterval(this._tick)
    this._tick = setInterval(() => {
      const su = this.data.su
      const stop = () => { clearInterval(this._tick); this._tick = null }
      if (!su.open) { stop(); return }
      const cooldown = su.cooldown > 0 ? su.cooldown - 1 : 0
      const expiresIn = su.expiresIn > 0 ? su.expiresIn - 1 : 0
      this.setData({ 'su.cooldown': cooldown, 'su.expiresIn': expiresIn })
      if (cooldown === 0 && expiresIn === 0) stop()
    }, 1000)
  },

  resendCode() {
    if (this.data.su.sending || this.data.su.cooldown > 0) return
    this._code = ''
    this.setData({ 'su.code': '' })
    this.sendCode()
  },

  // 回写形态与 pages/launch 的验证码输入一致（该页已在真机跑通），不另立一套。
  onCodeInput(e) {
    const code = String(e.detail.value || '').replace(/\D/g, '').slice(0, 6)
    this._code = code
    this.setData({ 'su.code': code, 'su.error': '' })
  },

  closeStepUp() {
    this.stopTimers()
    this._code = ''
    this.setData({ 'su.open': false, 'su.code': '', 'su.error': '' })
    this.schedulePoll()
  },

  // 浮层面板上的点击不应穿透到遮罩
  keepOpen() {},

  submitStepUp() {
    const su = this.data.su
    const code = su.code || this._code || ''
    if (su.verifying || su.sending) return
    if (!su.challengeId) { this.setData({ 'su.error': '验证码尚未发出，请先获取验证码' }); return }
    if (!/^\d{6}$/.test(code)) { this.setData({ 'su.error': '请输入 6 位数字验证码' }); return }

    this.setData({ 'su.verifying': true, 'su.error': '' })
    api.verifyMemberStepUp(su.challengeId, code)
      .then((grant) => {
        const token = grant && grant.stepUpToken
        if (!token) throw new Error('服务端未返回二次验证凭证')
        this.stopTimers()
        this._code = ''
        this.setData({ 'su.open': false, 'su.verifying': false, 'su.code': '' })
        if (su.purpose === 'export_data_request') return this.doCreateExport(token)
        if (su.purpose === 'export_data_download') return this.doDownload(token)
        return null
      })
      .catch((err) => {
        // 挑战失效（含验证码错误达上限）必须重新发码，不能让用户在死界面里重试。
        const dead = err && err.code === 'STEP_UP_CHALLENGE_INVALID'
        this.setData({
          'su.verifying': false,
          'su.error': dr.errText(err),
          'su.challengeId': dead ? '' : su.challengeId,
        })
      })
  },

  // ---------- 数据导出 ----------

  startExport() {
    if (!this.requireLogin()) return
    if (this.data.busy) return
    if (this.data.hasActiveRequest) {
      wx.showModal({
        title: '已有请求在处理',
        content: '同一时间只能有一个数据权利请求在处理中。请等待当前请求完成后再提交。',
        showCancel: false,
      })
      return
    }
    wx.showModal({
      title: '导出我的数据',
      content: '将向你账号绑定的手机号发送验证码。验证通过后由服务端后台生成导出包，生成需要一点时间，完成后可在本页取件。',
      confirmText: '发送验证码',
      success: (r) => {
        if (!r.confirm) return
        this._exportIdemKey = dr.uuidV4()
        this.openStepUp(
          'export_data_request',
          '验证身份后提交导出',
          '导出属于高敏操作，需要短信二次验证。',
        )
      },
    })
  },

  doCreateExport(stepUpToken) {
    this.setData({ busy: '正在提交导出请求…' })
    wx.showLoading({ title: '提交中', mask: true })
    const key = this._exportIdemKey || dr.uuidV4()
    this._exportIdemKey = key
    return api.createMemberDataRequest('export', { idempotencyKey: key, stepUpToken })
      .then(() => {
        this._exportIdemKey = null
        wx.hideLoading()
        this.setData({ busy: '' })
        // 不说「导出完成」：此刻服务端状态是 pending，页面按真实状态展示。
        wx.showToast({ title: '请求已受理', icon: 'none', duration: 1600 })
        this._pollCount = 0
        this.loadRequests()
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ busy: '' })
        // DATA_REQUEST_EXECUTION_INCOMPLETE 时记录其实已建，必须刷新后按服务端状态说话。
        this.loadRequests()
        wx.showModal({ title: '导出请求未完成', content: dr.errText(err), showCancel: false })
      })
  },

  startDownload() {
    if (!this.requireLogin()) return
    if (this.data.busy) return
    const item = this.data.latestExport
    if (!item || !item.canDownload) return
    wx.showModal({
      title: '取回导出包',
      content: '下载授权是一次性的：服务端把内容发出后即标记为已取件，同一份导出包不能再取第二次。请确认现在方便保存文件。',
      confirmText: '发送验证码',
      success: (r) => {
        if (!r.confirm) return
        this._downloadId = item.id
        this.openStepUp(
          'export_data_download',
          '验证身份后取件',
          '取件需要单独的一次短信二次验证。',
        )
      },
    })
  },

  doDownload(stepUpToken) {
    const requestId = this._downloadId
    if (!requestId) return null
    this.setData({ busy: '正在取回导出包…' })
    wx.showLoading({ title: '取件中', mask: true })
    return api.authorizeMemberDataExportDownload(requestId, stepUpToken)
      .then((grant) => {
        const parsed = exportFile.parseDownloadUrl(grant && grant.downloadUrl, requestId)
        if (!parsed) {
          const e = new Error('服务端返回的下载授权无法解析，导出包未被取走')
          e.code = 'DOWNLOAD_URL_UNPARSABLE'
          throw e
        }
        return exportFile.fetchExportContent(requestId, parsed.ticket)
      })
      .then((text) => exportFile.saveExportContent(text))
      .then((saved) => {
        wx.hideLoading()
        this.setData({ busy: '', savedFiles: exportFile.listSavedExports() })
        this.loadRequests()
        wx.showModal({
          title: '导出包已存到本机',
          content: `文件 ${saved.fileName}（${exportFile.formatSize(saved.sizeBytes)}）已保存在小程序本地目录。`
            + '本地副本不会自动上传，请用下方「转发到微信」把它保存到你自己的设备，用完可随时删除。',
          showCancel: false,
        })
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ busy: '' })
        this.loadRequests()
        wx.showModal({ title: '取件未完成', content: dr.errText(err), showCancel: false })
      })
  },

  // ---------- 本机导出件 ----------

  shareFile(e) {
    const f = this.data.savedFiles[Number(e.currentTarget.dataset.index)]
    if (!f) return
    exportFile.shareExportFile(f.filePath, f.fileName)
      .catch((err) => wx.showModal({ title: '转发未完成', content: dr.errText(err), showCancel: false }))
  },

  saveFileToDisk(e) {
    const f = this.data.savedFiles[Number(e.currentTarget.dataset.index)]
    if (!f) return
    exportFile.saveExportToDisk(f.filePath)
      .catch((err) => wx.showModal({ title: '另存未完成', content: dr.errText(err), showCancel: false }))
  },

  copyFile(e) {
    const f = this.data.savedFiles[Number(e.currentTarget.dataset.index)]
    if (!f) return
    exportFile.readSavedExport(f.filePath)
      .then((text) => new Promise((resolve, reject) => {
        wx.setClipboardData({
          data: text,
          success: () => resolve(true),
          fail: (er) => reject(new Error((er && er.errMsg) || '复制失败')),
        })
      }))
      .catch((err) => wx.showModal({
        title: '复制未完成',
        content: `${dr.errText(err)}。导出包较大时剪贴板可能装不下，请改用转发文件。`,
        showCancel: false,
      }))
  },

  removeFile(e) {
    const index = Number(e.currentTarget.dataset.index)
    const f = this.data.savedFiles[index]
    if (!f) return
    wx.showModal({
      title: '删除本机副本',
      content: `将从本机删除 ${f.fileName}。服务端那份导出包已取走或已到期，删除后无法在此页面恢复。`,
      confirmText: '删除',
      confirmColor: '#b5643c',
      success: (r) => {
        if (!r.confirm) return
        exportFile.removeSavedExport(f.filePath)
          .then(() => {
            this.setData({ savedFiles: exportFile.listSavedExports() })
            wx.showToast({ title: '已删除本机副本', icon: 'none' })
          })
          .catch((err) => wx.showModal({ title: '删除未完成', content: dr.errText(err), showCancel: false }))
      },
    })
  },

  // ---------- 撤回岗位 AI 授权 ----------

  revokeConsent() {
    if (!this.requireLogin()) return
    if (this.data.busy) return
    wx.showModal({
      title: '撤回岗位 AI 授权',
      content: '撤回后再次使用岗位 AI 需重新确认授权。此操作只撤回授权，不会删除简历、文档、打印订单或收藏。',
      confirmText: '确认撤回',
      success: (r) => {
        if (!r.confirm) return
        this.setData({ busy: '正在提交…' })
        wx.showLoading({ title: '提交中', mask: true })
        api.createMemberDataRequest('revoke_consent', { idempotencyKey: dr.uuidV4() })
          .then((item) => {
            wx.hideLoading()
            this.setData({ busy: '' })
            // 服务端对 revoke_consent 是同步完成（status=completed），照它返回的说。
            const label = dr.statusLabel(item && item.status) || '已受理'
            wx.showToast({ title: `撤回${label}`, icon: 'none', duration: 1600 })
            this.loadRequests()
          })
          .catch((err) => {
            wx.hideLoading()
            this.setData({ busy: '' })
            wx.showModal({ title: '撤回未完成', content: dr.errText(err), showCancel: false })
          })
      },
    })
  },

  // ---------- 账号注销 ----------

  requestAccountClosure() {
    if (!this.requireLogin()) return
    if (this.data.busy) return

    const unavailable = this.data.capabilityLoaded && !this.data.accountClosureAvailable
    const content = unavailable
      ? '服务端当前未开放线上自助注销，提交后会被服务端直接拒绝，你会看到它的原话。'
        + '本入口不会删除简历、文档、打印订单或收藏。'
        + '现在就能做的：导出我的数据、撤回岗位 AI 授权、在「我的文档」里删除文件、退出登录。'
      : '账号注销不可逆。提交后由服务端按其注销流程处理，本页只如实展示服务端返回的状态，不代表已经注销。'

    wx.showModal({
      title: '账号注销',
      content,
      confirmText: unavailable ? '仍要提交' : '提交注销请求',
      confirmColor: '#b5643c',
      success: (r) => {
        if (!r.confirm) return
        this.setData({ busy: '正在提交…' })
        wx.showLoading({ title: '提交中', mask: true })
        api.createMemberDataRequest('delete', { idempotencyKey: dr.uuidV4() })
          .then((item) => {
            wx.hideLoading()
            this.setData({ busy: '' })
            const label = dr.statusLabel(item && item.status) || '已受理'
            wx.showModal({
              title: '服务端已受理',
              content: `服务端返回状态：${label}。这不代表账号已注销，处理进度以本页记录为准。`,
              showCancel: false,
            })
            this.loadRequests()
          })
          .catch((err) => {
            wx.hideLoading()
            this.setData({ busy: '' })
            // 原样回显服务端答复（当前实现固定 ACCOUNT_CLOSURE_NOT_AVAILABLE / 账号注销暂未开放）。
            wx.showModal({ title: '服务端未受理', content: dr.errText(err), showCancel: false })
            this.loadRequests()
          })
      },
    })
  },

  // ---------- 导航 ----------

  requireLogin() {
    if (auth.isLoggedIn()) return true
    this.setData({ isLoggedIn: false })
    wx.showModal({
      title: '请先登录',
      content: '数据导出与账号注销只对本人开放，需要登录后由服务端核验身份。',
      confirmText: '去登录',
      success: (r) => { if (r.confirm) this.toLogin() },
    })
    return false
  },

  toLogin() { wx.navigateTo({ url: '/pages/launch/launch' }) },
  toPolicy() { wx.navigateTo({ url: '/pages/legal/legal?type=privacy_policy' }) },
  toDocuments() { wx.navigateTo({ url: '/pages/documents/documents' }) },
  back() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
