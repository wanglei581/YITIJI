import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { quotaDay, quotaResetsAt } from '../ai/quota/ai-quota.policy'

/** 默认值 10/6 产品负责人已定（按推荐）。平台设置缺省、空值或越界时回落到这四个数。 */
export const FREE_PRINT_TERMINAL_DAILY_SIDES = 300
export const FREE_PRINT_MEMBER_DAILY_SIDES = 50
export const FREE_PRINT_GUEST_PER_ORDER_SIDES = 20
export const FREE_PRINT_ALERT_PERCENT = 80

export const KEY_TERMINAL_DAILY_SIDES = 'print.freeQuota.terminalDailySides'
export const KEY_MEMBER_DAILY_SIDES = 'print.freeQuota.memberDailySides'
export const KEY_GUEST_PER_ORDER_SIDES = 'print.freeQuota.guestPerOrderSides'
export const KEY_ALERT_PERCENT = 'print.freeQuota.alertPercent'

export const FREE_PRINT_QUOTA_KEYS = [
  KEY_TERMINAL_DAILY_SIDES,
  KEY_MEMBER_DAILY_SIDES,
  KEY_GUEST_PER_ORDER_SIDES,
  KEY_ALERT_PERCENT,
] as const

export const AUDIT_PRINT_FREE_QUOTA_UPDATE = 'print_free_quota.update'
export const AUDIT_TERMINAL_DAILY_FREE_SIDES = 'terminal.daily_free_print_sides.update'

export const PRINT_TERMINAL_DAILY_QUOTA_REACHED = 'PRINT_TERMINAL_DAILY_QUOTA_REACHED'
export const PRINT_MEMBER_DAILY_QUOTA_REACHED = 'PRINT_MEMBER_DAILY_QUOTA_REACHED'
export const PRINT_GUEST_ORDER_QUOTA_EXCEEDED = 'PRINT_GUEST_ORDER_QUOTA_EXCEEDED'

export const FREE_PRINT_QUOTA_ERROR_CODES = [
  PRINT_TERMINAL_DAILY_QUOTA_REACHED,
  PRINT_MEMBER_DAILY_QUOTA_REACHED,
  PRINT_GUEST_ORDER_QUOTA_EXCEEDED,
] as const

export const PRINT_TERMINAL_DAILY_QUOTA_MESSAGE = '今天这台机器的免费打印量已用完，明天 0 点恢复。'

export function memberDailyQuotaMessage(limit: number): string {
  return `你今天已免费打印 ${limit} 面，达到每日上限，明天 0 点恢复。确有急用，可以拨打屏幕上的服务电话。`
}

export function guestOrderQuotaMessage(limit: number): string {
  return `免登录每次最多打印 ${limit} 面。用手机号登录后，可以一次打更多。`
}

/** 在途：仍会出纸、还没成功也还没失败。 */
export const FREE_PRINT_IN_FLIGHT_STATUSES = ['pending', 'claimed', 'printing'] as const

/** 出纸未确认即使状态被写成 completed 也不计成功出纸。 */
export const FREE_PRINT_UNCONFIRMED_ERROR_CODE = 'PRINT_JOB_UNCONFIRMED'

export const FREE_PRINT_SIDES_MIN = 1
export const FREE_PRINT_SIDES_MAX = 10_000
export const FREE_PRINT_ALERT_PERCENT_MIN = 50
export const FREE_PRINT_ALERT_PERCENT_MAX = 100

export interface FreePrintQuotaDetails {
  limit: number
  used: number
  remaining: number
  requested: number
  resetAt: string
}

export interface FreePrintQuotaConfig {
  terminalDailySides: number
  memberDailySides: number
  guestPerOrderSides: number
  alertPercent: number
}

export interface BeijingDayBounds {
  day: string
  start: Date
  end: Date
  resetAt: string
}

let quotaClock: () => Date = () => new Date()

/** 门禁注入时钟。传 null 恢复系统时间。 */
export function setFreePrintQuotaClock(next: (() => Date) | null): void {
  quotaClock = next ?? (() => new Date())
}

export function freePrintQuotaNow(): Date {
  return quotaClock()
}

/** 北京自然日，与 AI 次数同一对函数。resetAt 是次日 0 点的 UTC ISO。 */
export function beijingDayBounds(now: Date): BeijingDayBounds {
  const day = quotaDay(now)
  const startMs = Date.parse(`${day}T00:00:00+08:00`)
  return {
    day,
    start: new Date(startMs),
    end: new Date(startMs + 24 * 3600_000),
    resetAt: quotaResetsAt(now),
  }
}

export function remainingSides(limit: number, used: number, inFlight: number): number {
  return Math.max(0, limit - used - inFlight)
}

export function parseQuotaSides(raw: string | null | undefined, fallback: number): number {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < FREE_PRINT_SIDES_MIN || parsed > FREE_PRINT_SIDES_MAX) return fallback
  return parsed
}

export function parseAlertPercent(raw: string | null | undefined): number {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return FREE_PRINT_ALERT_PERCENT
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < FREE_PRINT_ALERT_PERCENT_MIN || parsed > FREE_PRINT_ALERT_PERCENT_MAX) {
    return FREE_PRINT_ALERT_PERCENT
  }
  return parsed
}

/** null、缺省或越界的覆盖值都用全局上限。 */
export function terminalDailyLimit(override: number | null | undefined, globalLimit: number): number {
  if (typeof override === 'number' && Number.isInteger(override) && override >= FREE_PRINT_SIDES_MIN && override <= FREE_PRINT_SIDES_MAX) {
    return override
  }
  return globalLimit
}

export function assertQuotaSides(value: number, label: string): void {
  if (!Number.isInteger(value) || value < FREE_PRINT_SIDES_MIN || value > FREE_PRINT_SIDES_MAX) {
    throw new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: `${label}须为 1 到 10000 的整数` },
    })
  }
}

export function assertAlertPercent(value: number): void {
  if (!Number.isInteger(value) || value < FREE_PRINT_ALERT_PERCENT_MIN || value > FREE_PRINT_ALERT_PERCENT_MAX) {
    throw new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: '告警阈值须为 50 到 100 的整数' },
    })
  }
}

export function throwFreePrintQuota(code: string, message: string, details: FreePrintQuotaDetails): never {
  throw new HttpException({ error: { code, message, details } }, HttpStatus.TOO_MANY_REQUESTS)
}
