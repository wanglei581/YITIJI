import { BadRequestException } from '@nestjs/common'
import { readFreePrintQuotaConfig } from './free-print-quota.config'
import {
  PRINT_GUEST_ORDER_QUOTA_EXCEEDED,
  PRINT_MEMBER_DAILY_QUOTA_REACHED,
  PRINT_ORDER_EXCEEDS_DAILY_FREE_SIDES,
  PRINT_TERMINAL_DAILY_QUOTA_REACHED,
  beijingDayBounds,
  freePrintQuotaMessages,
  freePrintQuotaNow,
  orderExceedsDailyFreeSidesMessage,
  remainingSides,
  terminalDailyLimit,
  throwFreePrintQuota,
  type FreePrintQuotaConfig,
  type FreePrintQuotaSubject,
  type FreeQuotaNotice,
} from './free-print-quota.policy'
import { loadFreePrintUsage, type FreePrintQuotaDb } from './free-print-quota.usage'

export interface FreePrintQuotaView {
  terminal: { limit: number; used: number; remaining: number }
  member: { limit: number; used: number; remaining: number } | null
  guestPerOrderLimit: number
  resetAt: string
}

export async function assertFreePrintQuota(
  db: FreePrintQuotaDb,
  input: {
    terminalId: string
    endUserId: string | null
    requestedSides: number
    payableCents: number
    now?: Date
    /** 复印传 copy：同一份额度、同样的错误码，只换提示语。 */
    subject?: FreePrintQuotaSubject
  },
): Promise<void> {
  // 实付大于 0 不受这三条约束。反向变异：删掉这一行，付费单也会被拒。
  if (input.payableCents > 0) return
  if (!Number.isInteger(input.requestedSides) || input.requestedSides <= 0) return
  const now = input.now ?? freePrintQuotaNow()
  const bounds = beijingDayBounds(now)
  const config = await readFreePrintQuotaConfig(db)
  const terminal = await db.terminal.findUnique({
    where: { id: input.terminalId },
    select: { dailyFreePrintSides: true },
  })
  const usage = await loadFreePrintUsage(db, input.terminalId, input.endUserId, now)
  const terminalLimit = terminalDailyLimit(terminal?.dailyFreePrintSides, config.terminalDailySides)
  const messages = freePrintQuotaMessages(input.subject)
  if (!input.endUserId && input.requestedSides > config.guestPerOrderSides) {
    throwFreePrintQuota(PRINT_GUEST_ORDER_QUOTA_EXCEEDED, messages.guest(config.guestPerOrderSides), {
      limit: config.guestPerOrderSides,
      used: 0,
      remaining: config.guestPerOrderSides,
      requested: input.requestedSides,
      resetAt: bounds.resetAt,
    })
  }
  if (usage.terminalUsed + usage.terminalInFlight + input.requestedSides > terminalLimit) {
    throwFreePrintQuota(PRINT_TERMINAL_DAILY_QUOTA_REACHED, messages.terminal, {
      limit: terminalLimit,
      used: usage.terminalUsed,
      remaining: remainingSides(terminalLimit, usage.terminalUsed, usage.terminalInFlight),
      requested: input.requestedSides,
      resetAt: bounds.resetAt,
    })
  }
  if (input.endUserId && usage.memberUsed + usage.memberInFlight + input.requestedSides > config.memberDailySides) {
    throwFreePrintQuota(PRINT_MEMBER_DAILY_QUOTA_REACHED, messages.member(config.memberDailySides), {
      limit: config.memberDailySides,
      used: usage.memberUsed,
      remaining: remainingSides(config.memberDailySides, usage.memberUsed, usage.memberInFlight),
      requested: input.requestedSides,
      resetAt: bounds.resetAt,
    })
  }
}

/**
 * 幂等回放是否还要附 freeQuotaNotice。
 * 只有仍待领取、没过期、没取消、没放行，并且订单上有机器号时才算。
 * 没有机器号时调用方不得拿空串去查机器和用量。
 * 已放行、已打印完成、已取消、已过期都不附。
 */
export function replayAttachesFreeQuotaNotice(order: {
  terminalId: string | null
  pickupStatus: string
  printTaskId: string | null
  pickupCodeExpiresAt: Date | null
}): boolean {
  if (!order.terminalId) return false
  if (order.pickupStatus !== 'pending') return false
  if (order.printTaskId) return false
  if (order.pickupCodeExpiresAt && order.pickupCodeExpiresAt.getTime() <= Date.now()) return false
  return true
}

