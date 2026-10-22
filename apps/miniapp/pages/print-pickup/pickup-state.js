// pages/print-pickup/pickup-state.js
// 取件页的纯函数：金额、码的分组、倒计时文案、订单状态 → 屏幕状态。从 print-pickup.js 拆出来
// （那个文件超过 800 行，CLAUDE.md §8 不再往里堆功能）。只服务取件页，不进 utils/。
const { SUPPORT_HINT } = require('../../utils/user-error')
const printParams = require('../../utils/print-params')

function parseAmountCents(value) {
  if (value === undefined || value === null || value === '') return null
  const amountCents = Number(value)
  return Number.isSafeInteger(amountCents) && amountCents >= 0 ? amountCents : null
}

function formatCode(raw) {
  if (!raw) return ''
  const value = String(raw).replace(/\s/g, '').toUpperCase()
  const groups = value.match(/.{1,2}/g)
  return groups ? groups.join('-') : ''
}

function formatCountdown(ms) {
  if (ms <= 0) return '已过期'
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  return hours > 0 ? `${hours}小时${minutes}分钟后过期` : `${Math.max(1, minutes)}分钟后过期`
}

function resolveOrderState(order) {
  const pickupStatus = String(order.pickupStatus || '')
  const taskStatus = String(order.taskStatus || '')
  const isFreeOrder = parseAmountCents(order.amountCents) === 0

  if (pickupStatus === 'expired' || taskStatus === 'expired') {
    return { key: 'expired', title: '到机码已过期', detail: '请返回打印订单重新发起打印。', showQr: false }
  }
  if (pickupStatus === 'cancelled' || taskStatus === 'cancelled') {
    return { key: 'cancelled', title: '订单已取消', detail: '本次到机码已经失效。', showQr: false }
  }
  if (taskStatus === 'failed') {
    return { key: 'failed', title: '打印失败', detail: `请查看终端屏幕上的提示；可以回到订单重新打印。${SUPPORT_HINT}`, showQr: false }
  }
  if (taskStatus === 'abandoned') {
    return { key: 'abandoned', title: '打印任务已终止', detail: `请回到订单页重新发起。${SUPPORT_HINT}`, showQr: false }
  }
  if (taskStatus === 'completed') {
    return { key: 'completed', title: '打印已完成', detail: '请及时取走纸张并检查是否齐全。', showQr: false }
  }
  if (taskStatus === 'printing') {
    return { key: 'printing', title: '正在打印', detail: '终端已经开始出纸，请在设备旁等候。', showQr: false }
  }
  if (pickupStatus === 'used' || taskStatus === 'pending' || taskStatus === 'claimed') {
    return { key: 'queued', title: '已进入打印队列', detail: '终端已核销并创建打印任务，请等待出纸。', showQr: false }
  }
  if (pickupStatus === 'claimed' || taskStatus === 'awaiting_payment') {
    return isFreeOrder
      ? { key: 'awaiting_release', title: '已扫码，正在进入打印队列', detail: '免费试运营订单，请在终端旁等待。', showQr: false }
      : { key: 'awaiting_payment', title: '已扫码，等待现场支付', detail: '请在一体机确认订单并完成现场支付。', showQr: false }
  }
  return { key: 'pending', title: '等待终端扫码', detail: '将二维码对准一体机扫码器，或手动输入到机码。', showQr: true }
}

// 底部主按钮：只有真的打印完成才写「完成」。码还没用、还在排队或打印时写「返回首页」——
// 写「完成」会让人以为这一单已经结束，其实还要走到一体机前扫码。
function bottomActionLabel(statusKey) {
  return statusKey === 'completed' ? '完成' : '返回首页'
}

// 文件名要能让人认出是哪一份：选错文件的两份往往只差中间一段（BIZ-COLOR / BIZ-PAPER），
// 所以常见长度一律全量显示，靠换行放下；只有超过 60 个字的才截，保留开头和扩展名。
function shortName(name, max) {
  const text = String(name || '').trim()
  const limit = max || 60
  if (text.length <= limit) return text
  const tail = Math.min(15, Math.floor(limit / 3))
  return `${text.slice(0, limit - tail - 1)}…${text.slice(text.length - tail)}`
}

/** 取件页信息卡：文件、终端、规格。全部来自服务端订单详情；缺的项就不显示。 */
function orderSummary(order) {
  const o = order || {}
  const store = [o.terminalName, o.locationLabel]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .filter((part, index, list) => list.indexOf(part) === index)
    .join(' · ')
  return { fileName: shortName(o.fileName), store, spec: printParams.displaySpec(o) }
}

// 下单流程里的页：取件页返回时跳过它们。下单已经完成，退回「选终端」只会让人再下一单。
const ORDER_FLOW_ROUTES = [
  'pages/print-upload/print-upload',
  'pages/print-store/print-store',
  'pages/print-pay/print-pay',
  'pages/print-preview/print-preview',
]

/**
 * 取件页返回要退几页。routes 是页面栈的 route 列表，最后一项是取件页自己。
 * 返回 0 表示栈里没有下单流程以外的页，应当回首页。
 */
function backDeltaPastOrderFlow(routes) {
  const list = Array.isArray(routes) ? routes : []
  let delta = 1
  for (let i = list.length - 2; i >= 0; i -= 1) {
    if (ORDER_FLOW_ROUTES.indexOf(list[i]) < 0) break
    delta += 1
  }
  return delta < list.length ? delta : 0
}

module.exports = {
  parseAmountCents,
  formatCode,
  formatCountdown,
  resolveOrderState,
  bottomActionLabel,
  orderSummary,
  backDeltaPastOrderFlow,
}
