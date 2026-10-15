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
export function dailyLimit(bucket: AiQuotaBucket): number {
  const config = {
    ai_resume: ['AI_QUOTA_RESUME_DAILY', 20],
    ai_assistant: ['AI_QUOTA_ASSISTANT_DAILY', 80],
    ai_interview: ['AI_QUOTA_INTERVIEW_DAILY', 5],
  } as const
  const [name, fallback] = config[bucket]
  return quotaEnv(name, fallback)
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
