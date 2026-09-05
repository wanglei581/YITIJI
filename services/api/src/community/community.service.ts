import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../common/redis/redis.service'
import type { CommunityFeedItem, CommunityFeedKind, CommunityFeedPage } from './community.types'

const CACHE_TTL_SECONDS = 15 * 60
const MAX_SUMMARY_LENGTH = 120

type FeedCursor = { publishedAt: Date; id: string }

@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async list(cursorValue?: string, requestedLimit?: number): Promise<CommunityFeedPage> {
    const cursor = cursorValue ? this.parseCursor(cursorValue) : null
    const limit = requestedLimit ?? 20
    const cacheKey = `community:feeds:v1:${cursorValue ?? 'first'}:${limit}`

    return this.withPublicCache(cacheKey, async () => {
      const take = limit + 1
      const [policies, benefits, broadcasts] = await Promise.all([
        this.prisma.policyPost.findMany({
          where: this.afterCursorWhere(
            { reviewStatus: 'approved', publishStatus: 'published' },
            'policy',
            cursor,
          ),
          select: { id: true, title: true, summary: true, sourceName: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        }),
        this.prisma.benefitActivity.findMany({
          where: this.afterCursorWhere({ status: 'published' }, 'benefit', cursor),
          select: { id: true, title: true, description: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        }),
        this.prisma.systemBroadcast.findMany({
          where: this.afterCursorWhere({ deletedAt: null }, 'broadcast', cursor),
          select: { id: true, title: true, content: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        }),
      ])

      const merged: CommunityFeedItem[] = [
        ...policies.map((row) => this.policyItem(row)),
        ...benefits.map((row) => this.benefitItem(row)),
        ...broadcasts.map((row) => this.broadcastItem(row)),
      ].sort(compareFeed)
      const items = merged.slice(0, limit)
      const last = items.at(-1)
      return {
        items,
        nextCursor: merged.length > limit && last ? `${last.publishedAt}|${last.id}` : null,
        commentsEnabled: false,
      }
    })
  }

  private policyItem(row: { id: string; title: string; summary: string | null; sourceName: string; createdAt: Date }): CommunityFeedItem {
    return {
      id: `policy:${row.id}`,
      kind: 'policy',
      title: row.title,
      summary: truncate(row.summary ?? row.title),
      sourceName: row.sourceName,
      publishedAt: row.createdAt.toISOString(),
      action: { label: '查看政策', route: `/pages/policy-detail/policy-detail?id=${encodeURIComponent(row.id)}` },
    }
  }

  private benefitItem(row: { id: string; title: string; description: string | null; createdAt: Date }): CommunityFeedItem {
    return {
      id: `benefit:${row.id}`,
      kind: 'benefit',
      title: row.title,
      summary: truncate(row.description ?? row.title),
      sourceName: '平台公告',
      publishedAt: row.createdAt.toISOString(),
      action: { label: '查看权益', route: '/pages/membership/membership' },
    }
  }

  private broadcastItem(row: { id: string; title: string; content: string; createdAt: Date }): CommunityFeedItem {
    return {
      id: `broadcast:${row.id}`,
      kind: 'broadcast',
      title: row.title,
      summary: truncate(row.content || row.title),
      sourceName: '平台公告',
      publishedAt: row.createdAt.toISOString(),
      action: { label: '查看通知', route: '/pages/notifications/notifications' },
    }
  }

  private afterCursorWhere(base: Record<string, unknown>, kind: CommunityFeedKind, cursor: FeedCursor | null): Record<string, unknown> {
    if (!cursor) return base
    const [cursorKind, cursorRowId] = cursor.id.split(':', 2)
    const sameTimestamp = kind < cursorKind
      ? {}
      : kind === cursorKind
        ? { id: { lt: cursorRowId } }
        : null
    if (sameTimestamp === null) return { ...base, createdAt: { lt: cursor.publishedAt } }
    return {
      ...base,
      OR: [
        { createdAt: { lt: cursor.publishedAt } },
        { createdAt: cursor.publishedAt, ...sameTimestamp },
      ],
    }
  }

  private parseCursor(value: string): FeedCursor {
    const separator = value.indexOf('|')
    if (separator <= 0 || separator === value.length - 1) {
      throw new BadRequestException({ error: { code: 'COMMUNITY_INVALID_CURSOR', message: 'cursor 格式无效' } })
    }
    const publishedAt = new Date(value.slice(0, separator))
    const id = value.slice(separator + 1)
    if (Number.isNaN(publishedAt.getTime()) || !/^(policy|benefit|broadcast):[^|]+$/.test(id)) {
      throw new BadRequestException({ error: { code: 'COMMUNITY_INVALID_CURSOR', message: 'cursor 格式无效' } })
    }
    return { publishedAt, id }
  }

  private async withPublicCache(cacheKey: string, load: () => Promise<CommunityFeedPage>): Promise<CommunityFeedPage> {
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached) as CommunityFeedPage
        if (Array.isArray(parsed.items) && parsed.commentsEnabled === false) return parsed
      }
    } catch {
      // Redis 为公共性能优化；不可用时直接读真实数据，不让公开入口伪造空列表。
    }

    const result = await load()
    try {
      await this.redis.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result))
    } catch {
      // 缓存写失败不影响真实数据读路径。
    }
    return result
  }
}

function truncate(value: string): string {
  return value.length <= MAX_SUMMARY_LENGTH ? value : value.slice(0, MAX_SUMMARY_LENGTH)
}

function compareFeed(left: CommunityFeedItem, right: CommunityFeedItem): number {
  if (left.publishedAt !== right.publishedAt) return right.publishedAt.localeCompare(left.publishedAt)
  return right.id.localeCompare(left.id)
}
