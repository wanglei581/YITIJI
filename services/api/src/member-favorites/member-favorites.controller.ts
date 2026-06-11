import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import type { FavoriteTargetType, MemberFavoriteItem } from './member-favorites.types'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { MemberFavoritesService } from './member-favorites.service'
import { AddFavoriteDto, FAVORITE_TARGET_TYPES } from './dto/add-favorite.dto'
import { parseMemberPageQuery } from '../common/utils/member-page'

/**
 * 会员收藏接口（Phase C-2C）。路由前缀 /api/v1/me/favorites。
 *
 * 全部受 EndUserAuthGuard 保护：
 * - 必须携带有效会员 token（Bearer，audience=enduser，且 Redis 会话有效）。
 * - 匿名 / 缺 token / 失效 token / 内部运营 token → 401。
 * - endUserId 来自校验后的 token（req.endUser），service 只按本人 endUserId 读写，
 *   不接受任何外部传入用户 id → 跨用户越权天然不可能。
 *
 * 合规：收藏只记录浏览 / 收藏行为，绝不记录投递结果 / 候选人数据。
 */
@Controller('me/favorites')
@UseGuards(EndUserAuthGuard)
export class MemberFavoritesController {
  constructor(private readonly favorites: MemberFavoritesService) {}

  /** 我的收藏列表（本人，可选 ?type=job|job_fair|policy 过滤；游标分页，pageSize 封顶 50）。 */
  @Get()
  async list(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('type') type?: string,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ApiResponse<{ items: MemberFavoriteItem[]; nextCursor: string | null; total: number }>> {
    const targetType = this.parseOptionalType(type)
    return ApiResponse.ok(
      await this.favorites.list(user.endUserId, parseMemberPageQuery(cursor, pageSize), targetType),
    )
  }

  /** 新增收藏（幂等）。 */
  @Post()
  async add(
    @CurrentEndUser() user: AuthedEndUser,
    @Body() dto: AddFavoriteDto,
  ): Promise<ApiResponse<MemberFavoriteItem>> {
    return ApiResponse.ok(
      await this.favorites.add(user.endUserId, {
        targetType: dto.targetType,
        targetId: dto.targetId,
        title: dto.title,
      }),
    )
  }

  /** 取消收藏（幂等）。 */
  @Delete(':targetType/:targetId')
  async remove(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('targetType') targetType: string,
    @Param('targetId') targetId: string,
  ): Promise<ApiResponse<{ removed: boolean }>> {
    const type = this.parseRequiredType(targetType)
    return ApiResponse.ok(await this.favorites.remove(user.endUserId, type, targetId))
  }

  /** 可选 type 查询参数校验：缺省返回 undefined；非法值 → 400。 */
  private parseOptionalType(type?: string): FavoriteTargetType | undefined {
    if (type === undefined || type === '') return undefined
    return this.parseRequiredType(type)
  }

  private parseRequiredType(type: string): FavoriteTargetType {
    if (!(FAVORITE_TARGET_TYPES as string[]).includes(type)) {
      throw new BadRequestException({
        error: { code: 'FAVORITE_INVALID_TARGET_TYPE', message: 'targetType 必须是 job / job_fair / policy 之一' },
      })
    }
    return type as FavoriteTargetType
  }
}
