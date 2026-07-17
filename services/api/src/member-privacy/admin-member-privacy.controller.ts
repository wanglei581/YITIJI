import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common'
import { IsIn } from 'class-validator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { MemberDataRequestService } from './member-data-request.service'

class RejectDataRequestDto {
  @IsIn(['rejected'])
  status!: 'rejected'
}

@Controller('admin/member-privacy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminMemberPrivacyController {
  constructor(private readonly requests: MemberDataRequestService) {}

  @Get('data-requests')
  async list(@Query('status') status?: string) {
    return ApiResponse.ok(await this.requests.listDataRequestsForAdmin(status))
  }

  @Patch('data-requests/:id')
  async handle(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: RejectDataRequestDto,
  ) {
    return ApiResponse.ok(await this.requests.rejectExportRequest(id, user.userId, dto.status))
  }
}
