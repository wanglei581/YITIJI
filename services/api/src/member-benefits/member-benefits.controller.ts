import { Controller, Get, UseGuards } from '@nestjs/common'
import type { MemberBenefitItem } from './member-benefits.types'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { MemberBenefitsService } from './member-benefits.service'

/**
 * 会员权益只读接口（Phase C-2C 底座）。路由前缀 /api/v1/me/benefits。
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

  /** 我的权益列表（本人，只读）。 */
  @Get()
  async list(@CurrentEndUser() user: AuthedEndUser): Promise<ApiResponse<MemberBenefitItem[]>> {
    return ApiResponse.ok(await this.benefits.list(user.endUserId))
  }
}
