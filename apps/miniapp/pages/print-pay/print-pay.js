// pages/print-pay/print-pay.js
//
// 单件云打印的最后一步：确认参数 → 建 Order-only 订单 → 去到机码页。
//
// 本页收到的 URL **只有 fileId / storeId / store（终端公开显示名）/ copies** 四项。
// 文件名与金额此前是从上一页拼在 URL 里传过来的，现在一律向服务端取：
//   - 金额与页数走 `POST /orders/quote`（与 print-upload 同一条报价链，服务端识别真实
//     页数并按 PriceConfig 计价）。前端不做任何单价乘法，也不把调用方给的数字当事实。
//   - 文件名走 `GET /me/documents`（本人文件元数据，带登录态）。
// 为什么非改不可：求职材料的文件名里常常就写着本人姓名（「张三的简历.pdf」），
// 而金额是本人订单状态。它们进了 URL，一条构造出来或转发出去的链接就能在别人手机上
// 把这些渲染出来。与 package-confirm → package-code、orders → print-pickup 同一口径。
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { createLifecycleGuard, isMemberIdentity, resolveAccountState, sameAccount } = require('../../utils/page-guard')
const idem = require('../../utils/print-order-idempotency')
const reconcileEngine = require('../../utils/order-submission-reconcile')
const priceConfirm = require('../../utils/price-confirmation')

// MP-07 改法 (a)：标签只显示即将建单的真实参数，不从 query 猜彩色/双面。
// 与 print-upload.verifiedPrintParams 锁死同一组（verify-miniapp-static 抽取字面量）。
// 彩色/双面尚未通过真机验收，不能做 (b) 把 query 透传到报价/建单——那会按彩色收费或 400。
const ORDER_COLOR_MODE = 'black_white'
const ORDER_DUPLEX = 'simplex'

/**
 * 报价参数。**与下面 createCloudPrintOrder 用的是同两个常量**，
 * 两条链共用一个出口，就不可能出现「按一种参数报价、按另一种参数计价」。
 * 其余固定值与 print-upload 的 verifiedPrintParams 逐字一致。
 */
function quoteParams(copies) {
  return {
    copies,
    colorMode: ORDER_COLOR_MODE,
    duplex: ORDER_DUPLEX,
    paperSize: 'A4',
    orientation: 'auto',
    quality: 'standard',
    scale: 'fit',
    pagesPerSheet: 1,
  }
}

function colorLabelOf(colorMode) {
  return colorMode === 'color' ? '彩色' : '黑白'
}

function duplexLabelOf(duplex) {
  return duplex === 'simplex' ? '单面' : '双面'
}

/** 分 → 元字符串。0 分是真的免费（试运营价目），不是「未知」，两者必须分开。 */
function formatYuan(amountCents) {
  return (amountCents / 100).toFixed(2)
}

/** 给「价格已更新」那句话用的完整金额串。 */
function amountTextOf(amountCents) {
  return amountCents === 0 ? '免费' : '¥' + formatYuan(amountCents)
}

/**
 * 服务端这张订单是不是**已经走到头**了 —— 返回一句给用户看的原因，不是终态返回 `''`。
 *
 * 为什么必须问服务端、而且必须问清楚：本机那条恢复记录活 7 天，而它锁住的东西是
 * 「这一组参数不许再下单」。订单在这 7 天里完全可能已经取消、到机码已经过期、
 * 已经打完、或者打印失败 —— 服务端的幂等键是**永久**挂在那张 Order 行上的
 *（`Order_endUserId_idempotencyKey_key`，没有过期清理），所以继续拿同一个键去 POST
 * 只会一遍遍回放那张作废的订单。用户看到的是一个按不动的按钮和一句「订单已创建」，
 * 而他要的那份东西永远打不出来。
 *
 * 取值与 print-pickup 的 TERMINAL_STATES / resolveOrderState 同一组，判据也同源
 *（服务端 toView 同时给出 pickupStatus 与 taskStatus，两者任一到终态即终态）。
 */
function terminalReasonOf(order) {
  const pickupStatus = String((order && order.pickupStatus) || '')
  const taskStatus = String((order && order.taskStatus) || '')
  if (taskStatus === 'completed') return '上一张订单已经打印完成'
  if (taskStatus === 'failed') return '上一张订单打印失败'
  if (taskStatus === 'abandoned') return '上一张订单的打印任务已终止'
  if (pickupStatus === 'cancelled' || taskStatus === 'cancelled') return '上一张订单已取消'
  if (pickupStatus === 'expired' || taskStatus === 'expired') return '上一张订单的到机码已过期'
  return ''
}

