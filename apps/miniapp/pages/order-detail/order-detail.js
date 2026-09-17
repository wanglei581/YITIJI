// pages/order-detail/order-detail.js
//
// 单件云打印订单的详情页。数据只来自 GET /me/print-orders/:orderId
//（needAuth + requireOwned 归属校验）。其中 pickupStatus==='pending' 时带回的
// pickupCode 就是**到机码** —— 拿着它就能到一体机上取件。所以本页和 print-pickup、
// orders 同属"屏幕上会出现本人凭证"的那一类，必须守住身份与请求代次。
//
// 此前本页只有 onLoad 里的一发请求，**没有任何身份生命周期**，四种真实链路全漏：
//   · 换人 / 登出后回到本页：上一位的到机码、文件名、金额原样留在屏幕上等着下一位看；
//   · utils/request.js 拿到 401 会静默续签，续签失败就 auth.logout() —— 全程没有任何
//     生命周期回调，页面还停在前台，那张码属于一个已经不存在的会话；
//   · 切后台 / 离开本页时在途的那一发回来照样写进 data，把刚清掉的码原样写回去；
//   · 重复进入 / 重试时两发乱序返回，旧的那发盖掉新的。
//
// 判据全部复用 utils/page-guard.js，与 print-pay / print-pickup 同一口径，不另起一套：
//   身份（resolveAccountState）+ 代次（onHide/onUnload/换人 +1）+ 逐通道 latest-wins。
// 其中"同一个人的 JWT 自然到点"必须与"换人 / 主动登出"分开 —— 前者要放行请求让
// request.js 去补签（enduser JWT 只签 30 分钟，早上下单下午来看详情必然命中），
// 后者要当场清场。那一层由 page-guard 的 RESIGNIN_ELIGIBLE 判据负责。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { createLifecycleGuard, isMemberIdentity, resolveAccountState, sameAccount } = require('../../utils/page-guard')

const STATUS_MAP = {
  pending:   '待取件',
  claimed:   '待取件',
  printing:  '打印中',
  completed: '已完成',
  failed:    '打印失败',
  cancelled: '已取消',
}

const STATUS_TONE = {
  pending: 'wheat', claimed: 'wheat', printing: 'teal',
  completed: 'ok', failed: 'danger', cancelled: 'neutral',
}

const ERROR_TITLE_DEFAULT = '加载失败，点此重试'
const ERROR_TITLE_SWITCHED = '账号已切换'
const ERROR_TITLE_SIGNED_OUT = '登录已失效'

const MSG_SWITCHED = '当前账号与打开这张订单时的不是同一个，已停止显示订单详情与到机码。请到「我的 · 打印订单」重新进入。'
const MSG_SIGNED_OUT = '登录已失效，请重新登录后再查看订单详情与到机码。'

function fmtCode(raw) {
  if (!raw) return ''
  const s = String(raw).replace(/\s/g, '').toUpperCase()
  // groups 判空：纯空白入参 replace 后为空串，match 返回 null，直接 .join 会 THROW
  const groups = s.match(/.{1,2}/g)
  return groups ? groups.join('-') : ''
}

function fmtPrice(cents) {
  const n = Number(cents)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n === 0) return '免费'
  return '¥' + (n / 100).toFixed(2)
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function buildSpec(item) {
  const parts = []
  if (item.paperSize)     parts.push(String(item.paperSize).toUpperCase())
  if (item.colorMode)     parts.push(item.colorMode === 'color' ? '彩色' : '黑白')
  if (item.copies)        parts.push(`${item.copies} 份`)
  if (item.billablePages) parts.push(`共 ${item.billablePages} 页`)
  return parts.join(' · ') || '—'
}

function canCancelCloudOrder(raw) {
  return !raw.status
    && raw.payStatus === 'unpaid'
    && raw.pickupStatus === 'pending'
}

