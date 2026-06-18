import { Controller, Delete, Get, Param, Patch, Query, UseGuards } from '@nestjs/common'
import type { MemberNotificationItem, MemberNotificationPage } from './member-notifications.types'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { parseMemberPageQuery } from '../common/utils/member-page'
import { MemberNotificationsService } from './member-notifications.service'

@Controller('me/notifications')
@UseGuards(EndUserAuthGuard)
export class MemberNotificationsController {
  constructor(private readonly notifications: MemberNotificationsService) {}

  @Get()
  async list(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ): Promise<ApiResponse<MemberNotificationPage>> {
    const page = parseMemberPageQuery(cursor, pageSize)
    return ApiResponse.ok(await this.notifications.listForEndUser(user.endUserId, {
      ...page,
      unreadOnly: unreadOnly === '1' || unreadOnly === 'true',
    }))
  }

  @Patch('read-all')
  async readAll(@CurrentEndUser() user: AuthedEndUser): Promise<ApiResponse<{ updated: number }>> {
    return ApiResponse.ok(await this.notifications.markAllRead(user.endUserId))
  }

  @Patch(':kind/:id/read')
  async read(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ): Promise<ApiResponse<MemberNotificationItem>> {
    return ApiResponse.ok(kind === 'broadcast'
      ? await this.notifications.markBroadcastRead(user.endUserId, id)
      : await this.notifications.markPersonalRead(user.endUserId, id))
  }

  @Delete(':kind/:id')
  async remove(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    return ApiResponse.ok(kind === 'broadcast'
      ? await this.notifications.dismissBroadcast(user.endUserId, id)
      : await this.notifications.deletePersonal(user.endUserId, id))
  }
}
