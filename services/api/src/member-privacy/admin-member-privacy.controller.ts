import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { MemberPrivacyService } from './member-privacy.service'
import type { MemberDataRequestStatus } from './member-privacy.types'

class HandleDataRequestDto {
  @IsIn(['pending', 'handling', 'completed', 'rejected'])
  status!: MemberDataRequestStatus

  @IsOptional() @IsString() @MaxLength(120)
  auditRef?: string
}

@Controller('admin/member-privacy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminMemberPrivacyController {
  constructor(private readonly privacy: MemberPrivacyService) {}

  @Get('data-requests')
  async list(@Query('status') status?: string) {
    return ApiResponse.ok(await this.privacy.listDataRequestsForAdmin(status))
  }

  @Patch('data-requests/:id')
  async handle(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: HandleDataRequestDto,
  ) {
    return ApiResponse.ok(await this.privacy.handleDataRequest(id, {
      status: dto.status,
      handledBy: user.userId,
      auditRef: dto.auditRef ?? null,
    }))
  }
}
