import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AdminMemberBenefitsService } from './admin-member-benefits.service'
import { GrantBenefitDto, RevokeBenefitDto, SearchEndUserByPhoneDto } from './dto/admin-member-benefits.dto'

@Controller('admin/member-benefits')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminMemberBenefitsController {
  constructor(private readonly service: AdminMemberBenefitsService) {}

  // 兼容旧后台前端；带手机号的查询改走 POST /admin/member-benefits/users/search，网址不放手机号。
  @Get('users')
  @Header('Cache-Control', 'no-store')
  async searchUsers(@Query() query: SearchEndUserByPhoneDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.service.searchEndUsersByPhone(user, query.phone))
  }

  @Post('users/search')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async searchUsersPost(@Body() dto: SearchEndUserByPhoneDto, @CurrentUser() user: AuthedUser) {
    return this.searchUsers(dto, user)
  }

  @Get()
  async list(@Query('endUserId') endUserId: string) {
    return ApiResponse.ok(await this.service.listForEndUser(endUserId))
  }

  @Post()
  async grant(@Body() dto: GrantBenefitDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.service.grant(user, dto))
  }

  @Patch(':id/revoke')
  async revoke(@Param('id') id: string, @Body() dto: RevokeBenefitDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.service.revoke(user, id, dto))
  }
}
