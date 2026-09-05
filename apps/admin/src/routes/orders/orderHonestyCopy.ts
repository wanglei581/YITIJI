/** 订单详情诚实展示：缺值写「未记录」，金额不在前端推算。 */

export const UNRECORDED = '未记录'
export const NET_PAID_UNRECORDED = '未记录（无独立字段，不按应付减优惠推算）'

const DUPLEX_LABELS: Record<string, string> = {
  simplex: '单面',
  duplex_long_edge: '双面（长边）',
  duplex_short_edge: '双面（短边）',
}

const COLOR_LABELS: Record<string, string> = {
  black_white: '黑白',
  color: '彩色',
}

export function duplexText(value: string | null | undefined): string {
  if (!value) return UNRECORDED
  return DUPLEX_LABELS[value] ?? UNRECORDED
}

export function colorModeText(value: string | null | undefined): string {
  if (!value) return UNRECORDED
  return COLOR_LABELS[value] ?? UNRECORDED
}

export function copiesText(copies: number | null | undefined): string {
  if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1) return UNRECORDED
  return `${copies} 份`
}

export function pageRangeText(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0) return UNRECORDED
  const trimmed = value.trim()
  return trimmed.toLowerCase() === 'all' ? '全部' : trimmed
}

/** 抵扣 / 已退款：0 分也按整数分格式化，不说「免费」。非法则未记录。 */
export function recordedCentsText(cents: number | null | undefined, currency: string): string {
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents < 0) return UNRECORDED
  const yuan = Math.floor(cents / 100)
  const fen = String(cents % 100).padStart(2, '0')
  return `${currency === 'CNY' ? '¥' : currency} ${yuan}.${fen}`
}