Page({
  data: {
    statusBarHeight: 20,
    q: {},
    files: [{ name: '本人文件', price: '—' }],
    fee: { total: '—' },
    isFreeOrder: false,
    submitting: false,
    colorMode: ORDER_COLOR_MODE,
    duplex: ORDER_DUPLEX,
    colorLabel: '黑白',
    duplexLabel: '单面',
    pageCountLabel: '待服务端核定',
    copiesLabel: 1,
    // 报价状态：idle | loading | ready | error。金额与页数只有 ready 时才是真的。
    quoteState: 'idle',
    quoteError: '',
    // 报价失败时的**可执行下一步**，取值 '' | 'login' | 'retry'。
    // 用状态字段而不是去认文案里有没有「登录」两个字：文案是给人读的，会被改写、
    // 会被翻译，拿它当判据就是把一条控制流挂在一句话上。
    quoteRecover: '',
    // 订单已建成后的锁。服务端会按幂等键回放同一张单，所以这把锁不再是「防重复扣款」
    // 的最后一道 —— 它现在的职责是**把这件事告诉用户**：订单已经在了，去找它，别再提交。
    createdLocked: false,
    // 那张已建成的订单**现在**是什么状态，
    // 取值 '' | 'checking' | 'live' | 'unknown' | 'terminal' | 'abandoned'。
    // 'abandoned' 是唯一一档"压根没有订单"的锁态：服务端已给那个键立墓碑，可以换键重来。
    // 只有 'terminal' 是"服务端证明它已经走到头了"，也只有它才允许重新下一单。
    // 'unknown' 是查不出来（网络 / 401 / 5xx）：fail-closed，继续锁着。
    createdState: '',
    createdNotice: '',
    // 「重新下单」按钮的开关。与 createdState 分开一个字段，是为了让模板不必再解析
    // 状态语义，也让"能不能重新下单"这件事只有一个出口（startNewOrder 自己再判一次）。
    createdCanReorder: false,
    // 价格再确认（见 utils/price-confirmation.js）。两者都非空 = 服务端拒绝了按旧金额建单
    //（没建单、没扣款），屏幕已换成服务端当前金额，等用户**自己再点一次**按新金额确认。
    priceChangeText: '',
    priceConfirmLabel: '',
  },

  onLoad(opts) {
    const q = opts || {}
    const copies = Number(q.copies) > 0 ? Number(q.copies) : 1
    // 稳定账号快照。**只放内存**，并且必须在任何一次破坏性 token 读取之前就存在：
    // auth.getToken() 在 JWT 过期时会连 user 一起清掉，事后再去读就没有账号 id 了。
    this._account = ''
    // 报价链的代次守卫（latest-wins）。**建单链不走它** —— 见 continueFlow：
    // 建单的判据只能是"这次尝试绑给了哪位账号"，切后台绝不能让已经建成的订单丢掉。
    this._guard = createLifecycleGuard()
    this._guard.activate()
    // 「那张已建成的订单核过了吗」。只放内存：换人 / 重进都必须重新核一次。
    this._verifyingOrderId = ''
    this._verifiedOrderId = ''
    // 屏幕上那个金额的快照（price-confirmation.bindQuote）。**只放内存**：退出重进一律重新核价。
    this._quote = null
    this.setData({
      statusBarHeight: getApp().globalData.statusBarHeight || 20,
      q,
      colorMode: ORDER_COLOR_MODE,
      duplex: ORDER_DUPLEX,
      colorLabel: colorLabelOf(ORDER_COLOR_MODE),
      duplexLabel: duplexLabelOf(ORDER_DUPLEX),
      copiesLabel: copies,
    })
    // 进页面就先看一眼：这一组参数在本机有没有一张**已经建成**的订单。
    // 有就直接进恢复态，连第一次提交都不该发生。**必须排在核价之前**：锁住之后 _loadQuote
    // 不再核价 —— 否则一份与那张订单无关的现价会写上屏，甚至绑成之后可提交的金额。
    this._resolveAccount()
    this._restoreCreatedOrder()
    this._loadQuote()
    this._loadFileName()
  },

  /** 本次下单的 payload。指纹与幂等键都按它算，发给服务端的也是它。 */
  _orderPayload() {
    const q = this.data.q
    return {
      fileId: q.fileId,
      terminalId: q.storeId,
      copies: Math.max(1, Number(q.copies) || 1),
      // 与上面 quoteParams 逐字同源（同两个常量）：报价与计价不会分叉。
      colorMode: ORDER_COLOR_MODE,
      duplex: ORDER_DUPLEX,
    }
  },

  /**
   * 恢复「这一单已经建成」的锁。
   *
   * 触发它的是三种真实处境：上一次 200 回来时页面已经换了人（记录写给了 A，
   * A 重新登录回来要看得见）、跳转失败后用户退出又进来、以及小程序被杀掉重进。
   * 三种的共同点是**服务端那张订单已经存在**，而页面自己什么都不记得了 ——
   * 不恢复就会再提交一次。
   *
   * 只读**当前这位**的记录：findRecord 要求账号逐字相等且是确定的会员键。
   *
   * **恢复出来的锁必须再向服务端核一次。** 那条记录活 7 天，而它锁住的是「这一组参数
   * 不许再下单」；这 7 天里订单完全可能已经取消 / 到机码过期 / 打完 / 打印失败。
   * 服务端的幂等键永久挂在那张 Order 行上，所以继续拿同一个键去 POST 只会一遍遍回放
   * 那张作废的订单 —— 用户面对的是一个按不动的按钮和一句「订单已创建」，而他要的
   * 那份材料永远打不出来。核对结果由 `_verifyCreatedOrder` 写进 createdState。
   */
  _restoreCreatedOrder() {
    if (!isMemberIdentity(this._account)) return
    const q = this.data.q
    if (!q.fileId || !q.storeId) return
    const fingerprint = idem.fingerprintOf(this._orderPayload())
    const record = idem.findRecord(this._account, fingerprint)
    if (!record || !record.orderId) return
    this._createdOrderId = record.orderId
    // 先按「已建成」锁住，再去核状态：核对期间同样一次 POST 都不许发 —— 这一刻我们
    // 恰恰**还不知道**那张订单是不是活的，放开按钮就是在不确定时多建一张。
    this.setData({ submitting: false, createdLocked: true })
    this._verifyCreatedOrder(record.orderId)
  },

  /**
   * 向服务端核一次「那张已建成的订单现在怎么样了」。
   *
   * 三种结局，判据只认服务端：
   *   - 终态（取消 / 过期 / 完成 / 失败 / 终止，或 requireOwned 明确查不到这张订单）
   *     → 允许重新下一单，但**必须由用户自己点**那个按钮（startNewOrder）。
   *     页面不自动换键：那等于替用户做了一次下单决定，而他可能只是想找回原来那张。
   *   - 活着 → 继续锁着，指路「我的 · 打印订单」。**这一条结论不缓存**：见下面
   *     `_verifiedOrderId` 的写入时机。
   *   - 查不出来（网络失败 / 401 / 5xx）→ **继续锁着**。查询失败证明不了任何事，
   *     而这里只要放开一格，代价就是同一份材料的第二张订单、第二笔钱。
   *     更不许因为"查不到"就铸一个新键 —— 那会让服务端连回放的机会都没有。
   */
  _verifyCreatedOrder(orderId) {
    if (!orderId) return
    // 两道去重，管的是两件不同的事：
    //   `_verifiedOrderId` —— 已经拿到**终态**结论，不必再问（终态不可逆）。
    //   `_verifyingOrderId` —— 这张订单已经有一发在飞，onShow 连着触发两次也只打一发。
    // 'live' / 'unknown' 都不进 `_verifiedOrderId`：它们是会变的结论。
    if (this._verifiedOrderId === orderId || this._verifyingOrderId === orderId) return
    this._verifyingOrderId = orderId
    const token = this._guard.issue('restore', { orderId })
    this.setData({
      createdState: 'checking',
      createdNotice: '正在向服务端核对这张订单现在的状态…',
      createdCanReorder: false,
    })
    api.getCloudPrintOrder(orderId)
      .then((order) => {
        if (!this._accepts(token) || this._createdOrderId !== orderId) return
        this._verifyingOrderId = ''
        // 屏幕只认这张订单自己落库的金额。它不是报价：不绑快照，不能拿去下单。
        this._quote = null
        if (priceConfirm.isQuotableAmount(order && order.amountCents)) this._showAmount(order.amountCents)
        const reason = terminalReasonOf(order)
        if (reason) {
          // **终态才缓存。** 取消 / 过期 / 完成 / 失败 / 终止都是不可逆的：再问一百次
          // 服务端也是同一个答案，缓存它只省请求，不会让页面停在一个过期的结论上。
          this._verifiedOrderId = orderId
          this.setData({
            createdState: 'terminal',
            createdNotice: `${reason}，这一组参数可以重新下一单。原来那张仍可在「我的 · 打印订单」里查看。`,
            createdCanReorder: true,
          })
          return
        }
        // **「还活着」不缓存。** 上一版在分类之前就把 `_verifiedOrderId` 写死了，于是
        // 'live' 也被当成一个永久结论：用户照着提示去「我的 · 打印订单」把那张订单取消
        // （或它的到机码在这期间过期了），再回到本页 —— `_verifyCreatedOrder` 第一行
        // 就因为 `_verifiedOrderId === orderId` 原地返回，页面永远停在「这张订单还在」，
        // 那一组参数于是被一张早已作废的订单锁死到本机记录过期（7 天）为止。
        // "活着"本来就是一个会到期的结论，只能每次回到本页重新问一遍。
        // 重复请求由 `_verifyingOrderId` 挡（同一张订单在途时不再打第二发）。
        this.setData({
          createdState: 'live',
          createdNotice: '这张订单还在，到「我的 · 打印订单」就能找回它，点进去即是到机码。',
          createdCanReorder: false,
        })
      })
      .catch((err) => {
        if (!this._accepts(token) || this._createdOrderId !== orderId) return
        this._verifyingOrderId = ''
        // 服务端明确说"这位用户没有这张订单"（requireOwned 的 404 PRINT_ORDER_NOT_FOUND）。
        // 这是**服务端状态**，不是网络问题：那个 orderId 再也换不出任何东西，
        // 继续锁着只会把这一组参数封死到本机记录过期为止。
        if (err && err.statusCode === 404 && err.code === 'PRINT_ORDER_NOT_FOUND') {
          this._verifiedOrderId = orderId
          this.setData({
            createdState: 'terminal',
            createdNotice: '服务端已经查不到上一张订单了，这一组参数可以重新下一单。',
            createdCanReorder: true,
          })
          return
        }
        this.setData({
          createdState: 'unknown',
          createdNotice: '暂时核对不上这张订单的状态。为避免重复下单，这一步先锁着；请恢复网络后重新核对。',
          createdCanReorder: false,
        })
      })
  },

  /**
   * 'unknown' 态的可执行下一步：再核一次。核不上就还是 'unknown'，不会假装好了。
   *
   * **两种 'unknown' 走两条不同的核对。** 一种是"有一张已知的订单，但查不出它现在的
   * 状态"（`_createdOrderId` 有值）→ 再查那张订单；另一种是"本机那几条提交记录还没有
   * 确定结论"（_reconcileSubmissions 之后，没有任何 orderId）→ 再核对一次那批记录。
   * 少了后面这一条，那个按钮在第二种情形下按下去什么都不做 —— 一个看起来能用、
   * 按下去却不动的主动作，正是本页别处反复避免的那件事。
   */
  retryCreatedCheck() {
    if (this.data.createdState !== 'unknown') return
    if (!this._createdOrderId) { this._reconcileSubmissions(); return }
    this._verifyingOrderId = ''
    this._verifiedOrderId = ''
    this._verifyCreatedOrder(this._createdOrderId)
  },

  /**
   * 重新下一单。**只有服务端已经证明原单走到终态时才可达**。
   *
   * 做的事只有一件：把本机那条恢复记录丢掉，于是下一次 continueFlow 会铸一个新的
   * 幂等键 —— 服务端因此认得出这是一次**新的下单意图**，而不是上一次的重试。
   * 顺序不能反：记录还在就换键 = 同键不同参数的 409，或者干脆两条记录对不上。
   *
   * **而"丢掉了"必须由 clearRecord 读回来证明，不能假设。** 上一版无论清没清掉都照常
   * 解锁：存储写不进去（存满 / 被系统回收 / 被隐私策略拦截）时那条记录原样还在，
   * 于是下一次 continueFlow 的 `ensureKey` 命中它、复用那个**旧键** —— 服务端按
   * `(endUserId, key)` 回放的正是那张早已取消 / 过期的订单。用户面对的是一个能按的
   * 按钮、一句「订单已创建」，而他要的那份材料永远打不出来。清不掉就保持锁定，
   * 并且把"为什么"和"能做什么"一起写在屏幕上。
   */
  startNewOrder() {
    // 'abandoned'（服务端已给那个键立墓碑，压根没建成过订单）与 'terminal'（原单已走到
    // 终态）都可以重新下单，而且走的是同一条路：clearRecord 读回来确认真的清掉了，
    // 清不掉就保持锁定。两者都由**服务端**证明，页面自己一个都判不出来。
    if (!['terminal', 'abandoned'].includes(this.data.createdState) || !this.data.createdCanReorder) return
    if (this._resolveAccount() !== 'ok') return
    if (!idem.clearRecord(this._account, idem.fingerprintOf(this._orderPayload()))) {
      // 保持锁定、保留旧键、一个 POST 都不发。按钮留着（createdCanReorder 不动），
      // 因为"再点一次"正是这条错误对应的可执行下一步 —— 存储压力常常是一过性的。
      this.setData({
        createdNotice: '本机没能清掉上一张订单的记录（手机存储可能已满或被系统清理），'
          + '为避免重复下单，这一步先锁着。请清理一些存储空间后再点一次「重新下单」；'
          + '原来那张订单仍可在「我的 · 打印订单」里查看。',
      })
      return
    }
    this._createdOrderId = null
    this._createAttempt = null
    this._verifyingOrderId = ''
    this._verifiedOrderId = ''
    this._quote = null
    this.setData({
      submitting: false,
      createdLocked: false,
      createdState: '',
      createdNotice: '',
      createdCanReorder: false,
      // 屏幕上那个是原单的金额，不是报价：撤掉，重新核一次价，核出来之前提交按不动。
      isFreeOrder: false,
      pageCountLabel: '待服务端核定',
      'fee.total': '—',
      'files[0].price': '—',
      priceChangeText: '',
      priceConfirmLabel: '',
    })
    this._loadQuote()
  },

  /**
   * 账号判定。判据是 page-guard.resolveAccountState 那一份（见那里的长注释）。
   *
   * 本页此前用的是「发起时记一个 `memberIdentityKey()`，回调时再读一次逐字比对」。
   * 它挡得住换人，**挡不住同一个人的 JWT 在这条链在途期间到点**：`auth.getToken()`
   * 过期时会先 `clearSession()` 把 token 与 user 一起清掉，于是回调那一刻读到的是
   * `''`，与发起时的 `'u:A'` 不等 —— 被判成"换了人"。对建单链来说这是要命的：
   * 服务端那张订单已经建出来了，而本页**不锁 `_createdOrderId`、还把按钮解开**，
   * 用户以为没下成，再点一次。服务端补上幂等键之后那一次会回放同一张单、不会多扣，
   * 但前提是**前端把同一个键带过去** —— 而"判成换了人"这条路径连键都不会复用。
   *
   * @returns {'changed'|'unusable'|'resignable'|'ok'} changed 时本函数已经复位了本页
   *   与上一位绑定的全部状态（建单锁 / 提交锁 / 报价 / 文件名），调用方不要再覆盖。
   */
  _resolveAccount() {
    const resolved = resolveAccountState(auth, this._account)
    if (resolved.state === 'changed') {
      this._account = ''
      this._resetForAccountChange(isMemberIdentity(resolved.identity))
      return 'changed'
    }
    this._account = resolved.account
    // 补签升级（`''` → `'u:<id>'`）不 +1 代次：那条刚被 request.js 救回来的报价响应
    // 正在路上，作废它只会让金额永远停在「正在核定」。adoptIdentity 只放行这一个方向。
    this._guard.adoptIdentity(resolved.account)
    return resolved.state
  },

  /**
   * 换了人 / 主动登出：把与上一位绑定的一切当场复位。
   *
   * 三件事缺一不可：
   *   ① 建单锁（`_createdOrderId` / `_createAttempt` / `createdLocked`）—— 留着的话
   *      B 的页面要么被 A 的订单锁死按不动，要么点「订单已创建」被带去 A 的到机码页。
   *   ② 提交锁（`submitting`）—— 留着 B 的按钮永远按不动。
   *   ③ 屏幕上属于 A 的展示（文件名常常就写着本人姓名、金额是本人订单状态）。
   *
   * `_guard.setIdentity('')` 会 +1 代次，把 A 在途的报价 / 文件名请求一并作废。
   */
  _resetForAccountChange(switched) {
    // 上一位的提交遮罩必须当场收起：本页已经复位成一张空白确认页，屏幕上却还盖着
    // 一张「正在提交…」——而那次提交已经不属于任何人了。
    this._releaseLoading(this._createAttempt)
    this._guard.setIdentity('')
    this._createdOrderId = null
    this._createAttempt = null
    // 上一位那张订单的核对结论同样属于上一位：留着它，B 的页面会显示 A 那张订单
    // 「已取消，可以重新下单」，或者更糟 —— 带着一个对 B 毫无意义的「重新下单」按钮。
    this._verifyingOrderId = ''
    this._verifiedOrderId = ''
    // 上一位那一发核对的回调仍会回来，但它自己会逐字核账号后原样退出；这里把闸放开，
    // 免得 B 的页面因为 A 那一发还没回来而再也发不出自己的核对。
    this._reconciling = false
    // 上一位的报价快照不许留给下一位：金额绑的是 A 的账号，B 提交前必须自己核一次价。
    this._quote = null
    this.setData({
      submitting: false,
      createdLocked: false,
      createdState: '',
      createdNotice: '',
      createdCanReorder: false,
      priceChangeText: '',
      priceConfirmLabel: '',
      isFreeOrder: false,
      pageCountLabel: '待服务端核定',
      'fee.total': '—',
      'files[0].name': '本人文件',
      'files[0].price': '—',
      quoteState: 'error',
      quoteError: switched
        ? '当前账号与打开这一页时的不是同一个，已停止显示上一位的文件与金额。请返回重新选择文件。'
        : '登录状态已失效，请重新登录后返回重新选择文件。',
      quoteRecover: 'login',
    })
  },

  /** 异步响应还能不能写进 data：账号没变（含补签升级）+ 本通道最新一次。 */
  _accepts(token) {
    const state = this._resolveAccount()
    if (state === 'changed' || state === 'unusable') {
      // 'changed' 时 _resolveAccount 已经复位并写好说明。'unusable' 没有人写 ——
      // 而金额那一块很可能正**为这条报价**转着圈，只 return 就是永远「正在核定」。
      if (state === 'unusable') this._failClosedQuote(token)
      return false
    }
    if (!sameAccount(token && token.identity, this._account)) return false
    return this._guard.accepts(token)
  },

  /**
   * 报价因身份不可用被拒收时，把金额那一块从「正在核定」里解出来。
   *
   * 触发它的是补签**失败**那条路：进入本页时 JWT 已经过期（快照还是空的），报价因为仍有
   * 补签资格而照常发出；`utils/request.js` 补签失败时调 `auth.logout()` **撤销资格**，
   * 再把原始 401 抛回来 —— 于是回调这一刻从 `'resignable'` 掉成 `'unusable'`，
   * 这一跳里快照始终是 `''`，不算换人，没有任何人把 `quoteState` 写回去。
   * 停在 `'loading'` 会同时锁死两条路：模板只在 `'error'` 时才给「重新核价」，
   * 而 `retryQuote` 又只在 `quoteState !== 'loading'` 时才动。
   *
   * 只管报价通道：文件名那条链失败本来就是静默的（它只是一个让用户确认"我选的是哪一份"
   * 的标签），在这里替它写一个金额错误会答非所问。
   * 也只在这条报价仍是当前那一条时才写 —— 切后台与 latest-wins 各有接手路径，
   * `_guard.accepts(token)` 一次把这两条都问掉。
   */
  _failClosedQuote(token) {
    if (!token || token.channel !== 'quote') return
    if (!this._guard.accepts(token)) return
    this.setData({
      quoteState: 'error',
      quoteError: auth.isLoggedIn()
        ? '当前会话缺少会员标识，无法核定本人订单金额。请重新登录一次。'
        : '登录状态已失效，请重新登录后再核价。',
      // 这一支是**补签已经失败**之后才到的：再点一百次「重新核价」也只会再
      // fail-closed 一百次。必须给出登录这条真正有效的路。
      quoteRecover: 'login',
    })
  },

  /** 报价失效态的登录出口。与其它页同一落点（pages/launch/launch）。 */
  toLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  /**
   * 切后台 / 回前台。
   *
   * 回前台必须重新核一次账号：用户完全可能在这一页停留期间被静默登出，或者在另一页
   * 换了账号 —— 全程没有任何回调会通知本页，而屏幕上还挂着上一位的文件名、金额，
   * 以及一把指向上一位订单的建单锁。
   */
  onShow() {
    this._guard.activate()
    // 先判一次：换人 / 登出时 _resolveAccount 会把上一位的建单锁、提交锁、文件名与金额
    // 全部清干净。
    if (this._resolveAccount() === 'changed') {
      // 清场之后**再判一次**，采纳当前这位的身份。他对这组参数完全可能自己也有一张
      // 已经建成的订单 —— 上一次就是在这一页下的单，只是 200 回来那会儿页面已经换了人，
      // 于是订单只落进了他的恢复记录、没落进页面。不再判一次的话，他回到本页看到的是
      // 一张干净的确认页，然后再提交一次（服务端会按同一个幂等键回放，但页面会白跑一趟，
      // 而且"已经下过单了"这件事始终没告诉他）。
      this._resolveAccount()
    }
    this._restoreCreatedOrder()
  },

  // 只在真正离开本页时作废在途的报价。**不在 onHide 作废**：建单成功后本页会
  // redirectTo 到取件页，而报价链断在半路只会让金额停在「正在核定」——
  // 切后台对一次报价来说不是安全边界（金额是本人自己的），换人才是，那条由
  // _resolveAccount 的 setIdentity 管。
  onUnload() {
    this._guard.deactivate()
  },

  /**
   * 服务端报价。金额与页数的**唯一来源**。
   *
   * 报价拿不到时页面绝不本地补一个数字顶上 —— 只如实写「待服务端核定」（CLAUDE.md §9 不伪造能力）。
   * 而且**拿不到就不能提交**：建单要带上用户在屏幕上确认过的金额（quotedAmountCents），
   * 没有这个数就没有「用户确认过的价格」可言。重新核价按钮一直在，所以这不是死路。
   */
  _loadQuote() {
    // 已经锁在一张建成的订单上：屏幕只认那张订单自己的金额（_verifyCreatedOrder 取回），不再核价。
    if (this._createdOrderId) return
    // 一开始重新核价，屏幕上那个金额就不再算数了（它会被「正在核定」替换掉）。
    this._quote = null
    const { fileId } = this.data.q
    if (!fileId) {
      this.setData({ quoteState: 'error', quoteError: '这条链接没有带文件，请返回重新选择。' })
      return
    }
    const state = this._resolveAccount()
    // 'changed' 时 _resolveAccount 已经复位并写好说明，不要再覆盖它。
    if (state === 'changed') return
    if (state === 'unusable') {
      this.setData({
        quoteState: 'error',
        quoteError: auth.isLoggedIn()
          ? '当前会话缺少会员标识，无法核定本人订单金额。请重新登录一次。'
          : '金额由服务端按本人订单核定，请登录后再核价。',
        // 认不出人时「重新核价」是个死循环：再点一次还是同一条 fail-closed。
        // 真正有效的下一步是重新登录，所以这里必须给出登录出口。
        quoteRecover: 'login',
      })
      return
    }
    // 'resignable'（JWT 自然过期但没人登出）照常发：request.js 拿到 401 会静默补签
    // 一次再重发。在本页先拦下来，金额就永远停在「正在核定」。
    //
    // 令牌是 R5 补上的第二层：此前这条链只比对身份，同一位用户连点两次「重新核价」
    // 时，先发的那次若后回来就会把后发那次的金额盖掉（服务端识别页数的耗时并不固定）。
    const token = this._guard.issue('quote')
    // 发起这一刻是谁、按哪一组参数问的：回来时对不上就不许变成可提交的金额。
    const quoteCtx = priceConfirm.beginQuote(this._account, idem.fingerprintOf(this._orderPayload()))
    this.setData({ quoteState: 'loading', quoteError: '', quoteRecover: '', priceChangeText: '', priceConfirmLabel: '' })
    api.quoteMyPrintOrder(fileId, quoteParams(this.data.copiesLabel))
      .then((quote) => {
        if (!this._accepts(token)) return
        if (this._createdOrderId) { this._settleLateQuote(); return }
        const amountCents = Number(quote && quote.amountCents)
        const billablePages = Number(quote && quote.billablePages)
        if (!Number.isSafeInteger(amountCents) || amountCents < 0
          || !Number.isSafeInteger(billablePages) || billablePages < 1) {
          throw new Error('服务端报价缺少有效页数或金额')
        }
        const snapshot = priceConfirm.bindQuote(quoteCtx, this._account,
          idem.fingerprintOf(this._orderPayload()), amountCents, billablePages)
        if (!snapshot) throw new Error('这次报价已不对应当前账号或打印参数，请重新核价。')
        this._quote = snapshot
        this._showAmount(amountCents, billablePages)
      })
      .catch((err) => {
        if (!this._accepts(token)) return
        if (this._createdOrderId) { this._settleLateQuote(); return }
        this.setData({
          quoteState: 'error',
          quoteError: (err && err.message) || '暂时取不到服务端报价。金额由服务端核定之后才能提交，请稍后重新核价。',
          // 普通失败（网络 / 服务端）重试是有意义的，这里不给登录出口。
          quoteRecover: 'retry',
        })
      })
  },

  retryQuote() {
    if (this.data.quoteState !== 'loading') this._loadQuote()
  },

  /**
   * 报价在途时本页锁到了一张已建成的订单上：这份报价作废（不绑快照、不写金额），
   * 只把「正在核定」收起来 —— 金额由那张订单自己的 GET 写上屏。
   */
  _settleLateQuote() {
    if (this.data.quoteState === 'loading') this.setData({ quoteState: 'idle' })
  },

  /** 把一个**服务端给的**金额写到屏幕上（报价、价格变化、回放的原单共用）。页数不给就不动。 */
  _showAmount(amountCents, billablePages) {
    const isFreeOrder = amountCents === 0
    const total = isFreeOrder ? '免费' : formatYuan(amountCents)
    const patch = { quoteState: 'ready', quoteError: '', quoteRecover: '', isFreeOrder, 'fee.total': total, 'files[0].price': total }
    if (billablePages) patch.pageCountLabel = `${billablePages} 页`
    this.setData(patch)
  },

  /**
   * 服务端拒绝了按旧金额建单（409 PRICE_CHANGED，已被 classifyCreateError 证明：没建单、没扣款）。
   *
   * 读得懂新价格 → 屏幕换成服务端当前金额，按钮改成「按新金额确认提交」，**一个 POST
   * 都不自动发**：只有用户自己再点一次才提交，而且沿用原来那个幂等键（本页一个键都不动）。
   * 读不懂 → 撤掉金额，要求重新核价。两条都不把金额落盘：退出重进一律重新核价。
   */
  _showPriceChange(decision, attempt) {
    this._quote = decision.kind === priceConfirm.CHANGED
      ? priceConfirm.bindQuote(attempt, this._account, idem.fingerprintOf(this._orderPayload()),
        decision.amountCents, decision.billablePages)
      : null
    if (!this._quote) { this._dropQuote(priceConfirm.describePriceChange({ kind: priceConfirm.UNREADABLE }).text); return }
    const shown = priceConfirm.describePriceChange(decision, {
      fromText: amountTextOf(attempt.quotedAmountCents),
      toText: amountTextOf(decision.amountCents),
      submitLabel: '确认提交',
    })
    this._showAmount(decision.amountCents, decision.billablePages)
    this.setData({ priceChangeText: shown.text, priceConfirmLabel: shown.button })
  },

  /** 撤掉屏幕上的金额与快照，要求重新核价。 */
  _dropQuote(message) {
    this._quote = null
    this.setData({
      quoteState: 'error', quoteError: message, quoteRecover: 'retry', isFreeOrder: false,
      pageCountLabel: '待服务端核定', 'fee.total': '—', 'files[0].price': '—', priceChangeText: '', priceConfirmLabel: '',
    })
  },

  /** 没有一个属于当前账号、当前参数的服务端金额：不提交，说清下一步。 */
  _requireQuote() {
    if (this.data.quoteState === 'ready') this._dropQuote('金额需要重新核定后才能提交。')
    wx.showModal({
      title: '还不能提交',
      content: this.data.quoteState === 'loading'
        ? '正在向服务端核定金额，请稍候。'
        : '金额还没有由服务端核定。请先按页面上的提示重新核价，再提交。',
      showCancel: false,
    })
  },

  /**
   * 文件名只从**本人文件库**取，不从 URL 取。
   *
   * 取不到（翻页范围外、接口失败）就保留中性的「本人文件」，不猜、不回显 URL 里的值。
   * 这一步失败完全不影响下单：它只是一个让用户确认"我选的是哪一份"的标签。
   */
  _loadFileName() {
    const { fileId } = this.data.q
    if (!fileId) return
    const state = this._resolveAccount()
    // 与报价同口径：'resignable' 照常发，交给 request.js 补签。
    if (state === 'changed' || state === 'unusable') return
    const token = this._guard.issue('filename')
    api.getMyDocuments({ pageSize: 20 })
      .then((page) => {
        if (!this._accepts(token)) return
        const items = Array.isArray(page && page.items) ? page.items : (Array.isArray(page) ? page : [])
        const hit = items.find((doc) => doc && doc.id === fileId)
        if (hit && hit.filename) this.setData({ 'files[0].name': hit.filename })
      })
      .catch(() => {
        // 静默：标签取不到不该在确认页弹一个与下单无关的错误。
      })
  },

  /**
   * 收起**这次尝试自己挂上去的**那张遮罩。
   *
   * `wx.hideLoading()` 不是栈，它无条件掀掉当前屏幕上那一张，不管是谁挂的。于是
   * A 的迟到回调只要先调一次，就会把 B 正在进行的那次提交的遮罩掀掉 —— B 的按钮还锁着、
   * 请求还在飞，屏幕上却什么都没有了，用户会以为已经结束。所以遮罩要认主：
   * 谁挂的谁收，尝试被换掉之后就不再碰它。
   */
  _releaseLoading(attempt) {
    if (!attempt || !attempt.loading) return
    attempt.loading = false
    // 遮罩已经归后来那次提交了（换人复位之后 B 又点了一次）：不许碰。
    if (this._createAttempt && this._createAttempt !== attempt) return
    wx.hideLoading()
  },

  /**
   * 订单已经建出来之后的统一出口。
   *
   * 服务端现在按 `(endUserId, idempotency-key)` 回放同一张单，所以再 POST 一次不会多
   * 一张订单；但本页仍然到此为止 —— 用户需要的是「它在哪」，不是再提交一次。
   * 所以一旦拿到 orderId，本页就不再是一个可以下单的页面 —— 按钮变灰，
   * 并把恢复动作指向「我的 · 打印订单」，那里能找回这张订单、点进去就是到机码页。
   */
  _lockAfterCreated(orderId, notice) {
    // 模板里那个「提交」是一个加了 disabled **样式**的 view —— bindtap 照样会触发，
    // 于是 continueFlow 会把这里当作"已建过单"的出口再走一遍。这一路进来时页面对那张
    // 订单可能已经有结论了（'terminal' / 'unknown' / 还在 'checking'），无条件写成
    // 'live' 会把它们全盖掉：终态那句「上一张已取消，可以重新下一单」连同它旁边的按钮
    // 一起消失（用户点一下反而把自己唯一的出口点没了），'checking' 则被伪造成一个
    // 我们还没拿到的结论。
    // 只有一种情况该写 'live'：这一次是刚刚才建成的 —— 此前没有任何结论，createdState 为空。
    const justCreated = this.data.createdState === '' || !!notice
    this._createdOrderId = orderId
    if (this._createAttempt) this._createAttempt.settled = true
    this._releaseLoading(this._createAttempt)
    if (!justCreated) {
      this.setData({ submitting: false, createdLocked: true })
      return
    }
    // 刚刚才建成的订单当然是活的，不必为它打一发查询。但**不**写进 _verifiedOrderId：
    // 用户停在本页期间到机码照样会过期，下一次 onShow 该重新核一遍。
    this.setData({
      submitting: false,
      createdLocked: true,
      createdState: 'live',
      createdNotice: notice
        || '到机码已经生成，只是这一步没能自动跳转。到「我的 · 打印订单」就能找回这张订单，点进去即是到机码。',
      createdCanReorder: false,
    })
  },

  toOrders() {
    wx.navigateTo({ url: '/pages/orders/orders', fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  /**
   * 向服务端核对本机留下的那些下单记录 —— **「名额满了」那条死路唯一的出口**。
   *
   * 与材料包那一页同一条判据、同一个引擎（utils/order-submission-reconcile.js）：
   * 本机不按任何本地依据清未落定的记录，只认服务端**先立墓碑再回答**的 `not_created`。
   * 结论用本页既有的 createdState 三态渲染，不新增一套状态字段。
   */
  _reconcileSubmissions() {
    if (this._resolveAccount() !== 'ok') return
    if (this._reconciling) return
    const account = this._account
    this._reconciling = true
    this.setData({
      submitting: false,
      createdLocked: true,
      createdState: 'checking',
      createdNotice: '正在向服务端逐个确认之前那几次提交到底有没有建成订单。这一步不会创建任何新订单。',
      createdCanReorder: false,
    })
    const fingerprint = idem.fingerprintOf(this._orderPayload())
    reconcileEngine
      .reconcile(idem.submissionPort, account, (keys) => api.resolveOrderSubmissions(keys), { force: true })
      .then((result) => {
        this._reconciling = false
        // 换人了就什么都不写：这批记录属于发起这一发的那位。
        if (this._account !== account || this._resolveAccount() !== 'ok') return
        // 服务端说**这一组参数**那次提交其实已经建成了订单：锁到那张订单上，走既有的
        // 「查一次原单」路径。必须逐字比指纹 —— orders 里可能是别的文件那几格。
        const mine = (result.orders || []).find((row) => row.adopted && row.fingerprint === fingerprint)
        if (mine) {
          this._createdOrderId = mine.orderId
          this._lockAfterCreated(mine.orderId)
          this._verifyCreatedOrder(mine.orderId)
          return
        }
        const shown = reconcileEngine.describeReconcileResult(result, { submitLabel: '确认支付并打印' })
        // 'resubmit' = 名额腾出来了，下一步是用户自己再提交一次；本页把锁整个解开，
        // 主按钮随之回到可按状态。其余几档都还没有确定结论，继续锁着并给出重新核对。
        if (shown.recover === 'resubmit') {
          this.setData({ createdLocked: false, createdState: '', createdNotice: '', createdCanReorder: false })
          wx.showModal({ title: shown.title, content: shown.text, showCancel: false })
          return
        }
        this.setData({
          createdLocked: true,
          createdState: 'unknown',
          createdNotice: `${shown.title}。${shown.text}`,
          createdCanReorder: false,
        })
      })
  },

  continueFlow() {
    const q = this.data.q
    if (this.data.submitting) return
    // 已经建过单：不再发第二次 POST，直接把人送去找那张订单。
    if (this._createdOrderId) { this._lockAfterCreated(this._createdOrderId); return }
    // 上一次尝试还没落定：POST 可能已经到了服务端，订单可能已经建出来了。
    // 这一条不能只靠 data.submitting —— 它是 setData 出去的，任何一条路径把它写回
    // false（R5 之前"换了人"那一支就是这么干的）按钮就又能按了，而服务端那张订单还在。
    if (this._createAttempt && !this._createAttempt.settled) return
    if (!q.fileId || !q.storeId) {
      wx.showModal({ title: '参数不完整', content: '请返回重新选择文件和终端。', showCancel: false })
      return
    }
    const state = this._resolveAccount()
    if (state === 'changed') return
    if (state !== 'ok') {
      // 建单必须有一个确定的会员身份：它会在服务端落一张带钱的订单。
      // 不像报价那样放行 'resignable' —— 报价拿错身份只是显示错，建单拿错身份是错账。
      wx.showModal({
        title: '请先登录',
        content: '下单前需要确认是本人账号，请重新登录一次再提交。',
        showCancel: false,
      })
      return
    }
    // **在 POST 发出之前**就把这一次尝试绑给当前这位账号。
    //
    // 回调那一刻的本地身份完全可能已经不可用（enduser JWT 只签 30 分钟，
    // 用户在确认页上多看两眼就到点了）。判据若是"回调时再读一次身份"，
    // 自然过期会被读成换人：订单其实已经建出来了，本页却不锁、还把按钮解开 ——
    // 用户以为没下成，再点一次 —— 那一次会带着同一个幂等键回放同一张单（不会多扣），
    // 但页面得先把「已经建成」这件事显示出来，否则用户只会一直点。
    // 绑在尝试上的账号是发出那一刻的真值，过期清不掉它。
    const payload = this._orderPayload()
    const fingerprint = idem.fingerprintOf(payload)
    // 只带**屏幕上那个、属于当前账号与当前参数**的服务端金额出门；没有就不提交。
    const quotedAmountCents = priceConfirm.quotedAmount(this._quote, this._account, fingerprint)
    if (quotedAmountCents === null) { this._requireQuote(); return }
    // 尝试锁必须**同步**设上。取幂等键要等 wx.getRandomValues 的回调，
    // 这中间用户完全来得及再点一次；锁排在异步之后就等于没锁。
    const attempt = { account: this._account, fingerprint, key: '', settled: false, loading: true, quotedAmountCents }
    this._createAttempt = attempt
    this.setData({ submitting: true })
    wx.showLoading({ title: '正在提交…', mask: true })
    // 先拿键、先落盘，**然后**才 POST。
    //
    // 同账号 + 同参数一律复用同一个键：请求失败、补签失败、响应丢在路上、页面被杀掉
    // 重进 —— 下一次提交带着同一个键过去，服务端按 (endUserId, key) 回放**同一张**订单。
    // 顺序反过来（先发请求、成功了再记键）会把"响应丢了"这一种原样留着，
    // 而那正是最需要幂等键的时刻。参数变了指纹就变，会铸一个新键 ——
    // 否则同键不同参数在服务端是 409 IDEMPOTENCY_KEY_REUSED。
    idem.ensureKey(attempt.account, fingerprint).then((record) => {
      attempt.key = record.key
      // **出门之前先在本机把这个键标成"已提交"，标不住就一个 POST 都不发。**
      //
      // 本机那张表要淘汰"铸出来但从没用过"的键（不淘汰的话，一次失败的提交会把未落定
      // 名额永久占住），而"从没用过"只能由本机自己记下来——服务端不会告诉我们这件事，
      // 它那一侧的 (endUserId, key) 是永久的。标记落住之后这条记录就退出按本机时间的
      // 淘汰：设备时钟往前跳、或恰好卡在 7 天边界上，都不会再把一个**可能已经到过
      // 服务端**的键忘掉。忘掉它的代价很具体：下一次同参数提交铸新键，服务端按新键
      // 正常建第二张订单、再扣一笔钱。
      //
      // 标不住时停在这里（用户重试一次）比发出去（可能第二张订单）便宜得多。
      if (!idem.markSubmitted(attempt.account, fingerprint, record.key)) {
        throw new Error(idem.SUBMIT_MARK_FAILED_MESSAGE)
      }
      // 金额走 opts，由 api 层追加在 body 副本上：payload 本身仍是指纹来源，不含金额。
      return api.createCloudPrintOrder(payload, { idempotencyKey: record.key, quotedAmountCents: attempt.quotedAmountCents })
    }).then(order => {
      const orderId = (order && order.id) || ''
      // **先把 orderId 落进"发起这次提交的那位"的恢复记录，再判当前页面还接不接收它。**
      //
      // 这两件事的对象根本不同：记录属于 attempt.account，而页面此刻可能已经换人了。
      // 先判页面、后落盘的话，"A 的回调晚于换人"这一支会直接 return ——
      // 服务端那张订单已经建成，A 手上却一条线索都没有，A 重新登录回来只会再提交一次。
      // 服务端回放一张已 cancelled / expired 的原单时也走这里：orderId 是什么就记什么，
      // 本页不自己判断该不该换个新键（那等于伪造一次"重新下单"）。
      // **落盘失败必须当真。** rememberOrderId 写完会把 orderId 一起读回来核对，
      // 核不上就返回 null —— 那时服务端那张订单是真的（它刚刚把 orderId 给了我们），
      // 而本机已经指不回它了。处置见下面 `recoveryUnsaved` 那一支。
      const recoveryUnsaved = !!orderId
        && !idem.rememberOrderId(attempt.account, fingerprint, attempt.key, orderId)
      // 归属判定必须排在 hideLoading **之前**：hideLoading 无条件掀掉当前那张遮罩，
      // A 的迟到回调一旦先调它，掀掉的就是 B 正在进行的那次提交的遮罩。
      if (this._resolveAccount() === 'changed' || this._createAttempt !== attempt) {
        this._releaseLoading(attempt)
        return
      }
      this._releaseLoading(attempt)
      if (!orderId) throw new Error('服务端未返回订单号')
      // 走到这里账号仍是发起时那位（含"JWT 刚好在途中自然过期"这一种）。
      // 从这一行起，这张订单在服务端已经存在：本页永远不许再 POST 第二次。
      // 锁必须在 redirectTo **之前**设 —— 跳转失败（或同步抛）时页面还留在这里，
      // 不设锁的话用户只会以为没下成，然后再点一次，于是多出一张订单和一笔钱。
      this._createdOrderId = orderId
      attempt.settled = true
      // 服务端可能回放的是**早先建成的原单**（同键回放排在价格检查之前）：屏幕只认它自己
      // 落库的金额，不认之后任何一次报价。报价快照随之作废 —— 之后若经「重新下单」再提交，
      // 那是一次新的下单意图，必须重新核价，不能带着屏幕上已经不是报价的数字出门。
      this._quote = null
      if (priceConfirm.isQuotableAmount(order.amountCents)) this._showAmount(order.amountCents)
      this.setData({ priceChangeText: '', priceConfirmLabel: '' })
      if (recoveryUnsaved) {
        // orderId 没能落进本机恢复记录。**这一支不跳转**，而且不解锁、不重试。
        //
        // 为什么不跳：跳转成功的回调会 `clearRecord` 把整条记录清掉 —— 而此刻那条记录
        // 里剩下的正是**唯一还有用的东西**：那个幂等键（`orderId` 是 `''`，键还在）。
        // 清掉它，用户下次带着同一组参数回到本页时会铸一个新键，服务端于是再建一张订单、
        // 再扣一笔。留在本页并保持锁定，那个键就还在：真要再提交，也是同键回放同一张单。
        //
        // 为什么不解锁、不重试：订单在服务端已经建成了。重试一次 POST 最好的结果也只是
        // 回放同一张单，而解锁等于告诉用户"没下成"—— 他会以为要重来。
        // 能给的唯一真实出口是「我的 · 打印订单」：那张订单在那里，点进去就是到机码。
        this._lockAfterCreated(orderId,
          '订单已经建成，但这台手机没能把它记下来（存储可能已满或被系统清理），'
          + '所以没有自动跳转到机码页。请到「我的 · 打印订单」找回这张订单，点进去即是到机码；'
          + '不要重复提交。')
        return
      }
      // 只把 orderId 交给下一页。到机码 / 金额 / 有效期 / 订单号 / 任务状态一律由
      // print-pickup 自己带登录态向 GET /me/print-orders/:orderId 取（requireOwned 归属校验）。
      wx.redirectTo({
        url: '/pages/print-pickup/print-pickup?orderId=' + encodeURIComponent(orderId),
        // **确实跳走了才清恢复记录。** 拿到 200 就清的话，跳转失败会把唯一能找回
        // 这张订单的线索一起丢掉，而页面还留在原地 —— 用户只会再点一次。
        //
        // 这一处**刻意不看 clearRecord 的返回值**（它是布尔，见那里的说明）：
        // 到这一行页面已经在跳走了，本页的 data 不会再被渲染，写任何错误态都只是写给
        // 一个看不见的页面。而清不掉的后果也已经被别处兜住：那条记录里的 orderId 指向
        // 的是这张真实存在的订单，用户带同一组参数回来时会被 `_restoreCreatedOrder`
        // 锁住并向服务端核一次状态 —— 终态就给「重新下单」，活着就指路去找它。
        // 换句话说这一步失败只多一次核对，不会多一张订单，所以是 best effort。
        success: () => idem.clearRecord(attempt.account, fingerprint),
        fail: () => this._lockAfterCreated(orderId),
      })
    }).catch(err => {
      // 同上：先判归属，再动遮罩。
      // 真的换了人 / 登出：这张订单（如果建成了）属于上一位，不锁当前这位的页面、
      // 也不把他带去别人的到机码。上一位的订单不会丢，它已落库，本人可从
      // 「我的 · 打印订单」找回。_resolveAccount 在 'changed' 时已经把这次尝试连同
      // 建单锁一起复位了，所以这里用"尝试还是不是刚才那一次"判定，
      // B 因此可以安全地发起自己的那一次。
      if (this._resolveAccount() === 'changed' || this._createAttempt !== attempt) {
        this._releaseLoading(attempt)
        return
      }
      this._releaseLoading(attempt)
      // 订单已经建成、只是后续动作抛错（例如 redirectTo 同步抛）：
      // 不能当成"下单失败"让用户重来 —— 重来就是第二张订单。
      if (this._createdOrderId) { this._lockAfterCreated(this._createdOrderId); return }
      // 这一次确实没建成（网络失败 / 服务端拒绝）：解开尝试锁，让用户可以重试。
      attempt.settled = true
      this._createAttempt = null
      this.setData({ submitting: false })
      // 本机未落定名额满了（ensureKey 的 fail-closed，一个 POST 都没发出去）。
      // 把死路原样弹给用户没有意义 —— 它唯一的解法就是去问服务端那几个键落成了什么。
      if (err && err.message === idem.PENDING_FULL_MESSAGE) { this._reconcileSubmissions(); return }
      // 只有「409 + PRICE_CHANGED」两样都在才算价格变化（证明没建单）；网络失败 / 5xx /
      // 缺状态码一律留在下面原有那条路，键与 submittedAt 原样不动。
      const priceChange = priceConfirm.classifyCreateError(err, attempt.quotedAmountCents)
      if (priceChange) { this._showPriceChange(priceChange, attempt); return }
      // 409 有三种成因，处置完全相反（见 classifySubmitConflict）。
      const conflict = reconcileEngine.classifySubmitConflict(err)
      if (conflict) {
        const shown = reconcileEngine.describeSubmitConflict(conflict, { submitLabel: '确认支付并打印' })
        // `abandoned` 是服务端亲口证明的 not_created：这个键再也建不出订单，本机这一格
        // 可以安全地换掉。**换键走 startNewOrder 那条已经收口过的路** —— 它会先
        // clearRecord 并读回来确认真的清掉了，清不掉就保持锁定。这里只负责把状态摆好。
        if (conflict === reconcileEngine.CONFLICT_ABANDONED) {
          // **不复用 'terminal'**：那一档的标题是「上一张订单已经结束」，而这一支恰恰是
          // "根本没建成过订单"。共用一个状态就等于在屏幕上写下一件没发生过的事。
          this.setData({
            createdLocked: true,
            createdState: 'abandoned',
            createdNotice: shown ? shown.text : '',
            createdCanReorder: true,
          })
          return
        }
        // `in_progress`：那次提交正在服务端跑，现在换键就是第二张订单。一个字节都不动。
        wx.showModal({ title: shown.title, content: shown.text, showCancel: false })
        return
      }
      wx.showModal({ title: '提交失败', content: (err && err.message) || '请稍后重试', showCancel: false })
    })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
