import { BadRequestException } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client'
import { formatBeijingDate } from '../common/beijing-display-time'

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 政策截止日期按北京时间自然日。
 * 库存的是用户选的 YYYY-MM-DD 的 UTC 零点，比较也用「今天」的 UTC 零点。
 * 这样截止日期当天仍然公开，到了第二天（北京时间）才算过期。
 * 不能拿现在的瞬间去比 UTC 零点，否则当天早上 8 点就会被当成过期。
 */
export function policyDeadlineThreshold(now: Date = new Date()): Date {
  return new Date(`${formatBeijingDate(now)}T00:00:00.000Z`)
}

/** 公开读取：没有截止日期，或截止日期还没过（含当天）。 */
export function policyStillValidWhere(now: Date = new Date()): Prisma.PolicyPostWhereInput {
  const threshold = policyDeadlineThreshold(now)
  return { OR: [{ validThrough: null }, { validThrough: { gte: threshold } }] }
}

/** 已过截止日期。空日期不是过期，SQL 对 NULL 的小于比较本来就不会命中。 */
export function policyExpiredWhere(now: Date = new Date()): Prisma.PolicyPostWhereInput {
  return { validThrough: { lt: policyDeadlineThreshold(now) } }
}

/**
 * 机构填写的截止日期。空、null 表示清空。
 * 只收 YYYY-MM-DD，且必须晚于北京时间的今天。
 */
export function parsePolicyValidThrough(value: string | null | undefined, now: Date = new Date()): Date | null {
  if (value == null) return null
  const text = value.trim()
  if (!text) return null
  const parsed = new Date(`${text}T00:00:00.000Z`)
  const calendarOk = CALENDAR_DATE.test(text) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
  if (!calendarOk || text <= formatBeijingDate(now)) {
    throw new BadRequestException({
      error: { code: 'POLICY_DEADLINE_NOT_FUTURE', message: '截止日期只能选今天以后的日期' },
    })
  }
  return parsed
}
