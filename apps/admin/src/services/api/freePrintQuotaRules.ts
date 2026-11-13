/** 免费打印额度输入校验。不读环境、不发请求，门禁可以直接执行。 */

const SIDES_MESSAGE = '须为 1 到 10000 的整数'
const OVERRIDE_MESSAGE = '每日免费打印上限须为 1 到 10000 的整数，或留空使用全站默认'
const ALERT_MESSAGE = '告警阈值须为 50 到 100 的整数'

function wholeNumber(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return null
  const value = Number(text)
  if (!Number.isInteger(value)) return null
  return value
}

export function parseQuotaSidesField(raw: string, label: string): number {
  const value = wholeNumber(raw)
  if (value === null || value < 1 || value > 10000) {
    throw new Error(`${label}${SIDES_MESSAGE}`)
  }
  return value
}

/** 空字符串表示这台机器改回全站默认。0、负数、小数都不接受。 */
export function parseOptionalOverrideField(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = wholeNumber(raw)
  if (value === null || value < 1 || value > 10000) {
    throw new Error(OVERRIDE_MESSAGE)
  }
  return value
}

export function parseAlertPercentField(raw: string): number {
  const value = wholeNumber(raw)
  if (value === null || value < 50 || value > 100) {
    throw new Error(ALERT_MESSAGE)
  }
  return value
}
