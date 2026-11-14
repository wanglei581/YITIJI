// ============================================================
// AdminOrgContentTrustService — 机构内容信任标记（发布闸门的唯一人工入口）
//
// 为什么要新建这个 service 而不是塞进 AdminOrgsService：
//   admin-orgs.service.ts 已经 852 行，按 CLAUDE.md §8「800 行以上不得继续堆
//   新功能」，新能力单独成文件。
//
// 为什么是新端点而不是复用 PATCH /admin/orgs/:id：
//   `Organization` 从 P1 expand 起就带了 contentTrustReviewedBy /
//   ReviewedAt / Reason 三列 —— 设计时就是「这是一次有人负责的审核决策」，
//   而不是一个可以顺手改的档案字段。入口就这一个：一次调用 = 一次显式核验
//   决策 = 一条审计。回填脚本只对显式列出的机构写同样的三列。
//
// 合规：本端点只决定「该机构的内容能不能被发布」，不改机构档案、不碰账号、
// 不改任何内容行的 publishStatus。撤销后，已发布政策会从一体机和小程序的
// 公开读取里消失；恢复可信后重新显示。公开列表有缓存，所以这里要立刻清掉。
// ============================================================

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { REDIS_CLIENT } from '../common/redis/redis.service'
import { tryRedis } from '../common/redis/redis-degradation'
import {
  COMMUNITY_FEED_CACHE_PREFIX,
  DAILY_BRIEF_CITY_CACHE_PREFIX,
  PUBLIC_CONTENT_CACHE_STALE_WINDOW_SECONDS,
} from '../common/content-trust-cache-keys'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import type { OrgContentTrustDto } from './dto/org-content-trust.dto'

/** 与 docs/product/recruitment-content-domain-model-2026-08.md §Organization 一致。 */
export const ORG_CONTENT_TRUST_STATUSES = ['pending', 'active', 'suspended', 'revoked'] as const
export type OrgContentTrustStatus = (typeof ORG_CONTENT_TRUST_STATUSES)[number]

/** 社区动态和早报共用的公开缓存。生产走 Redis SCAN；门禁可以换一块内存实现。 */
export interface PublicContentCache {
  deleteByPrefix(prefix: string): Promise<void>
}

/**
 * 清社区动态和早报的公开缓存。库已经提交之后调用。
 * Redis 抖动只记警告和一条审计，不得把已经生效的撤销、恢复、停用打成 500。
 * 两个前缀各包一次 tryRedis：第一次失败会进入静默期，第二次可能被跳过，
 * 只要有一次没清掉就写一条审计。
 */
export async function invalidatePublicContentCache(
  cache: PublicContentCache,
  logger: Logger | undefined,
  audit: Pick<AuditService, 'write'>,
  actor: { userId: string | null; role: string },
  orgId: string,
): Promise<void> {
  let failed = false
  for (const prefix of [COMMUNITY_FEED_CACHE_PREFIX, DAILY_BRIEF_CITY_CACHE_PREFIX]) {
    const attempt = await tryRedis(
      'public-content-cache-invalidate',
      () => cache.deleteByPrefix(prefix),
      logger,
    )
    if (!attempt.ok) failed = true
  }
  if (!failed) return
  const code = 'PUBLIC_CONTENT_CACHE_INVALIDATION_FAILED'
  logger?.warn(`public content cache invalidation failed: orgId=${orgId} code=${code}`)
  await audit.write({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'organization.public_content_cache_invalidation_failed',
    targetType: 'organization',
    targetId: orgId,
    payload: { orgId, code, level: 'warn', staleWindowSeconds: PUBLIC_CONTENT_CACHE_STALE_WINDOW_SECONDS },
  })
}

@Injectable()
export class RedisPublicContentCache implements PublicContentCache {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async deleteByPrefix(prefix: string): Promise<void> {
    let cursor = '0'
    do {
      const page = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200)
      cursor = page[0]
      const keys = page[1]
      if (keys.length > 0) await this.client.del(...keys)
    } while (cursor !== '0')
  }
}

export interface OrgContentTrustView {
  id: string
  name: string
  contentTrustStatus: string | null
  contentTrustReviewedBy: string | null
  contentTrustReviewedAt: string | null
  contentTrustReason: string | null
  archived: boolean
}

