import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import type { ScreenSnapshot, ScreenTerminalTwin } from './console-screen.types'
import { Roles } from '../common/decorators/roles.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AdminScreenQueryDto } from './console-screen.dto'
import { ConsoleScreenService } from './console-screen.service'

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminScreenController {
  constructor(private readonly screen: ConsoleScreenService) {}

  /**
   * 领导/客户展示 = 已登录 admin 后台会话。不签发公开只读令牌。
   * `?mode=` / `?token=` 不在白名单，forbidNonWhitelisted 直接 400。
   */
  @Get('admin/screen/snapshot')
  async getAdminSnapshot(@Query() query: AdminScreenQueryDto): Promise<ApiResponse<ScreenSnapshot>> {
    return ApiResponse.ok(await this.screen.getAdminSnapshot(query.profile))
  }

  /** 单台终端孪生。与快照同一登录会话，不另开公开入口。 */
  @Get('admin/screen/terminals/:terminalId')
  async getAdminTerminalTwin(@Param('terminalId') terminalId: string): Promise<ApiResponse<ScreenTerminalTwin>> {
    return ApiResponse.ok(await this.screen.getAdminTerminalTwin(terminalId))
  }
}
