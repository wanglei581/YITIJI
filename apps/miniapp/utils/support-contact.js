// utils/support-contact.js
// 服务电话与同码续打的纯函数。号码和时间只认公开接口；读不到就退回 SUPPORT_HINT。
// 不读 miniappPublished。附近有没有别的一体机只认 otherOnlineTerminalNearby === true。
const { SUPPORT_HINT } = require('./user-error')

function phoneOf(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^[0-9 -]{7,20}$/.test(trimmed)) return null
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (digits.length < 7 || digits.length > 20) return null
  return trimmed
}

function hoursOf(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function resolveSupportView(data) {
  const source = data && typeof data === 'object' ? data : {}
  const phone = phoneOf(source.servicePhone)
  const hours = hoursOf(source.serviceHours)
  let hint = SUPPORT_HINT
  if (phone) {
    hint = hours
      ? `需要帮助可拨打服务电话 ${phone}（${hours}）`
      : `需要帮助可拨打服务电话 ${phone}`
  }
  return {
    phone,
    hours,
    hint,
    canCallPhone: !!phone,
    suggestOtherTerminal: source.otherOnlineTerminalNearby === true,
  }
}

/** 没有终端号时，即使接口说附近有别的机器，也不采用。 */
function supportViewForTerminal(data, terminalId) {
  const view = resolveSupportView(data)
  const ref = typeof terminalId === 'string' ? terminalId.trim() : ''
  if (ref) return view
  return Object.assign({}, view, { suggestOtherTerminal: false })
}

function supportFields(view) {
  const resolved = view && typeof view.hint === 'string' ? view : resolveSupportView(null)
  return {
    supportHint: resolved.hint,
    supportPhone: resolved.phone || '',
    canCallPhone: resolved.canCallPhone === true,
    supportHoursText: resolved.hours ? `（${resolved.hours}）` : '',
  }
}

function splitDetailPhone(text, phone) {
  const raw = typeof text === 'string' ? text : ''
  if (!phone) return { lead: raw, tail: '', hit: false }
  const at = raw.indexOf(String(phone))
  if (at < 0) return { lead: raw, tail: '', hit: false }
  return { lead: raw.slice(0, at), tail: raw.slice(at + String(phone).length), hit: true }
}

/** reprintAllowed 且剩余次数是大于 0 的整数时，才写「还能续打 N 次」。 */
function reprintNoteText(row) {
  const source = row && typeof row === 'object' ? row : {}
  if (source.reprintAllowed !== true) return ''
  const n = source.reprintRemaining
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return ''
  return `还能续打 ${n} 次`
}

function callSupportPhone(phone) {
  if (typeof phone !== 'string' || !phone) return
  if (typeof wx === 'undefined' || !wx || typeof wx.makePhoneCall !== 'function') return
  try {
    wx.makePhoneCall({ phoneNumber: phone, fail() {} })
  } catch (_) {}
}

module.exports = {
  resolveSupportView,
  supportViewForTerminal,
  supportFields,
  splitDetailPhone,
  reprintNoteText,
  callSupportPhone,
}
