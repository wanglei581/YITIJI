import { BadRequestException } from '@nestjs/common'
import { normalizeCreditCode } from './credit-code'
import {
  LICENSE_DEFAULT_GRACE_DAYS,
  LICENSE_MAX_GRACE_DAYS,
  LICENSE_MAX_TERMINAL_QUOTA,
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
  return text(value, 'LICENSE_CONTRACT_NO_INVALID', '合同编号', 1, 64)
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

/** 带时区的 ISO 8601（例：2027-10-29T00:00:00+08:00 或 2027-10-28T16:00:00Z）。日期不带时间或不带时区一律拒绝，免得「到期日」差一天。 */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

export function instant(value: unknown, code: string, label: string): Date {
  if (typeof value !== 'string' || !ISO_WITH_ZONE.test(value.trim())) {
    throw invalid(code, `${label}需为带时区的时间，例如 2027-10-29T00:00:00+08:00`)
  }
  const date = new Date(value.trim())
  const year = date.getUTCFullYear()
  if (Number.isNaN(date.getTime()) || year < 2000 || year > 2100) {
    throw invalid(code, `${label}不是有效时间`)
  }
  return date
}

const MAX_PERIOD_MS = 10 * 366 * 24 * 60 * 60 * 1000

export function period(startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw invalid('LICENSE_PERIOD_INVALID', '到期时间必须晚于生效时间')
  }
  if (endsAt.getTime() - startsAt.getTime() > MAX_PERIOD_MS) {
    throw invalid('LICENSE_PERIOD_INVALID', '一条授权的期限不能超过 10 年')
  }
}

/** 暂停 / 吊销的理由：必填，8–500 个字。 */
export function reason(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  const length = Array.from(trimmed).length
  if (length < 8 || length > 500) {
    throw invalid('LICENSE_REASON_INVALID', '理由需为 8–500 个字，请写清原因（可同时填工单号）')
  }
  if (UNSAFE_TEXT.test(trimmed)) throw invalid('LICENSE_REASON_INVALID', '理由含有不可见或控制字符')
  return trimmed
}

/** 恢复 / 切换授权方式的说明：可不填，填了不超过 500 个字。 */
export function optionalReason(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw invalid('LICENSE_REASON_INVALID', '说明需为文字')
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (Array.from(trimmed).length > 500) throw invalid('LICENSE_REASON_INVALID', '说明不超过 500 个字')
  if (UNSAFE_TEXT.test(trimmed)) throw invalid('LICENSE_REASON_INVALID', '说明含有不可见或控制字符')
  return trimmed
}

export function ticketNo(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw invalid('LICENSE_TICKET_INVALID', '工单号需为文字')
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (Array.from(trimmed).length > 64 || UNSAFE_TEXT.test(trimmed)) {
    throw invalid('LICENSE_TICKET_INVALID', '工单号不超过 64 个字，且不能含控制字符')
  }
  return trimmed
}
