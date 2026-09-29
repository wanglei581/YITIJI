// utils/price-confirmation.js
//
// 建单前的「价格再确认」：单件（print-pay）与材料包（package-confirm）两页共用这一份。
//
// 服务端契约（services/api/src/payment/order-quote.service.ts 的 priceChanged）：
//   建单请求带上用户在屏幕上看到的 `quotedAmountCents`；服务端按同一套报价重算，对不上就回
//   HTTP 409 + code `PRICE_CHANGED`，并且**不建单、不发支付令牌、不留审计、释放处理租约**。
//   error.details 是 string[]：
//     currentAmountCents=<分>
//     billablePages=<页>
//     line=<serviceKey>:<unitCents>:<quantity>:<subtotalCents>   （≥1 行；材料包逐文件展开，可以逐字重复）
//
// 本模块只做三件事，全部是纯函数、只放内存：
//   ① 严格解析 details。任何一处对不上都判「读不懂」—— 页面只能要求重新核价，绝不猜一个金额；
//   ② 把一次报价绑到「哪位账号 + 哪一组业务参数」上，建单时只认绑得上的那个数；
//   ③ 给页面一句不带实现细节的话。
// 它**不**计价（金额只认服务端给的数）、不碰存储、不调接口、不管幂等键。
// 幂等键仍由 print-order-idempotency / package-order-idempotency 管：价格再确认必须沿用
// 原来那个键（服务端指纹刻意不含 quotedAmountCents），所以这里一个键都不碰。

const { isMemberIdentity, sameAccount } = require('./page-guard')

const PRICE_CHANGED_CODE = 'PRICE_CHANGED'
/** 服务端给出了读得懂的新价格。 */
const CHANGED = 'changed'
/** 服务端确认价格变了（没建单），但新价格读不懂：只能重新核价。 */
const UNREADABLE = 'unreadable'

// 与 CreateMemberPrintOrderDto / CreatePackageOrderDto 的 `@Max(100_000_000)` 同值：
// 超出这个范围的数发回去必然 400，对页面没有意义。
const MAX_AMOUNT_CENTS = 100000000
// PricingService 当前只有这两个计价项。认不出的计价项按「读不懂」处理 —— 结果是
// 让用户重新核价，而不是替服务端解释一个本页不认识的东西。
const SERVICE_KEYS = ['print_bw_page', 'print_color_page']

const DECIMAL_RE = /^(?:0|[1-9][0-9]*)$/

/** 十进制非负整数串 → 安全整数；前导零、正负号、小数点、空白、科学计数一律 null。 */
function decimal(text) {
  if (typeof text !== 'string' || !DECIMAL_RE.test(text)) return null
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : null
}

/** 这个数能不能作为 quotedAmountCents 发给服务端。 */
function isQuotableAmount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_AMOUNT_CENTS
}

/** 一行 `line=` 的值 → 小计；任何一处不合法返回 null。 */
function lineSubtotal(value) {
  const parts = value.split(':')
  if (parts.length !== 4 || SERVICE_KEYS.indexOf(parts[0]) < 0) return null
  const unitCents = decimal(parts[1])
  const quantity = decimal(parts[2])
  const subtotalCents = decimal(parts[3])
  if (unitCents === null || quantity === null || subtotalCents === null || quantity < 1) return null
  const product = unitCents * quantity
  if (!Number.isSafeInteger(product) || product !== subtotalCents) return null
  return subtotalCents
}

/**
 * 严格解析 PRICE_CHANGED 的 details。
 *
 * 必须恰好一条 currentAmountCents、恰好一条 billablePages、至少一条 line；每行小计 =
 * 单价 × 数量；全部小计之和 = currentAmountCents。**重复的 line 是合法的**（材料包里两份
 * 页数相同的文件会产出逐字相同的两行）。出现任何认不出的条目 → null（fail-closed）。
 *
 * @returns {{amountCents:number, billablePages:number}|null}
 */
function parsePriceChangedDetails(details) {
  if (!Array.isArray(details) || !details.length) return null
  let amountCents = null
  let billablePages = null
  let lineCount = 0
  let sum = 0
  for (const entry of details) {
    if (typeof entry !== 'string') return null
    const eq = entry.indexOf('=')
    const name = eq > 0 ? entry.slice(0, eq) : ''
    const value = entry.slice(eq + 1)
    if (name === 'currentAmountCents') {
      if (amountCents !== null) return null
      amountCents = decimal(value)
      if (!isQuotableAmount(amountCents)) return null
    } else if (name === 'billablePages') {
      if (billablePages !== null) return null
      billablePages = decimal(value)
      if (billablePages === null || billablePages < 1) return null
    } else if (name === 'line') {
      const subtotal = lineSubtotal(value)
      if (subtotal === null) return null
      sum += subtotal
      if (!Number.isSafeInteger(sum)) return null
      lineCount += 1
    } else {
      return null
    }
  }
  if (amountCents === null || billablePages === null || lineCount < 1 || sum !== amountCents) return null
  return { amountCents, billablePages }
}

