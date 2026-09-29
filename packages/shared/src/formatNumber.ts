/**
 * 两后台金额、数量、百分比。
 *
 * 金额符号用「¥」、紧贴数字、两位小数：订单、价目、大屏成本多数已经是
 * `¥${toFixed(2)}`。「元」多出现在列头（单价（元））和确认句（0 元），不是金额单元格的多数写法。
 * 数量取整后加千分位。百分比一位小数；分母为 0 时不给百分比。
 */

const FALLBACK = '—'

function thousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function formatYuan(yuan: number | null | undefined, fallback = FALLBACK): string {
  if (typeof yuan !== 'number' || !Number.isFinite(yuan)) return fallback
  const negative = yuan < 0
  const [intPart, decPart] = Math.abs(yuan).toFixed(2).split('.')
  return `${negative ? '-' : ''}¥${thousands(intPart)}.${decPart}`
}

/** 分转元后再走 formatYuan。 */
export function formatCents(cents: number | null | undefined, fallback = FALLBACK): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return fallback
  return formatYuan(cents / 100, fallback)
}

/** 数量：向零取整，千分位。 */
export function formatCount(value: number | null | undefined, fallback = FALLBACK): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const negative = value < 0
  const digits = String(Math.trunc(Math.abs(value)))
  return `${negative ? '-' : ''}${thousands(digits)}`
}

/**
 * 百分比，一位小数。whole 为 0 或非有限数时返回 fallback（默认「—」），不显示 0% 或 Infinity。
 */
export function formatPercent(part: number, whole: number, fallback = FALLBACK): string {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) return fallback
  return `${((part / whole) * 100).toFixed(1)}%`
}
