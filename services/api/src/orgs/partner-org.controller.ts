import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { AdminOrgsService } from './admin-orgs.service'

/** 机构自助可改字段仅限联系人 / 联系电话；名称/类型/场景模板/启用模块由管理员管理（运营边界）。 */
export class UpdateOwnOrgProfileDto {
  @IsOptional() @IsString() @MaxLength(50)
  contact?: string

  @IsOptional() @IsString() @MaxLength(30)
  contactPhone?: string
}

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
  ip?: string
  requestId?: string
}

/**
 * Partner 机构资料自助端点（审计修复：替换前端 MOCK_PROFILE 硬编码）。
 *
 *   GET /partner/profile  本机构档案（含场景模板/启用模块/绑定数据源计数；无任何凭证字段）
 *   PUT /partner/profile  仅可改 联系人/联系电话（白名单 DTO，全局 forbidNonWhitelisted 兜底）
 *
 * 归属：orgId 取自登录 token（user.orgId），不接受任何外部传入机构 id → 跨机构不可达。
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerOrgController {
  constructor(private readonly orgs: AdminOrgsService) {}

  @Get('partner/profile')
  getProfile(@CurrentUser() user: AuthedUser) {
    return this.orgs.getOwnProfile(user)
  }

  @Put('partner/profile')
  updateProfile(
    @CurrentUser() user: AuthedUser,
    @Body() dto: UpdateOwnOrgProfileDto,
    @Req() req: ReqLike,
  ) {
    return this.orgs.updateOwnProfile(user, dto, req)
  }
}
