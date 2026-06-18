import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import type { MemberFeedbackPage, MemberFeedbackTicketDetail } from './member-feedback.types'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { parseMemberPageQuery } from '../common/utils/member-page'
import { AddFeedbackReplyDto, CreateFeedbackDto } from './dto/member-feedback.dto'
import { MemberFeedbackService } from './member-feedback.service'

@Controller('me/feedback')
@UseGuards(EndUserAuthGuard)
export class MemberFeedbackController {
  constructor(private readonly feedback: MemberFeedbackService) {}

  @Get()
  async list(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ApiResponse<MemberFeedbackPage>> {
    return ApiResponse.ok(await this.feedback.listForEndUser(user.endUserId, parseMemberPageQuery(cursor, pageSize)))
  }

  @Post()
  async create(
    @CurrentEndUser() user: AuthedEndUser,
    @Body() dto: CreateFeedbackDto,
  ): Promise<ApiResponse<MemberFeedbackTicketDetail>> {
    return ApiResponse.ok(await this.feedback.create(user.endUserId, dto))
  }

  @Get(':id')
  async get(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('id') id: string,
  ): Promise<ApiResponse<MemberFeedbackTicketDetail>> {
    return ApiResponse.ok(await this.feedback.getForEndUser(user.endUserId, id))
  }

  @Post(':id/replies')
  async reply(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('id') id: string,
    @Body() dto: AddFeedbackReplyDto,
  ): Promise<ApiResponse<MemberFeedbackTicketDetail>> {
    return ApiResponse.ok(await this.feedback.addUserReply(user.endUserId, id, dto))
  }

  @Patch(':id/close')
  async close(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('id') id: string,
  ): Promise<ApiResponse<MemberFeedbackTicketDetail>> {
    return ApiResponse.ok(await this.feedback.closeByEndUser(user.endUserId, id))
  }
}
