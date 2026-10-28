import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { LicenseService } from './license.service'

/**
 * 合作机构后台：本机构的授权（只读）。机构只看得到自己的——机构编号取自登录身份，不接受参数。
 *   GET /api/v1/partner/license
 * 不含备注、暂停理由、工单号、经办人。
 */
@Controller('partner/license')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class LicensePartnerController {
  constructor(private readonly licenses: LicenseService) {}

  @Get()
  async get(@CurrentUser() user: AuthedUser) {
    if (!user.orgId) {
      throw new ForbiddenException({ error: { code: 'AUTH_ORG_REQUIRED', message: '当前账号未关联机构' } })
    }
    return { success: true as const, data: await this.licenses.getPartnerView(user.orgId) }
  }
}
