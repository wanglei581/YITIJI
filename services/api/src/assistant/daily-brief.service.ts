import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../common/redis/redis.service'

const CACHE_TTL_SECONDS = 15 * 60
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const PUBLISHED = { reviewStatus: 'approved', publishStatus: 'published' }

type DailyReportModule =
  | { type: 'pickup_expiring'; items: Array<{ orderId: string; expiresAt: string; hoursLeft: number; route: string }> }
  | { type: 'fair_countdown'; items: Array<{ fairId: string; title: string; startAt: string; daysLeft: number; route: string }> }
  | { type: 'city_new'; city: string; newJobs: number; newPolicies: number; route: string }
  | { type: 'broadcast'; item: { id: string; title: string; publishedAt: string; route: string } }

export type DailyReport = { date: string; empty: boolean; modules: DailyReportModule[] }

@Injectable()
export class DailyBriefService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async create(endUserId: string, requestedCity?: string): Promise<DailyReport> {
    const now = new Date()
    const date = shanghaiDate(now)
    const city = requestedCity?.trim() || null
    const modules: DailyReportModule[] = []

    const pickup = await this.pickupExpiring(endUserId, now)
    if (pickup.items.length > 0) modules.push(pickup)

    const fairs = await this.fairCountdown(endUserId, now)
    if (fairs.items.length > 0) modules.push(fairs)

    if (city) {
      const cityNew = await this.cityNew(city, date)
      if (cityNew.newJobs > 0 || cityNew.newPolicies > 0) modules.push(cityNew)
    }

    const broadcast = await this.latestBroadcast()
    if (broadcast) modules.push(broadcast)

    return { date, empty: modules.length === 0, modules }
  }

  private async pickupExpiring(endUserId: string, now: Date): Promise<Extract<DailyReportModule, { type: 'pickup_expiring' }>> {
    const until = new Date(now.getTime() + DAY_MS)
    const rows = await this.prisma.order.findMany({
      where: {
        endUserId,
        payStatus: 'paid',
        pickupCodeExpiresAt: { gt: now, lte: until },
        pickupStatus: { notIn: ['none', 'used', 'expired', 'cancelled'] },
      },
      select: { id: true, pickupCodeExpiresAt: true },
      orderBy: { pickupCodeExpiresAt: 'asc' },
      take: 20,
    })
    return {
      type: 'pickup_expiring',
      items: rows.flatMap((row) => row.pickupCodeExpiresAt ? [{
        orderId: row.id,
        expiresAt: row.pickupCodeExpiresAt.toISOString(),
        hoursLeft: Math.max(0, Math.ceil((row.pickupCodeExpiresAt.getTime() - now.getTime()) / HOUR_MS)),
        route: '/pages/orders/orders',
      }] : []),
    }
  }

  private async fairCountdown(endUserId: string, now: Date): Promise<Extract<DailyReportModule, { type: 'fair_countdown' }>> {
    const favorites = await this.prisma.favorite.findMany({
      where: { endUserId, targetType: 'job_fair' },
      select: { targetId: true },
    })
    if (favorites.length === 0) return { type: 'fair_countdown', items: [] }
    const startBefore = new Date(now.getTime() + 2 * DAY_MS)
    const fairs = await this.prisma.jobFair.findMany({
      where: { id: { in: favorites.map((favorite) => favorite.targetId) }, ...PUBLISHED, startAt: { gt: now, lte: startBefore } },
      select: { id: true, title: true, startAt: true },
      orderBy: { startAt: 'asc' },
      take: 20,
    })
    return {
      type: 'fair_countdown',
      items: fairs.map((fair) => ({
        fairId: fair.id,
        title: fair.title,
        startAt: fair.startAt.toISOString(),
        daysLeft: Math.max(0, Math.floor((fair.startAt.getTime() - now.getTime()) / DAY_MS)),
        route: `/pages/fair-detail/fair-detail?id=${encodeURIComponent(fair.id)}`,
      })),
    }
  }

  private async cityNew(city: string, date: string): Promise<Extract<DailyReportModule, { type: 'city_new' }>> {
    const cacheKey = `daily-brief:city-new:v1:${date}:${encodeURIComponent(city)}`
    const load = async () => {
      const { start, end } = shanghaiDayRange(date)
      const [newJobs, newPolicies] = await Promise.all([
        this.prisma.job.count({ where: { ...PUBLISHED, city, syncTime: { gte: start, lt: end } } }),
        // PolicyPost 没有城市字段；这里如实统计当日已发布全局政策，不能伪造本地归属。
        this.prisma.policyPost.count({ where: { ...PUBLISHED, syncTime: { gte: start, lt: end } } }),
      ])
      return { newJobs, newPolicies }
    }
    const counts = await this.withCityCache(cacheKey, load)
    return { type: 'city_new', city, ...counts, route: '/pages/jobs/jobs' }
  }

  private async latestBroadcast(): Promise<Extract<DailyReportModule, { type: 'broadcast' }> | null> {
    const row = await this.prisma.systemBroadcast.findFirst({
      where: { deletedAt: null },
      select: { id: true, title: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    return row ? {
      type: 'broadcast',
      item: { id: row.id, title: row.title, publishedAt: row.createdAt.toISOString(), route: '/pages/notifications/notifications' },
    } : null
  }

  private async withCityCache(
    cacheKey: string,
    load: () => Promise<{ newJobs: number; newPolicies: number }>,
  ): Promise<{ newJobs: number; newPolicies: number }> {
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached) as { newJobs?: unknown; newPolicies?: unknown }
        if (Number.isInteger(parsed.newJobs) && Number.isInteger(parsed.newPolicies)) {
          return { newJobs: parsed.newJobs as number, newPolicies: parsed.newPolicies as number }
        }
      }
    } catch {
      // 多实例 Redis 不可达时仍回数据库；个人数据没有进入任何缓存键。
    }
    const result = await load()
    try {
      await this.redis.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result))
    } catch {
      // 缓存写失败不影响真实聚合结果。
    }
    return result
  }
}

function shanghaiDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = (type: string) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

function shanghaiDayRange(date: string): { start: Date; end: Date } {
  return {
    start: new Date(`${date}T00:00:00.000+08:00`),
    end: new Date(`${date}T24:00:00.000+08:00`),
  }
}
