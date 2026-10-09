// pages/print-pickup/pickup-support.js
// 取件页的服务电话：一页只取一次，不跟订单轮询。失败就留着原来的 SUPPORT_HINT。
// 从 print-pickup.js 拆出来（那个文件不得超过改前行数）。只服务取件页，不进 utils/。
const { SUPPORT_HINT } = require('../../utils/user-error')
const { PICKUP_CODE_RE, normalizePickupCode } = require('../../utils/pickup-qrcode')
const { formatCode, paintOrder } = require('./pickup-state')
const { supportViewForTerminal, callSupportPhone } = require('../../utils/support-contact')

const supportData = {
  // 现场无人值守：需要帮助只有服务电话（utils/user-error.js SUPPORT_HINT）
  supportHint: SUPPORT_HINT,
  supportPhone: '',
  canCallPhone: false,
  supportHoursText: '',
  statusLead: '',
  statusTail: '',
  detailPhone: false,
}

function initSupport(page, api) {
  // 服务电话一页只取一次。失败就留着原来的 SUPPORT_HINT。
  page._supportOnce = false
  page._supportView = null
  page._lastOrder = null
  page._supportTerminalRef = ''
  page._supportApi = api
}

function loadSupportOnce(page, terminalId) {
  if (page._supportOnce) return
  page._supportOnce = true
  const ref = typeof terminalId === 'string' ? terminalId.trim() : ''
  page._supportTerminalRef = ref
  const api = page._supportApi
  if (!api || typeof api.getSupportContact !== 'function') return
  let pending
  try { pending = api.getSupportContact(ref) } catch (_) { return }
  if (!pending || typeof pending.then !== 'function') return
  pending.then((data) => acceptSupport(page, data), () => {})
}

function acceptSupport(page, data) {
  page._supportView = supportViewForTerminal(data, page._supportTerminalRef)
  if (!page._visible || !page._lastOrder) return
  const order = page._lastOrder
  const pickupCode = normalizePickupCode(order.pickupCode)
  const hasCode = PICKUP_CODE_RE.test(pickupCode)
  const painted = paintOrder(order, page._supportView, pickupCode, formatCode(pickupCode), hasCode)
  page.setData(painted, () => {
    if (painted.showQr && page.data.qrStatus !== 'ready') page._drawPickupQr()
  })
}

function callSupport(page) {
  callSupportPhone(page.data.supportPhone)
}

/** 本地倒计时走到头：码撤下，电话拆段也一起清掉，避免过期页还挂着可拨号的号码。 */
function expiredCodePatch() {
  const expiredDetail = '请返回打印订单重新发起打印。'
  return {
    countdown: '已过期',
    statusKey: 'expired',
    statusTitle: '到机码已过期',
    statusDetail: expiredDetail,
    statusLead: expiredDetail,
    statusTail: '',
    detailPhone: false,
  }
}

module.exports = {
  supportData,
  initSupport,
  loadSupportOnce,
  acceptSupport,
  callSupport,
  expiredCodePatch,
}
