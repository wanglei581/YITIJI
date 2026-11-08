import { LICENSE_MAX_GRACE_DAYS, LICENSE_MAX_TERMINAL_QUOTA, LICENSE_REASON_MAX_LENGTH, LICENSE_REASON_MIN_LENGTH, LICENSE_TICKET_NO_MAX_LENGTH, LICENSE_TICKET_NO_PATTERN } from '@ai-job-print/shared'
import { maxEndsOn } from '../../lib/licensePeriod'

export const reasonLength = (value: string) => [...value.trim()].length
export const validReason = (value: string) => reasonLength(value) >= LICENSE_REASON_MIN_LENGTH && reasonLength(value) <= LICENSE_REASON_MAX_LENGTH
export const validTicket = (value: string) => value.length > 0 && value.length <= LICENSE_TICKET_NO_MAX_LENGTH && new RegExp(LICENSE_TICKET_NO_PATTERN).test(value)
export const validCreditCode = (value: string) => /^[0-9A-HJ-NPQRTUWXY]{18}$/.test(value.trim().toUpperCase())
export const validDates = (startsOn: string, endsOn: string) => /^\d{4}-\d{2}-\d{2}$/.test(startsOn) && /^\d{4}-\d{2}-\d{2}$/.test(endsOn) && endsOn >= startsOn && endsOn <= (maxEndsOn(startsOn) ?? '')
export const validQuota = (value: number) => Number.isInteger(value) && value >= 1 && value <= LICENSE_MAX_TERMINAL_QUOTA
export const validGraceDays = (value: number) => Number.isInteger(value) && value >= 0 && value <= LICENSE_MAX_GRACE_DAYS