/**
 * 建单失败时：这是不是一次**已被证明**的价格变化。
 *
 * 只有「HTTP 409 + code PRICE_CHANGED」两者同时成立才算 —— 那证明服务端拒绝了这次新建单。
 * 其余一切（网络失败、5xx、状态码或 code 缺一个）返回 null：页面走它原有的
 * 「结果未知 / 可重试」那条路，**不许**把它说成价格变化，也不许动幂等键。
 *
 * @param {number} quotedAmountCents 这一次提交带出去的金额
 * @returns {null|{kind:'changed', amountCents:number, billablePages:number}|{kind:'unreadable'}}
 */
function classifyCreateError(err, quotedAmountCents) {
  if (!err || err.statusCode !== 409 || err.code !== PRICE_CHANGED_CODE) return null
  const parsed = parsePriceChangedDetails(err.details)
  // 说「价格变了」却给回用户刚确认的那个数：自相矛盾，两边都不采信，只能重新核价。
  if (!parsed || parsed.amountCents === quotedAmountCents) return { kind: UNREADABLE }
  return { kind: CHANGED, amountCents: parsed.amountCents, billablePages: parsed.billablePages }
}

/** 发起报价那一刻：记下是谁、按哪一组业务参数（指纹）问的。 */
function beginQuote(account, fingerprint) {
  return { account: account || '', fingerprint: fingerprint || '' }
}

/**
 * 把服务端给的金额绑成本页可以拿去建单的快照。
 *
 * `context` 是发起那一刻的 `{account, fingerprint}`（报价用 beginQuote 的返回值；
 * 价格变化用那一次建单尝试本身）。回来这一刻账号必须还是同一位（补签把 `''` 升级成
 * 本人不算换人，判据与 page-guard.sameAccount 同一份）、指纹必须逐字相同。
 * 页面的 latest-wins / 生命周期守卫仍然先判，这里是第二道。
 *
 * @returns {{account:string, fingerprint:string, amountCents:number, billablePages:number}|null}
 */
function bindQuote(context, account, fingerprint, amountCents, billablePages) {
  if (!context || !fingerprint || context.fingerprint !== fingerprint) return null
  if (!sameAccount(context.account, account)) return null
  if (!isQuotableAmount(amountCents)) return null
  return { account: account || '', fingerprint, amountCents, billablePages }
}

/**
 * 建单那一刻能带出去的金额：快照属于**当前这位会员**、**当前这组参数**时才给，否则 null
 *（页面据此挡住提交、要求重新核价）。
 */
function quotedAmount(snapshot, account, fingerprint) {
  if (!snapshot || !isMemberIdentity(account)) return null
  if (snapshot.account !== account || snapshot.fingerprint !== fingerprint) return null
  return isQuotableAmount(snapshot.amountCents) ? snapshot.amountCents : null
}

/**
 * 业务载荷 + quotedAmountCents 的**副本**。调用方那一份原样不动 ——
 * 它同时是幂等指纹的来源，而指纹刻意不含金额。金额不合法返回 null（调用方不该发）。
 */
function withQuotedAmount(payload, amountCents) {
  if (!payload || typeof payload !== 'object' || !isQuotableAmount(amountCents)) return null
  return Object.assign({}, payload, { quotedAmountCents: amountCents })
}

/**
 * 给用户看的话。金额展示串由页面按自己的格式传进来（本模块不做金额格式化）。
 * @param {{kind:string}} decision classifyCreateError 的返回值
 * @param {{fromText?:string, toText?:string, submitLabel?:string}} texts
 * @returns {{title:string, text:string, button:string}}
 */
function describePriceChange(decision, texts) {
  const t = texts || {}
  if (decision && decision.kind === CHANGED && t.toText) {
    const from = t.fromText ? `已由 ${t.fromText} ` : ''
    // 按钮不带金额：两页底栏都是 nowrap 按钮挨着「到机应付 ¥…」，带上金额在 320pt 会顶出屏幕
    //（见 app.wxss「窄屏底栏」）。新金额就在按钮左边，也写在这句话里。
    const button = `按新金额${t.submitLabel || '确认下单'}`
    return {
      title: '价格已更新',
      text: `应付金额${from}更新为 ${t.toText}，以服务端当前价格为准。这一次没有建单，也没有扣款；核对无误后请点「${button}」。`,
      button,
    }
  }
  return {
    title: '价格已更新，请重新核价',
    text: '服务端提示价格有变化，这一次没有建单，也没有扣款，但没能读到新的金额。请先点「重新核价」取得当前金额，再确认提交。',
    button: '',
  }
}

module.exports = {
  PRICE_CHANGED_CODE,
  CHANGED,
  UNREADABLE,
  MAX_AMOUNT_CENTS,
  SERVICE_KEYS,
  isQuotableAmount,
  parsePriceChangedDetails,
  classifyCreateError,
  beginQuote,
  bindQuote,
  quotedAmount,
  withQuotedAmount,
  describePriceChange,
}
