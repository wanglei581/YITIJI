import { Injectable, NotFoundException } from '@nestjs/common'
import type { AddFavoriteInput, FavoriteTargetType, MemberFavoriteItem } from './member-favorites.types'
import { PrismaService } from '../prisma/prisma.service'
import { buildMemberPage, memberPageArgs, type MemberPageQuery } from '../common/utils/member-page'

// ============================================================
// 会员收藏服务（Phase C-2C）。
//
// 全部读写都以传入的 endUserId（来自 EndUserAuthGuard 注入的 req.endUser）为唯一过滤维度：
// 只能操作**本人**收藏；跨用户 / 匿名在 controller 层（guard）就已拒绝，service 永远拿到的是
// 已认证的 endUserId，绝不接受任意 id 参数 → 天然杜绝越权。
//
// 合规（CLAUDE.md §10）：收藏只记录"对外部来源岗位 / 招聘会 / 政策的兴趣标记"，
// 绝不记录投递结果 / 投递状态 / 面试 / Offer / 候选人数据，不形成招聘闭环。
// ============================================================

@Injectable()
export class MemberFavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 只允许收藏「已审核 + 已发布」的可见目标；标题快照由服务端派生，避免前端伪造。 */
  private async resolvePublishedTitle(targetType: FavoriteTargetType, targetId: string): Promise<string | null> {
    const published = { reviewStatus: 'approved', publishStatus: 'published' }
    if (targetType === 'job') {
      const job = await this.prisma.job.findFirst({
        where: { id: targetId, ...published },
        select: { title: true },
      })
      return job?.title ?? null
    }
    if (targetType === 'job_fair') {
      const fair = await this.prisma.jobFair.findFirst({
        where: { id: targetId, ...published },
        select: { title: true },
      })
      return fair?.title ?? null
    }
    const policy = await this.prisma.policyPost.findFirst({
      where: { id: targetId, ...published },
      select: { title: true },
    })
    return policy?.title ?? null
  }

  /** 我的收藏列表（本人，可按 targetType 过滤），游标分页（C-2D，不做无界查询）。 */
  async list(
    endUserId: string,
    page: MemberPageQuery,
    targetType?: FavoriteTargetType,
  ): Promise<{ items: MemberFavoriteItem[]; nextCursor: string | null; total: number }> {
    const where = { endUserId, ...(targetType ? { targetType } : {}) }
    const total = await this.prisma.favorite.count({ where })
    const rows = await this.prisma.favorite.findMany({
      where,
      select: { id: true, targetType: true, targetId: true, title: true, createdAt: true },
      ...memberPageArgs(page),
    })
    return buildMemberPage(rows, page, total, (r) => ({
      id: r.id,
      targetType: r.targetType as FavoriteTargetType,
      targetId: r.targetId,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
    }))
  }

  /**
   * 新增收藏（幂等）：重复收藏同一对象不报错，仅刷新展示标题快照并返回原记录。
   * 唯一键 (endUserId, targetType, targetId) 保证同一会员对同一对象只有一条。
   */
  async add(endUserId: string, input: AddFavoriteInput): Promise<MemberFavoriteItem> {
    const title = await this.resolvePublishedTitle(input.targetType, input.targetId)
    if (!title) {
      throw new NotFoundException({
        error: { code: 'FAVORITE_TARGET_NOT_FOUND', message: '收藏目标不存在或未发布' },
      })
    }

    const row = await this.prisma.favorite.upsert({
      where: {
        endUserId_targetType_targetId: {
          endUserId,
          targetType: input.targetType,
          targetId: input.targetId,
        },
      },
      // 已存在则按服务端来源刷新展示标题（来源标题可能更新）；不改 createdAt。
      update: { title },
      create: {
        endUserId,
        targetType: input.targetType,
        targetId: input.targetId,
        title,
      },
      select: { id: true, targetType: true, targetId: true, title: true, createdAt: true },
    })
    return {
      id: row.id,
      targetType: row.targetType as FavoriteTargetType,
      targetId: row.targetId,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
    }
  }

  /**
   * 取消收藏（幂等）：未收藏时返回 removed:false，不报错。
   * deleteMany 限定 endUserId → 绝不可能删到他人记录。
   */
  async remove(
    endUserId: string,
    targetType: FavoriteTargetType,
    targetId: string,
  ): Promise<{ removed: boolean }> {
    const res = await this.prisma.favorite.deleteMany({ where: { endUserId, targetType, targetId } })
    return { removed: res.count > 0 }
  }
}
