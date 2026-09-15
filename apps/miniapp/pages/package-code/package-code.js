// pages/package-code/package-code.js
//
// 材料包到机码页。**唯一数据来源是 GET /orders/package/:id**。
//
// 为什么不从 URL 读：到机码是拿去一体机取件的凭证。若它来自 URL，一条构造出来的链接、
// 或一张转发出去的「创建成功」卡片，就能在别人手机上渲染出一张带码的成功页。
// 服务端 requireOwned 归属校验：非本人订单 404 PACKAGE_ORDER_NOT_FOUND（连存在性都不
// 泄漏），未登录 401 —— 前端必须真的去问它。
//
// 本页也是「订单可找回」的落点：从「我的 · 打印订单」的材料包分区点进来时同样只带
// orderId，由这里重新核一次。这正是材料包此前不敢开放的那一环 —— 之前用户离开后
// 手上只剩一个到机码，而到机码不能反查订单。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const pkg = require('../../utils/package-order')
const { createPickupQrMatrix, PICKUP_CODE_RE } = require('../../utils/pickup-qrcode')
const { createLifecycleGuard, isMemberIdentity, resolveAccountState, sameAccount } = require('../../utils/page-guard')

const QR_SIZE_PX = 180

Page({
  data: {
    // 默认 false：模板里的「材料包已创建」是写死的，必须等服务端确认订单存在且属于
    // 当前账号之后才允许渲染。
    ready: false,
    loading: false,
    loadError: '',
    loadErrorTitle: '',
    loadRecover: '',
    statusBarHeight: 20,
    orderId: '',
    orderNo: '',
    pickupCode: '',
    fileCount: 0,
    expireTime: '',
    amountText: '',
    statusLabel: '',
    statusTone: 'neutral',
    payStatus: '',
    pickupStatus: '',
    taskStatus: '',
    showQr: false,
    qrStatus: 'loading',   // loading | ready | error
    qrSizePx: QR_SIZE_PX,
    onsiteNotice: pkg.PACKAGE_ONSITE_NOTICE,
    noCancelNotice: pkg.PACKAGE_NO_CANCEL_NOTICE,
  },

  onLoad(options) {
    const orderId = options.orderId ? decodeURIComponent(options.orderId) : ''
    this._guard = createLifecycleGuard()
    this._guard.activate()
    // 稳定账号快照。**只放内存**，并且必须在任何一次破坏性 token 读取之前就存在：
    // auth.getToken() 在 JWT 过期时会连 user 一起清掉，事后再去读就没有账号 id 了。
    this._account = ''
    // 开页那位（不随清场销毁）与"已经换给别人了"的粘性标记。见 _enforceIdentity。
    this._openerAccount = ''
    this._foreignBlocked = false
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      orderId,
    })
  },

  /**
   * 身份若在本页停留期间变了，**当场把凭证清掉**，而不只是丢弃这次响应。
   *
   * 这里是 P1-5 的落点，也是本页与其它三页判据不同的地方。真实触发链路：
   * `utils/request.js` 在 401 且 `auth.canSilentResignin()` 时会静默续签一次；
   * 续签**失败**时它调 `auth.logout()` 清掉 token 与 user —— 全程没有任何
   * 生命周期回调，页面还停在前台，而屏幕上那张已经渲染好的到机码属于一个
   * 已经不存在的会话。只"丢弃响应"的话它会一直留在那儿（共用设备上就是下一位看到它）。
   *
   * R5 修的是它漏掉的另一半：判据此前是 `_guard.setIdentity(memberIdentityKey(auth))`，
   * 而 `auth.getToken()` 在 JWT 自然过期时会先 `clearSession()`（token 与 user 一起清）。
   * 于是「同一个人的 30 分钟 JWT 到点了」与「用户主动登出」在这里完全同形，都是
   * `'u:A' → ''` —— 本页把前者也判成换人：清掉码、写「登录已失效」、**一个请求都不发**，
   * request.js 的静默补签永远没机会跑。用户手上那张码服务端其实还认。
   *
   * 现在改用 page-guard.resolveAccountState：稳定账号快照 + RESIGNIN_ELIGIBLE 这面
   * 持久旗子（`clearSession()` 不动它，只有 `auth.logout()` 撤销它，页面造不出来）。
   * 仍然不动 request.js 的续签设计。
   *
   * @returns {'changed'|'unusable'|'resignable'|'ok'} changed 时本函数已经写好了说明，
   *   调用方不要覆盖；resignable 要**照常发请求**，交给 request.js 去补签。
   */
  _enforceIdentity() {
    const resolved = resolveAccountState(auth, this._account)

    // 开这一页的是谁，单独记一份，**不随清场销毁**。
    // this._account 在换人时必须清空（它是"上一次见到谁"的快照，留着会把下一位的
    // 自然过期误判成换人），但清空之后 `'' → 'u:B'` 在状态机眼里就是一次正常的
    // "补签升级"= 'ok'。
    if (isMemberIdentity(resolved.account) && !this._openerAccount) {
      this._openerAccount = resolved.account
    }

    // 「换成了别人」的判据是**当前这位是不是开页那位**，不是"这一跳里身份变没变"。
    //
    // 后者只认得 A→B 这一种连续跳变，认不出真实链路里更常见的那一种：
    // A 登出（`'u:A' → ''`，本页把快照清成 `''`）→ B 登录 → 回到本页 onShow。
    // 那一跳在状态机眼里是 `'' → 'u:B'` = 一次正常的补签升级 = `'ok'`，
    // 于是本页会拿着**开页那位**的 orderId、带着 B 的登录态去 GET
    //（服务端 requireOwned 必然 404，但请求已经代表 B 发出去了，而"A 有这样一张
    // 订单"这件事也就顺着 404/200 的差别漏给了 B 这个会话）。
    // 按"当前这位是谁"判就没有这个缺口：中间隔了几跳、隔了多久都一样。
    const foreign = isMemberIdentity(this._openerAccount)
      && isMemberIdentity(resolved.identity)
      && resolved.identity !== this._openerAccount

    // 开页那位自己回来了：解除粘性封锁。登出不粘（identity 为 `''`），
    // 所以同一位 A 登出再登回来照样能恢复这一页。
    if (this._foreignBlocked && isMemberIdentity(resolved.identity) && !foreign) {
      this._foreignBlocked = false
    }

    if (foreign || resolved.state === 'changed') {
      if (foreign) this._foreignBlocked = true
      // 真的换了人，或主动登出。setIdentity 会 +1 代次，把上一位在途的请求一并作废 ——
      // 只清 data 不作废请求的话，那几个迟到的响应会把刚清掉的码原样写回来。
      this._account = ''
      this._guard.setIdentity('')
      this._clearCredentials()
      const switched = foreign || isMemberIdentity(resolved.identity)
      this.setData({
        loading: false,
        loadErrorTitle: switched ? '账号已切换' : '登录已失效',
        loadError: switched
          ? '当前账号与打开这张到机码时的不是同一个，已停止显示。可以到「我的 · 打印订单」里找回自己的材料包订单。'
          : '到机码只对订单本人显示，登录状态已失效，请重新登录后再查看。',
        loadRecover: switched ? 'orders' : 'login',
      })
      return 'changed'
    }

    // 已经换给别人、而现在既不是开页那位也不是别人（登出 / 会话缺 id）：
    // 保持已经写好的说明，一个请求都不发。
    if (this._foreignBlocked) {
      this._account = ''
      return 'changed'
    }

    this._account = resolved.account
    // 补签升级（`''` → `'u:<id>'`）**不得** +1 代次：那条刚被 request.js 救回来的响应
    // 正在路上，作废它就又变成一页转不完的 loading。adoptIdentity 只放行这一个方向。
    this._guard.adoptIdentity(resolved.account)
    return resolved.state
  },

  /**
   * 这个响应还能不能写进 data。
   *
   * 四层缺一不可：页面仍在前台（onHide/onUnload 之后一律拒绝，否则刚清掉的到机码
   * 会被迟到的响应原样写回去）、账号没变、是本通道最新一次请求（重复刷新 latest-wins，
   * 旧响应不得把终态改回去）、并且查的是**当前这张**订单。
   *
   * 顺带**执行**身份判定而不只是查询它：每个异步回调都会经过这里，于是前台静默登出
   * 会在下一个回调到达时被当场发现并清场。
   *
   * 账号那一层走 sameAccount 而不是 `accepts(token, identity)` 的逐字比对：后者会把
   * "发起时 JWT 刚过期、回调时补签已成功"（`''` → `'u:<id>'`）判成换人。
   */
  _accepts(token) {
    const state = this._enforceIdentity()
    if (state === 'changed' || state === 'unusable') {
      // 'changed' 时 _enforceIdentity 已经写好终态。'unusable' 没有人写 ——
      // 而页面很可能正**为这条请求**转着圈，只 return 就是一个永远转不完的圈。
      if (state === 'unusable') this._failClosedForIdentity(token)
      return false
    }
    if (!token || token.orderId !== this.data.orderId) return false
    if (!sameAccount(token.identity, this._account)) return false
    return this._guard.accepts(token)
  },

  /**
   * 身份不可用时把页面从 loading 里解出来，fail-closed 到一页**说得清、点得动**的错误态。
   *
   * 触发它的是补签**失败**那条路：打开页面时 JWT 已经过期（快照还是空的），本页因为仍有
   * 补签资格而照常发请求；`utils/request.js` 补签失败时调 `auth.logout()` **撤销资格**，
   * 再把原始 401 抛回来。于是回调这一刻账号状态从 `'resignable'` 掉成 `'unusable'` ——
   * 这一跳里快照始终是 `''`，不算"换人"，所以 `_enforceIdentity` 的 changed 分支不会执行，
   * 没有任何人把 `loading` 写回 false。屏幕上就留下一个既没有请求在跑、也没有出口的圈。
   *
   * 只在这条请求**仍然是本页当前那一条**时才写。`_accepts` 返回 false 还有另外两个原因，
   * 它们各自有接手的路径，在这里写错误态反而会把人家的 loading 顶掉：
   *   - 切后台 / 卸载（`isActive()` 为 false）：回到前台时 onShow 会重新取一次；
   *   - 被更新一次请求顶掉（latest-wins）：那一次自己会写终态。
   * `_guard.accepts(token)` 一次就把这两条都问掉了（它查的正是 active + 代次 + 本通道最新）。
   */
  _failClosedForIdentity(token) {
    if (token && !this._guard.accepts(token)) return
    this._clearCredentials()
    this.setData({
      ready: false, loading: false, pickupCode: '', showQr: false,
      // 登录了却拿不到会员 id 时不说「请先登录」——那句话会让用户以为自己没登录。
      loadErrorTitle: auth.isLoggedIn() ? '登录状态不完整' : '请先登录',
      loadError: auth.isLoggedIn()
        ? '当前会话缺少会员标识，无法确认这张订单是不是本人的。请重新登录一次再查看。'
        : '到机码只对订单本人显示，请登录后再查看。',
      loadRecover: 'login',
    })
  },

  onReady() {
    this._pageReady = true
    if (this.data.showQr) this._drawPickupQr()
  },

  onShow() {
    // 每次回到本页都重新向服务端核一遍：订单可能已被核销、已过期，或者换了登录账号。
    this._guard.activate()
    // 身份**只判一次**，并且判成 'changed' 就到此为止。
    //
    // 此前这里判完还无条件再调一次 loadOrder，而 loadOrder 自己又判一次 —— 那时快照
    // 已经被清空，B 的身份对上"快照为空"就成了 'ok'，于是本页拿着**上一位的 orderId**
    // 用 B 的 token 发请求（服务端 requireOwned 必然 404），并且把刚写好的
    // 「账号已切换」覆盖成 loading。B 的落点是「我的 · 打印订单」，不是这一页。
    if (this._enforceIdentity() === 'changed') return
    this.loadOrder()
  },

  /**
   * 离开或切后台时把凭证从内存里清掉。
   *
   * 到机码不写 storage、不进 URL、不做本地缓存 —— 共用设备上把码留在页面数据里，
   * 下一位用户从后台切回来就能看到上一位的码。回到本页时会重新向服务端取。
   * paymentSessionToken 虽然在详情响应里，但本页**从不 setData**，因此也不会被持久化。
   */
  // deactivate() 必须排在 _clearCredentials() 之前，而且两者都不能少：
  // 只清 data 的话，切后台那一刻仍在途的 getPackageOrder 响应回来时页面已经
  // 重新 activate，它会把刚清掉的到机码原样写回去 —— 码就这么"复活"了。
  // deactivate 会 +1 代次，让那条响应连 setData 的机会都没有。
  onHide() {
    this._guard.deactivate()
    this._clearCredentials()
  },

  onUnload() {
    this._guard.deactivate()
    this._clearCredentials()
  },

  _clearCredentials() {
    // `_codeRaw` 是画二维码用的明文副本，必须和 data 里的码一起清 ——
    // 只清 data 的话，切后台再回来那一帧会用上一位用户的码重绘出一张可扫的二维码。
    this._codeRaw = ''
    this._drawToken = null
    this.setData({ pickupCode: '', showQr: false, qrStatus: 'loading', ready: false })
  },

  loadOrder() {
    const { orderId } = this.data
    if (!orderId) {
      this.setData({
        ready: false, loading: false,
        loadErrorTitle: '缺少订单信息',
        loadError: '这条链接没有带订单号，本页不展示任何到机码。可以到「我的 · 打印订单」里找回自己的材料包订单。',
        loadRecover: 'orders',
      })
      return
    }
    // 每个入口都过一遍身份：用户点「重新加载」时也可能已经被静默登出了。
    // 'changed' 时 _enforceIdentity 已经清场并写好了说明，不要再覆盖成「请先登录」。
    const identityState = this._enforceIdentity()
    if (identityState === 'changed') return
    // 'resignable' 与 'ok' 一样**真的发请求**：本地 token 自然过期但没人登出时，
    // 必须让它进 request.js —— 那里拿到 401 会静默补签一次再重发，用户全程无感。
    // 在本页先拦下来，等于把一个能自己修好的过期会话变成一页转不完的 loading。
    // 与回调里那条路共用同一个出口（同一句文案、同一个恢复动作），不维护第二份。
    if (identityState === 'unusable') { this._failClosedForIdentity(); return }
    // 令牌带上 orderId：重复刷新只认最新一次，旧响应既不能把终态改回去，
    // 也不能拿另一张订单的数据覆盖当前这张。
    const token = this._guard.issue('order', { orderId })
    // `ready: false` 不能省：模板里 loading 块与 ready 成功块是**两个独立的 wx:if**，
    // 不是一条 if/elif 链。重新加载时若把 ready 留成 true，屏幕上会同时出现
    // 「正在向服务端核对订单」和上一轮那张到机码 —— 而那张码正等着被核销撤下。
    this.setData({ loading: true, ready: false, loadError: '', loadErrorTitle: '', loadRecover: '' })
    api.getPackageOrder(orderId)
      .then((order) => {
        if (!this._accepts(token)) return
        const status = pkg.resolvePackageStatus(order)
        // 服务端的 visibleCode 判据（pending 且未过期）已经决定了给不给码；
        // 前端不做第二套判据，只忠实反映「有没有拿到」。
        const code = order && order.pickupCode ? String(order.pickupCode) : ''
        const codeUsable = PICKUP_CODE_RE.test(code)
        this.setData({
          ready: true,
          loading: false,
          orderNo: (order && order.orderNo) || '',
          pickupCode: pkg.formatPickupCode(code),
          fileCount: Array.isArray(order && order.items) ? order.items.length : 0,
          expireTime: pkg.formatExpireAt(order && order.expiresAt),
          amountText: pkg.formatAmount(order && order.amountCents),
          statusLabel: status.label,
          statusTone: status.tone,
          payStatus: (order && order.payStatus) || '',
          pickupStatus: (order && order.pickupStatus) || '',
          taskStatus: (order && order.taskStatus) || '',
          showQr: codeUsable,
          qrStatus: codeUsable ? 'loading' : 'error',
        }, () => {
          // setData 的回调在下一帧：这中间可能已经 onHide。再核一次才动
          // _codeRaw —— 它是画二维码用的明文副本，写回去等于把码复活。
          if (!this._accepts(token)) return
          this._codeRaw = codeUsable ? code : ''
          this._drawToken = codeUsable ? token : null
          if (codeUsable) this._drawPickupQr()
        })
      })
      .catch((err) => {
        if (!this._accepts(token)) return
        // 不把服务端错误体当文案（utils/user-error.js 的判据），也绝不在查不到订单时
        // 退回 URL 里的值渲染成功页 —— 那等于把洞原样留着。
        const shown = pkg.describePackageError(err, '订单信息加载失败，请稍后重试。')
        this.setData({
          ready: false,
          loading: false,
          pickupCode: '',
          showQr: false,
          loadErrorTitle: shown.title,
          loadError: shown.text,
          loadRecover: shown.recover,
        })
      })
  },

  /**
   * 本地离线编码到机码二维码，与 print-pickup 同一套实现（utils/pickup-qrcode.js）。
   * 此处此前是一个写死「二维码」字样的占位方框 —— 用户以为有码可扫，到了机器前才发现
   * 只能手输。没有真码时明确说「二维码不可用，请手输下方到机码」。
   */
  _drawPickupQr() {
    if (!this._guard.isActive()) return
    if (!this._pageReady || !this.data.showQr || !this._codeRaw) return
    // 把"要画哪个码、属于哪次请求"在进入异步之前就钉死。
    // exec 的回调可能跨好几帧才回来，中间这张码完全可能已经被换掉或撤下。
    const code = this._codeRaw
    const token = this._drawToken
    let matrix
    try {
      matrix = createPickupQrMatrix(code)
    } catch (_) {
      this.setData({ qrStatus: 'error' })
      return
    }
    wx.createSelectorQuery().in(this).select('#package-qr').fields({ node: true, size: true }).exec((result) => {
      // exec 是异步的：回调执行时可能已经 onHide 并清掉了 _codeRaw，
      // 也可能已经取回了**另一张**码。此时既不该画，也不该把 qrStatus 写成 ready
      // （那会把上一张码的画布说成"新码已就绪"，用户扫到的是一张作废的码）。
      if (!this._guard.isActive() || !this._codeRaw) return
      if (this._codeRaw !== code) return
      if (token && !this._accepts(token)) return
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

  retryLoad() {
    this.loadOrder()
  },

  recover(e) {
    const target = e.currentTarget.dataset.recover
    if (target === 'login') return wx.navigateTo({ url: '/pages/launch/launch' })
    if (target === 'orders') return this.viewOrders()
    this.loadOrder()
  },

  /**
   * 去「我的 · 打印订单」。
   *
   * 这里此前跳的是 order-detail —— 那页读 `/me/print-orders/:orderId`，而该端点的
   * requireOwned 过滤把材料包排除在外（材料包 sourceFileId 为 null），点了只会拿到
   * PRINT_ORDER_NOT_FOUND。材料包的落点是打印订单页的材料包分区。
   */
  viewOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },

  /**
   * 复制**原始**到机码（未分组的 8 位），不是屏幕上那串 `12-34-56-78`。
   *
   * 服务端 `pickup-order.service.ts` 的 claim 只做 `codeInput.trim().toUpperCase()`，
   * **不去分隔符**，然后拿它算 `hashPickupCode` 去查 `pickupCodeHash` ——
   * 带横杠的串根本匹配不上。一体机自己的输入框会 `normalizeInput` 去掉分隔符，
   * 所以粘到一体机上没事；但剪贴板里的东西会被粘到哪儿不归我们决定。
   * 屏幕仍显示分组形式（好念好核对），复制走真值。
   */
  copyCode() {
    // 已被清场 / 尚未取到：不复制一个残留在 data 里的旧串。
    if (!this._codeRaw || !this.data.pickupCode) return
    wx.setClipboardData({
      data: this._codeRaw,
      success() { wx.showToast({ title: '到机码已复制', icon: 'success' }) },
    })
  },

  copyOrderNo() {
    if (!this.data.orderNo) return
    wx.setClipboardData({
      data: this.data.orderNo,
      success() { wx.showToast({ title: '订单号已复制', icon: 'success' }) },
    })
  },

  // 不提供 onShareAppMessage：这页原本可以把「材料包创建成功」当作分享标题转发出去，
  // 而收到的人打开的是一张没有任何订单支撑的成功页。到机码是取件凭证，不做分享。
})
