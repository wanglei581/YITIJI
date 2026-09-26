import { Controller, ForbiddenException, Get, Param, Query, UseGuards } from '@nestjs/common'
import type { ScreenSnapshot, ScreenTerminalTwin } from './console-screen.types'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { PartnerScreenQueryDto } from './console-screen.dto'
import { PartnerOrgRequiredError, requirePartnerOrgId } from './console-screen.org'
import { ConsoleScreenService } from './console-screen.service'

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerScreenController {
  constructor(private readonly screen: ConsoleScreenService) {}

  /**
   * GET /partner/screen/snapshot
   *
   * orgId 只来自 JwtAuthGuard 回源后的 AuthedUser（JWT sub → User.orgId）。
   * 不读 query/body，也不采信 JWT payload 里的 orgId 声明。
   * 响应保持裸对象，与 /partner/stats 同模块信封裁定一致。
   */
  @Get('partner/screen/snapshot')
  getPartnerSnapshot(
    @CurrentUser() user: AuthedUser,
    @Query() _query: PartnerScreenQueryDto,
  ): Promise<ScreenSnapshot> {
    try {
      return this.screen.getPartnerSnapshot(requirePartnerOrgId(user.orgId))
    } catch (error) {
      if (error instanceof PartnerOrgRequiredError) {
        throw new ForbiddenException({
          error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' },
        })
      }
      throw error
    }
  }

  /**
   * 机构端单台孪生。orgId 只来自当前用户。
   * 别家终端与不存在终端同一 404，响应体不包含对方编号。
   */
  @Get('partner/screen/terminals/:terminalId')
  getPartnerTerminalTwin(
    @CurrentUser() user: AuthedUser,
    @Param('terminalId') terminalId: string,
  ): Promise<ScreenTerminalTwin> {
    try {
      return this.screen.getPartnerTerminalTwin(requirePartnerOrgId(user.orgId), terminalId)
    } catch (error) {
      if (error instanceof PartnerOrgRequiredError) {
        throw new ForbiddenException({
          error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' },
        })
      }
      throw error
    }
  }
}
