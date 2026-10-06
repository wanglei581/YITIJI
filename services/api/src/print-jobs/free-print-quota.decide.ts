import { readFreePrintQuotaConfig } from './free-print-quota.config'
import {
  PRINT_GUEST_ORDER_QUOTA_EXCEEDED,
  PRINT_MEMBER_DAILY_QUOTA_REACHED,
  PRINT_TERMINAL_DAILY_QUOTA_REACHED,
  PRINT_TERMINAL_DAILY_QUOTA_MESSAGE,
  beijingDayBounds,
  freePrintQuotaNow,
  guestOrderQuotaMessage,
  memberDailyQuotaMessage,
  remainingSides,
  terminalDailyLimit,
  throwFreePrintQuota,
  type FreePrintQuotaConfig,
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
  if (!input.endUserId && input.requestedSides > config.guestPerOrderSides) {
    throwFreePrintQuota(PRINT_GUEST_ORDER_QUOTA_EXCEEDED, guestOrderQuotaMessage(config.guestPerOrderSides), {
      limit: config.guestPerOrderSides,
      used: 0,
      remaining: config.guestPerOrderSides,
      requested: input.requestedSides,
      resetAt: bounds.resetAt,
    })
  }
  if (usage.terminalUsed + usage.terminalInFlight + input.requestedSides > terminalLimit) {
    throwFreePrintQuota(PRINT_TERMINAL_DAILY_QUOTA_REACHED, PRINT_TERMINAL_DAILY_QUOTA_MESSAGE, {
      limit: terminalLimit,
      used: usage.terminalUsed,
      remaining: remainingSides(terminalLimit, usage.terminalUsed, usage.terminalInFlight),
      requested: input.requestedSides,
      resetAt: bounds.resetAt,
    })
  }
  if (input.endUserId && usage.memberUsed + usage.memberInFlight + input.requestedSides > config.memberDailySides) {
    throwFreePrintQuota(PRINT_MEMBER_DAILY_QUOTA_REACHED, memberDailyQuotaMessage(config.memberDailySides), {
      limit: config.memberDailySides,
      used: usage.memberUsed,
      remaining: remainingSides(config.memberDailySides, usage.memberUsed, usage.memberInFlight),
      requested: input.requestedSides,
      resetAt: bounds.resetAt,
    })
  }
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
