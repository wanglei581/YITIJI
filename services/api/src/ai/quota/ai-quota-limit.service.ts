import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common'
import { AuditService } from '../../audit/audit.service'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../common/redis/redis.service'
import type { AiQuotaBucket } from '../../member-benefits/member-benefits.types'
import {
  AI_QUOTA_BUCKETS,
  AI_QUOTA_LIMIT_MAX,
  AI_QUOTA_LIMIT_TTL_SECONDS,
  DailyLimitCache,
  aiQuotaDailyLimitKey,
  configuredDailyLimit,
  processDailyLimitCache,
  type PublishedDailyLimit,
} from './ai-quota.policy'

export interface AiQuotaDailyLimitInput {
  ai_resume: number
  ai_assistant: number
  ai_interview: number
}

export interface AiQuotaDailyLimitConfig {
  buckets: PublishedDailyLimit[]
}

const INVALID_MESSAGE = '每天的免费次数须是 0 到 1000 的整数'
const CHANGED_ACTION = 'ai.quota_daily_limit_changed'
const FAILED_ACTION = 'ai.quota_daily_limit_failed'

/**
 * 管理员改三个用途的每天免费次数。值在 Redis，这份缓存保留 30 秒。
 * 不传缓存时用本进程那一份。写成功只清自己这份。
 * 读 Redis 失败时回落环境变量（环境变量没设就是 20 / 80 / 5），不当成 0，也不抛给扣次。
 */
@Injectable()
export class AiQuotaLimitService {
  private readonly logger = new Logger(AiQuotaLimitService.name)
  private readonly limitCache: DailyLimitCache

  constructor(
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    @Optional() cache?: DailyLimitCache,
  ) {
    this.limitCache = cache ?? processDailyLimitCache
  }

  async getConfig(): Promise<AiQuotaDailyLimitConfig> {
    return this.ensureFresh()
  }

  async ensureFresh(): Promise<AiQuotaDailyLimitConfig> {
    const cached = this.limitCache.read()
    if (cached) return { buckets: cached }
    return this.loadFromRedis()
  }

  async update(input: AiQuotaDailyLimitInput, actorId: string, ipAddress?: string | null): Promise<AiQuotaDailyLimitConfig> {
    this.assertInput(input)
    const before = await this.getConfig()
    const after = AI_QUOTA_BUCKETS.map((bucket) => this.adminRow(bucket, input[bucket], before))
    await this.recordChange(actorId, before.buckets, after, ipAddress)
    try {
      await Promise.all(AI_QUOTA_BUCKETS.map((bucket) => (
        this.redis.setEx(aiQuotaDailyLimitKey(bucket), AI_QUOTA_LIMIT_TTL_SECONDS, String(input[bucket]))
      )))
    } catch (error) {
      await this.recordFailure(actorId, after, ipAddress)
      throw error
    } finally {
      this.limitCache.clear()
    }
    return this.getConfig()
  }

  async reset(actorId: string, ipAddress?: string | null): Promise<AiQuotaDailyLimitConfig> {
    const before = await this.getConfig()
    const after = AI_QUOTA_BUCKETS.map((bucket) => this.envRow(bucket))
    await this.recordChange(actorId, before.buckets, after, ipAddress)
    try {
      await Promise.all(AI_QUOTA_BUCKETS.map((bucket) => this.redis.del(aiQuotaDailyLimitKey(bucket))))
    } catch (error) {
      await this.recordFailure(actorId, after, ipAddress)
      throw error
    } finally {
      this.limitCache.clear()
    }
    return this.getConfig()
  }

  private async loadFromRedis(): Promise<AiQuotaDailyLimitConfig> {
    try {
      const raws = await Promise.all(AI_QUOTA_BUCKETS.map((bucket) => this.redis.get(aiQuotaDailyLimitKey(bucket))))
      const buckets = AI_QUOTA_BUCKETS.map((bucket, index) => this.resolve(bucket, raws[index]))
      this.limitCache.publish(buckets)
      return { buckets }
    } catch (error) {
      this.logger.warn(`每天免费次数读 Redis 失败，改用服务器配置: ${(error as Error).message}`)
      const buckets = AI_QUOTA_BUCKETS.map((bucket) => this.envRow(bucket))
      this.limitCache.publish(buckets)
      return { buckets }
    }
  }

  private resolve(bucket: AiQuotaBucket, raw: string | null): PublishedDailyLimit {
    const admin = this.parseAdmin(raw)
    if (admin === null) return this.envRow(bucket)
    const fallback = configuredDailyLimit(bucket).fallback
    return { bucket, effective: admin, source: 'admin', fallback }
  }

  /** 只有 0–1000 的整数字符串才算后台设过。空、乱码、超出范围都当没设，不能变成 0。 */
  private parseAdmin(raw: string | null): number | null {
    if (raw == null || !/^\d+$/.test(raw)) return null
    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > AI_QUOTA_LIMIT_MAX) return null
    return parsed
  }

  private envRow(bucket: AiQuotaBucket): PublishedDailyLimit {
    const configured = configuredDailyLimit(bucket)
    return { bucket, effective: configured.value, source: configured.source, fallback: configured.fallback }
  }

  private adminRow(bucket: AiQuotaBucket, effective: number, before: AiQuotaDailyLimitConfig): PublishedDailyLimit {
    const previous = before.buckets.find((item) => item.bucket === bucket)
    return { bucket, effective, source: 'admin', fallback: previous?.fallback ?? configuredDailyLimit(bucket).fallback }
  }

  private assertInput(input: AiQuotaDailyLimitInput): void {
    for (const bucket of AI_QUOTA_BUCKETS) {
      const value = input?.[bucket]
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > AI_QUOTA_LIMIT_MAX) {
        throw new BadRequestException({ error: { code: 'AI_QUOTA_LIMIT_INVALID', message: INVALID_MESSAGE } })
      }
    }
  }

  private async recordChange(
    actorId: string,
    before: PublishedDailyLimit[],
    after: PublishedDailyLimit[],
    ipAddress?: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.audit.writeRequired(tx, {
        actorId,
        actorRole: 'admin',
        action: CHANGED_ACTION,
        targetType: 'system',
        targetId: 'ai-quota-daily',
        payload: { before: this.brief(before), after: this.brief(after) },
        ipAddress: ipAddress || null,
      })
    })
  }

  private async recordFailure(actorId: string, attempted: PublishedDailyLimit[], ipAddress?: string | null): Promise<void> {
    await this.audit.write({
      actorId,
      actorRole: 'admin',
      action: FAILED_ACTION,
      targetType: 'system',
      targetId: 'ai-quota-daily',
      payload: { attempted: this.brief(attempted), reason: 'redis_write_failed' },
      ipAddress: ipAddress || null,
    })
  }

  private brief(rows: PublishedDailyLimit[]): Array<{ bucket: AiQuotaBucket; effective: number; source: PublishedDailyLimit['source'] }> {
    return rows.map(({ bucket, effective, source }) => ({ bucket, effective, source }))
  }
}
