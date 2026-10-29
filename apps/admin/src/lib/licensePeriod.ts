/**
 * 授权期限的长度上限，与后端 services/api/src/licenses/license-input.ts 的 maxEndExclusive / checkPeriod 同一口径：
 * 一条授权最长 10 个日历年，到期日（含当天）最晚是生效日起满 10 年的前一天。
 * 表单校验、日期选择框上限、演示数据三处共用，别各写一份。
 */
export const LICENSE_MAX_PERIOD_YEARS = 10
export const LICENSE_PERIOD_TOO_LONG_MESSAGE = `一条授权的期限不能超过 ${LICENSE_MAX_PERIOD_YEARS} 年（按日历年算，从生效日起满 ${LICENSE_MAX_PERIOD_YEARS} 年的前一天为止）`

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 生效日 → 到期日最晚哪天。2026-11-01 → 2036-10-31；2 月 29 日起算的，十年后没有 2 月 29 日，
 * 顺延到 3 月 1 日再退一天 → 2 月 28 日。不用「10 × 366 天」近似——那样会放过超过十周年的期限。
 */
export function maxEndsOn(startsOn: string): string | null {
  const match = DAY_PATTERN.exec(startsOn)
  if (!match) return null
  const anniversary = new Date(Date.UTC(Number(match[1]) + LICENSE_MAX_PERIOD_YEARS, Number(match[2]) - 1, Number(match[3])))
  anniversary.setUTCDate(anniversary.getUTCDate() - 1)
  return anniversary.toISOString().slice(0, 10)
}

/** 某天的次日（续期不填生效日时，服务端从上一条到期日的次日起算）。 */
export function nextDay(day: string): string | null {
  const match = DAY_PATTERN.exec(day)
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1)).toISOString().slice(0, 10)
}
