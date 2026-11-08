/**
 * 授权期限的北京时间口径（合同口径：含到期日）。
 *
 * 录入与展示只用北京日期 YYYY-MM-DD；存库的是 UTC 时刻：
 *   startsAt = startsOn 当天北京 0 点（含）；
 *   endsAt   = endsOn 次日北京 0 点（不含）——到期日那一整天都在期内。
 * 北京时间全年 UTC+8、没有夏令时，所以「加 8 小时再取日期」就是北京日期，换算不依赖运行环境的时区。
 *
 * 给人看的期限一律用 periodText：「2026-11-01 至 2027-10-31（北京时间，含当天）」。
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export const PERIOD_SUFFIX = '（北京时间，含当天）'

/** 'YYYY-MM-DD' → 北京当天 0 点；不是真实存在的日期（含 2 月 30 日之类）返回 null。 */
export function beijingDayStart(date: string): Date | null {
  const match = DATE_PATTERN.exec(date)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = Date.UTC(year, month - 1, day)
  const check = new Date(utc)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return new Date(utc - BEIJING_OFFSET_MS)
}

/** 某个时刻落在北京时间的哪一天（YYYY-MM-DD）。 */
export function beijingDateOf(instant: Date): string {
  return new Date(instant.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

/** 排他的终点（次日 0 点）→ 含当天的最后一天。 */
export function lastDayOf(endsAtExclusive: Date): string {
  return beijingDateOf(new Date(endsAtExclusive.getTime() - 1))
}

/** 「2027-10-31（北京时间，含当天）」 */
export function inclusiveDayText(day: string): string {
  return `${day}${PERIOD_SUFFIX}`
}

/** 「2026-11-01 至 2027-10-31（北京时间，含当天）」 */
export function periodText(startsAt: Date, endsAt: Date): string {
  return `${beijingDateOf(startsAt)} 至 ${lastDayOf(endsAt)}${PERIOD_SUFFIX}`
}
