// pages/home/pickup-summary.js
// 首页「待取件」卡片的取数与归并。只服务首页，不进 utils/。
//
// 数据源与「我的 · 打印订单」同两处（不另开接口）：
//   单件云打印 GET /me/print-orders/cloud —— 到机码只在 pickupStatus=pending 且未核销时下发；
//   材料包     GET /orders/package         —— 服务端 visibleCode 判据相同（pending 且未过期）。
// 首页只说「有几单待取、最近哪单什么时候到期」，**不在首页显示码本身**：
// 首页是 Tab 页、打开频率最高，码只在取件页里、凭本人登录态向服务端现取。

const api = require('../../utils/api')

const HOUR = 3600 * 1000

function expiryMs(value) {
  const t = new Date(value || '').getTime()
  return Number.isFinite(t) ? t : 0
}

/** 「还剩多久」：到期前一天内说小时，其余说天。已过期的不会进来（见 collect）。 */
function remainText(ms, now) {
  const left = ms - now
  if (left <= HOUR) return '1 小时内到期'
  if (left < 24 * HOUR) return `${Math.ceil(left / HOUR)} 小时后到期`
  return `${Math.ceil(left / (24 * HOUR))} 天后到期`
}

function outletOf(item) {
  const name = (item.share && item.share.outletName) || item.terminalDisplayName || item.terminalName || item.locationLabel
  return typeof name === 'string' && name.trim() ? name.trim() : ''
}

/**
 * 把两处订单归成首页要的样子。纯函数，便于测。
 * @returns {{ pendingCount: number, nearest: object|null, latestAt: string }}
 */
function collect(cloudItems, packageItems, now) {
  const pending = []
  let latest = 0
  for (const item of Array.isArray(cloudItems) ? cloudItems : []) {
    if (!item) continue
    latest = Math.max(latest, expiryMs(item.createdAt))
    const exp = expiryMs(item.pickupCodeExpiresAt || item.expiresAt)
    // Order-only 行没有 PrintTask.status；有 status 的是一体机历史任务，不是待取件的码。
    if (!item.status && item.pickupStatus === 'pending' && item.pickupCode && exp > now) {
      pending.push({ kind: 'print', orderId: String(item.id || ''), exp, outlet: outletOf(item) })
    }
  }
  for (const item of Array.isArray(packageItems) ? packageItems : []) {
    if (!item) continue
    latest = Math.max(latest, expiryMs(item.createdAt))
    const exp = expiryMs(item.expiresAt)
    if (item.pickupStatus === 'pending' && item.pickupCode && exp > now) {
      pending.push({ kind: 'package', orderId: String(item.orderId || ''), exp, outlet: '' })
    }
  }
  const valid = pending.filter((p) => p.orderId)
  valid.sort((a, b) => a.exp - b.exp)
  const first = valid[0] || null
  return {
    pendingCount: valid.length,
    nearest: first
      ? { kind: first.kind, orderId: first.orderId, outlet: first.outlet, remain: remainText(first.exp, now) }
      : null,
    latestAt: latest ? formatDay(latest) : '',
  }
}

function formatDay(ms) {
  const d = new Date(ms)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 两处各自失败不连坐：一处读不到就当那一处没有，另一处照常算。两处都失败才算失败。 */
function load() {
  let failures = 0
  const safe = (p) => p.catch(() => { failures += 1; return null })
  return Promise.all([
    safe(api.getMyCloudPrintOrders()),
    safe(api.getPackageOrders({ pageSize: 20 })),
  ]).then(([cloud, pkgPage]) => {
    if (failures === 2) throw new Error('订单暂时读不到')
    const packageItems = pkgPage && Array.isArray(pkgPage.items) ? pkgPage.items : []
    return collect(cloud, packageItems, Date.now())
  })
}

/** 待取件那一单的取件页：单件打印与材料包是两个页面，都只带 orderId（码由那一页凭登录态现取）。 */
function pickupUrl(nearest) {
  if (!nearest || !nearest.orderId) return ''
  const id = encodeURIComponent(nearest.orderId)
  return nearest.kind === 'package'
    ? `/pages/package-code/package-code?orderId=${id}`
    : `/pages/print-pickup/print-pickup?orderId=${id}`
}

module.exports = { collect, load, pickupUrl, remainText }
