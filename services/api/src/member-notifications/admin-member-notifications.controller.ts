import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common'
import type { AdminBroadcastItem } from './member-notifications.types'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { CreateBroadcastDto } from './dto/member-notifications.dto'
import { MemberNotificationsService } from './member-notifications.service'

@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminMemberNotificationsController {
  constructor(private readonly notifications: MemberNotificationsService) {}

  @Get('broadcasts')
  async listBroadcasts(): Promise<ApiResponse<{ items: AdminBroadcastItem[] }>> {
    return ApiResponse.ok(await this.notifications.listBroadcasts())
  }

  @Post('broadcasts')
  async createBroadcast(
    @CurrentUser() admin: AuthedUser,
    @Body() dto: CreateBroadcastDto,
  ): Promise<ApiResponse<AdminBroadcastItem>> {
    return ApiResponse.ok(await this.notifications.createBroadcast(admin, dto))
  }

  @Delete('broadcasts/:id')
  async deleteBroadcast(
    @CurrentUser() admin: AuthedUser,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    return ApiResponse.ok(await this.notifications.deleteBroadcast(admin, id))
  }
}
