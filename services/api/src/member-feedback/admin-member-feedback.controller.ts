import { Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
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
    @Query('submitterType') submitterType?: string,
  ): Promise<ApiResponse<{ items: AdminFeedbackTicketItem[]; total: number }>> {
    return ApiResponse.ok(await this.feedback.listForAdmin({ status, category, submitterType }))
  }

  @Get(':id')
  async get(
    @CurrentUser() admin: AuthedUser,
    @Param('id') id: string,
  ): Promise<ApiResponse<AdminFeedbackTicketDetail>> {
    return ApiResponse.ok(await this.feedback.getForAdmin(admin, id))
  }

  /** C3：查看 AI 内容投诉提交人留的完整号码。用 POST：每次都要留痕，不该被缓存或预取；限流防批量拉取。 */
  @Post(':id/contact-phone')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Header('Cache-Control', 'no-store')
  async revealContactPhone(
    @CurrentUser() admin: AuthedUser,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ phone: string }>> {
    return ApiResponse.ok(await this.feedback.revealContactPhoneForAdmin(admin, id))
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
