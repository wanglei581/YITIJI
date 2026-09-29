/**
 * 两后台金额、数量、百分比。
 *
 * 金额符号用「¥」、紧贴数字、默认两位小数：订单、价目、大屏成本多数已经是
 * `¥${toFixed(2)}`。AI 成本这类很小的金额由调用方把 precision 传成 4。
 * 「元」多出现在列头（单价（元））和确认句（0 元），不是金额单元格的多数写法。
 * 四舍五入或向零取整后绝对值为 0 时不带负号。数量取整后加千分位。
 * 百分比一位小数；分母为 0 时不给百分比。
 */

const FALLBACK = '—'

export interface FormatMoneyOptions {
  /** 小数位数，默认 2。 */
  precision?: number
  fallback?: string
}

function thousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function resolveMoney(fallbackOrOptions: string | FormatMoneyOptions | undefined): { precision: number; fallback: string } {
  if (typeof fallbackOrOptions === 'string' || fallbackOrOptions == null) {
    return { precision: 2, fallback: fallbackOrOptions ?? FALLBACK }
  }
  const precision = fallbackOrOptions.precision
  const safe = typeof precision === 'number' && Number.isInteger(precision) && precision >= 0 && precision <= 8
    ? precision
    : 2
  return { precision: safe, fallback: fallbackOrOptions.fallback ?? FALLBACK }
}

export function formatYuan(
  yuan: number | null | undefined,
  fallbackOrOptions: string | FormatMoneyOptions = FALLBACK,
): string {
  const { precision, fallback } = resolveMoney(fallbackOrOptions)
  if (typeof yuan !== 'number' || !Number.isFinite(yuan)) return fallback
  const fixed = Math.abs(yuan).toFixed(precision)
  const negative = yuan < 0 && Number(fixed) !== 0
  const dot = fixed.indexOf('.')
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot)
  const decPart = dot === -1 ? '' : fixed.slice(dot + 1)
  const decimals = decPart ? `.${decPart}` : ''
  return `${negative ? '-' : ''}¥${thousands(intPart)}${decimals}`
}

/** 分转元后再走 formatYuan。precision 与 fallback 一并传下去。 */
export function formatCents(
  cents: number | null | undefined,
  fallbackOrOptions: string | FormatMoneyOptions = FALLBACK,
): string {
  const { fallback } = resolveMoney(fallbackOrOptions)
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return fallback
  return formatYuan(cents / 100, fallbackOrOptions)
}

/** 数量：向零取整，千分位。取整后为 0 时不带负号。 */
export function formatCount(value: number | null | undefined, fallback = FALLBACK): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const truncated = Math.trunc(Math.abs(value))
  const negative = value < 0 && truncated !== 0
  return `${negative ? '-' : ''}${thousands(String(truncated))}`
}

/**
 * 百分比，一位小数。whole 为 0 或非有限数时返回 fallback（默认「—」），不显示 0% 或 Infinity。
 * 入参是分子和分母，不是已经乘过 100 的百分数。
 */
export function formatPercent(part: number, whole: number, fallback = FALLBACK): string {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) return fallback
  return `${((part / whole) * 100).toFixed(1)}%`
}
