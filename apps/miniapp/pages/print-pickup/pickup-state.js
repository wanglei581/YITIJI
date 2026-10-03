// pages/print-pickup/pickup-state.js
// 取件页的纯函数：金额、码的分组、倒计时文案、订单状态 → 屏幕状态。从 print-pickup.js 拆出来
// （那个文件超过 800 行，CLAUDE.md §8 不再往里堆功能）。只服务取件页，不进 utils/。

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
    return { key: 'failed', title: '打印失败', detail: '请查看终端提示，或联系现场工作人员处理。', showQr: false }
  }
  if (taskStatus === 'abandoned') {
    return { key: 'abandoned', title: '打印任务已终止', detail: '请返回订单页重新发起，或联系现场工作人员处理。', showQr: false }
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

module.exports = { parseAmountCents, formatCode, formatCountdown, resolveOrderState }
