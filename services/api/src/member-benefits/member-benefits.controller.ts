import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import type { MemberBenefitItem, MemberRedemptionItem } from './member-benefits.types'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { MemberBenefitsService } from './member-benefits.service'
import { parseMemberPageQuery } from '../common/utils/member-page'

/**
 * 会员权益只读接口（Phase C-2C 底座 + Wave 3 核销记录查看）。路由前缀 /api/v1/me/benefits。
 *
 * 受 EndUserAuthGuard 保护：匿名 / 缺 token / 失效 token / 内部运营 token → 401。
 * endUserId 来自校验后的 token（req.endUser），service 只按本人 endUserId 查询。
 *
 * 只读、不改任何数据；只回元数据；空列表返回 []，不伪造数量。
 * 本阶段不接发放 / 核销真实逻辑、不接支付。
 */
@Controller('me/benefits')
@UseGuards(EndUserAuthGuard)
export class MemberBenefitsController {
  constructor(private readonly benefits: MemberBenefitsService) {}

  /** 我的权益列表（本人，只读；游标分页，pageSize 封顶 50）。 */
  @Get()
  async list(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ApiResponse<{ items: MemberBenefitItem[]; nextCursor: string | null; total: number }>> {
    return ApiResponse.ok(await this.benefits.list(user.endUserId, parseMemberPageQuery(cursor, pageSize)))
  }

  /**
   * 我的核销记录列表（Wave 3；本人，只读；游标分页，pageSize 封顶 50）。
   *
   * 返回本人所有权益核销记录（RedemptionRecord），按核销时间倒序。
   * 不含 idempotencyKey 等内部字段；amountCents 为平台 credit 抵扣额（非资金）。
   * GET /api/v1/me/benefits/redemptions
   */
  @Get('redemptions')
  async listRedemptions(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ApiResponse<{ items: MemberRedemptionItem[]; nextCursor: string | null; total: number }>> {
    return ApiResponse.ok(
      await this.benefits.listRedemptions(user.endUserId, parseMemberPageQuery(cursor, pageSize)),
    )
  }
}
