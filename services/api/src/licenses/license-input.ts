import { BadRequestException } from '@nestjs/common'
import { normalizeCreditCode } from './credit-code'
import { beijingDayStart } from './license-time'
import {
  LICENSE_CONTRACT_NO_MAX_LENGTH,
  LICENSE_DEFAULT_GRACE_DAYS,
  LICENSE_MAX_GRACE_DAYS,
  LICENSE_MAX_TERMINAL_QUOTA,
  LICENSE_REASON_MAX_LENGTH,
  LICENSE_REASON_MIN_LENGTH,
  LICENSE_TICKET_NO_MAX_LENGTH,
  LICENSE_TICKET_NO_PATTERN,
} from './license.types'

/** 授权录入的校验。校验不过一律 400，错误码按字段区分，界面可以直接指到那一格。 */

function invalid(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

/** 控制字符、零宽字符、双向控制字符一律不收。 */
// eslint-disable-next-line no-control-regex -- 本来就是要匹配控制字符
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u

function text(value: unknown, code: string, label: string, min: number, max: number): string {
  if (typeof value !== 'string') throw invalid(code, `${label}必填`)
  const trimmed = value.trim()
  const length = Array.from(trimmed).length
  if (length < min || length > max) {
    throw invalid(code, min === 1 ? `${label}必填，不超过 ${max} 个字` : `${label}需为 ${min}–${max} 个字`)
  }
  if (UNSAFE_TEXT.test(trimmed)) throw invalid(code, `${label}含有不可见或控制字符`)
  return trimmed
}

export function licenseeName(value: unknown): string {
  return text(value, 'LICENSE_LICENSEE_INVALID', '被授权企业名称', 2, 100)
}

export function contractNo(value: unknown): string {
  return text(value, 'LICENSE_CONTRACT_NO_INVALID', '合同编号', 1, LICENSE_CONTRACT_NO_MAX_LENGTH)
}

export function creditCode(value: unknown): string {
  const code = normalizeCreditCode(value)
  if (code === null) {
    throw invalid('LICENSE_CREDIT_CODE_INVALID', '统一社会信用代码需为 18 位（数字与大写字母，末位校验位正确）')
  }
  return code
}

export function note(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw invalid('LICENSE_NOTE_INVALID', '备注需为文字')
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (Array.from(trimmed).length > 500) throw invalid('LICENSE_NOTE_INVALID', '备注不超过 500 个字')
  if (UNSAFE_TEXT.test(trimmed)) throw invalid('LICENSE_NOTE_INVALID', '备注含有不可见或控制字符')
  return trimmed
}

export function terminalQuota(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > LICENSE_MAX_TERMINAL_QUOTA) {
    throw invalid('LICENSE_QUOTA_INVALID', `终端台数需为 1–${LICENSE_MAX_TERMINAL_QUOTA} 的整数`)
  }
  return value
}

export function graceDays(value: unknown): number {
  if (value === undefined || value === null) return LICENSE_DEFAULT_GRACE_DAYS
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > LICENSE_MAX_GRACE_DAYS) {
    throw invalid('LICENSE_GRACE_INVALID', `宽限天数需为 0–${LICENSE_MAX_GRACE_DAYS} 的整数`)
  }
  return value
}

/**
 * 期限里的一天：YYYY-MM-DD，北京时间，必须是真实存在的日期（2027-02-30 之类拒绝），年份限 2000–2100。
 * 只收日期、不收带时区的时刻：合同写「到 10 月 31 日」就填 2027-10-31，服务端换成次日北京 0 点存，不会差一天。
 */
export function licenseDay(value: unknown, code: string, label: string): string {
  const day = typeof value === 'string' ? value.trim() : ''
  const start = beijingDayStart(day)
  if (!start) throw invalid(code, `${label}需为 YYYY-MM-DD 格式的真实日期（北京时间），例如 2027-10-31`)
  const year = Number(day.slice(0, 4))
  if (year < 2000 || year > 2100) throw invalid(code, `${label}不是有效日期`)
  return day
}

const MAX_PERIOD_MS = 10 * 366 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** 生效日 → 当天北京 0 点（含）。day 必须先经过 licenseDay 校验。 */
export function dayStart(day: string): Date {
  return beijingDayStart(day)!
}

/** 到期日（含当天）→ 次日北京 0 点（不含）。day 必须先经过 licenseDay 校验。 */
export function dayEnd(day: string): Date {
  return new Date(beijingDayStart(day)!.getTime() + DAY_MS)
}

/** 起止时刻的合理性：到期日不得早于生效日（同一天 = 一天），最长 10 年。 */
export function checkPeriod(startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw invalid('LICENSE_PERIOD_INVALID', '到期日不能早于生效日')
  }
  if (endsAt.getTime() - startsAt.getTime() > MAX_PERIOD_MS) {
    throw invalid('LICENSE_PERIOD_INVALID', '一条授权的期限不能超过 10 年')
  }
}

/** 含到期日的期限 → 存库的起止时刻。 */
export function period(startsOn: string, endsOn: string): { startsAt: Date; endsAt: Date } {
  const startsAt = dayStart(startsOn)
  const endsAt = dayEnd(endsOn)
  checkPeriod(startsAt, endsAt)
  return { startsAt, endsAt }
}

/** 乐观版本号：界面读到的 version，正整数。 */
export function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalid('LICENSE_VERSION_INVALID', '请带上界面读到的授权版本号（正整数）')
  }
  return value
}

/** 更正 / 恢复 / 模式切换 / 暂停 / 吊销的理由：必填，去首尾空白后 2–200 个字。 */
export function reason(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  const length = Array.from(trimmed).length
  if (length < LICENSE_REASON_MIN_LENGTH || length > LICENSE_REASON_MAX_LENGTH) {
    throw invalid('LICENSE_REASON_INVALID', `理由必填，需为 ${LICENSE_REASON_MIN_LENGTH}–${LICENSE_REASON_MAX_LENGTH} 个字，请写清原因`)
  }
  if (UNSAFE_TEXT.test(trimmed)) throw invalid('LICENSE_REASON_INVALID', '理由含有不可见或控制字符')
  return trimmed
}

const TICKET_PATTERN = new RegExp(LICENSE_TICKET_NO_PATTERN)

/** 暂停 / 吊销必填的审批工单号：1–64 位，只许字母、数字、- _ /。 */
export function approvalTicketNo(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed === '' || trimmed.length > LICENSE_TICKET_NO_MAX_LENGTH || !TICKET_PATTERN.test(trimmed)) {
    throw invalid(
      'LICENSE_TICKET_INVALID',
      `审批工单号必填，1–${LICENSE_TICKET_NO_MAX_LENGTH} 位，只能含字母、数字、- _ /`,
    )
  }
  return trimmed
}