/**
 * 小程序建单前只读预判。配置、用量和「实付大于 0 不看额度」与 assertFreePrintQuota 相同，不扣额度。
 * 只给会员建单用：endUserId 是会员 id。游客每单上限由取件时的 assertFreePrintQuota 判，这里不看。
 * 单笔大于会员每天上限或本机每天上限（含机器覆盖，取更紧的那个）时，建单抛 400。文案按哪一个更紧、份数是不是 1 分四句。
 * 回放传 rejectOverCap: false：已落库的单不因后来调低上限再被拒，也不附提示。
 * 没超上限但今天剩余不够：返回 freeQuotaNotice。够用返回 null，回包不带该字段。
 * 取件被拒仍走 assertFreePrintQuota 的 429，订单保持待领取。
 */
export async function previewFreePrintOrderQuota(
  db: FreePrintQuotaDb,
  input: {
    terminalId: string
    endUserId: string
    requestedSides: number
    payableCents: number
    copies: number
    now?: Date
  },
  options?: { rejectOverCap?: boolean },
): Promise<FreeQuotaNotice | null> {
  // 实付大于 0 不预判，与 assertFreePrintQuota 同口径。
  if (input.payableCents > 0) return null
  if (!Number.isInteger(input.requestedSides) || input.requestedSides <= 0) return null
  const now = input.now ?? freePrintQuotaNow()
  const bounds = beijingDayBounds(now)
  const config = await readFreePrintQuotaConfig(db)
  const terminal = await db.terminal.findUnique({
    where: { id: input.terminalId },
    select: { dailyFreePrintSides: true },
  })
  const terminalLimit = terminalDailyLimit(terminal?.dailyFreePrintSides, config.terminalDailySides)
  const memberLimit = config.memberDailySides
  const effectiveLimit = Math.min(memberLimit, terminalLimit)
  if (input.requestedSides > effectiveLimit) {
    if (options?.rejectOverCap === false) return null
    throw new BadRequestException({
      error: {
        code: PRINT_ORDER_EXCEEDS_DAILY_FREE_SIDES,
        message: orderExceedsDailyFreeSidesMessage({
          requestedSides: input.requestedSides,
          memberLimit,
          terminalLimit,
          copies: input.copies,
        }),
      },
    })
  }
  const usage = await loadFreePrintUsage(db, input.terminalId, input.endUserId, now)
  const remaining = Math.min(
    remainingSides(terminalLimit, usage.terminalUsed, usage.terminalInFlight),
    remainingSides(memberLimit, usage.memberUsed, usage.memberInFlight),
  )
  if (input.requestedSides > remaining) {
    return {
      remainingSides: remaining,
      requestedSides: input.requestedSides,
      resetsAt: bounds.resetAt,
    }
  }
  return null
}

/** notice 为 null 时原样返回，键不存在。不要写成 freeQuotaNotice: null。 */
export function withFreeQuotaNotice<T extends object>(
  view: T,
  notice: FreeQuotaNotice | null,
): T & { freeQuotaNotice?: FreeQuotaNotice } {
  if (notice === null) return view
  return { ...view, freeQuotaNotice: notice }
}

export async function freePrintQuotaView(
  db: FreePrintQuotaDb,
  terminalId: string,
  endUserId: string | null,
  config?: FreePrintQuotaConfig,
): Promise<FreePrintQuotaView> {
  const now = freePrintQuotaNow()
  const bounds = beijingDayBounds(now)
  const resolved = config ?? await readFreePrintQuotaConfig(db)
  const terminal = await db.terminal.findUnique({
    where: { id: terminalId },
    select: { dailyFreePrintSides: true },
  })
  const usage = await loadFreePrintUsage(db, terminalId, endUserId, now)
  const terminalLimit = terminalDailyLimit(terminal?.dailyFreePrintSides, resolved.terminalDailySides)
  return {
    terminal: {
      limit: terminalLimit,
      used: usage.terminalUsed,
      remaining: remainingSides(terminalLimit, usage.terminalUsed, usage.terminalInFlight),
    },
    member: endUserId
      ? {
          limit: resolved.memberDailySides,
          used: usage.memberUsed,
          remaining: remainingSides(resolved.memberDailySides, usage.memberUsed, usage.memberInFlight),
        }
      : null,
    guestPerOrderLimit: resolved.guestPerOrderSides,
    resetAt: bounds.resetAt,
  }
}