@Injectable()
export class AdminOrgContentTrustService {
  private readonly logger = new Logger(AdminOrgContentTrustService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(RedisPublicContentCache) private readonly publicCache: PublicContentCache,
  ) {}

  async getContentTrust(id: string): Promise<OrgContentTrustView> {
    const org = await this.prisma.organization.findUnique({ where: { id } })
    if (!org) {
      throw new NotFoundException({ error: { code: 'ORG_NOT_FOUND', message: `机构 ${id} 不存在` } })
    }
    return this.toView(org)
  }

  /**
   * 标记机构内容信任状态。
   *
   * 约束：
   *   - `active` 必须给 reason —— 「凭什么可信」要留下依据（授权书 / 合同 /
   *     公开声明编号）。没有依据的 active 就是把闸门当摆设。
   *   - 已归档机构不允许标 active：归档是更强的终止态，要先取消归档。
   *   - 无论标成什么，都写 AuditLog（含旧值 → 新值），审计不可跳过。
   */
  async setContentTrust(id: string, dto: OrgContentTrustDto, user: AuthedUser): Promise<OrgContentTrustView> {
    const org = await this.prisma.organization.findUnique({ where: { id } })
    if (!org) {
      throw new NotFoundException({ error: { code: 'ORG_NOT_FOUND', message: `机构 ${id} 不存在` } })
    }

    const status = dto.status
    if (!(ORG_CONTENT_TRUST_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_CONTENT_TRUST_STATUS',
          message: `无效内容信任状态 ${status}，可选：${ORG_CONTENT_TRUST_STATUSES.join(' / ')}`,
        },
      })
    }

    const reason = (dto.reason ?? '').trim()
    if (status === 'active' && reason.length === 0) {
      throw new BadRequestException({
        error: {
          code: 'CONTENT_TRUST_REASON_REQUIRED',
          message: '标记为 active 必须填写核验依据(授权书 / 合同 / 公开声明编号等),这条依据会进审计。',
        },
      })
    }
    if (status === 'active' && org.archivedAt != null) {
      throw new BadRequestException({
        error: {
          code: 'ORG_ARCHIVED',
          message: `机构 ${id} 已归档(archivedAt=${org.archivedAt.toISOString()}),不能标记为内容可信;如需恢复供稿请先取消归档。`,
        },
      })
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.organization.update({
        where: { id },
        data: {
          contentTrustStatus: status,
          contentTrustReviewedBy: user.userId,
          contentTrustReviewedAt: new Date(),
          contentTrustReason: reason.length > 0 ? reason : null,
        },
      })
      await this.audit.writeRequired(tx, {
        actorId: user.userId,
        actorRole: 'admin',
        action: 'organization.content_trust',
        targetType: 'organization',
        targetId: id,
        payload: {
          fromContentTrustStatus: org.contentTrustStatus,
          toContentTrustStatus: status,
          reason: reason.length > 0 ? reason : null,
          archived: org.archivedAt != null,
        },
      })
      return result
    })

    this.logger.log(
      `setContentTrust: org=${id} ${org.contentTrustStatus ?? 'null'} -> ${status} by=${user.userId}`,
    )
    // 公开列表已经看内容可信，但社区动态和早报把结果缓存了 15 分钟。
    // 撤销和恢复都要立刻清掉。清失败不能把已经落库的核验打成 500。
    await invalidatePublicContentCache(
      this.publicCache,
      this.logger,
      this.audit,
      { userId: user.userId, role: 'admin' },
      id,
    )
    return this.toView(updated)
  }

  private toView(org: {
    id: string
    name: string
    contentTrustStatus: string | null
    contentTrustReviewedBy: string | null
    contentTrustReviewedAt: Date | null
    contentTrustReason: string | null
    archivedAt: Date | null
  }): OrgContentTrustView {
    return {
      id: org.id,
      name: org.name,
      contentTrustStatus: org.contentTrustStatus,
      contentTrustReviewedBy: org.contentTrustReviewedBy,
      contentTrustReviewedAt: org.contentTrustReviewedAt ? org.contentTrustReviewedAt.toISOString() : null,
      contentTrustReason: org.contentTrustReason,
      archived: org.archivedAt != null,
    }
  }
}