function toDetail(raw) {
  const status = raw.status || raw.taskStatus || ''
  const pickupRaw = (!raw.status && raw.pickupStatus === 'pending') ? (raw.pickupCode || '') : ''
  return {
    fileName:     raw.fileName || '打印文件',
    store:        raw.terminalDisplayName || raw.terminalName || raw.storeName || '打印服务终端',
    spec:         buildSpec(raw),
    price:        fmtPrice(raw.amountCents),
    statusLabel:  STATUS_MAP[status] || status || '未知',
    statusTone:   STATUS_TONE[status] || 'neutral',
    pickup:       fmtCode(pickupRaw),
    createdAt:    fmtTime(raw.createdAt),
    payStatus:    raw.payStatus || '',
    pickupStatus: raw.pickupStatus || '',
    canCancel:    canCancelCloudOrder(raw),
  }
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    error: '',
    errorTitle: ERROR_TITLE_DEFAULT,
    detail: null,
    cancelling: false,
  },

  onLoad(options) {
    this._orderId = (options && options.orderId) || ''
    this._toDetail = toDetail
    // 稳定账号快照。**只放内存**，并且必须在任何一次破坏性 token 读取之前就存在 ——
    // auth.getToken() 在 JWT 过期时会连 user 一起清掉，事后再去读就没有账号 id 了。
    this._account = ''
    // 开页那位（不随清场销毁）与「已经换给别人了」的粘性标记。见 _resolveAccount。
    this._openerAccount = ''
    this._foreignBlocked = false
    // 取消链的去重锁。必须显式初始化：留成 undefined 不影响判断，但显式写出来才能
    // 和 _clearSensitive 里的释放对上。
    this._cancelLock = false
    this._guard = createLifecycleGuard()
    this._guard.activate()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    // **绑定开页那位的唯一时刻**：本页刚被导航打开，此刻登录着的那位就是把这张
    // orderId 带进来的那位。之后任何身份跳变都能被 resolveAccountState 与 foreign 判据
    // 看出来。取数交给紧随其后的 onShow —— 真机上 onLoad 之后必然走一次 onShow，
    // 两边都发就是同一份详情连打两发。
    this._resolveAccount(true)
  },

  /**
   * 账号判定 + **当场清场**。每个入口和每个异步回调都要过这里。
   * 判据是 page-guard.resolveAccountState 那一份（四态，见那里的长注释）。
   *
   * @param {boolean} [bindOwner] 只有 onLoad 传 true。
   * @returns {'changed'|'unusable'|'resignable'|'ok'} 'changed' 时本函数已经清场并写好
   *   说明，调用方直接返回，不要再覆盖。
   */
  _resolveAccount(bindOwner) {
    const resolved = resolveAccountState(auth, this._account)

    if (isMemberIdentity(resolved.account) && !this._openerAccount && bindOwner === true) {
      this._openerAccount = resolved.account
    }

    // 「换成了别人」的判据是**当前这位是不是开页那位**，不是"这一跳里身份变没变"。
    // 后者只认得 A→B 这一种连续跳变，认不出更常见的那一种：A 登出（快照被清成 ''）
    // → B 登录 → 回到本页 onShow。那一跳在状态机眼里是 '' → 'u:B' = 一次正常的补签
    // 升级 = 'ok'，于是本页会拿着**开页那位**的 orderId、带着 B 的登录态去请求
    //（服务端 requireOwned 必然 404，但请求已经代表 B 发出去了）。
    const foreign = isMemberIdentity(this._openerAccount)
      && isMemberIdentity(resolved.identity)
      && resolved.identity !== this._openerAccount

    // 开页那位自己回来了：解除粘性封锁。登出不粘（identity 为 ''），
    // 所以同一位登出再登回来照样能恢复这一页。
    if (this._foreignBlocked && isMemberIdentity(resolved.identity) && !foreign) {
      this._foreignBlocked = false
    }

    if (foreign || resolved.state === 'changed') {
      if (foreign) this._foreignBlocked = true
      this._account = ''
      // 身份一变，在途那一发就不再属于本页任何状态：setIdentity('') +1 代次，
      // 把上一位在途的详情 / 取消请求一并作废。只清 data 不作废请求的话，
      // 那几个迟到的响应会把上一位的到机码原样写回来。
      this._guard.setIdentity('')
      const switched = foreign || isMemberIdentity(resolved.identity)
      this._clearSensitive({
        loading: false,
        errorTitle: switched ? ERROR_TITLE_SWITCHED : ERROR_TITLE_SIGNED_OUT,
        error: switched ? MSG_SWITCHED : MSG_SIGNED_OUT,
      })
      return 'changed'
    }

    // 已经换给别人、而现在既不是开页那位也不是别人（登出 / 会话缺 id）：
    // 保持已经写好的说明，一个请求都不发。
    if (this._foreignBlocked) {
      this._account = ''
      return 'changed'
    }

    // 'ok' 采纳新账号；'resignable' 原样留住上一位的快照（那正是"还是同一位"的凭据，
    // 丢了它下一次就会把自然过期误判成登出）；'unusable' 快照本来就是空。
    this._account = resolved.account
    // 补签升级（'' → 'u:<id>'）不 +1 代次：那条刚被 request.js 救回来的响应正在路上，
    // 作废它只会让页面永远停在 loading。adoptIdentity 只放行这一个方向。
    this._guard.adoptIdentity(resolved.account)
    return resolved.state
  },

  /** 这条响应还能不能写进 data：账号没变（含补签升级）+ 页面在前台 + 本通道最新一次。 */
  _accepts(token) {
    const state = this._resolveAccount()
    if (state === 'changed') return false
    if (state === 'unusable') {
      // 'changed' 时 _resolveAccount 已经写好说明，'unusable' 没有人写 ——
      // 而页面很可能正**为这条响应**停在「正在加载订单详情…」上，只 return 就是永远转圈。
      this._failClosed()
      return false
    }
    if (!sameAccount(token && token.identity, this._account)) return false
    return this._guard.accepts(token)
  },

  /**
   * 清掉屏幕上属于某一位的一切：到机码、文件名（常常就写着本人姓名）、金额、
   * 终端、状态，以及那把「正在取消…」的遮罩锁。
   *
   * 这些字段全挂在 detail 上，所以 detail 置空即清场；cancelling 单独放，
   * 留着它 B 的按钮会永远按不动。
   */
  _clearSensitive(patch) {
    const next = { detail: null, cancelling: false }
    if (patch) {
      for (const key of Object.keys(patch)) next[key] = patch[key]
    }
    this.setData(next)
  },

  /** 身份不可用（从没登录 / 已登出 / 登录着却拿不到会员 id）：fail-closed。 */
  _failClosed() {
    this._clearSensitive({
      loading: false,
      errorTitle: ERROR_TITLE_SIGNED_OUT,
      error: MSG_SIGNED_OUT,
    })
  },

  onShow() {
    this._guard.activate()
    // 回前台必须重新核一次账号并重新取数：用户完全可能在本页停留期间被静默登出，
    // 或者在另一页换了账号 —— 全程没有任何回调会通知本页，而屏幕上还挂着上一位的
    // 到机码。同一位账号则照常刷新（订单状态、到机码有效性都会在这期间变）。
    this._load()
  },

  // 切后台 / 离开本页：在途请求全部作废（deactivate 会 +1 代次），**并且当场把
  // 凭证从 data 里清掉**。只作废请求不清 data 是不够的：一体机与共用手机上，
  // 上一位切出去之后那张到机码仍然留在页面对象里，回到本页的第一帧就会把它画出来。
  // 下一次 onShow 会重新取数，真属于当前这位的详情会再写回来。
  onHide() {
    this._guard.deactivate()
    this._clearSensitive({ loading: true, error: '', errorTitle: ERROR_TITLE_DEFAULT })
  },

  onUnload() {
    this._guard.deactivate()
    this._clearSensitive({ loading: true, error: '', errorTitle: ERROR_TITLE_DEFAULT })
  },

  _load() {
    const state = this._resolveAccount()
    if (state === 'changed') return
    if (state === 'unusable') { this._failClosed(); return }
    if (!this._orderId) {
      this.setData({ loading: false, errorTitle: '无法打开订单', error: '订单 ID 缺失' })
      return
    }
    const token = this._guard.issue('detail', { orderId: this._orderId })
    this.setData({ loading: true, error: '', errorTitle: ERROR_TITLE_DEFAULT })
    api.getCloudPrintOrder(this._orderId)
      .then((raw) => {
        // _accepts 内部会**先执行**账号判定：换人 / 前台静默登出时，光丢弃这条响应
        // 不够 —— 屏幕上已经渲染出来的到机码要在这一刻就清掉。
        if (!this._accepts(token)) return
        // 归属由**服务端**认下来：requireOwned 是按发出这一发时的登录态校验的，
        // 而那是谁在发出前就记进了令牌。发出时归属未定的那一发（token.identity 为 ''，
        // 也就是"开页时 JWT 恰好已过期、靠 request.js 补签救回来"那条路）什么都
        // 证明不了 —— 那段时间里完全可能是**另一个人**登录了进来。
        if (!this._openerAccount && isMemberIdentity(token.identity) && token.identity === this._account) {
          this._openerAccount = this._account
        }
        this.setData({
          loading: false,
          cancelling: false,
          detail: toDetail(raw),
        })
      })
      .catch((err) => {
        // 401 走到这里说明 request.js 连静默续签都没救回来（它续签失败时会 auth.logout()）。
        // 那一刻起页面上的到机码属于一个已经不存在的会话 —— _accepts 里的账号判定
        // 会当场把它清掉，不必等用户离开本页再回来。
        if (!this._accepts(token)) return
        this.setData({
          loading: false,
          errorTitle: ERROR_TITLE_DEFAULT,
          error: (err && err.message) || '加载失败，请稍后重试',
        })
      })
  },

  retry() { this._load() },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.navigateTo({ url: '/pages/orders/orders' }) } })
  },

  toPrint() {
    wx.navigateTo({ url: '/pages/documents/documents' })
  },

  cancelOrder() {
    const detail = this.data.detail
    if (!this._orderId || !detail || !detail.canCancel || this.data.cancelling) return
    // 换人 / 登出之后不该再弹出一张写着上一位订单的确认框。
    const state = this._resolveAccount()
    if (state === 'changed' || state === 'unusable') return
    wx.showModal({
      title: '取消订单',
      content: '取消后到机码立即失效，且不能恢复。确定取消这张未付款订单？',
      confirmText: '确认取消',
      cancelText: '再想想',
      confirmColor: '#b5643c',
      success: (res) => {
        if (!res.confirm) return
        this._submitCancel()
      },
    })
  },

  _submitCancel() {
    if (this._cancelLock) return
    const detail = this.data.detail
    if (!this._orderId || !detail || !detail.canCancel) return
    // 确认框停留期间完全可能已经换了人：这里再判一次，不要拿 B 的登录态去取消 A 的订单。
    const state = this._resolveAccount()
    if (state === 'changed' || state === 'unusable') return
    this._cancelLock = true
    // 取消**独占一个通道**：详情刷新（onShow 每次都会发）不该让在途的取消失效，
    // 反过来也一样 —— 两者写的是同一批字段，但有各自的因果。
    const token = this._guard.issue('cancel', { orderId: this._orderId })
    this.setData({ cancelling: true })
    api.cancelCloudPrintOrder(this._orderId)
      .then((raw) => {
        if (!this._accepts(token)) return
        this.setData({
          cancelling: false,
          detail: toDetail(raw),
        })
      })
      .catch((err) => {
        if (!this._accepts(token)) return
        this.setData({ cancelling: false })
        wx.showModal({
          title: '取消失败',
          content: (err && err.message) || '请稍后重试',
          showCancel: false,
        })
      })
      // 去重锁**无条件**交还：被守卫丢弃的那一发也必须放锁，否则"再取消一次"会是一个
      // 按不动的按钮。屏幕上的 cancelling 遮罩由清场那一步收起（_clearSensitive）。
      .then(() => { this._cancelLock = false })
  },
})
