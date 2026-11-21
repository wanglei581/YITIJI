// pages/orders/orders-display.js
// 打印订单列表页的纯展示与去重辅助函数（同分包内私有模块，不增大主包体积）。

const printParams = require('../../utils/print-params')
const { reprintNoteText } = require('../../utils/support-contact')

// PrintTask.status (后端) → UI 展示状态映射
const STATUS_MAP = {
  // 任务已建、在终端排队（取件页写「已进入打印队列」）。仍归「待取件」这一栏，但单子本身写「排队中」。
  pending:   { key: 'waiting',  label: '排队中', tone: 'wheat' },
  claimed:   { key: 'waiting',  label: '排队中', tone: 'wheat' },
  printing:  { key: 'printing', label: '打印中',  tone: 'teal'  },
  completed: { key: 'done',     label: '已完成', tone: 'ok'    },
  failed:    { key: 'done',     label: '打印失败', tone: 'danger' },
  cancelled: { key: 'done',     label: '已取消', tone: 'neutral' },
}

// 规格摘要：与取件页、订单详情同一份实现（utils/print-params.js displaySpec），含单双面。
function buildSpec(item) {
  return printParams.displaySpec(item) || '—'
}

// 出纸 / 领取的那台机器。后端 9/29 契约给打印历史行补 terminal { displayName, locationLabel }；
// 没有时照旧回落到其他名字字段，最后是「打印服务终端」。
function terminalLabel(item) {
  const t = item.terminal
  if (t && typeof t === 'object' && t.displayName) {
    return t.locationLabel ? `${t.displayName} · ${t.locationLabel}` : t.displayName
  }
  return item.terminalDisplayName || item.terminalName || item.storeName || item.locationLabel || '打印服务终端'
}

// 打印失败的原因（W-100）：服务端 /me/print-orders 只在失败行给白名单码 failureCode（#1171），
// 不给现场用的原文。这里只认这 5 个码；别的码或没这个字段，一律不写原因，不猜。
const FAILURE_NOTES = {
  PAPER_EMPTY:           '打印机缺纸，这次没有出纸；需要的话可重新打印',
  PRINTER_ERROR:         '打印机故障（可能卡纸），这次没有出纸；需要的话可重新打印',
  PRINTER_OFFLINE:       '打印机离线，这次没有出纸；需要的话可重新打印',
  PRINT_JOB_UNCONFIRMED: '已发到打印机，但没确认出纸，不会自动重打；没拿到纸可以重新下单',
  PARTIAL_OUTPUT:        '只打出了一部分，没有整单重打；需要的话请重新下单',
}

// 到机码过期：这张单没有打印，用户能做的是重新下单。
const EXPIRED_NOTE = '到机码已过期，这张单没有打印；需要的话请重新下单'

function reasonNoteOf(item, effectiveStatus) {
  if (effectiveStatus === 'failed') {
    const code = item.failureCode
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(FAILURE_NOTES, code) ? FAILURE_NOTES[code] : ''
  }
  if (item.pickupStatus === 'expired') return EXPIRED_NOTE
  return ''
}

function resolveActionMeta(item, ds, effectiveStatus, pendingCode) {
  const pickupRaw = (pendingCode || item.reprintAllowed === true) ? (item.pickupCode || '') : ''
  const action = ds.key === 'done' && effectiveStatus === 'completed' ? 'reprint'
               : (pickupRaw && ds.key === 'waiting')              ? 'pickup'
               : null
  const actionLabel = action === 'pickup' ? '查看到机码'
    : action === 'reprint' ? '去我的文档打印'
    : ''
  return {
    pickupRaw,
    reprintNote: pickupRaw ? reprintNoteText(item) : '',
    action,
    actionLabel,
  }
}

function buildUiItemFields(item, ds, amountCents, effectiveStatus, meta, price, pickup) {
  return {
    id:          item.id,
    cloudOrder:  !item.status,
    detailId:    !item.status ? item.id : (item.orderId || ''),
    orderNo:     item.orderNo || item.id,
    store:       terminalLabel(item),
    title:       item.fileName || '打印文件',
    spec:        buildSpec(item),
    price,
    status:      ds.key,
    statusLabel: ds.label,
    statusTone:  ds.tone,
    reasonNote:  reasonNoteOf(item, effectiveStatus),
    pickup,
    pickupRaw:   meta.pickupRaw,
    reprintNote: meta.reprintNote,
    expiresAt:   item.pickupCodeExpiresAt || item.expiresAt || item.pickupExpiresAt || '',
    taskStatus:  effectiveStatus,
    payStatus:   item.payStatus || '',
    paymentSource: item.paymentSource || '',
    paidAt:      item.paidAt || null,
    pickupStatus: item.pickupStatus || '',
    cancelling:  false,
    action:      meta.action,
    actionLabel: meta.actionLabel,
    orderId:     item.id,
    amountCents,
  }
}

function dedupeOrderRows(cloudItems, items, mapRow) {
  const combined = [...(Array.isArray(cloudItems) ? cloudItems : []), ...(Array.isArray(items) ? items : [])]
  const seen = new Set()
  return combined.filter((item) => {
    const key = item.id || item.printTaskId
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).map(mapRow)
}

const ORDER_TABS = [
  { key: 'all',      label: '全部' },
  { key: 'waiting',  label: '待取件' },
  { key: 'printing', label: '打印中' },
  { key: 'done',     label: '已完成' },
]

function filterByTab(orders, pkgRows, key) {
  return {
    activeTab: key,
    filtered: key === 'all' ? orders : orders.filter((o) => o.status === key),
    pkgFiltered: key === 'all' ? pkgRows : pkgRows.filter((o) => o.statusKey === key),
  }
}

module.exports = {
  ORDER_TABS,
  STATUS_MAP,
  buildSpec,
  terminalLabel,
  reasonNoteOf,
  resolveActionMeta,
  buildUiItemFields,
  dedupeOrderRows,
  filterByTab,
}
