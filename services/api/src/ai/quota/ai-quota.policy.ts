import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { AiQuotaBucket } from '../../member-benefits/member-benefits.types'

export const AI_QUOTA_BUCKETS: readonly AiQuotaBucket[] = ['ai_resume', 'ai_assistant', 'ai_interview']
export type ReleaseReason = 'provider_error' | 'content_rejected' | 'server_timeout' | 'stale'
export const RELEASE_REASONS: readonly ReleaseReason[] = ['provider_error', 'content_rejected', 'server_timeout', 'stale']
export const hashQuotaOperation = (bucket: AiQuotaBucket, operation: string): string => {
  if (!AI_QUOTA_BUCKETS.includes(bucket) || typeof operation !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(operation)) {
    throw new BadRequestException({ error: { code: 'AI_QUOTA_OPERATION_INVALID', message: 'AI 操作号或用途无效' } })
  }
  return createHash('sha256').update(`${bucket}:${operation}`).digest('hex')
}
export function quotaEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

const DAILY_LIMIT_ENV = {
  ai_resume: ['AI_QUOTA_RESUME_DAILY', 20],
  ai_assistant: ['AI_QUOTA_ASSISTANT_DAILY', 80],
  ai_interview: ['AI_QUOTA_INTERVIEW_DAILY', 5],
} as const

/** 管理员在后台填写的上限。环境变量不受这个上限约束。 */
export const AI_QUOTA_LIMIT_MAX = 1000
/** 各进程读 Redis 后的缓存时间。写成功的进程会立刻清掉自己的缓存。 */
export const AI_QUOTA_LIMIT_CACHE_MS = 30_000
export const AI_QUOTA_LIMIT_TTL_SECONDS = 60 * 60 * 24 * 365

export type AiQuotaLimitSource = 'admin' | 'env' | 'default'
export interface PublishedDailyLimit {
  bucket: AiQuotaBucket
  effective: number
  source: AiQuotaLimitSource
  fallback: number
}

/**
 * 没人发布快照时，dailyLimit 仍只读环境变量。
 * 旧的 `new AiQuotaService(prisma)` 和「刚改环境变量就要生效」的门禁都靠这一点。
 */
let publishedDailyLimits: { buckets: PublishedDailyLimit[]; expiresAt: number } | null = null

export function aiQuotaDailyLimitKey(bucket: AiQuotaBucket): string {
  return `system:ai-quota-daily:${bucket}`
}

export function configuredDailyLimit(bucket: AiQuotaBucket): { value: number; source: 'env' | 'default'; fallback: number } {
  const [name, fallback] = DAILY_LIMIT_ENV[bucket]
  const raw = process.env[name]
  if (raw && /^\d+$/.test(raw)) {
    const parsed = Number(raw)
    if (Number.isSafeInteger(parsed)) return { value: parsed, source: 'env', fallback }
  }
  return { value: fallback, source: 'default', fallback }
}

export function readPublishedDailyLimits(now = Date.now()): PublishedDailyLimit[] | null {
  if (!publishedDailyLimits || publishedDailyLimits.expiresAt <= now) return null
  return publishedDailyLimits.buckets
}

export function publishDailyLimits(buckets: PublishedDailyLimit[], now = Date.now()): void {
  publishedDailyLimits = { buckets, expiresAt: now + AI_QUOTA_LIMIT_CACHE_MS }
}

export function clearDailyLimitCache(): void {
  publishedDailyLimits = null
}

export function dailyLimit(bucket: AiQuotaBucket): number {
  const cached = readPublishedDailyLimits()?.find((item) => item.bucket === bucket)
  if (cached) return cached.effective
  return configuredDailyLimit(bucket).value
}
export function quotaDay(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new BadRequestException('AI_QUOTA_DATE_INVALID')
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
}
export function quotaResetsAt(now: Date): string {
  return new Date(Date.parse(`${quotaDay(now)}T00:00:00+08:00`) + 24 * 3600_000).toISOString()
}
export function exhausted(bucket: AiQuotaBucket, now: Date): never {
  throw new HttpException({ error: {
    code: 'AI_QUOTA_EXHAUSTED', message: '今天的 AI 次数用完了，明天 0 点恢复', bucket, resetsAt: quotaResetsAt(now),
  } }, HttpStatus.TOO_MANY_REQUESTS)
}
export function activeGrants(endUserId: string, bucket: AiQuotaBucket, now: Date) {
  return {
    endUserId, benefitType: 'ai_quota', serviceKey: bucket, status: 'active', quantityRemaining: { gt: 0 },
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
    ],
  }
}
