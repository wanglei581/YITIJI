/**
 * AI 按人次数余量契约的本地副本。
 *
 * 契约源：packages/shared/src/types/ai.ts 末尾的 AiQuotaRemaining /
 * KioskAiQuota / AdminAiQuotaUsage。services/api 不直接 import ESM 的 shared
 * 包（见 dto/resume-generate.dto.ts 顶部）。改字段必须两处一起改。
 *
 * 三个接口都只读。管理员汇总不含会员 id、手机号。
 */
import type { AiQuotaBucket } from '../../member-benefits/member-benefits.types'

export type { AiQuotaBucket }

export interface AiQuotaRemaining {
  bucket: AiQuotaBucket
  dailyLimit: number
  dailyUsed: number
  dailyRemaining: number
  extraRemaining: number
  extraEarliestExpiry: string | null
  resetsAt: string
}

export interface KioskAiQuota {
  guestEnabled: boolean
  dailyLimit: number
  dailyUsed: number
  dailyRemaining: number
  resetsAt: string
}

export interface AdminAiQuotaBucketUsage {
  bucket: AiQuotaBucket
  usedTotal: number
  membersUsed: number
  membersExhausted: number
  dailyLimit: number
}

export interface AdminAiQuotaGuestUsage {
  perTerminalDailyLimit: number
  terminalsUsed: number
  usedTotal: number
}

export interface AdminAiQuotaExtraBucket {
  bucket: AiQuotaBucket
  remainingTotal: number
  expiringWithin30Days: number
}

export interface AdminAiQuotaUsage {
  day: string
  buckets: AdminAiQuotaBucketUsage[]
  guest: AdminAiQuotaGuestUsage
  extra: AdminAiQuotaExtraBucket[]
}
