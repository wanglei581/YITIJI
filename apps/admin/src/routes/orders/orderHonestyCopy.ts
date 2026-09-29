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

/**
 * 运营关注角标文案。三个码的唯一来源是后端
 * `admin-orders-readonly.service.ts` 的互斥推导，前端不新增第四类。
 *
 * 返回 null 有两种情况，都必须什么都不显示：
 *   - 后端没返回该字段（存量部署）—— 不知道就不说，绝不默认「无异常」；
 *   - 出现了本前端不认识的新码 —— 瞎猜一个中文比留白更危险。
 *
 * 「渠道已受理未确认」刻意不写成「已支付」：那一类的 payStatus 是 paying/closed，
 * 渠道收了钱而本地没转账，写「已支付」会在管理端摆一个与支付状态相反的结论。
 */
export function opsAttentionText(
  code: 'refund_required' | 'refunding' | 'channel_accepted_unconfirmed' | null | undefined,
): string | null {
  if (code === 'refund_required') return '待退款'
  if (code === 'refunding') return '退款中'
  if (code === 'channel_accepted_unconfirmed') return '渠道已受理未确认'
  return null
}
