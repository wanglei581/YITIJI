import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { MemberDataRequestService } from './member-data-request.service'
import type { MemberDataRequestStatus, MemberDataRequestType } from './member-privacy.types'

class AdminDataRequestQueryDto {
  @IsOptional() @IsIn(['pending', 'handling', 'ready', 'completed', 'expired', 'failed', 'rejected', 'cancelled'])
  status?: MemberDataRequestStatus

  @IsOptional() @IsIn(['export', 'delete', 'revoke_consent'])
  requestType?: MemberDataRequestType

  @IsOptional() @IsString() @MaxLength(512)
  cursor?: string

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number
}

class RejectDataRequestDto {
  @IsString() @MaxLength(200)
  reason!: string
}

@Controller('admin/member-privacy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminMemberPrivacyController {
  constructor(private readonly requests: MemberDataRequestService) {}

  @Get('data-requests')
  async list(@Query() query: AdminDataRequestQueryDto) {
    return ApiResponse.ok(await this.requests.listForAdmin(query))
  }

  @Post('data-requests/:id/retry')
  async retry(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
  ) {
    return ApiResponse.ok(await this.requests.retry(id, user.userId))
  }

  @Post('data-requests/:id/reject')
  async reject(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: RejectDataRequestDto,
  ) {
    return ApiResponse.ok(await this.requests.reject(id, user.userId, dto.reason))
  }
}
