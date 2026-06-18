import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import type { AdminFeedbackTicketDetail, AdminFeedbackTicketItem } from './member-feedback.types'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AddFeedbackReplyDto, UpdateFeedbackStatusDto } from './dto/member-feedback.dto'
import { MemberFeedbackService } from './member-feedback.service'

@Controller('admin/feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminMemberFeedbackController {
  constructor(private readonly feedback: MemberFeedbackService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('category') category?: string,
  ): Promise<ApiResponse<{ items: AdminFeedbackTicketItem[] }>> {
    return ApiResponse.ok(await this.feedback.listForAdmin({ status, category }))
  }

  @Get(':id')
  async get(
    @CurrentUser() admin: AuthedUser,
    @Param('id') id: string,
  ): Promise<ApiResponse<AdminFeedbackTicketDetail>> {
    return ApiResponse.ok(await this.feedback.getForAdmin(admin, id))
  }

  @Post(':id/replies')
  async reply(
    @CurrentUser() admin: AuthedUser,
    @Param('id') id: string,
    @Body() dto: AddFeedbackReplyDto,
  ): Promise<ApiResponse<AdminFeedbackTicketDetail>> {
    return ApiResponse.ok(await this.feedback.addAdminReply(admin, id, dto))
  }

  @Patch(':id/status')
  async status(
    @CurrentUser() admin: AuthedUser,
    @Param('id') id: string,
    @Body() dto: UpdateFeedbackStatusDto,
  ): Promise<ApiResponse<AdminFeedbackTicketDetail>> {
    return ApiResponse.ok(await this.feedback.updateAdminStatus(admin, id, dto))
  }
}
